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

  const REN_TIERS = [20000,35000,50000,75000];
  const OWN_TIERS = [35000,50000,75000,100000];

  const fmt$ = x => '$' + Math.round(x).toLocaleString();
  const fmtN = x => Math.round(x).toLocaleString();
  const pct = x => (x*100).toFixed(1) + '%';

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
    // rental gap by tier
    const rentGap=REN_TIERS.map(cut=>{
      const hh=cumLE(REN_INC.map(b=>[b[0],b[1]]), m.ren.total, cut);
      const aff=affordRent(cut,A);
      const units=cumLE(RENT_BANDS, m.rentBands, aff);
      return {cut, aff, hh:Math.round(hh), units:Math.round(units), gap:Math.round(hh-units)};
    });
    // ownership supply by tier
    const ownGap=OWN_TIERS.map(cut=>{
      const hh=cumLE(OWNHH_INC, m.ownInc, cut);
      const price=affordPrice(cut,A);
      const units=cumLE(VAL_BANDS, m.valBands, price);
      return {cut, price, hh:Math.round(hh), units:Math.round(units)};
    });
    const peak=rentGap.reduce((a,b)=>b.gap>a.gap?b:a, rentGap[0]);
    return {renT,renB,renS,ownT,ownB,ownS, afford, rentGap, ownGap, peak};
  }

  // ---- rendering ----
  function tile(v,l,alert){ return `<div class="hg-tile${alert?' hg-alert':''}"><div class="hg-tv">${v}</div><div class="hg-tl">${l}</div></div>`; }

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
    const CW=680,CH=300,padL=55,padB=60,padT=20,plotW=CW-padL-20,plotH=CH-padB-padT;
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
      bars+=`<text x="${gx.toFixed(1)}" y="${(padT+plotH+16).toFixed(1)}" font-size="11" text-anchor="middle" fill="${C.ink}">≤ ${fmt$(x.cut)}</text>`;
      bars+=`<text x="${gx.toFixed(1)}" y="${(padT+plotH+30).toFixed(1)}" font-size="9" text-anchor="middle" fill="${C.faint}">rent ${fmt$(x.aff)}</text>`;
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
      return `<tr><td>≤ ${fmt$(x.cut)}</td><td class="n">${fmt$(x.aff)}</td><td class="n">${fmtN(x.hh)}</td><td class="n">${fmtN(x.units)}</td><td class="n" style="color:${col};font-weight:700">${x.gap>0?'+':''}${fmtN(x.gap)}</td><td style="color:${col}">${x.gap>0?'short':'surplus'}</td></tr>`;
    }).join('');
    // ownership
    root.querySelector('[data-ownrows]').innerHTML = c.ownGap.map(x=>{
      const share=model.tenure.owner?x.units/model.tenure.owner*100:0;
      return `<tr><td>≤ ${fmt$(x.cut)}</td><td class="n" style="font-weight:600;color:${C.ink}">${fmt$(x.price)}</td><td class="n">${fmtN(x.hh)}</td><td class="n">${fmtN(x.units)}</td><td class="n">${share.toFixed(0)}% of stock</td></tr>`;
    }).join('');
    // headline tiles
    root.querySelector('[data-tiles]').innerHTML =
      tile(pct(c.renB/c.renT), 'of renters cost-burdened (>30% of income)', true) +
      tile(fmtN(c.renS), 'renters severely burdened (>50%)', false) +
      tile('+'+fmtN(c.peak.gap), `rental units short for households ≤ ${fmt$(c.peak.cut)} (peak)`, true) +
      tile(fmt$(c.afford[3].price), 'affordable home price at ~$62.5k income', false);
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
      '<p class="hg-sub">Current asking rents and sale prices — the timeliness layer. Dated and kept separate from the ACS/CHAS structural counts above.</p>'+
      '<div class="hg-market">'+
        '<div class="hg-mcard"><div class="hg-mv">'+(mkt.rent?fmt$(mkt.rent)+'/mo':'—')+'</div><div class="hg-ml">Typical rent — '+(mkt.cbsaTitle||'metro')+'<br><span class="muted">Zillow ZORI · '+(mkt.rentAsOf||'')+'</span></div></div>'+
        '<div class="hg-mcard"><div class="hg-mv">'+(mkt.price?fmt$(mkt.price):'—')+'</div><div class="hg-ml">Median sale price<br><span class="muted">Redfin · '+(mkt.priceAsOf||'')+'</span></div></div>'+
      '</div>'+
      '<p class="hg-src" data-market-ctx></p>';
  }

  function chasSection(chas){
    const rows=[['≤ 30% AMI','Extremely low income','eli'],['≤ 50% AMI','Very low income','vli'],['≤ 80% AMI','Low income','li']]
      .map(function(t){ var c=chas[t[2]]; if(!c) return '';
        return '<tr><td><b>'+t[0]+'</b><br><span style="color:'+C.faint+';font-size:11px">'+t[1]+'</span></td>'+
          '<td class="n">'+fmtN(c.hh)+'</td><td class="n">'+fmtN(c.affordable)+'</td>'+
          '<td class="n" style="font-weight:600;color:'+C.ink+'">'+fmtN(c.affAndAvail)+'</td>'+
          '<td class="n" style="color:'+C.alert+';font-weight:700">'+(c.shortage>0?'-':'')+fmtN(Math.abs(c.shortage))+'</td></tr>';
      }).join('');
    return '<h3 class="hg-h3">Affordable <em>and available</em> — the headline shortage <span class="hg-pill">HUD CHAS</span></h3>'+
      '<p class="hg-sub">Renter units affordable to each income tier, minus those already occupied by higher-income households. This is the figure behind “City X is short N affordable units.” Source: HUD CHAS 2018–2022 (Table 15C), by HAMFI income tier.</p>'+
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

    <h3 class="hg-h3">Rental gap by price point <span class="hg-pill">the "short N units" number</span></h3>
    <p class="hg-legend"><span class="hg-sq" style="background:${C.ink}"></span>Renter households (cumulative) &nbsp; <span class="hg-sq" style="background:${C.accent}"></span>Affordable rental units (cumulative)</p>
    <div data-gapchart></div>
    <table class="hg-tbl"><thead><tr><th>Income tier</th><th class="n">Aff. rent</th><th class="n">Renter HH</th><th class="n">Aff. units</th><th class="n">Gap</th><th></th></tr></thead><tbody data-gaprows></tbody></table>
    <p class="hg-src" data-medline></p>
    <p class="hg-note"><b>Affordable vs. affordable-and-available:</b> this counts affordable units; the headline-grade figure removes units occupied by higher-income households (shown next, from HUD CHAS). Small places carry ±10–20% ACS margins of error.</p>

    ${meta.model && meta.model.chas ? chasSection(meta.model.chas) : ''}

    <h3 class="hg-h3">Ownership: what's within reach at each income</h3>
    <table class="hg-tbl"><thead><tr><th>Income tier</th><th class="n">Aff. price</th><th class="n">Owner HH</th><th class="n">Units ≤ price</th><th class="n">Share of stock</th></tr></thead><tbody data-ownrows></tbody></table>
    <p class="hg-src">Affordable price from current-market mortgage math (adjust above); owner-unit values from ACS B25075.</p>`;
  }

  window.HousingGap = { render, compute };
})();
