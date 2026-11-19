/*!
 * report-engine.js — the deterministic half of the housing-study generator.
 *
 * buildPack() takes the site's bundles for one community plus the analyst's
 * answers and returns a "data pack": every exhibit, every headline number, the
 * assumptions behind them, and a list of FLAGS — the conditions under which a
 * templated report would mislead (a prison in the city, a Census re-benchmark,
 * a margin of error wider than the estimate is useful).
 *
 * Nothing here writes prose and nothing here is generated: each figure is read
 * from a bundle or computed from one by a formula stated in `assumptions`.
 * The narrative is written from the pack, by a person or by Claude.
 *
 * No DOM, no fetch — the same file runs in the browser (window.HAReport) and
 * under Node for tests.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    program: {
      name: 'Georgia Rural Workforce Housing Initiative',
      infraCap: 2500000, financeCap: 1000000, saleMin: 125000, saleMax: 290000,
    },
    rental: {
      cost: { br1: 150000, br2: 180000, br3: 205000 },   // vertical construction, per unit
      capRate: 0.085, opex: 0.40, utilityAllowance: 0,
      mix: { br1: [4, 3, 3], br2: [7, 7, 6], br3: [3, 3, 4] },   // units at 80 / 100 / 120% AMI
    },
    sale: { rate: 0.0711, years: 30, down: 0.05, tax: 0.009, insurance: 1500, front: 0.30 },
    fmr: { year: '', br0: null, br1: null, br2: null, br3: null, br4: null },
    project: { name: '', builder: '', homes: null, price: null, infraRequest: null },
    inventory: [],   // [{ name, built, units, program, restricted }]
    notes: '',
  };

  // HUD / tax-credit convention: 1.5 persons per bedroom, as a share of the 4-person limit.
  const BR = [
    { key: 'br1', label: '1 bedroom', share: 0.75 },
    { key: 'br2', label: '2 bedroom', share: 0.90 },
    { key: 'br3', label: '3 bedroom', share: 1.04 },
  ];
  const BANDS = [{ k: '80', p: 0.8 }, { k: '100', p: 1.0 }, { k: '120', p: 1.2 }];

  // B25063 cash-rent bands 003..026, grouped for display.
  const RENT_GROUPS = [
    ['Under $500', 0, 8, 0], ['$500 to $599', 9, 10, 500], ['$600 to $699', 11, 12, 600], ['$700 to $799', 13, 14, 700],
    ['$800 to $899', 15, 15, 800], ['$900 to $999', 16, 16, 900], ['$1,000 to $1,249', 17, 17, 1000],
    ['$1,250 to $1,499', 18, 18, 1250], ['$1,500 to $1,999', 19, 19, 1500], ['$2,000 to $2,499', 20, 20, 2000],
    ['$2,500 to $2,999', 21, 21, 2500], ['$3,000 to $3,499', 22, 22, 3000], ['$3,500 or more', 23, 23, 3500],
  ];

  // ── small helpers ────────────────────────────────────────────────────────
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const sum = (a) => a.reduce((s, v) => s + (n(v) || 0), 0);
  const div = (a, b) => (n(a) != null && n(b) ? a / b : null);
  const pct = (a, b) => { const d = div(a, b); return d == null ? null : d * 100; };
  const chg = (a, b) => (n(a) != null && n(b) ? (b / a - 1) * 100 : null);
  const r100 = (v) => (n(v) == null ? null : Math.round(v / 100) * 100);
  const merge = (base, over) => {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const k of Object.keys(over || {})) {
      const v = over[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
    }
    return out;
  };

  // ── finance ──────────────────────────────────────────────────────────────
  function payFactor(rate, years) { const r = rate / 12, m = years * 12; return r === 0 ? 1 / m : r / (1 - Math.pow(1 + r, -m)); }
  /** Home price a household can carry: `front` share of income covers P&I + tax + insurance. */
  function supportablePrice(income, s) {
    if (n(income) == null) return null;
    const monthly = income * s.front / 12 - s.insurance / 12;
    return monthly <= 0 ? 0 : monthly / ((1 - s.down) * payFactor(s.rate, s.years) + s.tax / 12);
  }
  function incomeForPrice(price, s) {
    if (n(price) == null) return null;
    return (price * ((1 - s.down) * payFactor(s.rate, s.years) + s.tax / 12) + s.insurance / 12) * 12 / s.front;
  }
  /** Monthly rent that supports a per-unit cost at a cap rate, after operating expenses. */
  const rentNeeded = (cost, cap, opex) => cost * cap / 12 / (1 - opex);
  /** Capital subsidy that closes a monthly rent gap, capitalised at the same rate. */
  const subsidyFor = (gap, cap, opex) => (gap > 0 ? gap * 12 * (1 - opex) / cap : 0);

  // ── exhibit constructors ─────────────────────────────────────────────────
  const col = (label, fmt) => ({ label, fmt: fmt || 'text' });
  function table(id, title, columns, rows, source, note) { return { id, kind: 'table', title, columns, rows, source: source || '', note: note || '' }; }
  function chart(id, title, spec, source, note) { return { id, kind: 'chart', title, chart: spec, source: source || '', note: note || '' }; }

  // ── the pack ─────────────────────────────────────────────────────────────
  /**
   * @param ctx.target   { kind:'place'|'county', geoid, rec:{f,x,gap,permits?}, master:{name,byVintage} }
   * @param ctx.county   same shape for the parent county (place targets only), or null
   * @param ctx.state    { fips, name, ctx:{state}, pub, master:{byVintage} }
   * @param ctx.model    /analysis-data model for the target (rentBands, ami, chas, market, wahi), or null
   * @param ctx.countyModel  the county's model (market overlay), or null
   * @param ctx.meta     /report-data/meta.json
   * @param inputs       analyst answers; anything omitted falls back to DEFAULTS
   */
  function buildPack(ctx, inputs) {
    const A = merge(DEFAULTS, inputs || {});
    const T = ctx.target, C = ctx.county || null, S = ctx.state || {};
    const f = T.rec.f, x = T.rec.x || {}, g = T.rec.gap || {};
    const cf = C ? C.rec.f : null;
    const mv = (o, y) => (o && o.master && o.master.byVintage && o.master.byVintage[y]) || {};
    const m15 = mv(T, '2015'), m20 = mv(T, '2020'), m24 = mv(T, '2024');
    const c15 = mv(C, '2015'), c20 = mv(C, '2020'), c24 = mv(C, '2024');
    const s15 = mv(S, '2015'), s20 = mv(S, '2020'), s24 = mv(S, '2024');
    const sp = S.pub || {}, sc = (S.ctx && S.ctx.state) || {};
    const model = ctx.model || {};
    const ami = model.ami || (f.hud_ami && f.hud_ami.ami_80_4p ? { l80: f.hud_ami.ami_80_4p, ami: f.hud_ami.ami_80_4p / 0.8, a120: f.hud_ami.ami_80_4p * 1.5, mfi4: f.hud_ami.mfi_4p, area: f.hud_ami.fmr_area } : null);
    const Tn = (f.place_name || f.county_name || T.master && T.master.name || f.name || '').replace(/ (city|town|village|borough|CDP|municipality)$/i, '');
    const Cn = cf ? cf.county_name : null, Sn = S.name || f.state_name;
    const acsLabel = (ctx.meta && ctx.meta.acs_label) || 'ACS 2020–2024 5-Year Estimates';
    const geoCols = (fmt) => [col(Tn, fmt)].concat(C ? [col(Cn, fmt)] : [], [col(Sn, fmt)]);
    const geoRow = (label, t, c, s) => [label, t].concat(C ? [c] : [], [s]);

    const flags = [], exhibits = [], facts = {};
    const flag = (id, severity, title, detail, effect) => flags.push({ id, severity, title, detail, effect: effect || '' });

    // ── basics ─────────────────────────────────────────────────────────────
    const hh = f.units_occupied, own = f.tenure_owner_occupied, ren = f.tenure_renter_occupied;
    const statePop = sum([s24.age_under18, s24.age_18_24, s24.age_25_44, s24.age_45_64, s24.age_65_plus]) || sc.population_total;
    const eduTot = (r) => sum([r.edu_lt_9th, r.edu_9_12_no_diploma, r.edu_hs_grad, r.edu_some_college, r.edu_associates, r.edu_bachelors, r.edu_graduate]);
    const bachPlus = (r) => pct(sum([r.edu_bachelors, r.edu_graduate]), eduTot(r));
    const noHs = (r) => pct(sum([r.edu_lt_9th, r.edu_9_12_no_diploma]), eduTot(r));
    // Poverty and households with children: prefer the published ACS tables carried in report-extra (B17001, B11005).
    const xa = (r) => (r && r.x && r.x.acs) || {};
    const pov = (r, fb) => { const a = xa(r); return a.pov_den ? a.pov_num / a.pov_den * 100 : fb; };
    const kids = (r) => (xa(T.rec).hh_kids != null ? xa(T.rec).hh_kids : r.hh_with_children_u18 != null ? r.hh_with_children_u18 : r.hh_with_children);
    const gq = x.acs ? x.acs.gq : null, gqShare = div(gq, f.population_total);
    const hhPop = gq != null ? f.population_total - gq : null;

    Object.assign(facts, {
      name: Tn, county: Cn, state: Sn, kind: T.kind, geoid: T.geoid,
      population: f.population_total, group_quarters: gq, group_quarters_share: gqShare != null ? gqShare * 100 : null, household_population: hhPop,
      households: hh, owner_households: own, renter_households: ren,
      owner_share: pct(own, hh), renter_share: pct(ren, hh),
      households_with_children: kids(f), households_with_children_share: pct(kids(f), hh),
      mhi: f.hh_income_median, mhi_owner: f.income_median_owner, mhi_renter: f.income_median_renter,
      poverty_rate: pov(T.rec, f.poverty_rate), median_age: f.median_age,
    });

    // ── flags that change how the rest must be read ────────────────────────
    if (gqShare != null && gqShare >= 0.05) {
      flag('group_quarters', gqShare >= 0.15 ? 'high' : 'medium',
        `${(gqShare * 100).toFixed(0)}% of the counted population lives in group quarters`,
        `${gq.toLocaleString('en-US')} of ${f.population_total.toLocaleString('en-US')} residents are in group quarters (prisons, dormitories, barracks, nursing facilities). Identify which before writing.`,
        'Population, median age, race and ethnicity, education, per capita income and labor force figures include them. Household, tenure, household income, rent, value and housing-unit figures do not. Do not show a population, age or race trend.');
    }
    const acs20units = n(m20.total_housing_units), dec20units = x.dec20 ? n(x.dec20.units) : null;
    const benchGap = acs20units && dec20units ? acs20units / dec20units - 1 : null;
    const countsComparable = benchGap == null ? null : Math.abs(benchGap) <= 0.12;
    if (countsComparable === false) {
      flag('benchmark_break', 'high',
        'Housing unit counts before 2020 are not comparable with current counts',
        `ACS 2016–2020 estimated ${acs20units.toLocaleString('en-US')} housing units; the 2020 Census counted ${dec20units.toLocaleString('en-US')} (the survey estimate is ${Math.abs(benchGap * 100).toFixed(0)}% ${benchGap > 0 ? 'higher' : 'lower'}). Earlier ACS estimates were controlled to the 2010 Census base.`
          + (T.kind === 'county' && x.dec10 ? ` The 2010 Census counted ${x.dec10.units.toLocaleString('en-US')} units in the county.` : ''),
        'Compare medians and rates across periods, never unit or household counts. Do not describe the difference as housing lost or gained.');
    }
    const moe = x.acs || {};
    const wide = [];
    if (div(moe.mhi_moe, f.hh_income_median) > 0.25) wide.push(`median household income $${f.hh_income_median.toLocaleString('en-US')} ± $${moe.mhi_moe.toLocaleString('en-US')}`);
    if (div(moe.value_moe, f.value_median) > 0.25) wide.push(`median home value $${f.value_median.toLocaleString('en-US')} ± $${moe.value_moe.toLocaleString('en-US')}`);
    if (div(moe.rent_moe, f.rent_median) > 0.25) wide.push(`median gross rent $${f.rent_median.toLocaleString('en-US')} ± $${moe.rent_moe.toLocaleString('en-US')}`);
    if (wide.length) flag('wide_moe', 'medium', 'Key medians carry wide margins of error', wide.join('; ') + ' (90% confidence).', C ? `Show ${Cn} alongside and lean on it where the two disagree.` : 'State the margin wherever the figure is cited.');
    const suppressed = [];
    if (f.rent_median_1br == null) suppressed.push('one-bedroom median rent');
    if (f.rent_median_2br == null) suppressed.push('two-bedroom median rent');
    if (f.income_median_25_44 == null) suppressed.push('median income, householder 25 to 44');
    if (f.income_median_45_64 == null) suppressed.push('median income, householder 45 to 64');
    if (suppressed.length) flag('suppressed', 'low', 'Some estimates are suppressed by the Census Bureau', suppressed.join('; ') + '.', 'Leave them out; do not estimate them.');
    if (g.thin) flag('thin_gap', 'medium', 'The gap estimates rest on a thin sample', `HUD CHAS counts ${g.crt != null ? g.crt.toLocaleString('en-US') : 'far fewer'} renter households against ${ren.toLocaleString('en-US')} in the ACS.`, 'Present the workforce and low-income gaps as an order of magnitude.');
    if (!ami) flag('no_hud_ami', 'high', 'No HUD income limit matched this geography', 'The workforce band, rent ceilings and financing gap cannot be computed.', 'Enter the county HUD 80% limit manually or resolve the county match.');

    // ── 1. community summary ───────────────────────────────────────────────
    exhibits.push(table('community_summary', 'Community data summary', [col('Indicator')].concat(geoCols('auto')), [
      geoRow('Population', f.population_total, cf && cf.population_total, statePop),
      geoRow('Living in group quarters', gq, C && C.rec.x && C.rec.x.acs ? C.rec.x.acs.gq : null, null),
      geoRow('Households', hh, cf && cf.units_occupied, s24.occupied_units),
      geoRow('Average household size', { v: f.hh_avg_size, fmt: 'num2' }, cf && { v: cf.hh_avg_size, fmt: 'num2' }, { v: sp.hh_avg_size, fmt: 'num2' }),
      geoRow('Median age', { v: f.median_age, fmt: 'num1' }, cf && { v: cf.median_age, fmt: 'num1' }, { v: sp.median_age != null ? sp.median_age : s24.median_age, fmt: 'num1' }),
      geoRow('Owner-occupied share', { v: pct(own, hh), fmt: 'pct1' }, cf && { v: pct(cf.tenure_owner_occupied, cf.units_occupied), fmt: 'pct1' }, { v: pct(s24.owner_occupied, s24.occupied_units), fmt: 'pct1' }),
      geoRow('Renter-occupied share', { v: pct(ren, hh), fmt: 'pct1' }, cf && { v: pct(cf.tenure_renter_occupied, cf.units_occupied), fmt: 'pct1' }, { v: pct(s24.renter_occupied, s24.occupied_units), fmt: 'pct1' }),
      geoRow('Median household income', { v: f.hh_income_median, fmt: 'usd' }, cf && { v: cf.hh_income_median, fmt: 'usd' }, { v: sp.hh_income_median != null ? sp.hh_income_median : s24.median_hh_income, fmt: 'usd' }),
      geoRow('Per capita income', { v: f.per_capita_income, fmt: 'usd' }, cf && { v: cf.per_capita_income, fmt: 'usd' }, { v: sp.per_capita_income != null ? sp.per_capita_income : s24.per_capita_income, fmt: 'usd' }),
      geoRow("Bachelor's degree or higher (25+)", { v: bachPlus(f), fmt: 'pct1' }, cf && { v: bachPlus(cf), fmt: 'pct1' }, { v: pct(s24.edu_bachelors_or_higher, sum([s24.edu_less_than_hs, s24.edu_hs_or_higher])), fmt: 'pct1' }),
      geoRow('Poverty rate (individuals)', { v: pov(T.rec, f.poverty_rate), fmt: 'pct1' }, cf && { v: pov(C && C.rec, cf.poverty_rate), fmt: 'pct1' }, { v: sp.poverty_rate, fmt: 'pct1' }),
    ], `U.S. Census Bureau, ${acsLabel}`,
    gqShare >= 0.05 ? 'Population, median age, per capita income and education include the group quarters population. Poverty is measured only for people outside institutions.' : ''));

    // ── 2. race and ethnicity (current period only) ────────────────────────
    const eth = (r) => (r && r.eth_total ? [pct(r.eth_nh_white, r.eth_total), pct(r.eth_nh_black, r.eth_total), pct(r.eth_hispanic, r.eth_total), pct(r.eth_nh_two_plus, r.eth_total), pct(r.eth_nh_asian, r.eth_total)] : [null, null, null, null, null]);
    const eT = eth(f), eC = eth(cf), eS = [s24.race_white_nh, s24.race_black_nh, s24.race_hispanic, s24.race_two_plus_nh, s24.race_asian_nh].map((v) => (n(v) != null ? v * 100 : null));
    exhibits.push(table('race_ethnicity', 'Race and ethnicity', [col('Race / ethnicity')].concat(geoCols('pct1')),
      ['White, non-Hispanic', 'Black, non-Hispanic', 'Hispanic or Latino (any race)', 'Two or more races, non-Hispanic', 'Asian, non-Hispanic'].map((l, i) => geoRow(l, eT[i], eC[i], eS[i])),
      `${acsLabel}, Table DP05`, gqShare >= 0.05 ? 'Includes the group quarters population. No trend is shown.' : ''));

    // ── 3. income trend ────────────────────────────────────────────────────
    const trendCols = [col('Geography'), col('2011 to 2015', 'usd'), col('2016 to 2020', 'usd'), col('2020 to 2024', 'usd'), col('Change', 'pctchg')];
    const tr = (label, a, b, c) => [label, a, b, c, chg(a, c)];
    exhibits.push(table('income_trend', 'Median household income, 2015 to 2024', trendCols,
      [tr(Tn, m15.median_hh_income, m20.median_hh_income, m24.median_hh_income)].concat(C ? [tr(Cn, c15.median_hh_income, c20.median_hh_income, c24.median_hh_income)] : [], [tr(Sn, s15.median_hh_income, s20.median_hh_income, s24.median_hh_income)]),
      'ACS 5-Year Estimates, Table B19013', 'Not adjusted for inflation.'));
    facts.mhi_change_pct = chg(m15.median_hh_income, m24.median_hh_income);

    // ── 4. income by tenure ────────────────────────────────────────────────
    const tenureSeries = [{ name: Tn, values: [f.hh_income_median, f.income_median_owner, f.income_median_renter] }]
      .concat(C ? [{ name: Cn, values: [cf.hh_income_median, cf.income_median_owner, cf.income_median_renter] }] : [],
        [{ name: Sn, values: [sp.hh_income_median != null ? sp.hh_income_median : s24.median_hh_income, sp.income_median_owner != null ? sp.income_median_owner : s24.mhi_owner, sp.income_median_renter != null ? sp.income_median_renter : s24.mhi_renter] }]);
    exhibits.push(chart('income_by_tenure', 'Median household income by tenure', { type: 'grouped', fmt: 'usd', categories: ['All households', 'Owner households', 'Renter households'], series: tenureSeries }, `${acsLabel}, Tables B19013 and B25119`));
    facts.renter_affordable_rent = n(f.income_median_renter) != null ? f.income_median_renter * 0.30 / 12 : null;

    // ── 5. earners ─────────────────────────────────────────────────────────
    const fam = sum([f.earners_0, f.earners_1, f.earners_2, f.earners_3_plus]);
    exhibits.push(table('earners', 'Median income by number of earners', [col('Household type'), col('Households', 'int'), col('Share', 'pct1'), col('Share of'), col('Median income', 'usd')], [
      ['Families, no earner', f.earners_0, pct(f.earners_0, fam), 'families', f.earners_0_income],
      ['Families, one earner', f.earners_1, pct(f.earners_1, fam), 'families', f.earners_1_income],
      ['Families, two earners', f.earners_2, pct(f.earners_2, fam), 'families', f.earners_2_income],
      ['Families, three or more earners', f.earners_3_plus, pct(f.earners_3_plus, fam), 'families', f.earners_3_plus_income],
      ['Non-family households', f.earners_nonfamily, pct(f.earners_nonfamily, hh), 'all households', f.earners_nonfamily_income],
    ], `${acsLabel}, Table S1903`));
    facts.workforce_families = sum([f.earners_1, f.earners_2]);
    facts.income_1_earner = f.earners_1_income; facts.income_2_earner = f.earners_2_income;

    // ── 6. education and labor force ───────────────────────────────────────
    const lfAdj = gqShare >= 0.05 && n(f.lfpr_16_plus) != null && n(f.pop_16_plus) && gq < f.pop_16_plus ? f.lfpr_16_plus * f.pop_16_plus / (f.pop_16_plus - gq) : null;
    exhibits.push(table('education_labor', 'Education and labor force', [col('Indicator')].concat(geoCols('pct1')), [
      geoRow("Bachelor's degree or higher (25+)", bachPlus(f), cf && bachPlus(cf), pct(s24.edu_bachelors_or_higher, sum([s24.edu_less_than_hs, s24.edu_hs_or_higher]))),
      geoRow('No high school diploma (25+)', noHs(f), cf && noHs(cf), pct(s24.edu_less_than_hs, sum([s24.edu_less_than_hs, s24.edu_hs_or_higher]))),
      geoRow('Labor force participation (16+)', f.lfpr_16_plus, cf && cf.lfpr_16_plus, sc.lfpr_16_plus),
      geoRow('Unemployment rate', f.unemployment_rate, cf && cf.unemployment_rate, sc.unemployment_rate),
    ], `${acsLabel}, Tables B15003 and S2301`,
    lfAdj != null ? `Includes the group quarters population. Removing all ${gq.toLocaleString('en-US')} group quarters residents from the population 16 and over gives a participation rate of about ${lfAdj.toFixed(0)}% among household residents — an analyst estimate, not a published figure.` : ''));
    facts.lfpr_household_estimate = lfAdj;

    // ── 7. permits (county) ────────────────────────────────────────────────
    const permitRec = T.kind === 'county' ? T.rec.permits : C && C.rec.permits;
    const pYears = (ctx.meta && ctx.meta.permit_years) || [];
    if (permitRec && pYears.length) {
      const sf = permitRec.map((p) => (p ? p[0] : null)), mid = permitRec.map((p) => (p ? p[1] : null)), big = permitRec.map((p) => (p ? p[2] : null));
      exhibits.push(chart('permits', `Housing units permitted per year, ${T.kind === 'county' ? Tn : Cn}`, {
        type: 'stacked', fmt: 'int', categories: pYears.map(String),
        series: [{ name: 'Single-family', values: sf }, { name: '2 to 4 units', values: mid }, { name: '5 or more units', values: big }],
      }, 'U.S. Census Bureau, Building Permits Survey, annual county files', T.kind === 'place' ? 'Permits are reported for the county, not the city.' : ''));
      facts.permits = { years: [pYears[0], pYears[pYears.length - 1]], single_family: sum(sf), units_2_to_4: sum(mid), units_5_plus: sum(big), total: sum(sf) + sum(mid) + sum(big), multifamily_years: pYears.filter((y, i) => (big[i] || 0) + (mid[i] || 0) > 0) };
      if (facts.permits.units_5_plus === 0) flag('no_mf_permits', 'info', `No building of 5 or more units permitted in the county, ${pYears[0]} to ${pYears[pYears.length - 1]}`, '', 'Useful evidence that the market is not producing multifamily housing.');
    }

    // ── 8. structure type ──────────────────────────────────────────────────
    const ST = [['Single-family detached', 'structure_1_detached', '1_detached'], ['Single-family attached', 'structure_1_attached', '1_attached'], ['Duplex', 'structure_2', '2'], ['3 to 4 units', 'structure_3_4', '3_4'], ['5 to 9 units', 'structure_5_9', '5_9'], ['10 to 19 units', 'structure_10_19', '10_19'], ['20 to 49 units', 'structure_20_49', '20_49'], ['50 or more units', 'structure_50_plus', '50_plus'], ['Mobile home', 'structure_mobile', 'mobile']];
    exhibits.push(table('structure_type', 'Housing units by structure type', [col('Structure type'), col('Units', 'int'), col('Share', 'pct1')],
      ST.filter((s) => f[s[1]] > 0).map((s) => [s[0], f[s[1]], pct(f[s[1]], f.units_total)]).sort((a, b) => b[1] - a[1]),
      `${acsLabel}, Table B25024`, 'Categories with no units are omitted.'));
    const mm = sum([f.structure_2, f.structure_3_4, f.structure_5_9, f.structure_10_19]);
    facts.small_multifamily_units = mm; facts.small_multifamily_share = pct(mm, f.units_total);
    const yb = ['year_built_2020_plus', 'year_built_2010_19', 'year_built_2000_09', 'year_built_1980_99', 'year_built_1960_79', 'year_built_1940_59', 'year_built_1939_earlier'].map((k) => f[k] || 0);
    facts.median_year_built = f.structure_median_age; facts.pre_1980_share_of_occupied = pct(yb[4] + yb[5] + yb[6], sum(yb));
    facts.built_2020_plus = yb[0]; facts.built_2010_19 = yb[1];

    // ── 9. size mismatch ───────────────────────────────────────────────────
    const stock = [sum([f.br_0, f.br_1]), f.br_2, f.br_3, sum([f.br_4, f.br_5_plus])], hhs = [f.hh_size_1, f.hh_size_2, f.hh_size_3, f.hh_size_4_plus];
    const stockT = sum(stock), hhT = sum(hhs), mmCats = ['Studio or 1 BR vs. 1 person', '2 BR vs. 2 people', '3 BR vs. 3 people', '4+ BR vs. 4+ people'];
    exhibits.push(chart('size_mismatch', 'Housing stock by bedrooms against households by size', { type: 'grouped', fmt: 'pct1', categories: mmCats, series: [{ name: `Housing units (${stockT.toLocaleString('en-US')})`, values: stock.map((v) => pct(v, stockT)) }, { name: `Households (${hhT.toLocaleString('en-US')})`, values: hhs.map((v) => pct(v, hhT)) }] }, `${acsLabel}, Tables B25041 and B25009`, 'Each series is a share of its own total; bedroom counts include vacant units.'));
    exhibits.push(table('size_mismatch_detail', 'Housing size mismatch, detail', [col('Unit size vs. household size'), col('Units', 'int'), col('Share of stock', 'pct1'), col('Households', 'int'), col('Share of households', 'pct1'), col('Gap (points)', 'signed1')],
      mmCats.map((l, i) => [l, stock[i], pct(stock[i], stockT), hhs[i], pct(hhs[i], hhT), pct(stock[i], stockT) - pct(hhs[i], hhT)]),
      `${acsLabel}, Tables B25041 and B25009`, 'A positive gap means the stock holds a larger share of that size than households do.'));
    facts.mismatch = mmCats.map((l, i) => ({ label: l, stock_share: pct(stock[i], stockT), household_share: pct(hhs[i], hhT) }));

    // ── 10. non-occupancy by structure ─────────────────────────────────────
    if (f.units_by_structure) {
      const rows = ST.map((s) => [s[0], f.units_by_structure[s[2]]]).filter((r) => r[1] && r[1].total >= 50)
        .map((r) => [r[0], r[1].total, r[1].vacant, r[1].rate]).sort((a, b) => b[3] - a[3]);
      exhibits.push(table('non_occupancy', 'Non-occupancy by structure type', [col('Structure type'), col('Units', 'int'), col('Not occupied', 'int'), col('Rate', 'pct0')], rows,
        `${acsLabel}, all units (B25024) less occupied units (B25032)`, 'A non-occupancy rate, not a market vacancy rate: it includes units held off the market. Categories under 50 units are omitted.'));
    }

    // ── 11. vacancy composition ────────────────────────────────────────────
    const vacT = f.units_vacant, fric = sum([f.vacant_for_rent, f.vacant_rented_not_occ, f.vacant_for_sale, f.vacant_sold_not_occ]);
    exhibits.push(table('vacancy_composition', 'Vacant units by status', [col('Status'), col('Units', 'int'), col('Share of vacant', 'pct1'), col('Share of all units', 'pct1')],
      [['For rent', f.vacant_for_rent], ['Rented, not yet occupied', f.vacant_rented_not_occ], ['For sale', f.vacant_for_sale], ['Sold, not yet occupied', f.vacant_sold_not_occ], ['Seasonal or migrant', sum([f.vacant_seasonal, f.vacant_migrant])], ['Other vacant', f.vacant_other]]
        .map((r) => [r[0], r[1] || 0, pct(r[1] || 0, vacT), pct(r[1] || 0, f.units_total)]).concat([['Total vacant', vacT, 100, pct(vacT, f.units_total)]]),
      `${acsLabel}, Table B25004`, '"Other vacant" covers homes held in estates, under repair, in foreclosure, condemned or abandoned.' + (moe.other_vacant_moe ? ` Its margin of error is ±${moe.other_vacant_moe.toLocaleString('en-US')} units.` : '')));
    Object.assign(facts, { units_total: f.units_total, units_moe: moe.units_moe || null, census_2020_units: dec20units, vacant_units: vacT, vacancy_rate: pct(vacT, f.units_total), frictional_vacant: fric, other_vacant: f.vacant_other, other_vacant_share_of_units: pct(f.vacant_other, f.units_total), other_vacant_moe: moe.other_vacant_moe || null, vacant_for_sale: f.vacant_for_sale || 0, vacant_for_rent: f.vacant_for_rent || 0 });
    if (facts.other_vacant_share_of_units > 5) flag('other_vacant', 'info', `"Other vacant" units are ${facts.other_vacant_share_of_units.toFixed(1)}% of all housing`, 'Above the 5% level generally read as an early sign of disinvestment.', 'Support a rehabilitation and code-enforcement recommendation.');
    if ((f.vacant_for_sale || 0) === 0) flag('nothing_for_sale', 'info', 'The ACS estimates zero vacant homes for sale', '', 'Availability, not price, is the ownership constraint.');

    // ── 12. rent burden ────────────────────────────────────────────────────
    const rb = [sum([f.rent_burden_lt_10, f.rent_burden_10_14, f.rent_burden_15_19]), sum([f.rent_burden_20_24, f.rent_burden_25_29]), sum([f.rent_burden_30_34, f.rent_burden_35_39]), f.rent_burden_40_49 || 0, f.rent_burden_50_plus || 0, f.rent_burden_not_computed || 0];
    const burdened = rb[2] + rb[3] + rb[4];
    exhibits.push(chart('rent_burden', 'Renter households by gross rent as a share of income', { type: 'bar', fmt: 'int', share: true, categories: ['Under 20%', '20 to 29%', '30 to 39%', '40 to 49%', '50% or more', 'Not computed'], series: [{ name: 'Renter households', values: rb }], highlight: [2, 3, 4], muted: [5] }, `${acsLabel}, Table B25070`, 'Not computed: households paying no cash rent or reporting zero or negative income.'));
    Object.assign(facts, { renters_cost_burdened: burdened, renters_cost_burdened_share: pct(burdened, ren), renters_severely_burdened: rb[4], renters_severely_burdened_share: pct(rb[4], ren), renters_burden_not_computed: rb[5], renters_no_cash_rent: f.cb_renter_no_cash || 0, renters_burdened_share_of_computed: pct(burdened, ren - rb[5]) });
    if (pct(f.cb_renter_no_cash || 0, ren) > 10) flag('no_cash_rent', 'low', `${pct(f.cb_renter_no_cash, ren).toFixed(0)}% of renter households pay no cash rent`, '', 'The headline cost-burden rate understates burden among households that do pay rent; cite both bases.');

    // ── 13. rent indicators ────────────────────────────────────────────────
    const fmrRows = [['studio', 'br0'], ['1-bedroom', 'br1'], ['2-bedroom', 'br2'], ['3-bedroom', 'br3'], ['4-bedroom', 'br4']].filter((r) => n(A.fmr[r[1]]) != null)
      .map((r) => [`HUD Fair Market Rent, ${r[0]}`, A.fmr[r[1]], `HUD ${A.fmr.year || 'FMR'}${Cn || T.kind === 'county' ? ', ' + (Cn || Tn) : ''}`]);
    exhibits.push(table('rent_indicators', 'Rent indicators', [col('Rent indicator'), col('Amount', 'usd'), col('Source')],
      [['Median gross rent, all units', f.rent_median], ['Median gross rent, 1-bedroom', f.rent_median_1br], ['Median gross rent, 2-bedroom', f.rent_median_2br], ['Median gross rent, 3-bedroom', f.rent_median_3br]]
        .filter((r) => r[1] != null).map((r) => [r[0], r[1], `ACS, ${Tn}`]).concat(fmrRows),
      `${acsLabel}, Table B25031` + (fmrRows.length ? '; HUD Fair Market Rents' : ''), fmrRows.length ? '' : 'HUD Fair Market Rents not entered.'));
    Object.assign(facts, { rent_median: f.rent_median, rent_median_2015: m15.median_gross_rent, rent_change_pct: chg(m15.median_gross_rent, m24.median_gross_rent), state_rent_median: sp.rent_median != null ? sp.rent_median : s24.median_gross_rent });

    // ── 14. income anchors ─────────────────────────────────────────────────
    const wahi = n(model.wahi) != null ? model.wahi : g.wahi;
    const anchors = [['ACS median household income (MHI)', f.hh_income_median, 'All households'], ['Working-age household income (WAHI)', wahi, 'Householder aged 25 to 64']];
    const anchorRows = anchors.filter((a) => n(a[1]) != null).map((a) => [a[0], a[1] * 0.8, a[1], a[1] * 1.2, a[2]]);
    if (ami) anchorRows.push(['HUD income limit, 4-person', ami.l80, ami.ami, ami.a120, `HUD Section 8 limits${ami.area ? ', ' + ami.area : ''}`]);
    exhibits.push(table('income_anchors', 'Workforce income bands under three anchors', [col('Income anchor'), col('80%', 'usd'), col('100%', 'usd'), col('120%', 'usd'), col('Basis')], anchorRows,
      `${acsLabel}; HUD Income Limits`, 'HUD publishes the 80% limit; 100% and 120% are derived from it.'));
    Object.assign(facts, { wahi, hud_80: ami && ami.l80, hud_100: ami && ami.ami, hud_120: ami && ami.a120, hud_mfi: ami && ami.mfi4, hud_area: ami && ami.area, hud_80_over_mhi_pct: ami ? (ami.l80 / f.hh_income_median - 1) * 100 : null });
    if (ami && ami.mfi4 && Math.abs(ami.ami / ami.mfi4 - 1) > 0.05) flag('hud_floor', 'low', 'The HUD band is not built on the county\'s own median', `HUD median family income is $${ami.mfi4.toLocaleString('en-US')}; the published 80% limit implies $${Math.round(ami.ami).toLocaleString('en-US')}.`, 'Explain that HUD applies floors and adjustments (often the state non-metropolitan median). Sources will disagree on "the" AMI.');

    // ── 15. apartment inventory (analyst-entered) ──────────────────────────
    const inv = (A.inventory || []).filter((p) => p && p.name);
    if (inv.length) {
      const invUnits = sum(inv.map((p) => Number(p.units) || 0)), invRestricted = sum(inv.filter((p) => p.restricted !== false).map((p) => Number(p.units) || 0));
      exhibits.push(table('inventory', 'Apartment properties identified', [col('Property'), col('Built'), col('Units', 'int'), col('Program')],
        inv.map((p) => [p.name, p.built || '', Number(p.units) || null, p.program || '']).concat([['Total', '', invUnits, `${invRestricted.toLocaleString('en-US')} restricted or subsidized`]]),
        'HUD, USDA and state housing records; see sources', ''));
      Object.assign(facts, { inventory_properties: inv.length, inventory_units: invUnits, inventory_restricted_units: invRestricted, inventory_market_units: invUnits - invRestricted, inventory_share_of_renters: pct(invUnits, ren) });
    } else {
      flag('no_inventory', 'medium', 'No apartment inventory entered', 'The report builder has no property list for this community.', 'Assemble one from HUD LIHTC, HUD multifamily, USDA Section 515 and state records before writing the rental section.');
    }

    // ── 16–19. financing ───────────────────────────────────────────────────
    const R = A.rental;
    const ceil = (b, p) => (ami ? ami.ami * p * b.share * 0.30 / 12 - (R.utilityAllowance || 0) : null);
    const need = (b, cap) => rentNeeded(R.cost[b.key], cap, R.opex);
    const rawSubsidy = [];   // unrounded, so program totals are not built from rounded parts
    const finRows = BR.map((b) => {
      const rn = need(b, R.capRate), row = [b.label, R.cost[b.key], rn], raw = [];
      BANDS.forEach((bd) => { const a = ceil(b, bd.p), sub = a == null ? null : subsidyFor(rn - a, R.capRate, R.opex); raw.push(sub || 0); row.push(a, sub == null ? null : r100(sub)); });
      rawSubsidy.push(raw);
      return row;
    });
    const rentNeed2 = need(BR[1], R.capRate);
    if (ami) {
      exhibits.push(table('financing_gap', 'Rental financing gap across the workforce band',
        [col('Unit type'), col('Vertical cost', 'usd'), col('Rent needed', 'usd'), col('Affordable at 80%', 'usd'), col('Subsidy at 80%', 'usd'), col('Affordable at 100%', 'usd'), col('Subsidy at 100%', 'usd'), col('Affordable at 120%', 'usd'), col('Subsidy at 120%', 'usd')], finRows,
        'HUD Income Limits; analyst assumptions', `Affordable rents are HUD gross rents at 30% of income, 1.5 persons per bedroom${R.utilityAllowance ? `, less a $${R.utilityAllowance} utility allowance` : ''}. Subsidy is the annual rent shortfall net of operating expenses, capitalized at ${(R.capRate * 100).toFixed(1)}%. Vertical construction only.`));
      let total = 0, units = 0, atOrBelow100 = 0;
      const progRows = BR.map((b, i) => {
        const mix = R.mix[b.key] || [0, 0, 0];
        const gapFin = r100(mix.reduce((s, u, j) => s + u * rawSubsidy[i][j], 0));
        total += mix.reduce((s, u, j) => s + u * rawSubsidy[i][j], 0); units += sum(mix); atOrBelow100 += mix[0] + mix[1];
        return [b.label, mix[0], mix[1], mix[2], sum(mix), gapFin];
      });
      exhibits.push(table('program', `Representative ${units}-unit mixed-income program`, [col('Product'), col('Units at 80%', 'int'), col('Units at 100%', 'int'), col('Units at 120%', 'int'), col('Total units', 'int'), col('Gap financing', 'usd')],
        progRows.concat([['Total', sum(progRows.map((r) => r[1])), sum(progRows.map((r) => r[2])), sum(progRows.map((r) => r[3])), units, r100(total)]]),
        'Analyst assumptions', 'Illustrative only. Vertical construction; land, demolition and site infrastructure are additional.'));
      const sens = [R.capRate - 0.01, R.capRate, R.capRate + 0.01].map((cap) => {
        const rn = need(BR[1], cap);
        return [{ v: cap * 100, fmt: 'pct1' }, rn].concat(BANDS.map((bd) => { const gp = rn - ceil(BR[1], bd.p); return gp > 0 ? r100(subsidyFor(gp, cap, R.opex)) : { v: null, text: 'None needed' }; }));
      });
      exhibits.push(table('cap_rate_sensitivity', 'Sensitivity of the two-bedroom gap to the capitalization rate', [col('Capitalization rate'), col('Rent needed', 'usd'), col('Subsidy at 80%', 'usd'), col('Subsidy at 100%', 'usd'), col('Subsidy at 120%', 'usd')], sens, 'Analyst assumptions'));
      Object.assign(facts, {
        rent_needed: { br1: need(BR[0], R.capRate), br2: rentNeed2, br3: need(BR[2], R.capRate) },
        rent_ceiling_2br: { p80: ceil(BR[1], 0.8), p100: ceil(BR[1], 1.0), p120: ceil(BR[1], 1.2) },
        subsidy_2br: { p80: finRows[1][4], p100: finRows[1][6], p120: finRows[1][8] },
        program_units: units, program_gap_financing: r100(total), program_gap_per_unit: units ? r100(total / units) : null,
        program_units_at_or_below_100: atOrBelow100, program_over_finance_cap: r100(total) - A.program.financeCap,
        workforce_rent_range_4p: [ami.l80 * 0.3 / 12, ami.a120 * 0.3 / 12],
      });
    }

    // ── 20. rent distribution ──────────────────────────────────────────────
    if (model.rentBands) {
      let groups = RENT_GROUPS.map((gr) => ({ label: gr[0], lo: gr[3], n: sum(model.rentBands.slice(gr[1], gr[2] + 1)) }));
      const lastUsed = Math.max(groups.reduce((mx, gr, i) => (gr.n > 0 ? i : mx), 0), groups.reduce((mx, gr, i) => (gr.lo <= rentNeed2 ? i : mx), 0));
      groups = groups.slice(0, Math.min(groups.length, lastUsed + 1));
      if (groups.length < RENT_GROUPS.length) groups[groups.length - 1].label = groups[groups.length - 1].label.replace(/ to .*/, ' or more');
      const slot = (v) => groups.reduce((mx, gr, i) => (gr.lo <= v ? i : mx), 0);
      const top = groups.reduce((mx, gr, i) => (gr.n > 0 ? i : mx), 0), topNext = RENT_GROUPS[top + 1];
      exhibits.push(chart('rent_distribution', 'Rental units by monthly gross rent', {
        type: 'bar', fmt: 'int', categories: groups.map((gr) => gr.label), series: [{ name: 'Units paying cash rent', values: groups.map((gr) => gr.n) }],
        refs: ami ? [{ label: 'Two-bedroom rent affordable at 80% of AMI', value: ceil(BR[1], 0.8), slot: slot(ceil(BR[1], 0.8)) }, { label: 'Rent needed to finance a new two-bedroom', value: rentNeed2, slot: slot(rentNeed2) }] : [],
      }, `${acsLabel}, Table B25063`, ''));
      Object.assign(facts, { cash_rent_units: sum(model.rentBands), no_unit_rents_at_or_above: topNext ? topNext[3] : null, units_at_or_above_80pct_2br_rent: ami ? sum(groups.filter((gr) => gr.lo >= ceil(BR[1], 0.8)).map((gr) => gr.n)) : null });
    }

    // ── 21. vacancy rates over time (rates are comparable across the break) ─
    const rv = (m) => pct(m.vacant_for_rent, sum([m.renter_occupied, m.vacant_for_rent])), ov = (m) => pct(m.vacant_for_sale, sum([m.owner_occupied, m.vacant_for_sale]));
    exhibits.push(table('vacancy_trend', 'Vacancy rates, 2015 to 2024', [col('Measure'), col('2011 to 2015', 'pct1'), col('2016 to 2020', 'pct1'), col('2020 to 2024', 'pct1')],
      [['Rental vacancy rate', rv(m15), rv(m20), rv(m24)], ['Homeowner vacancy rate', ov(m15), ov(m20), ov(m24)]],
      'ACS 5-Year Estimates, Tables B25003 and B25004', 'Vacant units for rent (or for sale) divided by occupied units of that tenure plus those vacant units, applied identically to all three periods.'));
    Object.assign(facts, { rental_vacancy_rate: rv(m24), rental_vacancy_rate_2015: rv(m15), homeowner_vacancy_rate: ov(m24), homeowner_vacancy_rate_2015: ov(m15) });

    // ── 22. counts over time — only where the benchmark allows it ──────────
    if (countsComparable !== false) {
      exhibits.push(table('count_trend', 'Housing units and households, 2015 to 2024', [col('Measure'), col('2011 to 2015', 'int'), col('2016 to 2020', 'int'), col('2020 to 2024', 'int'), col('Change', 'pctchg')],
        [['Housing units', 'total_housing_units'], ['Owner-occupied households', 'owner_occupied'], ['Renter-occupied households', 'renter_occupied'], ['Vacant units for sale', 'vacant_for_sale'], ['Mobile homes', 'structure_mobile'], ['Duplexes', 'structure_2']]
          .map((r) => [r[0], m15[r[1]], m20[r[1]], m24[r[1]], chg(m15[r[1]], m24[r[1]])]),
        'ACS 5-Year Estimates', countsComparable == null ? 'The 2020 benchmark check could not be run for this geography; verify before citing.' : `ACS 2016–2020 and the 2020 Census agree within ${Math.abs(benchGap * 100).toFixed(0)}% on housing units.`));
      facts.count_trend = { units_change_pct: chg(m15.total_housing_units, m24.total_housing_units), owner_change_pct: chg(m15.owner_occupied, m24.owner_occupied), renter_change_pct: chg(m15.renter_occupied, m24.renter_occupied) };
    }
    facts.counts_comparable = countsComparable;

    // ── 23. workforce gap ──────────────────────────────────────────────────
    if (g && g.wsh != null || g.xsh != null || g.msh != null) {
      const gr = (label, lo, hi, hhB, av, sh) => (sh == null ? null : [label, `$${Math.round(lo * 0.3 / 12).toLocaleString('en-US')} to $${Math.round(hi * 0.3 / 12).toLocaleString('en-US')}`, hhB, av, sh >= 0 ? { v: sh, text: `+${sh.toLocaleString('en-US')} short`, tone: 'short' } : { v: sh, text: `+${Math.abs(sh).toLocaleString('en-US')} surplus`, tone: 'surplus' }]);
      const rows = [gr('HUD income limit', g.wlo, g.whi, g.whh, g.wav, g.wsh), gr('Working-age household income', g.xlo, g.xhi, g.xhh, g.xav, g.xsh), gr('Median household income', g.mlo, g.mhii, g.mhh, g.mav, g.msh)].filter(Boolean);
      exhibits.push(table('workforce_gap', 'Workforce rental gap, 80% to 120% of the anchor', [col('Anchor'), col('Rent range'), col('Renter households in band', 'int'), col('Units affordable and available', 'int'), col('Shortage or surplus')], rows,
        `${acsLabel}, Tables B25063 and B25122; HUD Income Limits`, '"Available" removes units in the range occupied by households earning above the band.'));
      const sh = [g.wsh, g.xsh, g.msh].filter((v) => v != null);
      Object.assign(facts, { workforce_gap: { hud: g.wsh, wahi: g.xsh, mhi: g.msh, min: Math.min.apply(null, sh), max: Math.max.apply(null, sh) }, shortage_le_50_ami: g.vli, shortage_le_30_ami: g.eli, chas_renter_total: g.crt });
    }

    // ── 24. value trend ────────────────────────────────────────────────────
    const pti = (m) => div(m.median_home_value, m.median_hh_income);
    exhibits.push(table('value_trend', 'Home value and affordability indicators, 2015 to 2024', [col('Indicator'), col('2011 to 2015', 'auto'), col('2016 to 2020', 'auto'), col('2020 to 2024', 'auto'), col('Change', 'auto')],
      [[`Median home value, ${Tn}`, m15, m20, m24]].concat(C ? [[`Median home value, ${Cn}`, c15, c20, c24]] : [], [[`Median home value, ${Sn}`, s15, s20, s24]])
        .map((r) => [r[0], { v: r[1].median_home_value, fmt: 'usd' }, { v: r[2].median_home_value, fmt: 'usd' }, { v: r[3].median_home_value, fmt: 'usd' }, { v: chg(r[1].median_home_value, r[3].median_home_value), fmt: 'pctchg' }])
        .concat([[`Price-to-income ratio, ${Tn}`, { v: pti(m15), fmt: 'num2' }, { v: pti(m20), fmt: 'num2' }, { v: pti(m24), fmt: 'num2' }, { v: pti(m24) != null && pti(m15) != null ? pti(m24) - pti(m15) : null, fmt: 'signed2' }]]),
      'ACS 5-Year Estimates, Tables B25077 and B19013', 'Price-to-income is median home value divided by median household income.'));
    Object.assign(facts, { value_median: f.value_median, value_moe: moe.value_moe || null, value_change_pct: chg(m15.median_home_value, m24.median_home_value), price_to_income: pti(m24), price_to_income_2015: pti(m15), state_price_to_income: div(sp.value_median != null ? sp.value_median : s24.median_home_value, sp.hh_income_median != null ? sp.hh_income_median : s24.median_hh_income) });
    const mkt = model.market || (ctx.countyModel && ctx.countyModel.market) || null;
    if (mkt) facts.market = { level: model.market ? T.kind : 'county', zillow_home_value: mkt.hval, zillow_as_of: mkt.hvalAsOf, redfin_median_sale_price: mkt.price, redfin_as_of: mkt.priceAsOf, zillow_rent: mkt.rent, rent_as_of: mkt.rentAsOf };

    // ── 25. supportable price ──────────────────────────────────────────────
    const SL = A.sale, sp$ = (inc) => r100(supportablePrice(inc, SL));
    const priceRows = [].concat(
      ami ? [['HUD 120% of AMI (4-person)', ami.a120], ['HUD 100% of AMI (4-person)', ami.ami], ['HUD 80% of AMI (4-person)', ami.l80]] : [],
      [['Two-earner families (median)', f.earners_2_income], ['Owner households (median)', f.income_median_owner], ['One-earner families (median)', f.earners_1_income], ['Working-age households (WAHI)', wahi], ['All households (median)', f.hh_income_median]],
    ).filter((r) => n(r[1]) != null).sort((a, b) => b[1] - a[1]).map((r) => [r[0], r[1], sp$(r[1])]);
    exhibits.push(table('supportable_price', 'Supportable home price by income group', [col('Household group'), col('Income', 'usd'), col('Supportable price', 'usd')],
      priceRows.concat([['Existing median home value, for comparison', null, f.value_median]]),
      'Analyst assumptions', `Assumes ${(SL.front * 100).toFixed(0)}% of gross income toward principal, interest, taxes and insurance; a ${SL.years}-year loan at ${(SL.rate * 100).toFixed(2)}%; ${(SL.down * 100).toFixed(0)}% down; a ${(SL.tax * 100).toFixed(1)}% effective property tax rate; $${SL.insurance.toLocaleString('en-US')} annual insurance.`));
    Object.assign(facts, { price_ceiling: ami ? { p80: sp$(ami.l80), p100: sp$(ami.ami), p120: sp$(ami.a120) } : null, income_for_median_home: incomeForPrice(f.value_median, SL), price_one_earner: sp$(f.earners_1_income), price_two_earner: sp$(f.earners_2_income) });

    // ── 26. value distribution ─────────────────────────────────────────────
    const VB = [['Under $50,000', 'value_lt_50k', 0], ['$50,000 to $99,999', 'value_50_99k', 50000], ['$100,000 to $149,999', 'value_100_150k', 100000], ['$150,000 to $199,999', 'value_150_200k', 150000], ['$200,000 to $299,999', 'value_200_300k', 200000], ['$300,000 to $499,999', 'value_300_500k', 300000], ['$500,000 to $999,999', 'value_500_1m', 500000], ['$1,000,000 or more', 'value_1m_plus', 1000000]];
    const vVals = VB.map((b) => f[b[1]] || 0);
    exhibits.push(chart('value_distribution', 'Owner-occupied homes by value', { type: 'bar', fmt: 'int', categories: VB.map((b) => b[0]), series: [{ name: 'Owner-occupied homes', values: vVals }],
      range: facts.price_ceiling ? { label: 'New workforce homes, 80% to 100% of AMI', lo: facts.price_ceiling.p80, hi: facts.price_ceiling.p100, edges: VB.map((b) => b[2]) } : null }, `${acsLabel}, Table B25075`));
    Object.assign(facts, { homes_under_100k: vVals[0] + vVals[1], homes_200k_plus: sum(vVals.slice(4)), homes_300k_plus: sum(vVals.slice(5)), homes_500k_plus: sum(vVals.slice(6)) });
    const hi75 = sum([f.oi_75_100k, f.oi_100_150k, f.oi_150k_plus, f.ri_75_100k, f.ri_100_150k, f.ri_150k_plus]);
    Object.assign(facts, { households_75k_plus: hi75, households_75k_plus_share: pct(hi75, hh), price_at_75k: sp$(75000) });

    // ── 27. owner age ──────────────────────────────────────────────────────
    const oa = [['Under 35', f.owner_age_under35], ['35 to 44', f.owner_age_35_44], ['45 to 54', f.owner_age_45_54], ['55 to 64', f.owner_age_55_64], ['65 to 74', f.owner_age_65_74], ['75 to 84', f.owner_age_75_84], ['85 and over', f.owner_age_85_plus]];
    exhibits.push(table('owner_age', 'Owner households by age of householder', [col('Age of householder'), col('Owner households', 'int'), col('Share', 'pct1')], oa.map((r) => [r[0], r[1] || 0, pct(r[1] || 0, own)]), `${acsLabel}, Table B25007`));
    const o65 = sum([f.owner_age_65_74, f.owner_age_75_84, f.owner_age_85_plus]);
    Object.assign(facts, { owners_65_plus: o65, owners_65_plus_share: pct(o65, own), owners_under_35: f.owner_age_under35 || 0 });
    const ocb = sum([f.cb_owner_30_plus_lt20k, f.cb_owner_30_plus_20_35k, f.cb_owner_30_plus_35_50k, f.cb_owner_30_plus_50_75k, f.cb_owner_30_plus_75k_plus]);
    Object.assign(facts, { owners_cost_burdened: ocb, owners_cost_burdened_share: pct(ocb, own) });

    // ── 28. proposed development (only when the analyst supplies one) ──────
    const P = A.project;
    if (n(P.homes) && n(P.price)) {
      const perLot = n(P.infraRequest) ? P.infraRequest / P.homes : null, allIn = perLot != null ? P.price + perLot : null;
      const stack = [['Builder sale price on a served lot', P.price]].concat(perLot != null ? [['Infrastructure cost per lot', perLot], ['All-in delivered cost', allIn]] : []);
      exhibits.push(table('project_stack', 'Project cost stack against affordability ceilings', [col('Cost and affordability stack'), col('Per home', 'usd'), col('Income required', 'usd'), col('Share of HUD AMI', 'pct0')],
        stack.map((r, i) => [r[0], r[1], i === 1 ? null : incomeForPrice(r[1], SL), i === 1 || !ami ? null : incomeForPrice(r[1], SL) / ami.ami * 100])
          .concat(ami ? [['80% AMI affordability ceiling', sp$(ami.l80), ami.l80, 80]] : []),
        'Development partner; analyst assumptions', 'Infrastructure cost per lot is the request divided by the number of homes.'));
      Object.assign(facts, { project: { name: P.name, builder: P.builder, homes: P.homes, price: P.price, private_investment: P.homes * P.price, infra_request: P.infraRequest, infra_per_lot: perLot, all_in_cost: allIn, income_for_price: incomeForPrice(P.price, SL), income_for_all_in: allIn != null ? incomeForPrice(allIn, SL) : null, leverage: n(P.infraRequest) ? P.homes * P.price / P.infraRequest : null } });
    }

    exhibits.forEach((e, i) => { e.number = i + 1; });

    return {
      schema: 'housing-report-pack/1',
      generated_at: new Date().toISOString(),
      target: { kind: T.kind, geoid: T.geoid, name: Tn, full_name: f.name || Tn, county: Cn, county_fips: C ? C.geoid : null, state: Sn, state_fips: S.fips || f.state_fips },
      vintages: { acs: acsLabel, permits: pYears.length ? `${pYears[0]} to ${pYears[pYears.length - 1]}` : null, gap: ctx.meta && ctx.meta.gap_vintage, hud_income_limits: 'FY2026' },
      flags, facts, exhibits,
      inputs: A,
      assumptions: [
        ['Vertical construction cost per unit', `$${R.cost.br1.toLocaleString('en-US')} / $${R.cost.br2.toLocaleString('en-US')} / $${R.cost.br3.toLocaleString('en-US')} (1, 2, 3 bedroom)`],
        ['Capitalization rate', `${(R.capRate * 100).toFixed(1)}%`], ['Operating expense ratio', `${(R.opex * 100).toFixed(0)}%`],
        ['Utility allowance', R.utilityAllowance ? `$${R.utilityAllowance} a month` : 'Not applied'],
        ['Household size for rent ceilings', '1.5 persons per bedroom'], ['Housing cost share of income', '30%'],
        ['Mortgage terms', `${(SL.rate * 100).toFixed(2)}%, ${SL.years} years, ${(SL.down * 100).toFixed(0)}% down`],
        ['Property tax and insurance', `${(SL.tax * 100).toFixed(1)}% of value; $${SL.insurance.toLocaleString('en-US')} a year`],
        ['Program limits', `${A.program.name}: infrastructure grant up to $${A.program.infraCap.toLocaleString('en-US')}; construction finance up to $${A.program.financeCap.toLocaleString('en-US')}`],
      ],
      not_in_pack: [
        'Current asking rents and vacancy by unit size (no public source; phone survey)',
        'Identification of group quarters facilities and local employers',
        'FHFA House Price Index (not published for every county; pull from FRED when writing)',
        'Site infrastructure cost (engineer, by site)',
      ],
    };
  }

  const api = { buildPack, DEFAULTS, supportablePrice, incomeForPrice, rentNeeded, subsidyFor, payFactor };
  root.HAReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
