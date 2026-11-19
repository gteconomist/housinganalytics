#!/usr/bin/env node
/**
 * fetch-acs-published.mjs
 *
 * Pulls figures that must come STRAIGHT from the Census Bureau's published
 * tables rather than from the workbooks or from re-aggregating counties, and
 * writes one committed file:
 *
 *   src/data/acs-published.json
 *
 * Why this exists (audit of 2026-11-19):
 *   1. POVERTY RATE. The workbooks carry S1701_C03_006E, which is the poverty
 *      rate for people aged 18-64, and the site labelled it "Poverty rate".
 *      The all-ages rate is S1701_C03_001E. It is fetched here for every
 *      county, place, state and the nation.
 *   2. HOUSEHOLDS WITH CHILDREN. The workbooks carry S1101_C01_005E —
 *      households with the householder's OWN children under 18. The card on
 *      the profile says "Households with children", which readers check
 *      against B11005_002E (households with one or more people under 18).
 *      B11005_002E is fetched here; the S1101 figure stays available.
 *   3. STATE AND NATIONAL MEDIANS. build-data used to produce a state's
 *      "median household income" as a household-weighted AVERAGE OF COUNTY
 *      MEDIANS. That is not a median and matched no Census figure (Georgia
 *      showed $79,556; the published B19013 value is $77,353). Every median,
 *      mean and rate that cannot be summed is fetched here from the API's
 *      own state / us records.
 *
 * Output is committed OUTSIDE src/data/generated/ because CI does not run
 * this script (same rule as acs-extra.json).
 *
 * Env:
 *   CENSUS_API_KEY  repo-root .env or environment
 *   CENSUS_YEAR     ACS5 vintage (default 2024)
 *   CENSUS_STATE    optional comma list of state FIPS (smoke test)
 *
 * Run:  npm run acs-published      (about a minute)
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VARIABLES } from '../src/data/variable-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_FILE  = join(ROOT, 'src', 'data', 'acs-published.json');
const YEAR      = process.env.CENSUS_YEAR || '2024';

let API_KEY = process.env.CENSUS_API_KEY || '';
if (!API_KEY && existsSync(join(ROOT, '.env'))) {
  const m = /^\s*CENSUS_API_KEY\s*=\s*"?([^"\s]+)"?/m.exec(readFileSync(join(ROOT, '.env'), 'utf8'));
  if (m) API_KEY = m[1];
}

const ALL_STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
  '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40','41','42','44','45','46','47','48',
  '49','50','51','53','54','55','56','72',
];
const STATES = (process.env.CENSUS_STATE || '').trim()
  ? process.env.CENSUS_STATE.split(',').map(s => s.trim().padStart(2, '0'))
  : ALL_STATE_FIPS;

// ── g: fetched for EVERY geography ────────────────────────────────
export const GEO_FIELDS = [
  ['poverty_rate',         'S1701_C03_001E'],  // % below poverty, all ages
  ['hh_with_children_u18', 'B11005_002E'],     // households with 1+ people under 18
];

// ── m: fetched for STATES and the NATION only ─────────────────────
// Fields the site otherwise derived by averaging county values. The ACS code
// for each comes from variable-map.js, so this list cannot drift from the
// definitions the county and place pages use.
export const AGG_FIELDS = [
  'hh_income_median', 'hh_income_mean', 'income_median_owner', 'income_median_renter',
  'value_median', 'rent_median', 'rent_median_0br', 'rent_median_1br', 'rent_median_2br',
  'rent_median_3br', 'rent_median_4br', 'rent_median_5br', 'mortgage_median',
  'structure_median_age', 'median_age', 'per_capita_income', 'hh_avg_size',
];
const codeOf = Object.fromEntries(VARIABLES.filter(v => v.acs).map(v => [v.field, v.acs]));
const AGG = AGG_FIELDS.map(f => {
  if (!codeOf[f]) throw new Error(`variable-map.js has no ACS code for ${f}`);
  return [f, codeOf[f]];
});

const endpointOf = c => c.startsWith('S') ? 'subject' : c.startsWith('DP') ? 'profile' : 'detailed';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 204) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt.trim().startsWith('[')) throw new Error('non-JSON: ' + txt.slice(0, 100));
      return JSON.parse(txt);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(900 * (i + 1));
    }
  }
}

/** Fetch [field, code] pairs for one geography clause → {geoid: {field: number|null}} */
async function fetchPairs(pairs, geoClause, geoCols) {
  const out = {};
  const byEp = {};
  for (const [f, c] of pairs) (byEp[endpointOf(c)] ??= []).push([f, c]);
  await Promise.all(Object.entries(byEp).map(async ([ep, list]) => {
    const base = `https://api.census.gov/data/${YEAR}/acs/acs5${ep === 'detailed' ? '' : '/' + ep}`;
    const url = `${base}?get=${list.map(p => p[1]).join(',')}&${geoClause}${API_KEY ? '&key=' + API_KEY : ''}`;
    const m = await getJson(url);
    if (!m || m.length < 2) return;
    const idx = Object.fromEntries(m[0].map((h, i) => [h, i]));
    for (const row of m.slice(1)) {
      const geoid = geoCols.map(c => row[idx[c]]).join('');
      const rec = (out[geoid] ??= {});
      for (const [f, c] of list) {
        const raw = row[idx[c]];
        const n = raw == null ? null : Number(raw);
        // Census uses large negative sentinels for suppressed estimates.
        rec[f] = (n == null || !isFinite(n) || n <= -666666) ? null : n;
      }
    }
  }));
  return out;
}

const pack = (rec, pairs) => pairs.map(([f]) => rec?.[f] ?? null);

async function main() {
  if (!API_KEY) console.warn('! No CENSUS_API_KEY — requests will be rate-limited.');

  // Keep only the geographies the site profiles: the same set acs-extra.json holds.
  let keep = null;
  try {
    const x = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'acs-extra.json'), 'utf8'));
    keep = { counties: new Set(Object.keys(x.counties)), places: new Set(Object.keys(x.places)) };
  } catch { console.warn('! acs-extra.json not found — keeping every county and place.'); }

  const result = {
    vintage: Number(YEAR),
    order: { g: GEO_FIELDS.map(p => p[0]), m: AGG_FIELDS },
    codes: Object.fromEntries([...GEO_FIELDS, ...AGG]),
    counties: {}, places: {}, states: {}, national: null,
  };

  const both = [...GEO_FIELDS, ...AGG];
  const us = Object.values(await fetchPairs(both, 'for=us:1', ['us']))[0];
  result.national = { g: pack(us, GEO_FIELDS), m: pack(us, AGG) };
  const st = await fetchPairs(both, 'for=state:*', ['state']);
  for (const [fips, rec] of Object.entries(st)) result.states[fips] = { g: pack(rec, GEO_FIELDS), m: pack(rec, AGG) };
  console.log(`national + ${Object.keys(result.states).length} states`);

  const queue = STATES.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const [c, p] = await Promise.all([
        fetchPairs(GEO_FIELDS, `for=county:*&in=state:${s}`, ['state', 'county']),
        fetchPairs(GEO_FIELDS, `for=place:*&in=state:${s}`, ['state', 'place']),
      ]);
      for (const [g, rec] of Object.entries(c)) if (!keep || keep.counties.has(g)) result.counties[g] = pack(rec, GEO_FIELDS);
      for (const [g, rec] of Object.entries(p)) if (!keep || keep.places.has(g))   result.places[g]   = pack(rec, GEO_FIELDS);
    }
  }));

  await writeFile(OUT_FILE, JSON.stringify(result));
  console.log(`✓ ${OUT_FILE}`);
  console.log(`  counties ${Object.keys(result.counties).length} · places ${Object.keys(result.places).length}`);
  if (keep) {
    const mc = [...keep.counties].filter(g => !result.counties[g]).length;
    const mp = [...keep.places].filter(g => !result.places[g]).length;
    if (mc || mp) console.warn(`! missing: ${mc} counties, ${mp} places`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
