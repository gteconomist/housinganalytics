#!/usr/bin/env node
/**
 * build-report-data.mjs
 *
 * Bundles what the report builder (/report) reads in the browser into
 *   public/report-data/states/<fips>.json   one file per state
 *   public/report-data/meta.json
 *
 * WHY a bundle of its own: the profile JSON under /data/ sits behind the login
 * gate, and a browser fetch() to a gated path gets a login redirect instead of
 * JSON. Like /master-data and /analysis-data, this folder is public Census
 * data and must stay OUTSIDE the gate. And like them it is bundled by state:
 * GitHub Pages silently drops folders holding thousands of small files.
 *
 * It runs in the build chain right after build-data, so it always reflects
 * the profile data being deployed — the output is gitignored. Its inputs:
 *   public/data/places/*.json, public/data/counties/*.json   (build-data)
 *   src/data/report-extra.json     group quarters, margins of error, 2010/2020
 *                                  Census counts        (npm run report-extra)
 *   src/data/permits-county.json   building permits     (npm run permits)
 *   src/data/housing-gap-summary.json                   (npm run analysis-geo)
 *   public/master-data/index.json  place → county crosswalk
 *   src/data/acs-published.json    Census-published state medians and rates
 * Every input but the first is committed, so nothing here touches the network.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'report-data');
const J = async (p, fallback = null) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : fallback);

// Profile fields the report engine reads. Anything not listed is left out of
// the bundle — the full record is ~3x larger and the bundle is public.
const KEEP = [
  'geoid', 'name', 'place_name', 'county_name', 'state_name', 'state_fips', 'parent_county_fips', 'acs_year',
  'population_total', 'median_age', 'hh_avg_size', 'hh_with_children', 'hh_with_children_u18',
  'units_total', 'units_occupied', 'units_vacant', 'tenure_owner_occupied', 'tenure_renter_occupied',
  'vacant_for_rent', 'vacant_rented_not_occ', 'vacant_for_sale', 'vacant_sold_not_occ', 'vacant_seasonal', 'vacant_migrant', 'vacant_other',
  'structure_1_detached', 'structure_1_attached', 'structure_2', 'structure_3_4', 'structure_5_9', 'structure_10_19',
  'structure_20_49', 'structure_50_plus', 'structure_mobile', 'structure_other', 'structure_median_age', 'units_by_structure',
  'year_built_2020_plus', 'year_built_2010_19', 'year_built_2000_09', 'year_built_1980_99', 'year_built_1960_79', 'year_built_1940_59', 'year_built_1939_earlier',
  'br_0', 'br_1', 'br_2', 'br_3', 'br_4', 'br_5_plus', 'hh_size_1', 'hh_size_2', 'hh_size_3', 'hh_size_4_plus',
  'value_median', 'value_lt_50k', 'value_50_99k', 'value_100_150k', 'value_150_200k', 'value_200_300k', 'value_300_500k', 'value_500_1m', 'value_1m_plus',
  'hh_income_median', 'per_capita_income', 'income_median_owner', 'income_median_renter',
  'income_median_under25', 'income_median_25_44', 'income_median_45_64', 'income_median_65_plus',
  'earners_0', 'earners_1', 'earners_2', 'earners_3_plus', 'earners_nonfamily',
  'earners_0_income', 'earners_1_income', 'earners_2_income', 'earners_3_plus_income', 'earners_nonfamily_income',
  'poverty_rate', 'edu_lt_9th', 'edu_9_12_no_diploma', 'edu_hs_grad', 'edu_some_college', 'edu_associates', 'edu_bachelors', 'edu_graduate',
  'rent_median', 'rent_median_0br', 'rent_median_1br', 'rent_median_2br', 'rent_median_3br', 'rent_median_4br',
  'rent_burden_total', 'rent_burden_lt_10', 'rent_burden_10_14', 'rent_burden_15_19', 'rent_burden_20_24', 'rent_burden_25_29',
  'rent_burden_30_34', 'rent_burden_35_39', 'rent_burden_40_49', 'rent_burden_50_plus', 'rent_burden_not_computed', 'cb_renter_no_cash',
  'cb_owner_30_plus_lt20k', 'cb_owner_30_plus_20_35k', 'cb_owner_30_plus_35_50k', 'cb_owner_30_plus_50_75k', 'cb_owner_30_plus_75k_plus',
  'oi_75_100k', 'oi_100_150k', 'oi_150k_plus', 'ri_75_100k', 'ri_100_150k', 'ri_150k_plus',
  'owner_age_under35', 'owner_age_35_44', 'owner_age_45_54', 'owner_age_55_64', 'owner_age_65_74', 'owner_age_75_84', 'owner_age_85_plus',
  'eth_total', 'eth_hispanic', 'eth_nh_white', 'eth_nh_black', 'eth_nh_asian', 'eth_nh_two_plus', 'eth_nh_other',
  'pop_16_plus', 'lfpr_16_plus', 'lfpr_20_64', 'emp_pop_ratio', 'unemployment_rate', 'hud_ami',
];

const named = (order, arr) => (arr ? Object.fromEntries(order.map((k, i) => [k, arr[i]])) : null);

async function loadDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of await readdir(dir)) if (/^\d+\.json$/.test(f)) out.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  return out;
}

async function main() {
  const extra = await J(join(ROOT, 'src', 'data', 'report-extra.json'), { order: { acs: [], dec: [] }, places: {}, counties: {} });
  const permits = await J(join(ROOT, 'src', 'data', 'permits-county.json'), { years: [], counties: {} });
  const gap = await J(join(ROOT, 'src', 'data', 'housing-gap-summary.json'), { places: {}, counties: {} });
  // Public sources for the Word report (npm run report-sources): HUD Fair Market Rents,
  // subsidized apartment inventory, FHFA county price index, mortgage rate.
  const src = await J(join(ROOT, 'src', 'data', 'report-sources.json'), {});
  const fmrOf = (fips) => { const r = src.fmr?.counties?.[fips]; return r ? { br0: r[0], br1: r[1], br2: r[2], br3: r[3], br4: r[4] } : undefined; };
  // A property belongs to a city when HUD's place code says so or when its mailing city is the city's name.
  // HUD's place codes use older boundaries (McRae and Helena are still separate there), so the name match matters.
  const cityKey = (v) => String(v || '').toLowerCase().replace(/\b(city|town|village|borough|cdp|municipality)\b/g, '').replace(/\bmc /g, 'mc').replace(/\bst\.? /g, 'saint ').replace(/[^a-z]/g, '');
  const invOf = (fips, place, name) => {
    const full = String(name || ''), keys = new Set([full, ...full.split(/[-\/]/)].map(cityKey).filter(Boolean));
    const l = (src.inventory?.counties?.[fips] || []).filter((p) => !place || p[4] === place || (p[5] && keys.has(cityKey(p[5])))).map((p) => p.slice(0, 4));
    return l.length ? l : undefined;
  };
  const mIdx = await J(join(ROOT, 'public', 'master-data', 'index.json'), { places: [] });
  const placeCounty = Object.fromEntries(mIdx.places.map((p) => [p.geoid, p.county_fips]));
  // Census-PUBLISHED state medians and rates (never a weighted average of counties).
  const pub = await J(join(ROOT, 'src', 'data', 'acs-published.json'), null);
  const statePub = (fips) => {
    const e = pub?.states?.[fips]; if (!e) return null;
    return { ...named(pub.order.g, e.g), ...named(pub.order.m, e.m) };
  };

  const places = await loadDir(join(ROOT, 'public', 'data', 'places'));
  const counties = await loadDir(join(ROOT, 'public', 'data', 'counties'));
  if (!places.length && !counties.length) { console.error('No profile JSON under public/data — run build-data first.'); process.exit(1); }

  const byState = {};
  const bucket = (fips, name) => (byState[fips] ||= { state: { fips, name, ctx: null, pub: statePub(fips) }, places: {}, counties: {} });
  const slim = (rec) => Object.fromEntries(KEEP.filter((k) => rec[k] !== undefined && rec[k] !== null).map((k) => [k, rec[k]]));
  const x = (e, withDec10) => (e ? { acs: named(extra.order.acs, e[0]), dec20: named(extra.order.dec, e[1]), ...(withDec10 ? { dec10: named(extra.order.dec, e[2]) } : {}) } : null);

  for (const c of counties) {
    const b = bucket(c.state_fips, c.state_name);
    if (!b.state.ctx && c._context) b.state.ctx = { state: c._context.state || null, national: c._context.national || null };
    b.counties[c.geoid] = { f: slim(c), x: x(extra.counties[c.geoid], true), gap: gap.counties?.[c.geoid] || null, permits: permits.counties[c.geoid] || null,
      fmr: fmrOf(c.geoid), hpi: src.hpi?.counties?.[c.geoid], inv: invOf(c.geoid) };
  }
  for (const p of places) {
    const b = bucket(p.state_fips, p.state_name);
    if (!b.state.ctx && p._context) b.state.ctx = { state: p._context.state || null, national: p._context.national || null };
    b.places[p.geoid] = { f: slim(p), x: x(extra.places[p.geoid], false), gap: gap.places?.[p.geoid] || null, county: p.parent_county_fips || placeCounty[p.geoid] || null,
      inv: invOf(p.parent_county_fips || placeCounty[p.geoid], p.geoid, p.place_name || p.name) };
  }

  await mkdir(join(OUT, 'states'), { recursive: true });
  let bytes = 0;
  for (const [fips, b] of Object.entries(byState)) {
    const s = JSON.stringify(b); bytes += s.length;
    await writeFile(join(OUT, 'states', `${fips}.json`), s);
  }
  await writeFile(join(OUT, 'meta.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    acs_label: 'ACS 2020–2024 5-Year Estimates',
    permit_years: permits.years, permit_source: permits.source || null,
    gap_vintage: gap.vintage || null, extra_vintage: extra.vintage || null,
    sources: { as_of: src.asOf || null, fmr_year: src.fmr?.year || null, mortgage: src.mortgage || null, hpi_years: src.hpi ? [src.hpi.from, src.hpi.to] : null },
    states: Object.keys(byState).sort(),
  }));
  console.log(`report-data: ${places.length} places, ${counties.length} counties, ${Object.keys(byState).length} state bundles, ${(bytes / 1e6).toFixed(1)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
