#!/usr/bin/env node
/**
 * fetch-acs-extra.mjs
 *
 * Pulls the handful of ACS 5-year variables that are NOT in the two
 * committed "Full Housing Data Table" workbooks, for every county, every
 * place, every state, and the nation — and writes ONE committed file:
 *
 *   src/data/acs-extra.json
 *
 * build-data.mjs merges this onto each county / place / state record, so
 * the profile templates just read the extra fields like any other field.
 *
 * WHY a separate file instead of new spreadsheet columns:
 *   the workbooks are hand-maintained; this keeps them untouched and makes
 *   the annual refresh a one-command job. Output is committed OUTSIDE
 *   src/data/generated/ because CI does not run this script (see
 *   conventions: committed-vs-generated data).
 *
 * What it adds
 *   1. Ethnicity (Hispanic or Latino origin) — DP05_0089..0102.
 *      The site already had RACE (DP05 race-alone counts) but no ETHNICITY.
 *      Census treats these as two separate questions; Hispanic origin is
 *      crossed with race, not a race category.
 *   2. Labor force — S2301: participation rate 16+, participation rate
 *      20–64, employment/population ratio, unemployment rate.
 *   3. Occupied units by structure type — B25032, summed across tenure,
 *      differenced against B25024 (all units by structure) to derive
 *      VACANT units and a vacancy rate per structure type.
 *
 *      CAVEAT, stated on the page too: B25024 − B25032 counts every unit
 *      that is not occupied, which includes seasonal, migrant and "other
 *      vacant" units. It is a non-occupancy rate by structure type, not a
 *      market (for-rent / for-sale) vacancy rate. It is the only way ACS
 *      lets you split vacancy by structure type.
 *
 * Env:
 *   CENSUS_API_KEY  (required — repo-root .env)
 *   CENSUS_YEAR     ACS5 vintage (default 2024)
 *   GEOIDS_FILE     optional JSON {counties:[],places:[]} to restrict output
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_FILE   = join(ROOT, 'src', 'data', 'acs-extra.json');

const API_KEY = process.env.CENSUS_API_KEY || '';
const YEAR    = process.env.CENSUS_YEAR || '2024';

const ALL_STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
  '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40','41','42','44','45','46','47','48',
  '49','50','51','53','54','55','56',
  '72',  // Puerto Rico — the site profiles all 78 municipios.
];
// CENSUS_STATE=13 (or a comma list) restricts the run — used for smoke tests.
const STATES = (process.env.CENSUS_STATE || '').trim()
  ? process.env.CENSUS_STATE.split(',').map(s => s.trim().padStart(2, '0'))
  : ALL_STATE_FIPS;

// ── Variables ─────────────────────────────────────────────────────
const PROFILE_VARS = {
  DP05_0089E: 'eth_total',
  DP05_0090E: 'eth_hispanic',
  DP05_0095E: 'eth_not_hispanic',
  DP05_0096E: 'eth_nh_white',
  DP05_0097E: 'eth_nh_black',
  DP05_0098E: '_nh_aian',
  DP05_0099E: 'eth_nh_asian',
  DP05_0100E: '_nh_nhpi',
  DP05_0101E: '_nh_other_race',
  DP05_0102E: 'eth_nh_two_plus',
};

const SUBJECT_VARS = {
  S2301_C01_001E: 'pop_16_plus',
  S2301_C02_001E: 'lfpr_16_plus',
  S2301_C02_021E: 'lfpr_20_64',
  S2301_C03_001E: 'emp_pop_ratio',
  S2301_C04_001E: 'unemployment_rate',
};

// Structure categories: [key, B25024 code, B25032 owner code, B25032 renter code]
const STRUCT = [
  ['1_detached', 'B25024_002E', 'B25032_003E', 'B25032_014E'],
  ['1_attached', 'B25024_003E', 'B25032_004E', 'B25032_015E'],
  ['2',          'B25024_004E', 'B25032_005E', 'B25032_016E'],
  ['3_4',        'B25024_005E', 'B25032_006E', 'B25032_017E'],
  ['5_9',        'B25024_006E', 'B25032_007E', 'B25032_018E'],
  ['10_19',      'B25024_007E', 'B25032_008E', 'B25032_019E'],
  ['20_49',      'B25024_008E', 'B25032_009E', 'B25032_020E'],
  ['50_plus',    'B25024_009E', 'B25032_010E', 'B25032_021E'],
  ['mobile',     'B25024_010E', 'B25032_011E', 'B25032_022E'],
  ['other',      'B25024_011E', 'B25032_012E', 'B25032_023E'],
];

const DETAILED_CODES = ['B25024_001E', 'B25032_001E',
  ...STRUCT.flatMap(([, a, b, c]) => [a, b, c])];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)',
  Accept: 'application/json, text/plain, */*',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 204) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt.trim().startsWith('[')) throw new Error('non-JSON: ' + txt.slice(0, 120));
      return JSON.parse(txt);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

function buildUrl(endpoint, codes, geoClause) {
  const base = endpoint === 'detailed'
    ? `https://api.census.gov/data/${YEAR}/acs/acs5`
    : `https://api.census.gov/data/${YEAR}/acs/acs5/${endpoint}`;
  const key = API_KEY ? `&key=${API_KEY}` : '';
  return `${base}?get=${codes.join(',')}&${geoClause}${key}`;
}

/** Turn a Census matrix response into {geoid: {code: number}} */
function rowsToMap(matrix, geoCols) {
  if (!matrix || matrix.length < 2) return {};
  const hdr = matrix[0];
  const idx = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const out = {};
  for (const row of matrix.slice(1)) {
    const geoid = geoCols.map(c => row[idx[c]]).join('');
    const rec = {};
    for (const h of hdr) {
      if (geoCols.includes(h) || h === 'NAME') continue;
      const raw = row[idx[h]];
      const n = raw == null ? null : Number(raw);
      // Census uses large negative sentinels (-666666666 etc.) for suppressed.
      rec[h] = (n == null || !isFinite(n) || n <= -666666) ? null : n;
    }
    out[geoid] = rec;
  }
  return out;
}

/** Batch codes into <=45-variable requests and merge the results. */
async function fetchEndpoint(endpoint, codes, geoClause, geoCols) {
  const merged = {};
  for (let i = 0; i < codes.length; i += 45) {
    const chunk = codes.slice(i, i + 45);
    const data = await getJson(buildUrl(endpoint, chunk, geoClause));
    const map = rowsToMap(data, geoCols);
    for (const [g, rec] of Object.entries(map)) {
      merged[g] = Object.assign(merged[g] || {}, rec);
    }
    await sleep(120);
  }
  return merged;
}

/* ── Wire format ───────────────────────────────────────────────────
   The file is committed and read at build time for ~8,000 geographies,
   so it is stored COMPACT: three fixed-order numeric arrays per record
   rather than 30+ named keys. build-data.mjs expands it into readable
   field names on the per-geography JSON, which is what pages consume.

     e[] ethnicity  — order = ETH_ORDER below
     l[] labor      — order = Object.values(SUBJECT_VARS)
     s[] structure  — one [totalUnits, occupiedUnits] pair per STRUCT row,
                      same order as STRUCT; null for a suppressed category
   Anything derivable (shares, vacant counts, vacancy rates) is NOT stored. */
export const ETH_ORDER = [
  'eth_total', 'eth_hispanic', 'eth_nh_white', 'eth_nh_black',
  'eth_nh_asian', 'eth_nh_two_plus', 'eth_nh_other',
];
export const LABOR_ORDER = Object.values(SUBJECT_VARS);
export const STRUCT_ORDER = STRUCT.map(s => s[0]);

/** Collapse raw ACS codes into the compact record we publish. */
function shape(raw) {
  if (!raw) return null;

  // ── Ethnicity ────────────────────────────────────────────────
  // "Not Hispanic — AIAN / NHPI / some other race" fold into one residual
  // bucket so the chart never renders three slivers.
  const resid = ['DP05_0098E', 'DP05_0100E', 'DP05_0101E']
    .map(c => raw[c]).filter(v => v != null);
  const e = [
    raw.DP05_0089E ?? null,
    raw.DP05_0090E ?? null,
    raw.DP05_0096E ?? null,
    raw.DP05_0097E ?? null,
    raw.DP05_0099E ?? null,
    raw.DP05_0102E ?? null,
    resid.length ? resid.reduce((a, b) => a + b, 0) : null,
  ];

  // ── Labor force ──────────────────────────────────────────────
  const l = Object.keys(SUBJECT_VARS).map(c => raw[c] ?? null);

  // ── Units by structure type: [all units, occupied units] ─────
  // Vacant = all − occupied, derived downstream. See the CAVEAT at the
  // top of this file: that difference includes seasonal / migrant / other
  // vacant units, so it is a NON-OCCUPANCY rate, not a market vacancy rate.
  const s = STRUCT.map(([, totCode, ownCode, rentCode]) => {
    const total = raw[totCode], own = raw[ownCode], rent = raw[rentCode];
    if (total == null || own == null || rent == null) return null;
    return [total, own + rent];
  });

  const empty = e.every(v => v == null) && l.every(v => v == null) && s.every(v => v == null);
  return empty ? null : { e, l, s };
}

async function fetchLevel(geoClause, geoCols) {
  const [prof, subj, det] = await Promise.all([
    fetchEndpoint('profile', Object.keys(PROFILE_VARS), geoClause, geoCols),
    fetchEndpoint('subject', Object.keys(SUBJECT_VARS), geoClause, geoCols),
    fetchEndpoint('detailed', DETAILED_CODES, geoClause, geoCols),
  ]);
  const geoids = new Set([...Object.keys(prof), ...Object.keys(subj), ...Object.keys(det)]);
  const out = {};
  for (const g of geoids) {
    out[g] = shape(Object.assign({}, prof[g], subj[g], det[g]));
  }
  return out;
}

async function main() {
  if (!API_KEY) console.warn('! No CENSUS_API_KEY — requests will be rate-limited.');

  let keep = null;
  if (process.env.GEOIDS_FILE) {
    keep = JSON.parse(await readFile(process.env.GEOIDS_FILE, 'utf8'));
    keep = {
      counties: new Set(keep.counties || []),
      places:   new Set(keep.places   || []),
    };
  }

  const result = {
    vintage: Number(YEAR),
    order: { e: ETH_ORDER, l: LABOR_ORDER, s: STRUCT_ORDER },
    counties: {}, places: {}, states: {}, national: null,
  };

  console.log('→ national');
  const nat = await fetchLevel('for=us:1', ['us']);
  result.national = nat['1'] ?? Object.values(nat)[0] ?? null;

  console.log('→ states');
  result.states = await fetchLevel('for=state:*', ['state']);

  for (const st of STATES) {
    process.stdout.write(`→ ${st} counties`);
    const c = await fetchLevel(`for=county:*&in=state:${st}`, ['state', 'county']);
    let nc = 0;
    for (const [g, rec] of Object.entries(c)) {
      if (keep && !keep.counties.has(g)) continue;
      result.counties[g] = rec; nc++;
    }
    process.stdout.write(` ${nc} · places`);
    const p = await fetchLevel(`for=place:*&in=state:${st}`, ['state', 'place']);
    let np = 0;
    for (const [g, rec] of Object.entries(p)) {
      if (keep && !keep.places.has(g)) continue;
      result.places[g] = rec; np++;
    }
    console.log(` ${np}`);
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(result));
  console.log(`\n✓ ${OUT_FILE}`);
  console.log(`  counties ${Object.keys(result.counties).length} · places ${Object.keys(result.places).length} · states ${Object.keys(result.states).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
