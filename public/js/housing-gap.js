/* housing-gap.js — client-side cost-burden & gap-by-price-point analysis.
   Bundles store RAW ACS counts; all affordability math runs here so the
   calculator's assumptions recompute the gap live. window.HousingGap.render(...) */
(function () {
  'use strict';

  // ---- palette — resolved from src/styles/tokens.css (EIG); hex fallbacks = token values ----
  const CS = getComputedStyle(document.documentElement);
  const tok = (n, f) => ((CS.getPropertyValue(n) || '').trim() || f);
  const C = {
    ink:    tok('--color-navy',     '#231f20'),  // charcoal — headings, primary series
    accent: tok('--color-gold',     '#f7941e'),  // EIG orange — secondary series, rules
    alert:  tok('--color-brick',    '#a8432f'),  // shortage / severe burden
    warn:   tok('--color-orange-d', '#c9740f'),  // moderate burden
    ok:     tok('--color-green',    '#3f7d52'),  // surplus / live data
    muted:  tok('--text-muted',     '#6d6e71'),
    faint:  tok('--color-faint',    '#a7a9ac'),
  };

  // ---- ACS bracket / band edge definitions (match build-analysis-geo.mjs) ----
  const REN_INC = [ // B25074 income brackets: [lower, upper, label]
    [0,10000,'<$10k'],[10000,20000,'$10–20k'],[20000,35000,'$20–35k'],
    [35000,50000,'$35–50k'],[50000,75000,'$50–75k'],[75000,100000,'$75–100k'],[100000,Infinity,'$100k+']];
  const OWN_INC = [ // B25095 income brackets
    [0,10000,'<$10k'],[10000,20000,'$10–20k'],[20000,35000,'$20–35k'],[35000,50000,'$35–50k'],
    [50000,75000,'$50–75k'],[75000,100000,'$75–100k'],[100000,150000,'$100–150k'],[150000,Infinity,'$150k+']];
  const OWNHH_INC = [ // B25118 owner-occupied income brackets (for owner demand)
    [0,5000],[5000,10000],[10000,15000],[15000,20000],[20000,25000],[25000,35000],
    [35000,50000],[50000,75000],[75000,100000],[100000,150000],[150000,Infinity]];
  const RENT_BANDS = [ // B25063 cash-rent bands 003..026
    [0,99],[100,149],[150,199],[200,249],[250,299],[300,349],[350,399],[400,449],[450,499],
    [500,549],[550,599],[600,649],[650,699],[700,749],[750,799],[800,899],[900,999],
    [1000,1249],[1250,1499],[1500,1999],[2000,2499],[2500,2999],[3000,3499],[3500,6000]];
  const VAL_BANDS = [ // B25075 value bands 002..027
    [0,9999],[10000,14999],[15000,19999],[20000,24999],[25000,29999],[30000,34999],[35000,39999],
    [40000,49999],[50000,59999],[60000,69999],[70000,79999],[80000,89999],[90000,99999],
    [100000,124999],[125000,149999],[150000,174999],[175000,199999],[200000,249999],[250000,299999],
    [300000,399999],[400000,499999],[500000,749999],[750000,999999],[1000000,1499999],
    [1500000,1999999],[2000000,3000000]];

  const B122_BANDS = [ // B25122's 13 closed gross-rent bands; its 14th is open-ended "$2,000 or more"
    [0,99],[100,199],[200,299],[300,399],[400,499],[500,599],[600,699],[700,799],
    [800,899],[900,999],[1000,1249],[1250,1499],[1500,1999]];
  const B122_TOP = 2000;
  // The renter-income top bracket is open-ended ($100k+). Once 120% AMI clears $100k we have
  // to interpolate inside it, so model it as $100k–$300k rather than dropping it entirely.
  const TOP_INC = 300000;
  const REN_INC_CAP = REN_INC.map(b => [b[0], isFinite(b[1]) ? b[1] : TOP_INC]);

  // Rental-gap price points run on the AMI LADDER so this chart shares a ruler with the CHAS
  // block below it (which is already in AMI tiers). Fixed dollar cuts were geography-blind —
  // $20k means something entirely different in Muscogee than in San Francisco. Geographies with
  // no HUD AMI match fall back to the old dollar tiers.
  const AMI_TIERS = [0.30,0.50,0.80,1.20];
  const REN_TIERS = [20000,35000,50000,75000];   // fallback only
  const OWN_TIERS = [35000,50000,75000,100000];
  function renTiers(model){
    const a = model.ami;
    if(a && a.ami) return AMI_TIERS.map(p=>({cut:Math.round(a.ami*p), pctAmi:p}));
    return REN_TIERS.map(c=>({cut:c, pctAmi:null}));
  }
  const tierLabel = t => t.pctAmi!=null ? `≤ ${Math.round(t.pctAmi*100)}% AMI` : `≤ ${fmt$(t.cut)}`;

  const fmt$ = x => '$' + Math.round(x).toLocaleString();
  const fmtN = x => Math.round(x).toLocaleString();
  const pct = x => (x*100).toFixed(1) + '%';
  const fmt$r = x => '$' + (Math.round(x/100)*100).toLocaleString();   // rounded to $100, for price ranges

  // cumulative count in `bands` (array of [lo,hi]) with paired counts, price <= X, interpolated
  function cumLE(bands, counts, X) {
    let t = 0;
    for (let i=0;i<bands.length;i++){
      const [lo,hi]=bands[i], n=counts[i]||0;
      if (hi <= X) t += n;
      else if (lo > X) continue;
      else t += n * Math.max(0, Math.min(1, (X-lo)/(hi-lo+1)));
    }
    return t;
  }
  const sum = a => a.reduce((x,y)=>x+(y||0),0);
  const inBand = (bands, counts, lo, hi) => cumLE(bands, counts, hi) - cumLE(bands, counts, lo);

  // B25122's top rent band is open-ended at $2,000+, which swallows the whole workforce range in
  // expensive metros. Use B25063's finer $2,000+ shape ([2000,2499]…[3500,6000]) to work out what
  // share of that open band falls inside [lo,hi], then apply it to each income bracket.
  function topBandShare(rentBands, lo, hi){
    if(hi <= B122_TOP) return 0;
    const tb=[], tc=[];
    RENT_BANDS.forEach((b,i)=>{ if(b[0]>=B122_TOP){ tb.push(b); tc.push(rentBands[i]||0); } });
    const denom=sum(tc);
    if(!denom) return 1;   // no tail detail — treat the open band as fully in range
    return Math.max(0, Math.min(1, inBand(tb, tc, Math.max(lo,B122_TOP), hi)/denom));
  }

  // ---- workforce housing band: 80–120% of HUD area median family income (4-person) ----
  // Affordable AND available. B25063's fine rent bands give the affordable COUNT; B25122
  // (renter income x gross rent) gives only the availability RATIO — the share of units
  // renting in the workforce range that are NOT already occupied by households above the
  // 120% AMI ceiling. Same idea as CHAS "affordable and available", computed from ACS so it
  // recomputes live as the assumption sliders move.
  //
  // TWO ANCHORS, DELIBERATELY. workforceBand() is the pure math; the two wrappers below feed it
  // different income edges. HUD AMI is a REGULATORY threshold (regional, family-based, 4-person,
  // capped and floored) and local MHI is a DESCRIPTIVE one (this jurisdiction, all households).
  // They disagree on the SIGN of the gap in 26% of geographies and by >2x in 41%, so the page
  // must never show one without the other. See the memo in project memory.
  function workforceBand(model, A, lo, hi){
    if(!model.rentByInc || !(hi > lo)) return null;
    const rLo=affordRent(lo,A), rHi=affordRent(hi,A);
    const hh = inBand(REN_INC_CAP, model.ren.total, lo, hi);
    const affordable = inBand(RENT_BANDS, model.rentBands, rLo, rHi);
    const tShare = topBandShare(model.rentBands, rLo, rHi);
    const perInc = model.rentByInc.map(row =>
      inBand(B122_BANDS, row.slice(0,13), rLo, Math.min(rHi,B122_TOP)) + (row[13]||0)*tShare);
    const tot122 = sum(perInc);
    let above = 0;
    perInc.forEach((n,i)=>{
      const bl=REN_INC_CAP[i][0], bh=REN_INC_CAP[i][1];
      const leShare = bh<=hi ? 1 : (bl>hi ? 0 : Math.max(0, Math.min(1, (hi-bl)/(bh-bl+1))));
      above += n*(1-leShare);
    });
    const availRatio = tot122>0 ? Math.max(0, Math.min(1, 1-above/tot122)) : 1;   // no B25122 units in the window (tiny geos): no availability discount
    const available = availRatio==null ? null : affordable*availRatio;
    return {
      lo: Math.round(lo), hi: Math.round(hi), rLo, rHi,
      hh: Math.round(hh),
      affordable: Math.round(affordable),
      available: available==null ? null : Math.round(available),
      occupiedAbove: Math.round(above),
      availRatio, ratioNA: tot122 === 0, topModeled: hi > 100000,
      shortage: available==null ? null : Math.round(hh-available),
      priceLo: affordPrice(lo,A), priceHi: affordPrice(hi,A),
    };
  }

  // Anchor A — HUD AMI. What housing PROGRAMS target: LIHTC, HOME, CDBG, inclusionary zoning
  // and density bonuses all key off this, so it is the number that reconciles with other
  // consultants' work. Band = HUD's published 4-person 80% limit up to 120% of the implied AMI.
  function workforce(model, A){
    const ami = model.ami;
    if(!ami || !ami.a80 || !ami.a120) return null;
    const w = workforceBand(model, A, ami.a80, ami.a120);
    if(!w) return null;
    w.basis='ami'; w.label='HUD AMI'; w.area=ami.area; w.ami=ami.ami; w.l80=ami.l80;
    return w;
  }

  // Anchor B — local median household income. What RESIDENTS experience: can the people who
  // actually live here afford what is here. Same 80–120% width, anchored on this jurisdiction.
  function workforceLocal(model, A){
    if(!model.mhi || model.mhi <= 0) return null;
    const w = workforceBand(model, A, model.mhi*0.8, model.mhi*1.2);
    if(!w) return null;
    w.basis='mhi'; w.label='Local median household income'; w.mhi=model.mhi;
    return w;
  }

  // Anchor C — WAHI, working-age household income. What the local WORKFORCE earns, once
  // retiree- and student-headed households are out of the median. Shown everywhere, not as
  // an exception: WAHI exceeds MHI in nearly every community (national median 1.16×), and
  // the size of that gap does NOT predict whether it changes the answer — re-anchoring flips
  // the sign of the gap in ~10% of places in every ratio band, including below-average ones.
  function workforceWorking(model, A){
    if(!model.wahi || model.wahi <= 0) return null;
    const w = workforceBand(model, A, model.wahi*0.8, model.wahi*1.2);
    if(!w) return null;
    w.basis='wahi'; w.label='Working-age household income';
    w.wahi=model.wahi; w.wr=model.wahiRatio; w.s65=model.s65; w.su25=model.su25; w.rel=model.wahiRel;
    return w;
  }

  // ---- affordability math ----
  function mortConst(rate){ const r=rate/12, n=360; return r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1); }
  function affordRent(income, A){ return A.front*income/12; }
  function affordPrice(income, A){
    const budget=A.front*income/12;
    const denom=(1-A.down)*(mortConst(A.rate)+A.pmi/12)+A.ti/12;
    return budget/denom;
  }

  // ---- compute everything for one geography given assumptions ----
  function compute(model, A){
    const m=model;
    // cost-burden summary
    const renT=sum(m.ren.total), renB=sum(m.ren.burd), renS=sum(m.ren.sev);
    const ownT=sum(m.own.total), ownB=sum(m.own.burd), ownS=sum(m.own.sev);
    // affordability conversion table (representative incomes)
    const incs=[15000,30000,50000,62500,87500,125000];
    const afford=incs.map(i=>({income:i, budget:A.front*i/12, rent:affordRent(i,A), price:affordPrice(i,A)}));
    // rental gap by tier (AMI ladder where available)
    const rentGap=renTiers(m).map(t=>{
      const cut=t.cut;
      // REN_INC_CAP, not REN_INC: on the AMI ladder these cuts routinely clear $100k, and the
      // open-ended top bracket would contribute zero, flatlining the 80% and 120% tiers.
      const hh=cumLE(REN_INC_CAP, m.ren.total, cut);
      const aff=affordRent(cut,A);
      const units=cumLE(RENT_BANDS, m.rentBands, aff);
      return {cut, pctAmi:t.pctAmi, aff, hh:Math.round(hh), units:Math.round(units), gap:Math.round(hh-units)};
    });
    // ownership supply by tier
    const ownGap=OWN_TIERS.map(cut=>{
      const hh=cumLE(OWNHH_INC, m.ownInc, cut);
      const price=affordPrice(cut,A);
      const units=cumLE(VAL_BANDS, m.valBands, price);
      return {cut, price, hh:Math.round(hh), units:Math.round(units)};
    });
    const peak=rentGap.reduce((a,b)=>b.gap>a.gap?b:a, rentGap[0]);
    const wf=workforce(m,A), wfLocal=workforceLocal(m,A), wfWork=workforceWorking(m,A);
    // divergence between the two anchors — drives the caution flag
    const ratio = (wf && m.mhi>0) ? wf.ami/m.mhi : null;
    const bandShare = (wf && renT>0) ? wf.hh/renT : null;
    // Flag on what actually misleads: the two anchors reaching OPPOSITE conclusions, or an AMI so
    // far from local incomes that the band describes a population that barely exists here.
    // Fires on ~29% of geographies; a looser rule fired on 40% and stopped meaning anything.
    const signSplit = !!(wf && wfLocal && wf.shortage!=null && wfLocal.shortage!=null && (wf.shortage>0)!==(wfLocal.shortage>0));
    const diverges = !!(signSplit || (ratio!=null && (ratio>2.0 || ratio<0.80)));
    // How far the WAHI anchor moves the answer, per 1,000 renter households. Deliberately NOT
    // a percentage of the MHI-anchored gap — that gap is often near zero, so a percentage is
    // unstable and produces absurd numbers (Muscogee GA: +325 → +1,974 reads as "507%", when
    // it is really 41 units per 1,000 renters, the 78th percentile nationally).
    const wahiShift = (wfWork && wfLocal && wfWork.shortage!=null && wfLocal.shortage!=null && renT>0)
      ? (wfWork.shortage - wfLocal.shortage)/renT*1000 : null;
    return {renT,renB,renS,ownT,ownB,ownS, afford, rentGap, ownGap, peak, wf, wfLocal, wfWork, ratio, bandShare, signSplit, diverges, wahiShift};
  }

  // ---- rendering ----
  function tile(v,l,alert,sub,small){ return `<div class="hg-tile${alert?' hg-alert':''}"><div class="hg-tv${small?' hg-tv--sm':''}">${v}</div><div class="hg-tl">${l}</div>${sub?`<div class="hg-ts">${sub}</div>`:''}</div>`; }

  // ---- the two-anchor panel: same calculation, two income definitions, side by side ----
  function anchorCard(w, kind, A){
    if(!w || w.shortage==null) return '';
    const short=w.shortage>0;
    const basisLine = kind==='ami'
      ? `HUD AMI ${fmt$(w.ami)} — 4-person family median${w.area?', '+w.area:''}`
      : kind==='wahi'
      ? `WAHI ${fmt$(w.wahi)} — households headed 25–64${w.wr?', '+w.wr.toFixed(2)+'× local median':''}`
      : `Median household income ${fmt$(w.mhi)} — this jurisdiction, all households`;
    const kick = kind==='ami' ? 'Program threshold' : kind==='wahi' ? 'Workforce earnings' : 'Local affordability';
    return '<div class="hg-anchor hg-anchor--'+kind+'">'+
      '<div class="hg-akick">'+kick+'</div>'+
      '<div class="hg-atitle">'+w.label+'</div>'+
      '<div class="hg-abasis">'+basisLine+'</div>'+
      '<div class="hg-av" style="color:'+(short?C.alert:C.ok)+'">'+(short?'+':'')+fmtN(w.shortage)+'</div>'+
      '<div class="hg-al">rental units '+(short?'short':'surplus')+' at 80–120% of this anchor</div>'+
      '<dl class="hg-adl">'+
        '<div><dt>Income band</dt><dd>'+fmt$(w.lo)+'–'+fmt$(w.hi)+'</dd></div>'+
        '<div><dt>Supports rent of</dt><dd>'+fmt$(w.rLo)+'–'+fmt$(w.rHi)+'/mo</dd></div>'+
        '<div><dt>Renter households in band</dt><dd>'+fmtN(w.hh)+'</dd></div>'+
        '<div><dt>Affordable &amp; available</dt><dd>'+fmtN(w.available)+'</dd></div>'+
        '<div><dt>Affordable home price</dt><dd>'+fmt$r(w.priceLo)+'–'+fmt$r(w.priceHi)+'</dd></div>'+
      '</dl>'+
      (kind==='wahi' && w.rel===0
        ? '<p class="hg-athin">Thin sample — too few households here for a reliable age &times; income cross-tab. Treat the WAHI figure as indicative.</p>'
        : '')+
      '</div>';
  }

  function anchorPanel(c, A){
    if(!c.wf && !c.wfLocal && !c.wfWork) return '';
    const w=c.wf, l=c.wfLocal, x=c.wfWork;
    let recon='';
    if(w && c.ratio!=null){
      const x=c.ratio, hi=x>=1;
      recon = 'HUD sets this area\'s AMI at <b>'+fmt$(w.ami)+'</b>'+(w.area?' ('+w.area+' — a 4-person <i>family</i> median for the whole area)':'')+
        '. This jurisdiction\'s own median household income is <b>'+fmt$(l?l.mhi:0)+'</b>, '+
        (Math.abs(x-1)<0.03 ? 'essentially the same' : (hi? x.toFixed(2)+'× lower' : (1/x).toFixed(2)+'× higher'))+
        '. The AMI band above covers <b>'+(c.bandShare!=null?pct(c.bandShare):'—')+'</b> of the renter households who actually live here.';
    }
    const flag = c.diverges
      ? '<p class="hg-flag"><b>'+(c.signSplit
          ? 'These two anchors reach opposite conclusions here — one shows a shortage, the other a surplus.'
          : 'HUD\'s AMI is far from local incomes here.')+'</b> The AMI figure is a regional program threshold, not a description of local incomes; quoting it on its own will mislead a local reader. Use the AMI number when the audience is a funder, a developer pro forma or an ordinance. Use the local-income number when the question is whether the people who live here can afford to stay. Say which one you are citing.</p>'
      : '';
    // Per-geography WAHI reconciliation: what taking retirees and students out of the
    // median actually does here, and what that does to the answer.
    let wrecon='';
    if(x && l && x.wahi>0){
      wrecon = 'Households headed by someone <b>65 or older are '+(x.s65!=null?x.s65.toFixed(1)+'%':'—')+'</b> of households here'+
        (x.su25!=null && x.su25>=5 ? ', and those headed by someone under 25 are <b>'+x.su25.toFixed(1)+'%</b>' : '')+
        '. Taking both out of the median moves it from <b>'+fmt$(l.mhi)+'</b> to <b>'+fmt$(x.wahi)+'</b>'+
        (x.wr?' ('+x.wr.toFixed(2)+'×, against a national median of 1.16×)':'')+'. '+
        (c.wahiShift!=null
          ? 'Run against the same rent stock, that shifts the gap by <b>'+(c.wahiShift>0?'+':'')+c.wahiShift.toFixed(0)+' units per 1,000 renter households</b> (national median 15).'
          : '');
    }
    return '<h3 class="hg-h3">Three income anchors — and why they disagree <span class="hg-pill">read all three</span></h3>'+
      '<p class="hg-sub">The same shortage calculation, run against the three income definitions this field uses: what programs fund, what the workforce earns, and what all residents earn. Nationally the first two disagree on the <i>direction</i> of the gap in 26% of communities and by more than 2× in 41%; adding the workforce anchor changes the direction again in a further 11%. None is wrong — they answer different questions.</p>'+
      // Order is deliberate: AMI (the program threshold) → WAHI (what the
      // workforce earns) → MHI (what all residents earn). WAHI sits in the
      // middle because it is the measure that reconciles the outer two.
      '<div class="hg-anchors">'+anchorCard(w,'ami',A)+anchorCard(x,'wahi',A)+anchorCard(l,'mhi',A)+'</div>'+
      (recon?'<p class="hg-recon">'+recon+'</p>':'')+
      (wrecon?'<p class="hg-recon">'+wrecon+'</p>':'')+ flag +
      '<p class="hg-note"><b>On working-age household income (WAHI).</b> WAHI is the median income of households <i>headed by</i> someone aged 25–64, computed from ACS table B19037 (age of householder × household income). It is <i>not</i> the income of working-age adults: ACS classifies an entire household by the age of one reference person, so a 70-year-old still working is excluded, and a retired parent living in a 45-year-old\'s household is counted in full. Read it as <i>what households run by working-age people earn here</i>. WAHI is higher than the local median household income in almost every community — nationally by a median of <b>1.16×</b> — because retiree- and student-headed households sit below both. Judge this area\'s figure against that 1.16 norm, not against 1.00. Use it when the question is whether the people who <i>work</i> here can afford to live here; use local median household income when the question is about all residents, retirees included.</p>'+
      '<p class="hg-note"><b>On area median income.</b> HUD\'s AMI is a regulatory threshold, not a local statistic: it is a <i>family</i> median for an entire metro or HUD-defined area, adjusted to a 4-person household, and subject to statutory high-housing-cost adjustments and rural floors. It is higher than the local median household income in 92% of U.S. communities, and more than 1.5× higher in 38%. Figures anchored on AMI describe <i>program eligibility</i>; figures anchored on local median household income describe <i>local affordability</i>. Both are shown above, and they will not agree.</p>';
  }

  function matrixRows(model){
    let html='';
    REN_INC.forEach((bi,i)=>{
      const rt=model.ren.total[i],rb=model.ren.burd[i],rs=model.ren.sev[i];
      const rr=rt?rb/rt:0;
      const rc=rr>=0.5?C.alert:(rr>=0.3?C.warn:C.muted);
      // owner cell — owners have 8 brackets; map first 6 directly, collapse last for 100k+ display
      let ownCells;
      if(i<6){ const ot=model.own.total[i],ob=model.own.burd[i],os=model.own.sev[i],orr=ot?ob/ot:0;
        const oc=orr>=0.5?C.alert:(orr>=0.3?C.warn:C.muted);
        ownCells=`<td class="n">${fmtN(ot)}</td><td class="n">${fmtN(ob)}</td><td class="n" style="color:${oc};font-weight:600">${pct(orr)}</td><td class="n">${fmtN(os)}</td>`;
      } else { ownCells=`<td class="n" colspan="4" style="color:${C.faint}">see $100–150k / $150k+ below</td>`; }
      html+=`<tr><td>${bi[2]}</td><td class="n">${fmtN(rt)}</td><td class="n">${fmtN(rb)}</td><td class="n" style="color:${rc};font-weight:600">${pct(rr)}</td><td class="n">${fmtN(rs)}</td>${ownCells}</tr>`;
    });
    [6,7].forEach(i=>{ const ot=model.own.total[i],ob=model.own.burd[i],os=model.own.sev[i],orr=ot?ob/ot:0;
      const oc=orr>=0.5?C.alert:(orr>=0.3?C.warn:C.muted);
      html+=`<tr><td>${OWN_INC[i][2]}</td><td class="n" colspan="4" style="color:${C.faint}">—</td><td class="n">${fmtN(ot)}</td><td class="n">${fmtN(ob)}</td><td class="n" style="color:${oc};font-weight:600">${pct(orr)}</td><td class="n">${fmtN(os)}</td></tr>`;
    });
    return html;
  }

  function gapChart(rentGap){
    const CW=680,CH=316,padL=55,padB=76,padT=20,plotW=CW-padL-20,plotH=CH-padB-padT;
    const maxv=Math.max(...rentGap.map(x=>Math.max(x.hh,x.units)))||1;
    const grpW=plotW/rentGap.length, bw=grpW*0.30;
    let bars='';
    rentGap.forEach((x,i)=>{
      const gx=padL+i*grpW+grpW*0.5;
      [[x.hh,C.ink],[x.units,C.accent]].forEach((d,j)=>{
        const h=plotH*d[0]/maxv, bx=gx-bw+j*bw, by=padT+plotH-h;
        bars+=`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${d[1]}"/>`;
        bars+=`<text x="${(bx+bw/2).toFixed(1)}" y="${(by-4).toFixed(1)}" font-size="10" text-anchor="middle" fill="${C.muted}">${fmtN(d[0])}</text>`;
      });
      bars+=`<text x="${gx.toFixed(1)}" y="${(padT+plotH+16).toFixed(1)}" font-size="11" font-weight="600" text-anchor="middle" fill="${C.ink}">${tierLabel(x)}</text>`;
      if(x.pctAmi!=null) bars+=`<text x="${gx.toFixed(1)}" y="${(padT+plotH+30).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="${C.muted}">${fmt$(x.cut)}</text>`;
      bars+=`<text x="${gx.toFixed(1)}" y="${(padT+plotH+(x.pctAmi!=null?44:30)).toFixed(1)}" font-size="9" text-anchor="middle" fill="${C.faint}">rent ${fmt$(x.aff)}</text>`;
    });
    let yaxis='';
    for(let t=0;t<=4;t++){ const yv=maxv*t/4, yy=padT+plotH-plotH*t/4;
      yaxis+=`<text x="${padL-8}" y="${(yy+3).toFixed(1)}" font-size="9" text-anchor="end" fill="${C.faint}">${fmtN(yv)}</text>`; }
    const axis=`<line x1="${padL}" y1="${padT+plotH}" x2="${CW-20}" y2="${padT+plotH}" stroke="${C.ink}"/><line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+plotH}" stroke="${C.ink}"/>`;
    return `<svg viewBox="0 0 ${CW} ${CH}" width="100%" style="max-width:${CW}px">${axis}${yaxis}${bars}</svg>`;
  }

  function renderDynamic(root, model, A){
    const c=compute(model,A);
    // affordability table
    root.querySelector('[data-afford]').innerHTML = c.afford.map(a=>
      `<tr><td class="n">${fmt$(a.income)}</td><td class="n">${fmt$(a.budget)}/mo</td><td class="n">${fmt$(a.rent)}/mo</td><td class="n" style="font-weight:600;color:${C.ink}">${fmt$(a.price)}</td></tr>`).join('');
    // rental gap chart + table
    root.querySelector('[data-gapchart]').innerHTML = gapChart(c.rentGap);
    root.querySelector('[data-gaprows]').innerHTML = c.rentGap.map(x=>{
      const col=x.gap>0?C.alert:C.ok;
      return `<tr><td><b>${tierLabel(x)}</b>${x.pctAmi!=null?` <span style="color:${C.faint}">${fmt$(x.cut)}</span>`:''}</td><td class="n">${fmt$(x.aff)}</td><td class="n">${fmtN(x.hh)}</td><td class="n">${fmtN(x.units)}</td><td class="n" style="color:${col};font-weight:700">${x.gap>0?'+':''}${fmtN(x.gap)}</td><td style="color:${col}">${x.gap>0?'short':'surplus'}</td></tr>`;
    }).join('');
    // ownership
    root.querySelector('[data-ownrows]').innerHTML = c.ownGap.map(x=>{
      const share=model.tenure.owner?x.units/model.tenure.owner*100:0;
      return `<tr><td>≤ ${fmt$(x.cut)}</td><td class="n" style="font-weight:600;color:${C.ink}">${fmt$(x.price)}</td><td class="n">${fmtN(x.hh)}</td><td class="n">${fmtN(x.units)}</td><td class="n">${share.toFixed(0)}% of stock</td></tr>`;
    }).join('');
    // headline tiles — every count is HOUSEHOLDS (ACS renter-occupied-unit universe), not people
    const w=c.wf;
    root.querySelector('[data-tiles]').innerHTML =
      tile(pct(c.renB/c.renT), 'of renter households cost-burdened (>30% of income)', true,
           `${fmtN(c.renB)} of ${fmtN(c.renT)} renter households`) +
      tile(fmtN(c.renS), 'renter households severely burdened (>50%)', false,
           `${pct(c.renS/c.renT)} of ${fmtN(c.renT)} renter households`) +
      (w && w.shortage!=null
        ? tile((w.shortage>0?'+':'')+fmtN(w.shortage), `workforce rental units ${w.shortage>0?'short':'surplus'} — 80–120% <b>HUD AMI</b> (${fmt$(w.lo)}–${fmt$(w.hi)})`, w.shortage>0,
               `${fmtN(w.available)} affordable &amp; available for ${fmtN(w.hh)} households` +
               (c.wfLocal && c.wfLocal.shortage!=null
                 ? `<br><span class="hg-alt">On local median income: <b>${c.wfLocal.shortage>0?'+':''}${fmtN(c.wfLocal.shortage)}</b></span>` : ''))
        : tile('+'+fmtN(c.peak.gap), `rental units short for households ≤ ${fmt$(c.peak.cut)} (peak)`, true,
               'HUD AMI unavailable here — showing the peak ACS price point')) +
      (w
        ? tile(`${fmt$r(w.priceLo)}–${fmt$r(w.priceHi)}`, 'affordable home price, 80–120% AMI (4-person)', false,
               `at ${fmt$(w.lo)}–${fmt$(w.hi)} household income`, true)
        : tile(fmt$(c.afford[3].price), 'affordable home price at ~$62.5k income', false));
    // workforce-band methodology line
    const wn=root.querySelector('[data-wfnote]');
    if(wn) wn.innerHTML = w
      ? `Workforce band = 80–120% AMI for a 4-person household, anchored on HUD's published FY26 low-income (80%) limit of <b>${fmt$(w.l80)}</b>${w.area?' for '+w.area:''} — so 100% AMI is ${fmt$(w.ami)} and the band runs <b>${fmt$(w.lo)}–${fmt$(w.hi)}</b>, supporting rent of <b>${fmt$(w.rLo)}–${fmt$(w.rHi)}/mo</b> at ${(A.front*100).toFixed(0)}% of income. Anchoring on the published limit carries HUD's own high-cost and rural-floor adjustments. Of ${fmtN(w.affordable)} units renting in that range, ~${fmtN(w.occupiedAbove)} are occupied by households above 120% AMI, leaving ${fmtN(w.available)} affordable <i>and available</i>.${w.topModeled?" ACS's top renter-income bracket is open-ended ($100k+); the share of it inside this band is modelled." : ''} Source: HUD Section 8 income limits; ACS 2020–2024 B25063 &amp; B25122. All counts are households, not people.`
      : 'All counts are households (ACS renter- and owner-occupied housing units), not people.';
    const gn=root.querySelector('[data-gapnote]');
    if(gn){
      const amiLadder=c.rentGap[0].pctAmi!=null, over=c.rentGap.filter(x=>x.cut>100000).length;
      gn.innerHTML = (amiLadder
        ? '<b>Price points run on the AMI ladder</b> — 30 / 50 / 80 / 120% of this area\'s HUD area median income, so this chart shares a ruler with the CHAS shortage table below. Dollar equivalents are shown under each tier.'
        : '<b>Price points run on fixed dollar tiers</b> — no HUD income limit matched this geography, so the AMI ladder is unavailable here.')
        + (over ? ' ACS\'s top renter-income bracket is open-ended ($100k+); ' + over + ' of these tiers sit inside it, so the household counts there are modelled rather than observed.' : '');
      gn.style.display = '';
    }
    // the two-anchor comparison panel (re-rendered so it tracks the sliders)
    const ap=root.querySelector('[data-anchors]');
    if(ap) ap.innerHTML = anchorPanel(c, A);
    // overlay affordability-at-median line
    const affMed=A.front*model.mhi/12;
    var mkt=model.market, mc=root.querySelector('[data-market-ctx]');
    if(mc && mkt){
      var rentInc = mkt.rent? Math.round(mkt.rent*12/A.front):null;
      var denomM=(1-A.down)*(mortConst(A.rate)+A.pmi/12)+A.ti/12;
      var priceInc = mkt.price? Math.round(mkt.price*denomM*12/A.front):null;
      mc.innerHTML = 'At today\'s market, renting the typical unit takes about <b>'+(rentInc?fmt$(rentInc):'—')+'</b> in household income; buying the median home takes about <b>'+(priceInc?fmt$(priceInc):'—')+'</b> at '+(A.rate*100).toFixed(2)+'%. This area\'s median household income is <b>'+fmt$(model.mhi)+'</b>.';
    }
    root.querySelector('[data-medline]').innerHTML =
      `A household at this area's median income (${fmt$(model.mhi)}) can afford ≈${fmt$(affMed)}/mo in rent. ACS-period median rent here was ${fmt$(model.medRent)}; median home value ${fmt$(model.medValue)}.`;
  }

  function marketPanel(mkt){
    if(!mkt) return '';
    return '<h3 class="hg-h3">Where the market is right now <span class="hg-pill hg-pill--live">live</span></h3>'+
      '<p class="hg-sub">Current asking rents, sale prices and home values — the timeliness layer. Dated and kept separate from the ACS/CHAS structural counts above.</p>'+
      '<div class="hg-market">'+
        '<div class="hg-mcard"><div class="hg-mv">'+(mkt.rent?fmt$(mkt.rent)+'/mo':'—')+'</div><div class="hg-ml">Typical asking rent, all rental types — '+(mkt.cbsaTitle||'metro')+'<br><span class="muted">Zillow ZORI · '+(mkt.rentAsOf||'')+'</span></div></div>'+
        '<div class="hg-mcard"><div class="hg-mv">'+(mkt.price?fmt$(mkt.price):'—')+'</div><div class="hg-ml">Median sale price — homes that closed<br><span class="muted">Redfin · '+(mkt.priceAsOf||'')+'</span></div></div>'+
        '<div class="hg-mcard"><div class="hg-mv">'+(mkt.hval?fmt$(mkt.hval):'—')+'</div><div class="hg-ml">Typical home value — all homes, sold or not<br><span class="muted">Zillow ZHVI · '+(mkt.hvalAsOf||'')+'</span></div></div>'+
      '</div>'+
      '<p class="hg-src" data-market-ctx></p>'+
      '<p class="hg-src">Sale price is the median of homes that actually closed, so it swings with what happened to sell; ZHVI is a modeled mid-tier value across all homes, smoothed and seasonally adjusted, so it is the steadier series for trends. ZHVI covers single-family and condo only, while the rent index also includes multifamily.</p>';
  }

  function chasSection(chas){
    const rows=[['≤ 30% AMI','Extremely low income','eli'],['≤ 50% AMI','Very low income','vli'],['≤ 80% AMI','Low income','li']]
      .map(function(t){ var c=chas[t[2]]; if(!c) return '';
        return '<tr><td><b>'+t[0]+'</b><br><span style="color:'+C.faint+';font-size:11px">'+t[1]+'</span></td>'+
          '<td class="n">'+fmtN(c.hh)+'</td><td class="n">'+fmtN(c.affordable)+'</td>'+
          '<td class="n" style="font-weight:600;color:'+C.ink+'">'+fmtN(c.affAndAvail)+'</td>'+
          '<td class="n" style="color:'+C.alert+';font-weight:700">'+(c.shortage>0?'-':'')+fmtN(Math.abs(c.shortage))+'</td></tr>';
      }).join('');
    return '<h3 class="hg-h3">Affordable <em>and available</em> — the headline shortage <span class="hg-pill">HUD CHAS · HAMFI 2018–2022</span></h3>'+
      '<p class="hg-sub">Renter units affordable to each income tier, minus those already occupied by higher-income households. This is the figure behind “City X is short N affordable units.” Source: HUD CHAS 2018–2022 (Table 15C), by HAMFI income tier. <b>Note the vintage:</b> these AMI tiers use HUD’s HAMFI for 2018–2022, while the workforce band above uses HUD’s FY2026 income limits — they are not the same AMI.</p>'+
      '<table class="hg-tbl"><thead><tr><th>Renter income (AMI)</th><th class="n">Households</th><th class="n">Affordable units</th><th class="n">Affordable &amp; available</th><th class="n">Shortage</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<p class="hg-note"><b>Why this is the credible number:</b> “available” removes affordable units occupied by higher-income renters. Look at the ≤ 80% row — there can be more <i>affordable</i> units than households, yet still a shortage once the unavailable ones are removed, which a simple affordability count misses. CHAS is 2018–2022 (HUD’s latest); the cost-burden and price-point figures above are ACS 2020–2024. (Vacant-for-rent affordable units are a small pending addition.)</p>';
  }

  function render(root, model, meta) {
    root.innerHTML = TEMPLATE(meta);
    const A = readAssumptions(root);
    renderDynamic(root, model, A);
    // wire assumption inputs
    root.querySelectorAll('[data-assump]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        root.querySelector(`[data-out="${inp.dataset.assump}"]`).textContent = inp.dataset.assump==='rate'||inp.dataset.assump==='down'||inp.dataset.assump==='ti'||inp.dataset.assump==='pmi'?(inp.value+'%'):inp.value;
        renderDynamic(root, model, readAssumptions(root));
      });
    });
  }
  function readAssumptions(root){
    const g=k=>parseFloat(root.querySelector(`[data-assump="${k}"]`).value);
    return {rate:g('rate')/100, down:g('down')/100, ti:g('ti')/100, pmi:g('pmi')/100, front:g('front')/100};
  }

  function slider(k,label,min,max,step,val,suffix){
    return `<label class="hg-assump"><span>${label}</span>
      <input type="range" data-assump="${k}" min="${min}" max="${max}" step="${step}" value="${val}">
      <output data-out="${k}">${val}${suffix}</output></label>`;
  }
  function TEMPLATE(meta){ return `
    <div class="hg-head"><span class="hg-kick">Analysis</span>
      <h2 class="hg-title">${meta.name}</h2>
      <p class="hg-sub">${meta.state_name||''} · ACS 2020–2024 5-year · existing shortage by price point</p></div>
    <div class="hg-tiles" data-tiles></div>
    <p class="hg-src" data-wfnote></p>

    <div data-anchors></div>

    <h3 class="hg-h3">Cost burden by household income &amp; tenure</h3>
    <table class="hg-tbl"><thead>
      <tr><th rowspan="2">Household income</th><th colspan="4" class="hg-grp">Renters</th><th colspan="4" class="hg-grp">Owners</th></tr>
      <tr><th class="n">Total</th><th class="n">Burdened</th><th class="n">Rate</th><th class="n">Severe</th><th class="n">Total</th><th class="n">Burdened</th><th class="n">Rate</th><th class="n">Severe</th></tr>
    </thead><tbody>${matrixRows(meta.model)}</tbody></table>
    <p class="hg-src">Source: U.S. Census Bureau, ACS 2020–2024 5-year, B25074 &amp; B25095.</p>

    <h3 class="hg-h3">Affordability calculator — income → price point</h3>
    <div class="hg-calc">
      ${slider('rate','30-yr mortgage rate',3,10,0.05,6.70,'%')}
      ${slider('down','Down payment',0,40,1,10,'%')}
      ${slider('ti','Taxes + insurance /yr',0.5,3,0.1,1.5,'%')}
      ${slider('pmi','PMI /yr of loan',0,1.5,0.05,0.5,'%')}
      ${slider('front','Housing % of income',25,40,1,30,'%')}
    </div>
    <table class="hg-tbl"><thead><tr><th class="n">Income</th><th class="n">Budget /mo</th><th class="n">Affordable rent</th><th class="n">Affordable home price</th></tr></thead><tbody data-afford></tbody></table>

    ${meta.model && meta.model.market ? marketPanel(meta.model.market) : ''}

    <div class="hg-figure" data-export-figure="Rental gap by price point">
      <h3 class="hg-h3">Rental gap by price point <span class="hg-pill">AMI ladder</span></h3>
      <p class="hg-legend"><span class="hg-sq" style="background:${C.ink}"></span>Renter households (cumulative) &nbsp; <span class="hg-sq" style="background:${C.accent}"></span>Affordable rental units (cumulative)</p>
      <div data-gapchart></div>
    </div>
    <table class="hg-tbl"><thead><tr><th>Income tier</th><th class="n">Aff. rent</th><th class="n">Renter HH</th><th class="n">Aff. units</th><th class="n">Gap</th><th></th></tr></thead><tbody data-gaprows></tbody></table>
    <p class="hg-src" data-medline></p>
    <p class="hg-note" data-gapnote></p>
    <p class="hg-note"><b>Affordable vs. affordable-and-available:</b> this counts affordable units; the headline-grade figure removes units occupied by higher-income households (shown next, from HUD CHAS). Small places carry ±10–20% ACS margins of error.</p>

    ${meta.model && meta.model.chas ? chasSection(meta.model.chas) : ''}

    <h3 class="hg-h3">Ownership: what's within reach at each income</h3>
    <table class="hg-tbl"><thead><tr><th>Income tier</th><th class="n">Aff. price</th><th class="n">Owner HH</th><th class="n">Units ≤ price</th><th class="n">Share of stock</th></tr></thead><tbody data-ownrows></tbody></table>
    <p class="hg-src">Affordable price from current-market mortgage math (adjust above); owner-unit values from ACS B25075.</p>`;
  }

  window.HousingGap = { render, compute };
})();
