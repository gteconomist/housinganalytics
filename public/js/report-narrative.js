/* report-narrative.js — writes the public-data housing overview from a data pack.
 *
 * Every number comes from the pack (report-engine.js).  The text is assembled
 * from rules: each sentence is tied to a condition in the data, so nothing is
 * said that the pack does not support.  Output is a document model that
 * report-docx.js turns into a Word file.
 * Runs in the browser (window.HANarrative) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const n0 = (x) => x == null || isNaN(x) ? 'n/a' : Math.round(x).toLocaleString('en-US');
  const usd = (x) => x == null || isNaN(x) ? 'n/a' : '$' + Math.round(x).toLocaleString('en-US');
  const usd100 = (x) => usd(Math.round(x / 100) * 100);
  const p1 = (x) => x == null || isNaN(x) ? 'n/a' : (+x).toFixed(1) + '%';
  const p0 = (x) => x == null || isNaN(x) ? 'n/a' : Math.round(x) + '%';
  const sg = (x, d) => (x >= 0 ? '+' : '-') + Math.abs(x).toFixed(d);
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const num = (x) => (Number.isInteger(x) && x >= 0 && x <= 12 ? words[x] : n0(x));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, s, pl) => (n === 1 ? s : pl || s + 's');
  const USD = '"$"#,##0';

  function cellText(c, fmt) {
    if (c == null) return '';
    if (typeof c === 'object') { if (c.text != null) return c.text; fmt = c.fmt || fmt; c = c.v; if (c == null) return ''; }
    if (typeof c === 'string') return c;
    switch (fmt) {
      case 'usd': return usd(c);
      case 'pct1': return p1(c);
      case 'pct0': return p0(c);
      case 'num1': return (+c).toFixed(1);
      case 'num2': return (+c).toFixed(2);
      case 'pctchg': return sg(c, 1) + '%';
      case 'signed1': return sg(c, 1);
      case 'signed2': return sg(c, 2);
      default: return Number.isInteger(c) ? n0(c) : (+c).toFixed(1);
    }
  }

  function build(pack) {
    const f = pack.facts, inp = pack.inputs, B = [];
    const ex = (id) => pack.exhibits.find((x) => x.id === id);
    const flag = (id) => pack.flags.find((x) => x.id === id);
    const val = (c) => (c != null && typeof c === 'object' ? c.v : c);
    const cellOf = (id, label, col) => { const e = ex(id); if (!e) return null; const r = e.rows.find((x) => String(x[0]).indexOf(label) === 0); return r ? val(r[col]) : null; };
    const isPlace = f.kind === 'place', nm = f.name, GA = f.state === 'Georgia';
    const area = isPlace ? 'city' : 'county';
    const cmp = ex('community_summary').columns.slice(1).map((c) => c.label);        // [target, (county), state]
    const sCol = cmp.length, cCol = isPlace && cmp.length === 3 ? 2 : null;          // column indexes in comparison tables
    const acs = (pack.vintages.acs || 'ACS 5-Year Estimates').replace('–', ' to ');
    const period = (acs.match(/(\d{4}) to (\d{4})/) || [])[0] || 'the current period';
    const d = new Date(pack.generated_at || Date.now());
    const dateStr = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const gq = f.group_quarters_share >= 10, gqBig = f.group_quarters_share >= 15;

    const P = (text, o) => B.push(Object.assign({ t: 'p', text }, o || {}));
    const H1 = (title, n) => B.push({ t: 'h1', title, num: n });
    const H2 = (title) => B.push({ t: 'h2', title });
    const bullet = (text) => B.push({ t: 'bullet', text });
    const callout = (label, paras) => { paras = paras.filter(Boolean); if (paras.length) B.push({ t: 'callout', label, paras }); };
    const banner = (text) => B.push({ t: 'banner', text });
    const tiles = (items) => B.push({ t: 'tiles', items: items.filter(Boolean) });
    const srcOf = (e, extra) => 'Source: ' + [e.source, e.note, extra].filter(Boolean).join('. ').replace(/\.\./g, '.').replace(/–/g, ' to ') + (/[.)]$/.test([e.source, e.note, extra].filter(Boolean).join('. ')) ? '' : '.');
    function T(id, o) {
      const e = ex(id); if (!e) return false; o = o || {};
      let cols = e.columns.map((c, k) => k), rows = e.rows;
      if (o.rows) rows = rows.filter(o.rows);
      if (!rows.length) return false;
      B.push({ t: 'table', title: o.title || e.title, headers: o.headers || cols.map((k) => e.columns[k].label), rows: rows.map((r) => (o.map ? o.map(r, e) : cols.map((k) => cellText(r[k], e.columns[k].fmt)))),
        widths: o.widths, first: o.first, align: o.align, total: o.total, sz: o.sz, src: srcOf(e, o.note) });
      return true;
    }
    function chartOf(id, o) {
      const e = ex(id); if (!e) return false; o = o || {};
      const ch = e.chart, pal = o.colors || (ch.series.length === 1 ? ['SLATE'] : ch.series.length === 2 ? ['SLATE', 'PRIMARY'] : ['PRIMARY', 'ACCENT', 'SLATE', 'PALE']);
      let series = ch.series.map((s, k) => ({ name: s.name, values: s.values.map((v) => (v == null ? null : ch.fmt === 'pct1' ? Math.round(v * 10) / 10 : Math.round(v))), color: pal[k % pal.length] })).filter((s) => !o.dropEmpty || s.values.some((v) => v));
      if (!series.length) series = [{ name: ch.series[0].name, values: ch.series[0].values, color: pal[0] }];
      if (o.dropEmpty && series.length === 1) series[0].color = 'SLATE';
      if (ch.highlight && series.length === 1) { series[0].points = {}; ch.highlight.forEach((i) => { series[0].points[i] = 'ACCENT'; }); (ch.muted || []).forEach((i) => { series[0].points[i] = 'PALE'; }); }
      if (o.points) series[0].points = o.points;
      B.push({ t: 'chart', title: o.title || e.title, cats: o.cats || ch.categories, series, kind: ch.type === 'stacked' ? 'stacked' : 'clustered',
        fmt: ch.fmt === 'usd' ? USD : ch.fmt === 'pct1' ? '0.0"%"' : '#,##0', axisFmt: ch.fmt === 'pct1' ? '0"%"' : null, height: o.height, gap: o.gap, src: srcOf(e, o.note) });
      return true;
    }

    // ── values used in several places ────────────────────────────────────
    const hhCounty = cCol ? cellOf('community_summary', 'Households', cCol) : null;
    const stateName = cmp[cmp.length - 1];
    const mhiState = cellOf('community_summary', 'Median household income', sCol), mhiCounty = cCol ? cellOf('community_summary', 'Median household income', cCol) : null;
    const povState = cellOf('community_summary', 'Poverty rate', sCol);
    const renterShareCounty = cCol ? cellOf('community_summary', 'Renter-occupied share', cCol) : null;
    const ownerShareState = cellOf('community_summary', 'Owner-occupied share', sCol);
    const valueState = cellOf('value_trend', 'Median home value, ' + stateName, 3);
    const wg = f.workforce_gap || {}, wgLo = Math.max(0, wg.min || 0), wgHi = wg.max || 0, wgShort = wgHi > 0;
    const wgText = !wgShort ? 'no shortage' : wgLo === wgHi ? n0(wgHi) : wgLo === 0 ? `up to ${n0(wgHi)}` : `${n0(wgLo)} to ${n0(wgHi)}`;
    const sub = f.subsidy_2br || {}, rc = f.rent_ceiling_2br || {}, rn2 = f.rent_needed ? f.rent_needed.br2 : null;
    const hasInv = f.inventory_properties > 0, noMarket = hasInv && f.inventory_market_units === 0;
    const permits = f.permits, pY = permits ? `${permits.years[0]} through ${permits.years[1]}` : '', pYears = permits ? permits.years[1] - permits.years[0] + 1 : 0;
    const hhBase = isPlace ? hhCounty : f.households, buildRate = permits && hhBase ? permits.total / pYears / hhBase * 100 : null;   // units a year per 100 households
    const slowBuild = buildRate != null && buildRate < 0.5;
    const mm = f.mismatch || [], small = mm[0], biggest = mm.slice().sort((a, z) => (z.stock_share - z.household_share) - (a.stock_share - a.household_share))[0];
    const smallShort = small && small.household_share - small.stock_share > 10;
    const otherVacHigh = f.other_vacant_share_of_units > 5;
    const old = f.median_year_built && f.median_year_built < 1985;
    const rvr = f.rental_vacancy_rate, rvrWord = rvr < 5 ? 'tight' : rvr <= 8 ? 'balanced' : 'soft';
    const pti = f.price_to_income, pc = f.price_ceiling || {};
    const prog = inp.program || {}, costs = inp.rental.cost, capRate = inp.rental.capRate, opex = inp.rental.opex;
    const noSale = (f.vacant_for_sale || 0) === 0;
    const mfPermits = permits ? permits.units_5_plus + permits.units_2_to_4 : 0;

    // ══ SUMMARY ══════════════════════════════════════════════════════════
    H1('Summary of Findings');
    P(`This assessment documents housing conditions in ${f.name}, ${f.state}, and measures the need for workforce housing: homes affordable to households earning 80% to 120% of area median income (AMI). Rental and owner-occupied findings are presented separately so each can be read alone.`);
    B.push({ t: 'eyebrow', text: `${nm} at a glance  ·  ${period}` });
    tiles([
      noMarket ? ['0', 'Market-rate apartment communities', `All ${n0(f.inventory_units)} apartment units found are restricted`] : [p1(f.renter_share), 'Households that rent', `${n0(f.renter_households)} of ${n0(f.households)} households`],
      [p1(f.renters_cost_burdened_share), 'Renters cost-burdened', `${n0(f.renters_cost_burdened)} of ${n0(f.renter_households)} renter households`],
      rn2 ? [usd(rn2), 'Rent to finance a new two-bedroom', f.no_unit_rents_at_or_above ? `Nothing in the ${area} rents above ${usd(f.no_unit_rents_at_or_above)}` : `Median rent today is ${usd(f.rent_median)}`] : [usd(f.rent_median), 'Median gross rent', `${stateName}: ${usd(f.state_rent_median)}`],
    ]);
    B.push({ t: 'eyebrow', text: 'The gap' });
    tiles([
      [wgShort ? wgText : 'None', wgShort ? 'Workforce rental units short' : 'Workforce rental shortage', '80% to 120% of AMI, three income anchors'],
      f.shortage_le_50_ami != null ? [f.shortage_le_50_ami > 0 ? n0(f.shortage_le_50_ami) : 'None', 'Units short at or below 50% of AMI', 'A separate and deeper need'] : null,
      [n0(f.vacant_for_sale || 0), 'Vacant homes for sale', 'Census Bureau estimate'],
    ]);
    B.push({ t: 'eyebrow', text: 'Key findings' });
    if (noMarket) bullet(`**No market-rate apartment community was found.** Public records show ${num(f.inventory_properties)} apartment ${plural(f.inventory_properties, 'property', 'properties')} with ${n0(f.inventory_units)} units, all of them subsidized or income-restricted. A household at 80% to 120% of AMI earns too much for that stock and has nothing newer to rent.`);
    else if (hasInv) bullet(`**Most identified apartments are income-restricted.** Public records show ${num(f.inventory_properties)} apartment ${plural(f.inventory_properties, 'property', 'properties')} with ${n0(f.inventory_units)} units, of which ${n0(f.inventory_restricted_units)} are subsidized or income-restricted.`);
    else bullet(`**Renters are stretched.** ${n0(f.renters_cost_burdened)} of ${n0(f.renter_households)} renter households (${p1(f.renters_cost_burdened_share)}) spend more than 30% of income on housing, and ${n0(f.renters_severely_burdened)} spend more than half.`);
    if (rn2 && sub.p100 > 0) bullet(`**New apartments do not finance without subsidy.** At planning-level costs a new two-bedroom needs about ${usd(rn2)} a month. Workforce households can pay ${usd(rc.p80)} at 80% of AMI and ${usd(rc.p120)} at 120%. The gap is ${usd(sub.p80)} per unit at 80% of AMI and ${sub.p120 > 0 ? usd(sub.p120) + ' at 120%' : 'closes at 120%'}.`);
    else if (rn2) bullet(`**New apartments are close to financeable in the upper workforce band.** At planning-level costs a new two-bedroom needs about ${usd(rn2)} a month, against ${usd(rc.p100)} affordable at 100% of AMI and ${usd(rc.p120)} at 120%.`);
    if (permits) bullet(`**${slowBuild ? (noSale ? 'Almost nothing is being built, and nothing is for sale.' : 'Almost nothing is being built.') : buildRate >= 1.5 ? 'Construction is active.' : 'New supply is modest.'}** ${f.county || nm} permitted ${n0(permits.total)} ${plural(permits.total, 'home')} from ${pY}: ${n0(permits.single_family)} single-family and ${n0(mfPermits)} in multifamily buildings.${noSale && !slowBuild ? ' The Census Bureau estimates no vacant homes for sale.' : ''}`);
    if (smallShort || otherVacHigh) bullet(`**${smallShort ? 'The stock is the wrong size' : 'A large share of the stock is idle'}${smallShort && otherVacHigh ? ', and a large share of it is idle' : ''}.** ${smallShort ? `One-person households are ${p0(small.household_share)} of households while studios and one-bedrooms are ${p0(small.stock_share)} of housing. ` : ''}${otherVacHigh ? `${n0(f.other_vacant)} units, ${p0(f.other_vacant_share_of_units)} of all housing, sit vacant and off the market.` : ''}`);
    callout('Reading these results', [
      gq ? `**${p0(f.group_quarters_share)} of the counted population lives in group quarters.** ${n0(f.group_quarters)} of ${n0(f.population)} counted residents live in group quarters such as correctional facilities, college housing, barracks or nursing homes. Population, age, race, education and labor force figures include them. Household, income, rent, value and housing-unit figures do not, and the housing case is built on those.` : null,
      flag('wide_moe') ? `**The ${area} is small.** Single Census estimates carry wide margins of error.${isPlace ? ` ${f.county} figures are shown alongside as the steadier guide.` : ''}` : null,
      '**This is a public-data overview.** It establishes the need, its scale and the products that fit. Section 6 lists the local analysis that should precede a specific project.']);

    // ══ INTRODUCTION ═════════════════════════════════════════════════════
    H1('Introduction');
    P(`When teachers, nurses, public safety officers, plant supervisors and skilled tradespeople cannot find housing near their jobs, employers struggle to hire and keep them, commutes lengthen, and local spending leaves the community. That is the workforce housing gap this assessment measures for ${nm}.`);
    callout('Three terms used throughout', [
      '**Workforce housing.** Homes affordable to households earning 80% to 120% of area median income. These households earn too much for most subsidized housing and often too little for new market-rate construction.',
      '**Area median income (AMI).** HUD\'s benchmark income for a county or metropolitan area, adjusted for household size and used to set program eligibility. It is not the same as median household income (MHI), the Census Bureau\'s midpoint for all households in a place.',
      '**Naturally occurring affordable housing.** Housing that is affordable without subsidy or rent restriction, usually because it is old and has not been updated. A low median rent is therefore not proof of a healthy market. It can equally be evidence of an aging stock.']);
    if (GA) P(`Georgia's OneGeorgia Authority and Department of Community Affairs (DCA) run the Workforce Housing Initiative and its rural counterpart to help local governments close this gap. Infrastructure grants are limited to ${usd(prog.infraCap)} per application and development, and construction finance to ${usd(prog.financeCap)} per applicant and development phase. Applications require documentation of local housing need.`);
    else P('Many states and federal agencies offer infrastructure grants, gap financing and tax credits to help local governments and developers close this gap. Most require documentation of local housing need.');
    H2('Scope of this study');
    P(`This is a community-level overview built entirely from public data. It answers four questions: whether a workforce housing need exists, roughly how large it is, where in the market it sits, and what kind of product would meet it. **It does not evaluate a site or a specific project, and its cost figures are planning-level assumptions.** ${nm} is compared throughout with ${cmp.slice(1).join(' and ')}. Section 6 sets out the further analysis that would carry these findings into a project.`);
    if (isPlace && hhCounty) {
      const rc2 = cellOf('community_summary', 'Renter-occupied share', cCol), renC = rc2 != null ? Math.round(hhCounty * rc2 / 100) : null;
      H2('About the place');
      P(`${nm} is in ${f.county}, ${f.state}. It holds ${n0(f.households)} of the county's ${n0(hhCounty)} households (${p0(f.households / hhCounty * 100)})${renC ? ` and ${n0(f.renter_households)} of its roughly ${n0(renC)} renter households (${p0(Math.min(100, f.renter_households / renC * 100))})` : ''}.`);
    }
    const feats = [];
    if (gq) feats.push(['A large share of the counted population lives in group quarters.', `The ${acs.replace(' 5-Year Estimates', '')} American Community Survey (ACS) places ${n0(f.group_quarters)} of the ${area}'s ${n0(f.population)} residents in group quarters. They are counted in the population but do not form households or occupy housing units.`]);
    const bb = flag('benchmark_break');
    if (bb) feats.push(['Earlier counts rest on a different base.', `${bb.detail} This report compares medians and rates over time and uses counts only for the current period.`]);
    const wm = flag('wide_moe');
    if (wm) feats.push(['The sample is small.', `${wm.detail}`]);
    if (feats.length) { H2(`${cap(num(feats.length))} ${plural(feats.length, 'feature')} of the data`); feats.forEach((x, k) => B.push({ t: 'num', n: k + 1, lead: x[0], text: x[1] })); }

    // ══ 1 COMMUNITY PROFILE ══════════════════════════════════════════════
    H1('Community Profile', '1');
    tiles([[n0(f.households), 'Households', gq ? `${n0(f.household_population)} residents live in households` : `${n0(f.population)} residents`],
      [p1(f.renter_share), 'Renter households', cCol ? `${f.county}: ${p1(renterShareCounty)}` : `${stateName}: ${p1(100 - ownerShareState)}`],
      [usd(f.mhi), 'Median household income', `${stateName}: ${usd(mhiState)}`], [p1(f.poverty_rate), 'Poverty rate', `${stateName}: ${p1(povState)}`]]);
    P(`${nm} has ${n0(f.households)} households, ${p0(f.renter_share)} of them renters, and a median renter income of ${usd(f.mhi_renter)}. Those facts set the terms for everything that follows.`);
    T('community_summary', { title: 'Community Data Summary' });
    H2('Population, households and tenure');
    P(`${gq ? `Of the ${area}'s ${n0(f.population)} counted residents, ${n0(f.household_population)} live in households. They form` : `${nm}'s ${n0(f.population)} residents form`} ${n0(f.households)} households.${f.households_with_children ? ` An estimated ${n0(f.households_with_children)} households (${p1(f.households_with_children_share)}) include a child under 18.` : ''}`);
    const moreRent = cCol ? f.renter_share - renterShareCounty : f.renter_share - (100 - ownerShareState);
    P(`Owners hold ${n0(f.owner_households)} homes (${p1(f.owner_share)}) and renters ${n0(f.renter_households)} (${p1(f.renter_share)}). Renting is ${Math.abs(moreRent) < 3 ? 'about as common here as' : moreRent > 0 ? 'more common here than' : 'less common here than'} in ${cCol ? f.county + ' as a whole' : stateName}${cCol ? ` (${p1(renterShareCounty)})` : ` (${p1(100 - ownerShareState)})`}.`);
    if (ex('race_ethnicity')) { H2('Race and ethnicity'); if (gqBig) P(`Because ${p0(f.group_quarters_share)} of the counted population lives in group quarters, ${area}wide age and race figures describe those facilities as much as the community. They are shown for fair housing context only.`); T('race_ethnicity', { title: `Race and Ethnicity, ${period}` }); }
    H2('Income');
    const gapSt = (1 - f.mhi / mhiState) * 100;
    P(`Median household income is ${usd(f.mhi)} in ${nm}${mhiCounty ? ` and ${usd(mhiCounty)} in ${f.county}` : ''}, against ${usd(mhiState)} statewide. The ${area} figure is ${Math.abs(gapSt) < 3 ? 'close to' : p0(Math.abs(gapSt)) + (gapSt > 0 ? ' below' : ' above')} the state median.${gq ? ' Household income excludes the group quarters population.' : ''}`);
    T('income_trend', { title: 'Median Household Income Over Time' });
    if (f.mhi_owner && f.mhi_renter) {
      P(`Income varies sharply by tenure. Owner households report a median of ${usd(f.mhi_owner)} and renter households ${usd(f.mhi_renter)}. The overall median describes neither group well.`);
      chartOf('income_by_tenure', { title: `Median Household Income by Tenure, ${period}`, gap: 60, height: 2100000 });
      banner(`Owner households report ${usd(f.mhi_owner)}. Renter households report ${usd(f.mhi_renter)}${f.mhi_renter / f.mhi_owner < 0.4 ? ', less than ' + (f.mhi_renter / f.mhi_owner < 1 / 3 ? 'a third' : '40%') + ' as much' : ''}.`);
      P(`A renter household at the median can afford about ${usd(f.renter_affordable_rent)} a month at 30% of income. The median gross rent is ${usd(f.rent_median)}.${f.renter_affordable_rent < f.rent_median ? ' That gap is the main source of the cost burden documented in Section 3, and it sits below the workforce band.' : ''}`);
    }
    if (f.wahi) P(`Working-age household income (WAHI), the median for households headed by someone aged 25 to 64, is ${usd(f.wahi)}. It is used in Section 3 as a local measure of what working households earn.`);
    if (T('earners', { title: 'Median Income by Number of Earners', headers: ['Household type', 'Households', 'Share of group', 'Median income'], widths: [3360, 1500, 2500, 2000], map: (r) => [r[0], n0(r[1]), `${p1(r[2])} of ${r[3]}`, r[4] == null ? 'Suppressed' : usd(r[4])] }) && f.workforce_families)
      P(`One-earner and two-earner families, ${n0(f.workforce_families)} households with medians of ${usd(f.income_1_earner)} and ${usd(f.income_2_earner)}, are the core of the workforce market.`);
    if (ex('education_labor')) {
      H2('Education and labor force');
      const ba = cellOf('education_labor', 'Bachelor', 1), baS = cellOf('education_labor', 'Bachelor', sCol), lf = cellOf('education_labor', 'Labor force', 1), lfS = cellOf('education_labor', 'Labor force', sCol);
      P(`${gqBig ? 'These measures are the most affected by the group quarters population. As reported, ' : ''}${p1(ba)} of residents aged 25 and over hold a bachelor's degree or higher, against ${p1(baS)} statewide. The labor force participation rate is ${p1(lf)}, against ${p1(lfS)} statewide.${gqBig && f.lfpr_household_estimate ? ` Removing group quarters residents from the population aged 16 and over puts participation among household residents at roughly ${p0(f.lfpr_household_estimate)}. That is an estimate, not a published figure.` : ''}`);
    }
    const sz = ex('size_mismatch_detail');
    if (sz) { H2('Household size'); const r = sz.rows; P(`${r[0][4] + r[1][4] > 60 ? 'Households are small. ' : ''}One-person households are ${p1(r[0][4])} of the total (${n0(r[0][3])}) and two-person households ${p1(r[1][4])} (${n0(r[1][3])}). Three-person households are ${p1(r[2][4])} (${n0(r[2][3])}) and households of four or more ${p1(r[3][4])} (${n0(r[3][3])}). Section 2 sets this against the size of the homes.`); }
    callout('Community profile takeaways', [
      `**${p1(f.renter_share)} of households rent.** ${cCol ? `The ${f.county} share is ${p1(renterShareCounty)}.` : `The statewide share is ${p1(100 - ownerShareState)}.`}`,
      f.mhi_owner && f.mhi_renter ? `**Income is a tenure story.** Owners report ${usd(f.mhi_owner)} and renters ${usd(f.mhi_renter)}.` : null,
      f.workforce_families ? `**The workforce market is about ${n0(f.workforce_families)} families.** One-earner and two-earner families report medians of ${usd(f.income_1_earner)} and ${usd(f.income_2_earner)}.` : null,
      f.poverty_rate > 20 ? `**Deeper need sits below the workforce band.** A ${p1(f.poverty_rate)} poverty rate calls for deeper subsidy than a workforce housing program provides.` : null]);

    // ══ 2 HOUSING STOCK ══════════════════════════════════════════════════
    H1('Housing Stock', '2');
    tiles([[n0(f.units_total), 'Housing units', `${n0(f.households)} occupied, ${n0(f.vacant_units)} vacant`],
      f.median_year_built ? [String(f.median_year_built), 'Median year built', `${p1(f.pre_1980_share_of_occupied)} of occupied homes predate 1980`] : null,
      [p1(f.vacancy_rate), 'Vacancy rate', otherVacHigh ? 'Much of it off the market' : 'All vacant units'],
      permits ? [n0(permits.total), `Units permitted, ${permits.years[0]} to ${permits.years[1]}`, `${f.county || nm}, ${num(pYears)} years`] : null]);
    H2('How much housing, and is it changing?');
    P(`The ${acs.replace(' 5-Year Estimates', '')} ACS estimates ${n0(f.units_total)} housing units${f.units_moe ? `, plus or minus ${n0(f.units_moe)}` : ''}.${f.census_2020_units ? ` The 2020 Census counted ${n0(f.census_2020_units)}.` : ''}${bb ? ' Earlier ACS estimates were tied to the 2010 Census base and are not comparable.' : ''}`);
    if (permits) {
      P(`Building permits give the cleanest read on new supply. ${f.county || nm} issued permits for ${n0(permits.total)} ${plural(permits.total, 'home')} from ${pY}: ${n0(permits.single_family)} single-family ${plural(permits.single_family, 'house')} and ${n0(mfPermits)} ${plural(mfPermits, 'unit')} in multifamily buildings.${buildRate != null ? ` That is about ${buildRate.toFixed(1)} new ${plural(2, 'home')} a year for every 100 households${slowBuild ? ', a very low rate of replacement' : ''}.` : ''}`);
      chartOf('permits', { title: `Housing Units Permitted per Year, ${f.county || nm}, ${permits.years[0]} to ${permits.years[1]}`, dropEmpty: true, colors: ['SLATE', 'PRIMARY', 'ACCENT'], height: 2300000 });
    }
    H2('Structure type and age');
    T('structure_type', { title: 'Housing Units by Structure Type', widths: [5360, 2000, 2000] });
    if (f.median_year_built) P(`The median home was built in ${f.median_year_built}. Of occupied homes, ${p1(f.pre_1980_share_of_occupied)} were built before 1980${f.built_2020_plus != null ? ` and ${f.built_2020_plus === 0 ? 'none' : n0(f.built_2020_plus)} in 2020 or later` : ''}.${old && f.rent_median < f.state_rent_median ? ` Age is a large part of why housing here is inexpensive. A median gross rent of ${usd(f.rent_median)} and a median home value of ${usd(f.value_median)} reflect an older stock, and that stock loses condition every year it is not reinvested in.` : ''}`);
    if (mm.length && biggest) {
      H2('Housing mismatch');
      P('A community can have enough units and still have the wrong ones. Comparing bedrooms in the stock with the size of households shows where the stock does not fit.');
      chartOf('size_mismatch', { title: 'Housing Stock by Bedrooms Against Households by Size (share of each total)', gap: 70 });
      const over = biggest.stock_share - biggest.household_share;
      const bi = mm.indexOf(biggest), SN = ['Studios and one-bedroom homes', 'Two-bedroom homes', 'Three-bedroom homes', 'Homes with four or more bedrooms'], HN = ['One-person households', 'Two-person households', 'Three-person households', 'Households of four or more'];
      if (over > 10) banner(`${SN[bi]} are ${p0(biggest.stock_share)} of the stock. ${HN[bi]} are ${p0(biggest.household_share)}.`);
      T('size_mismatch_detail', { title: 'Housing Size Mismatch, Detail', widths: [2860, 1100, 1350, 1300, 1450, 1300] });
      if (smallShort) P('The product implication is direct. New construction should lean toward one-bedroom and two-bedroom units, cottage courts and small-footprint homes. Smaller units also give older owners somewhere to downsize, which returns family homes to the market.');
    }
    if (ex('non_occupancy')) { H2('Where the vacancy sits'); P('No public source reports vacancy by unit size for most markets. The nearest public measure is how many units of each structure type are not occupied.'); T('non_occupancy', { title: 'Non-Occupancy by Structure Type', widths: [3960, 1800, 1800, 1800], note: 'Small counts; read as directional' }); }
    H2('Vacant does not mean available');
    T('vacancy_composition', { title: 'Vacant Units by Status', widths: [3960, 1800, 1800, 1800], total: true, rows: (r) => r[1] > 0 || /Total|For sale|For rent|Other/.test(r[0]) });
    P(`Of ${n0(f.vacant_units)} vacant units, ${n0(f.frictional_vacant)} are in normal market circulation: for rent, for sale, or rented or sold and awaiting occupancy. Another ${n0(f.other_vacant)} fall in the Census residual category, which covers homes held in estates, under repair, in foreclosure, condemned or abandoned.${otherVacHigh ? ` Those units are ${p1(f.other_vacant_share_of_units)} of all housing, above the 5% level generally treated as an early sign of disinvestment.` : ` Those units are ${p1(f.other_vacant_share_of_units)} of all housing.`}`);
    callout('Housing stock takeaways', [
      permits ? `**${slowBuild ? 'Almost nothing is being added.' : 'New supply is modest.'}** ${f.county || nm} permitted ${n0(permits.total)} ${plural(permits.total, 'home')} in ${num(pYears)} years.` : null,
      f.median_year_built ? `**${old ? 'The stock is old.' : 'Age of the stock.'}** The median home dates to ${f.median_year_built}.` : null,
      smallShort ? `**The stock is the wrong size.** Small units are ${p1(small.stock_share)} of stock against ${p1(small.household_share)} one-person households.` : null,
      `**Vacant does not mean available.** Of ${n0(f.vacant_units)} vacant units, ${n0(f.other_vacant)} are off the market.`]);

    // ══ 3 RENTAL ═════════════════════════════════════════════════════════
    H1('Rental Housing', '3');
    tiles([[n0(f.renter_households), 'Renter households', `${p1(f.renter_share)} of all households`],
      [p1(f.renters_cost_burdened_share), 'Cost-burdened renters', `${p1(f.renters_severely_burdened_share)} pay more than half of income`],
      [p1(rvr), 'Rental vacancy rate', rvrWord === 'tight' ? 'Below the balanced range' : rvrWord === 'balanced' ? 'Within the balanced range' : 'Above the balanced range'],
      hasInv ? [n0(f.inventory_market_units), 'Market-rate apartment units', `${n0(f.inventory_units)} apartment units identified`] : [usd(f.rent_median), 'Median gross rent', `${stateName}: ${usd(f.state_rent_median)}`]]);
    P('This section stands alone for a developer or funder evaluating a rental project.');
    H2('Rental affordability');
    P(`A household is cost-burdened when it spends more than 30% of gross income on housing, and severely burdened above 50%. In ${nm}, ${n0(f.renters_cost_burdened)} of ${n0(f.renter_households)} renter households (${p1(f.renters_cost_burdened_share)}) are cost-burdened and ${n0(f.renters_severely_burdened)} (${p1(f.renters_severely_burdened_share)}) are severely burdened.`);
    chartOf('rent_burden', { title: 'Renter Households by Gross Rent as a Share of Income', height: 2300000, note: 'Highlighted bars are cost-burdened households' });
    if (f.renters_burden_not_computed / f.renter_households > 0.1) P(`The headline rate understates the burden. For ${n0(f.renters_burden_not_computed)} renter households the ratio cannot be computed${f.renters_no_cash_rent ? `, including ${n0(f.renters_no_cash_rent)} who pay no cash rent` : ''}. Among the households where it can be computed, ${p1(f.renters_burdened_share_of_computed)} are cost-burdened.`);
    P(`Median gross rent is ${usd(f.rent_median)}${f.rent_median_2015 ? `, ${f.rent_change_pct >= 0 ? 'up' : 'down'} ${p1(Math.abs(f.rent_change_pct))} from ${usd(f.rent_median_2015)} a decade earlier` : ''}. Statewide the median is ${usd(f.state_rent_median)}.`);
    T('rent_indicators', { title: 'Rent Indicators', widths: [4160, 1600, 3600], align: ['l', 'r', 'l'] });
    H2('Three ways to measure the workforce band');
    P('The dollar value of "80% to 120% of area median income" depends on which median is used. This report shows three.');
    T('income_anchors', { title: 'Workforce Income Bands Under Three Anchors', widths: [3360, 1100, 1100, 1100, 2700], align: ['l', 'r', 'r', 'r', 'l'] });
    if (f.hud_80_over_mhi_pct > 15) P(`The HUD band sits well above local incomes: it begins ${p0(f.hud_80_over_mhi_pct)} above the ${area}'s median household income.${flag('hud_floor') ? ' HUD\'s published limit for this area implies a higher median than the county\'s own, which happens where HUD applies a state floor.' : ''} Program eligibility follows the HUD band; local demand is better described by the working-age income band.`);
    else P('Program eligibility follows the HUD band. The two local anchors show how closely that band matches what households here earn.');
    if (hasInv) {
      H2('The apartment inventory');
      P(`Federal housing records identify ${num(f.inventory_properties)} apartment ${plural(f.inventory_properties, 'property', 'properties')} with ${n0(f.inventory_units)} units, about ${p0(f.inventory_share_of_renters)} of the ${area}'s ${n0(f.renter_households)} renter households. The remaining renters live in single-family houses, mobile homes, duplexes and small buildings. These records cover subsidized and income-restricted properties; a privately financed complex would not appear in them and should be confirmed locally.`);
      T('inventory', { title: `Apartment Properties Identified in ${nm}`, widths: [4160, 900, 900, 3400], align: ['l', 'r', 'r', 'l'], total: true });
      if (noMarket) banner(`All ${n0(f.inventory_units)} apartment units identified in ${nm} are subsidized or income-restricted.`);
    }
    chartOf('rent_distribution', { title: 'Rental Units by Monthly Gross Rent', height: 2500000, colors: ['PRIMARY'] });
    if (rn2 && f.no_unit_rents_at_or_above && f.no_unit_rents_at_or_above < rn2) banner(`No unit in the ${area} rents for ${usd(f.no_unit_rents_at_or_above)} or more. A new two-bedroom needs ${usd(rn2)}.`);
    const fg = ex('financing_gap');
    if (fg && rn2) {
      H2('Product financing gap');
      P('The question a developer and a funder both need answered is what new product costs, what the target households can pay, and how far apart those numbers are.');
      callout('All development costs are vertical construction only', [
        `Costs assume a finished, served site and exclude sewer and water mains, taps, drainage, streets, sidewalks, lighting, engineering and permitting. Those costs must be priced by an engineer for the actual site. Every gap shown here is therefore a floor.`,
        `**Planning-level assumptions.** Construction cost of ${usd(costs.br1)}, ${usd(costs.br2)} and ${usd(costs.br3)} per one-, two- and three-bedroom unit; a ${p1(capRate * 100)} capitalization rate; and a ${p0(opex * 100)} operating expense ratio. These are illustrative figures for modest garden-style construction, not quotes for a project. Two sensitivity tables below show how far the gap moves when they change.`]);
      B.push({ t: 'chart', title: 'Affordable Rent Against the Rent Needed to Finance Construction', cats: fg.rows.map((r) => r[0]), gap: 55, height: 2800000, fmt: USD,
        series: [{ name: 'Affordable at 80% AMI', values: fg.rows.map((r) => Math.round(r[3])), color: 'PALE' }, { name: 'Affordable at 100% AMI', values: fg.rows.map((r) => Math.round(r[5])), color: 'SLATE' }, { name: 'Affordable at 120% AMI', values: fg.rows.map((r) => Math.round(r[7])), color: 'PRIMARY' }, { name: 'Rent needed to finance', values: fg.rows.map((r) => Math.round(r[2])), color: 'ACCENT' }],
        src: `Sources: HUD ${pack.vintages.hud_income_limits || ''} Income Limits, ${f.hud_area || f.county || nm}; planning-level cost assumptions. Monthly gross rent.` });
      const sv = (v) => (val(v) > 0 ? usd(val(v)) : 'None needed');
      T('financing_gap', { title: 'Rental Financing Gap Across the Workforce Band', headers: ['Unit type', 'Vertical cost', 'Rent needed', 'Rent at 80%', 'Subsidy at 80%', 'Rent at 100%', 'Subsidy at 100%', 'Rent at 120%', 'Subsidy at 120%'],
        widths: [1200, 1060, 1000, 1000, 1040, 1000, 1040, 1000, 1020], sz: 16, map: (r) => [r[0], usd(r[1]), usd(r[2]), usd(r[3]), sv(r[4]), usd(r[5]), sv(r[6]), usd(r[7]), sv(r[8])] });
      P(`${sub.p120 > 0 ? 'A gap exists at every point in the band and widens as income falls.' : 'The gap widens as income falls.'} A two-bedroom unit for a household at 80% of AMI can charge ${usd(rc.p80)} against the ${usd(rn2)} needed, a shortfall of ${usd(rn2 - rc.p80)} a month or about ${usd(sub.p80)} per unit. At 100% of AMI the gap is ${sub.p100 > 0 ? usd(sub.p100) : 'closed'}, and at 120% it is ${sub.p120 > 0 ? usd(sub.p120) : 'closed'}.`);
      if (rc.p80 > f.rent_median * 1.5) P(`The ceiling that binds in practice may be lower than any of these. A new two-bedroom at the 80% AMI rent of ${usd(rc.p80)} would be well above the median rent of ${usd(f.rent_median)}. That is an absorption risk as much as a financing one.`);
      if (T('program', { title: `Representative ${n0(f.program_units)}-Unit Mixed-Income Program`, widths: [2360, 1350, 1400, 1400, 1300, 1550], total: true }))
        P(`This program needs about ${usd(f.program_gap_financing)} in gap financing, a blended ${usd(f.program_gap_per_unit)} per unit, with ${n0(f.program_units_at_or_below_100)} of ${n0(f.program_units)} units serving households at or below 100% of AMI.${GA && f.program_over_finance_cap > 0 ? ` It exceeds the ${usd(prog.financeCap)} construction finance cap by about ${usd(f.program_over_finance_cap)} on vertical costs alone.` : ''}`);
      T('cap_rate_sensitivity', { title: 'Sensitivity of the Two-Bedroom Gap to the Capitalization Rate', widths: [2560, 1700, 1700, 1700, 1700], map: (r, e) => r.map((c, k) => (k >= 2 && !(val(c) > 0) ? 'None needed' : cellText(c, e.columns[k].fmt))) });
      const k = 12 * (1 - opex) / capRate, c2 = costs.br2, step = Math.max(10000, Math.round(c2 * 0.11 / 10000) * 10000);
      const subAt = (cost, rent) => { const s = Math.round((cost - rent * k) / 100) * 100; return s > 0 ? usd(s) : 'None needed'; };
      B.push({ t: 'table', title: 'Sensitivity of the Two-Bedroom Gap to Construction Cost', headers: ['Vertical cost per unit', 'Rent needed', 'Subsidy at 80%', 'Subsidy at 100%', 'Subsidy at 120%'], widths: [2560, 1700, 1700, 1700, 1700],
        rows: [c2 - step, c2, c2 + step].map((c) => [usd(c), usd(c / k), subAt(c, rc.p80), subAt(c, rc.p100), subAt(c, rc.p120)]),
        src: `Capitalization rate held at ${p1(capRate * 100)} and operating expenses at ${p0(opex * 100)}. Every $10,000 of construction cost moves the per-unit gap by $10,000.` });
      const robust = (c2 - step) - rc.p100 * k > 0;
      P(robust ? 'The two tables point the same way. At 80% and 100% of AMI a gap remains under every case tested, so the conclusion that workforce rental product needs public participation does not depend on the exact cost figure. At 120% of AMI the result is sensitive to the cost and the capitalization rate.'
        : 'The two tables show that the result is sensitive to the assumptions. At 80% of AMI a gap remains in every case tested. Higher in the band, a lower cost or capitalization rate closes the gap on paper, so local cost figures matter before any conclusion is drawn.');
      P('**Gross rent and the utility allowance.** The ceilings above are gross rents, which include tenant-paid utilities. The rent a developer can charge is the gross rent less the local utility allowance, and every dollar of allowance widens the gap by a dollar a month. A project-level analysis should apply the current local schedule.');
    }
    H2('Rental availability');
    P(`The rental vacancy rate is ${p1(rvr)}, ${rvrWord === 'tight' ? 'below the 5% to 8% range usually considered balanced. Units are scarce' : rvrWord === 'balanced' ? 'inside the 5% to 8% range usually considered balanced' : 'above the 5% to 8% range usually considered balanced'}.${rvrWord !== 'tight' && noMarket ? ' The case for new rental supply here does not rest on scarcity of units. It rests on the absence of a product type.' : ''}`);
    T('vacancy_trend', { title: 'Vacancy Rates Over Time', widths: [3960, 1800, 1800, 1800] });
    if (T('workforce_gap', { title: 'Workforce Rental Gap, 80% to 120% of the Anchor', widths: [2760, 1800, 1700, 1900, 1200], align: ['l', 'l', 'r', 'r', 'r'] }))
      P(wgShort ? `${wgLo === wgHi ? 'The anchors agree' : 'The three anchors disagree on size and agree on direction'}: a shortage of ${wgText} units.${flag('thin_gap') || wgHi < 150 ? ' These are small numbers from a small sample and should be read as an order of magnitude.' : ''}`
        : 'On all three anchors the units affordable to the workforce band and available to it meet or exceed the households in the band. The rental need here is not a count shortage in the band; it is a question of quality, product type and the deeper need below.');
    if (f.shortage_le_50_ami != null) P(f.shortage_le_50_ami > 0 ? `A ${wgShort ? 'larger ' : ''}shortage sits below the band. HUD's affordability data estimate that ${n0(f.shortage_le_50_ami)} more rental units are needed for renter households at or below 50% of AMI${f.shortage_le_30_ami > 0 ? `, and ${n0(f.shortage_le_30_ami)} for those at or below 30%` : ''}.` : 'HUD\'s affordability data do not show a shortage of rental units for households at or below 50% of AMI.');
    callout('Rental housing takeaways', [
      noMarket ? `**No market-rate apartment product was found.** All ${n0(f.inventory_units)} apartment units identified are restricted or subsidized.` : null,
      `**Renters are cost-burdened.** ${n0(f.renters_cost_burdened)} of ${n0(f.renter_households)} households pay more than 30% of income, and ${n0(f.renters_severely_burdened)} pay more than half.`,
      wgShort ? `**The documented workforce gap is ${wgText} units.**` : '**No count shortage shows in the workforce band.**',
      rn2 && sub.p100 > 0 ? `**New construction needs subsidy at planning-level costs**, from ${usd(sub.p80)} per two-bedroom unit at 80% of AMI to ${sub.p120 > 0 ? usd(sub.p120) + ' at 120%' : 'none at 120%'}.` : null]);

    // ══ 4 OWNER ══════════════════════════════════════════════════════════
    H1('Owner-Occupied Housing', '4');
    tiles([[p1(f.owner_share), 'Homeownership rate', `${stateName}: ${p1(ownerShareState)}`], [usd(f.value_median), 'Median home value', valueState ? `${stateName}: ${usd(valueState)}` : ''],
      [pti.toFixed(2), 'Price-to-income ratio', `${stateName}: ${f.state_price_to_income ? f.state_price_to_income.toFixed(2) : 'n/a'}`], [p1(f.homeowner_vacancy_rate), 'Homeowner vacancy rate', noSale ? 'No vacant homes for sale' : `${n0(f.vacant_for_sale)} vacant homes for sale`]]);
    P('This section stands alone for a developer or funder evaluating a for-sale project.');
    H2('Ownership affordability');
    P(`Median home value is ${usd(f.value_median)}${f.value_change_pct != null ? `, ${f.value_change_pct >= 0 ? 'up' : 'down'} ${p1(Math.abs(f.value_change_pct))} over the past decade` : ''}.${f.mhi_change_pct != null ? ` Household income ${f.mhi_change_pct >= 0 ? 'rose' : 'fell'} ${p1(Math.abs(f.mhi_change_pct))} over the same span${f.value_change_pct > f.mhi_change_pct ? ', so homes cost more relative to income than they did a decade ago' : ''}.` : ''}`);
    T('value_trend', { title: 'Home Value and Affordability Indicators', widths: [3760, 1400, 1400, 1400, 1400] });
    P(`A price-to-income ratio of ${pti.toFixed(2)} is ${pti < 3 ? 'inside the range usually considered affordable' : pti < 4 ? 'moderately above the range usually considered affordable' : 'well above the range usually considered affordable'}. The median existing home requires an income of about ${usd100(f.income_for_median_home)}.`);
    const sp = ex('supportable_price');
    T('supportable_price', { title: 'Supportable Home Price by Income Group', widths: [5360, 2000, 2000] });
    if (sp) { const can = sp.rows.filter((r) => r[1] != null && r[2] >= f.value_median).length, all = sp.rows.filter((r) => r[1] != null).length;
      P(can === all ? `Every group above can afford the existing median home. Ownership affordability, measured against existing prices, is not the binding constraint in ${nm}. Availability and condition are.` : `${cap(num(can))} of the ${num(all)} groups above can afford the existing median home of ${usd(f.value_median)}. For the others, price is a barrier before availability is.`); }
    const mk = f.market || {};
    if (mk.zillow_home_value || mk.redfin_median_sale_price || f.hpi) {
      H2('Current price signals');
      const bits = [];
      if (mk.zillow_home_value) bits.push(`Zillow's Home Value Index stood at ${usd(mk.zillow_home_value)}${mk.zillow_as_of ? ' as of ' + mk.zillow_as_of.slice(0, 7) : ''}`);
      if (mk.redfin_median_sale_price) bits.push(`Redfin's median sale price was ${usd(mk.redfin_median_sale_price)}${mk.redfin_as_of ? ' as of ' + mk.redfin_as_of.slice(0, 7) : ''}`);
      if (bits.length) P(`Market sources give a current cross-check${mk.level === 'county' && isPlace ? `, reported for ${f.county}` : ''}. ${bits.join('. ')}. The Census median of ${usd(f.value_median)} is an owner-reported value averaged over five years, so some difference is expected.`);
      if (f.hpi) P(`The Federal Housing Finance Agency's House Price Index for ${f.hpi.area} rose ${p1(f.hpi.change_pct)} from ${f.hpi.from} to ${f.hpi.to}.${f.hpi.proxy ? ' No index is published for ' + (f.county || nm) + ', so the nearest available area is shown.' : ''}`);
    }
    H2('Ownership availability');
    P(`The Census Bureau estimates ${noSale ? 'no' : n0(f.vacant_for_sale)} vacant ${plural(f.vacant_for_sale || 0, 'home')} for sale and a homeowner vacancy rate of ${p1(f.homeowner_vacancy_rate)}${f.homeowner_vacancy_rate_2015 != null ? `, against ${p1(f.homeowner_vacancy_rate_2015)} a decade earlier` : ''}.${permits ? ` ${f.county || nm} permitted ${n0(permits.single_family)} single-family ${plural(permits.single_family, 'house')} from ${pY}.` : ''}`);
    chartOf('value_distribution', { title: 'Owner-Occupied Homes by Value', height: 2400000 });
    P(`${n0(f.homes_under_100k)} of ${n0(f.owner_households)} owner-occupied homes are valued under $100,000, and ${n0(f.homes_200k_plus)} at $200,000 or more. A new home priced for the workforce band, between about ${usd(pc.p80)} and ${usd(pc.p100)}, would enter ${f.homes_200k_plus / f.owner_households < 0.3 ? 'a price tier that is thin locally' : 'an established local price tier'}.`);
    const oa = ex('owner_age');
    if (oa) {
      const senior = {}; oa.rows.forEach((r, i) => { if (/^(65|75|85)/.test(r[0])) senior[i] = 'ACCENT'; });
      B.push({ t: 'chart', title: 'Owner Households by Age of Householder', cats: oa.rows.map((r) => r[0]), series: [{ name: 'Owner households', values: oa.rows.map((r) => r[1]), color: 'SLATE', points: senior }], height: 2300000, src: srcOf(oa, 'Highlighted bars are householders aged 65 and over') });
      if (f.owners_65_plus_share >= 40) banner(`${f.owners_65_plus_share >= 48 ? 'Nearly half' : p0(f.owners_65_plus_share)} of owner households are headed by someone 65 or older.`);
      P(`Of ${n0(f.owner_households)} owner households, ${n0(f.owners_65_plus)} (${p1(f.owners_65_plus_share)}) are headed by someone 65 or older, and ${n0(f.owners_under_35)} by someone under 35.${f.owners_65_plus_share >= 35 ? ' Over the next ten to fifteen years a large share of owner-occupied homes will change hands through estates and downsizing.' + (otherVacHigh ? ` Section 2 showed what can happen to those homes: ${n0(f.other_vacant)} units already sit in the off-market vacant category.` : '') : ''}`);
    }
    H2('Where the for-sale gap sits');
    P(`For rental product the gap is in the rent. For-sale product behaves differently. At a ${p1(inp.sale.rate * 100).replace('.0%', '%')} mortgage rate a household at 80% of AMI can afford about ${usd(pc.p80)} and one at 100% about ${usd(pc.p100)}.${GA && prog.saleMin ? ` The state program's own window for for-sale workforce homes is a sale price between ${usd(prog.saleMin)} and ${usd(prog.saleMax)}.` : ''}`);
    P('Whether a builder can deliver a modest home inside that range depends chiefly on the cost of the finished lot: streets, water, sewer, drainage and utilities. That cost is site-specific. A per-lot infrastructure estimate should be added to the builder\'s sale price and compared with the ceilings above.');
    if (f.price_one_earner && f.price_two_earner) P(`Two local price points deserve attention. The median one-earner family, at ${usd(f.income_1_earner)}, can support a home near ${usd(f.price_one_earner)}. The median two-earner family, at ${usd(f.income_2_earner)}, can support about ${usd(f.price_two_earner)}.${f.workforce_families ? ` Those two groups are ${n0(f.workforce_families)} households.` : ''}`);
    if (f.households_75k_plus) { H2('The move-up market'); P(`About ${n0(f.households_75k_plus)} households, ${p0(f.households_75k_plus_share)} of the total, report incomes of $75,000 or more, enough to support a home near ${usd(f.price_at_75k)}. Against that, ${n0(f.homes_200k_plus)} homes are valued at $200,000 or more.${f.households_75k_plus > f.homes_200k_plus * 1.3 ? ' This is a product gap, not an affordability gap, and it needs no subsidy. It still matters for the workforce band: a household that could buy up and finds nothing stays in a home a workforce buyer could otherwise purchase.' : ''}`); }
    if (pc.p80 > f.value_median * 1.4) callout(`A fair objection: can a ${usd(Math.round(pc.p80 / 5000) * 5000)} home sell where the median is ${usd(f.value_median)}?`, [
      `New product near ${usd(Math.round(pc.p80 / 5000) * 5000)} is about ${p0((pc.p80 / f.value_median - 1) * 100)} above the existing median. ${old ? 'The median reflects an older stock, and new construction does not compete with it on equal terms. ' : ''}The purchasing power exists${f.workforce_families ? `: ${n0(f.workforce_families)} one-earner and two-earner families` : ''}${f.households_75k_plus ? ` and about ${n0(f.households_75k_plus)} households above $75,000` : ''}.${noSale ? ' And there is nothing for sale, so buyers who want a newer home have no local choice.' : ''}`,
      'The real risks are narrower. The market is small, so absorption may be slow. Phased delivery, with pricing tested against actual sales before a full build-out, manages that risk.']);
    callout('Owner-occupied housing takeaways', [
      pti < 3 ? '**Affordability of existing homes is not the constraint.** The price-to-income ratio is ' + pti.toFixed(2) + '.' : `**Existing homes are ${pti < 4 ? 'moderately' : 'increasingly'} expensive relative to income.** The price-to-income ratio is ${pti.toFixed(2)}.`,
      noSale ? '**Nothing is for sale.** The Census Bureau estimates no vacant homes for sale.' : null,
      f.owners_65_plus_share >= 35 ? `**Owners are aging.** ${p1(f.owners_65_plus_share)} of owner households are headed by someone 65 or older.` : null,
      `**Workforce price range.** About ${usd(pc.p80)} to ${usd(pc.p100)} at 80% to 100% of AMI.`,
      '**The for-sale gap is likely in the lot, not the house.**']);

    // ══ 5 RECOMMENDATIONS ════════════════════════════════════════════════
    H1('Recommendations', '5');
    P(`The recommendations follow from the findings above. They are grouped by product type and are general directions, not a plan for a specific site.`);
    let rn = 0; const R = (lead, text) => B.push({ t: 'num', n: ++rn, lead, text });
    H2('Rental housing');
    if (wgShort || noMarket) R(`Pursue a first workforce rental phase, sized modestly.`, `The documented gap is ${wgShort ? wgText + ' units' : 'one of product type, not unit count'}${noMarket ? ' and there is no market-rate apartment product to prove the concept' : ''}. A first phase scaled to the low end of the gap fits both the evidence and the absorption risk.${GA && f.program_over_finance_cap > 0 ? ` Pair any construction finance request with the infrastructure grant, because the vertical gap on the illustrative ${n0(f.program_units)}-unit program alone exceeds the ${usd(prog.financeCap)} cap.` : ''}`);
    if (noMarket) R('Build it as market-rate or shallow-subsidy product.', `The apartments identified are already restricted, and the workforce band is served by nothing. New two-bedroom units should be underwritten to gross rents between ${usd(rc.p80)} and ${usd(rc.p100)}.`);
    if (smallShort) R('Build small.', `One-person households are ${p1(small.household_share)} of households and studios and one-bedrooms are ${p1(small.stock_share)} of the stock. Concentrate on one-bedroom and two-bedroom units.`);
    if (f.small_multifamily_share > 15) R('Use the building form the community already has.', `Small buildings of two to nine units are ${p1(f.small_multifamily_share)} of the stock. Duplexes, quadplexes and cottage courts on infill lots fit the existing pattern and can be phased a few buildings at a time.`);
    if (f.shortage_le_50_ami > 0) R('Treat the low-income gap as a separate track.', `The ${n0(f.shortage_le_50_ami)}-unit shortage at or below 50% of AMI needs tax-credit, voucher and other deep-subsidy tools, not a workforce program.${hasInv ? ' The affordability terms of the existing subsidized properties should be confirmed, because losing even one would widen the deepest gap.' : ''}`);
    if (!rn) R('Monitor the rental market before adding supply.', 'The data do not show a count shortage in the workforce band. Confirm current rents and vacancy locally before sizing any project.');
    H2('Owner-occupied housing');
    R('Deliver finished lots for modest homes.', `Target sale prices between about ${usd(Math.round(Math.min(pc.p80, f.price_one_earner || pc.p80) / 5000) * 5000)} and ${usd(Math.round(pc.p100 / 5000) * 5000)}. Favor small-lot detached or attached homes to hold down infrastructure cost per unit.`);
    R('Phase the subdivision and price upward.', 'Start at the most affordable price to draw from the widest buyer pool. Once a first phase sells, the community has new-construction comparable sales, which lowers the risk premium for everything after it.');
    if (f.owners_65_plus_share >= 35) R('Plan for the turnover that is coming.', `${p1(f.owners_65_plus_share)} of owner households are headed by someone 65 or older. Single-level, low-maintenance homes give those owners a reason to move and release family homes to younger buyers.`);
    if (f.households_75k_plus > f.homes_200k_plus * 1.3) R('Court move-up product alongside workforce housing.', `About ${p0(f.households_75k_plus_share)} of households can support a home near ${usd(f.price_at_75k)} and only ${n0(f.homes_200k_plus)} homes are valued at $200,000 or more. This segment needs no subsidy and frees mid-priced homes for workforce buyers.`);
    if (otherVacHigh) { H2('Both product types'); R('Bring the off-market vacant stock back.', `At ${p1(f.other_vacant_share_of_units)} of all housing, the "other vacant" category is a large untapped supply. Code enforcement aimed at returning units to service, a land bank, and rehabilitation funding through CDBG, HOME and USDA home repair programs can convert some of it into occupied homes or buildable infill lots.`); }

    // ══ 6 FURTHER ANALYSIS ═══════════════════════════════════════════════
    H1('Further Analysis and Conclusion', '6');
    P('Public data can show that a need exists, how large it is and what product fits. It cannot show current asking rents, a builder\'s bid or the cost to serve a site. The steps below fill those gaps.');
    B.push({ t: 'table', title: 'Recommended Further Analysis', headers: ['Analysis', 'What it adds', 'When it is needed'], widths: [2500, 4660, 2200], align: ['l', 'l', 'l'], sz: 17, boldFirst: true, rows: [
      ['Rental market survey', 'Current asking rents, vacancies and waiting lists at the apartment properties and private landlords', 'Before sizing a rental project'],
      ['Employer and commuter survey', 'How many employees of the largest employers commute in from other communities', 'Before a funding application'],
      ['Housing unit and condition inventory', `A unit count checked against local records and a condition rating for the roughly ${n0(f.other_vacant)} off-market vacant units`, 'Before a rehabilitation or land bank program'],
      ['Development cost estimate', 'Local construction cost, operating expenses, financing terms and utility allowances', 'Before requesting gap financing'],
      ['Site and infrastructure assessment', 'Candidate sites and an engineer\'s estimate of water, sewer, street and drainage cost per lot', 'Before an infrastructure grant request'],
      ['For-sale market review', 'Recent sales, time on market, new-home comparables in nearby communities and builder interest', 'Before platting a subdivision'],
    ].concat(hasInv ? [['Subsidized housing preservation review', 'Mortgage maturity and affordability terms for the existing subsidized properties', 'Within the next year']] : [], [['Site-specific market study', 'Demand, capture rate and absorption for a defined project', 'Where a lender or funder requires one']]) });
    callout('Where to start', ['The first three items need no consultant. A few days of staff time is enough to call apartment managers and landlords, ask the largest employers where their workers live, and check the unit count against local records.']);
    H2('Conclusion');
    const c1 = [];
    if (old) c1.push(`${nm}'s housing is inexpensive largely because it is old`);
    if (slowBuild) c1.push(`${c1.length ? 'and ' : ''}very little has been added to it in a decade`);
    P(`${c1.length ? cap(c1.join(', ')) + '. ' : ''}${n0(f.renters_cost_burdened)} renter households are cost-burdened${f.owners_65_plus_share >= 35 ? ', a large share of owners are over 65' : ''}${otherVacHigh ? `, and ${n0(f.other_vacant)} homes sit vacant and off the market` : ''}${noSale ? ' while none are for sale' : ''}.`);
    P(`${rn2 && sub.p100 > 0 ? 'On the rental side, a financing gap across most of the workforce band makes the argument for public participation in a first project. ' : ''}On the ownership side, incomes support new homes between about ${usd(Math.round(pc.p80 / 5000) * 5000)} and ${usd(Math.round(pc.p100 / 5000) * 5000)}, and the main barrier is the cost of finished lots.`);
    banner(`A modest, phased program${otherVacHigh ? ' that adds new product while bringing vacant homes back into use' : ' that adds new product in both rental and for-sale form'} is the direction the public data support.`);

    // ══ APPENDIX ═════════════════════════════════════════════════════════
    H1('Appendix A: Methodology and Data Sources', 'A');
    P(`This report relies mainly on the U.S. Census Bureau's ${acs}, with earlier releases used for change in medians and rates. No commercial or subscription data was used.`);
    const g = pack.vintages.gap || {};
    B.push({ t: 'table', title: 'Data Sources', headers: ['Source', 'Used for', 'Vintage'], widths: [3660, 3600, 2100], align: ['l', 'l', 'l'], sz: 17, rows: [
      ['ACS 5-Year Estimates, U.S. Census Bureau', 'Households, tenure, income, rent, value, stock, vacancy', period],
      ['Decennial Census', 'Housing unit and group quarters counts', '2010, 2020'],
      permits ? ['Census Building Permits Survey', 'Permits by year, county', `${permits.years[0]} to ${permits.years[1]}`] : null,
      ['HUD Income Limits', 'Workforce band, rent ceilings', pack.vintages.hud_income_limits || ''],
      inp.fmr && inp.fmr.br2 ? ['HUD Fair Market Rents', 'Rent benchmarks', inp.fmr.year || ''] : null,
      g.chas ? ['HUD CHAS', 'Shortage at or below 30% and 50% of AMI', g.chas.replace('HUD CHAS ', '').replace('–', ' to ')] : null,
      hasInv ? ['HUD and USDA property records', 'Apartment inventory', 'Current'] : null,
      mk.zillow_home_value || mk.redfin_median_sale_price ? ['Zillow Home Value Index; Redfin', 'Current home value cross-check', [mk.zillow_as_of, mk.redfin_as_of].filter(Boolean).map((x) => x.slice(0, 7)).join('; ')] : null,
      f.hpi ? ['FHFA House Price Index', 'Regional price trend', `${f.hpi.from} to ${f.hpi.to}`] : null,
      ['Freddie Mac Primary Mortgage Market Survey', 'Mortgage rate', inp.sale.rateAsOf || 'Current'],
    ].filter(Boolean) });
    B.push({ t: 'table', title: 'Financial Assumptions (planning-level)', headers: ['Assumption', 'Value'], widths: [4160, 5200], align: ['l', 'l'], sz: 17, rows: pack.assumptions.filter((a) => GA || a[0] !== 'Program limits') });
    H2('Method notes');
    bullet('**Workforce rental gap.** The affordable count comes from the ACS distribution of gross rents. The availability adjustment removes units in the range that are occupied by households above the band. The HUD band is anchored on the published 80% limit.');
    bullet('**Working-age household income.** The median income of households headed by someone aged 25 to 64, estimated from ACS Table B19037.');
    bullet('**Rent ceilings and subsidy.** Affordable rents are HUD gross rents at 30% of income, sized at 1.5 persons per bedroom. Subsidy per unit is the annual rent shortfall net of operating expenses, divided by the capitalization rate.');
    bullet('**Supportable price.** 30% of gross income toward principal, interest, taxes and insurance at the mortgage terms shown above.');
    bullet('**Vacancy rates.** Vacant units for rent (or for sale) divided by occupied units of that tenure plus those vacant units, applied identically to all periods.');
    bullet('**Margins of error.** Where a figure is cited with its margin, the margin is the Census Bureau\'s 90% confidence interval.');

    const sub2 = `${f.name}, ${f.state}`, title = 'Workforce Housing Needs Assessment';
    return {
      cover: { kicker: 'Housing Market Study', subKicker: 'Rental and owner-occupied housing', eyebrow: isPlace && f.county ? `${f.county}, ${f.state}` : f.state, titleLines: ['Workforce Housing', 'Needs Assessment'], subtitle: sub2, date: dateStr,
        details: [['Study area', isPlace && f.county ? `${pack.target.full_name.replace(', ' + f.state, '')}, with ${f.county} and ${f.state} for comparison` : `${nm}, with ${f.state} for comparison`], ['Data', 'Public sources only: U.S. Census Bureau, HUD, USDA and other published data']],
        footer: `${title}   |   ${sub2}` },
      header: { left: title, right: sub2 }, footer: { left: `${title}  |  ${sub2}`, date: dateStr }, blocks: B,
      fileName: `${nm.replace(/[^A-Za-z0-9]+/g, '-')}_${title.replace(/ /g, '_')}.docx`,
    };
  }

  const api = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HANarrative = api;
})(typeof window !== 'undefined' ? window : globalThis);
