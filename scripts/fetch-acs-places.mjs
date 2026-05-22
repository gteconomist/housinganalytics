#!/usr/bin/env node
/**
 * fetch-acs-places.mjs
 *
 * Pulls ACS 5-year estimates for Census "places" (incorporated cities,
 * towns, villages, plus CDPs) from the Census Data API and writes
 * `src/data/generated/places.json` — keyed by 7-digit place GEOID
 * (2-digit state + 5-digit place). build-data.mjs consumes that file
 * the same way it consumes hud-ami.json / gazetteer.json.
 *
 * Also fetches the Census place-to-county relationship file and stores
 * a primary-county FIPS per place, so build-data can inherit HUD AMI
 * (which is published at county level) onto place profiles.
 *
 * Env vars:
 *   CENSUS_API_KEY   (required for non-trivial volume; free signup at
 *                    https://api.census.gov/data/key_signup.html)
 *   CENSUS_STATE     2-digit state FIPS, or 'all' (default: '13' / Georgia
 *                    pilot). Comma-separated list also accepted.
 *   CENSUS_YEAR      ACS5 vintage year (default: '2024'; falls back through
 *                    2023, 2022 if 2024 isn't live yet)
 *   PLACE_MIN_POP    Skip places below this population (default: 10000)
 *
 * The Census Data API splits ACS into three endpoints by table series:
 *   /acs/acs5            (detailed B-tables)
 *   /acs/acs5/subject    (S-tables)
 *   /acs/acs5/profile    (DP-tables)
 * Variables are routed to the right endpoint based on their code prefix.
 * Up to ~50 variables per call; we batch in groups of 45 to be safe.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VARIABLES, MHC_COMPONENTS } from '../src/data/variable-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'places.json');

const API_KEY = process.env.CENSUS_API_KEY || '';
const STATE_INPUT = (process.env.CENSUS_STATE || '13').trim();
const STATES = STATE_INPUT.toLowerCase() === 'all'
  ? ALL_STATE_FIPS
  : STATE_INPUT.split(',').map(s => s.trim().padStart(2, '0')).filter(Boolean);
const YEAR_CANDIDATES = (() => {
  const start = parseInt(process.env.CENSUS_YEAR || '2024', 10);
  return [start, start - 1, start - 2];
})();
const MIN_POP = parseInt(process.env.PLACE_MIN_POP || '10000', 10);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)',
  'Accept': 'application/json, text/plain, */*',
};

// All 50 states + DC (Puerto Rico has limited ACS coverage; skip for now).
function makeAllStateFips() {
  const fips = [
    '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
    '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
    '34','35','36','37','38','39','40','41','42','43','44','45','46','47','48',
    '49','50','51','53','54','55','56',
  ];
  // 11 = DC, 43 doesn't exist (skip), 51 = VA etc — keep as-is.
  return fips.filter(f => f !== '43');
}
// eslint-disable-next-line no-var
var ALL_STATE_FIPS = makeAllStateFips();

// ── Variable routing by endpoint ──────────────────────────────────
function endpointFor(code) {
  if (code.startsWith('DP')) return 'profile';
  if (code.startsWith('S'))  return 'subject';
  return 'detailed';
}

// Build the master list of ACS codes we need. Strip DERIVED entries, then
// add the MHC component codes used by build-data.mjs to compute the coarse
// $0–499 and $500–999 buckets.
const allCodes = new Set(
  VARIABLES.filter(v => v.acs && v.acs !== 'DERIVED').map(v => v.acs)
);
for (const codes of Object.values(MHC_COMPONENTS)) {
  for (const c of codes) allCodes.add(c);
}

const codesByEndpoint = { detailed: [], subject: [], profile: [] };
for (const code of allCodes) codesByEndpoint[endpointFor(code)].push(code);

console.log(`Variables: ${allCodes.size} total · ` +
  `detailed=${codesByEndpoint.detailed.length} ` +
  `subject=${codesByEndpoint.subject.length} ` +
  `profile=${codesByEndpoint.profile.length}`);

// ── Census API helpers ────────────────────────────────────────────
const BATCH_SIZE = 45; // leave headroom under the 50-var soft cap

function batchCodes(codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    out.push(codes.slice(i, i + BATCH_SIZE));
  }
  return out;
}

function apiUrl(year, endpoint, vars, stateFips) {
  const path = endpoint === 'detailed'
    ? `${year}/acs/acs5`
    : `${year}/acs/acs5/${endpoint}`;
  const params = new URLSearchParams();
  params.set('get', ['NAME', ...vars].join(','));
  params.set('for', 'place:*');
  params.set('in',  `state:${stateFips}`);
  if (API_KEY) params.set('key', API_KEY);
  return `https://api.census.gov/data/${path}?${params.toString()}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Census returns: first row = headers; subsequent rows = values.
// Geography columns (state, place) come at the END of each row.
function parseResponse(data) {
  const header = data[0];
  const stateIdx = header.indexOf('state');
  const placeIdx = header.indexOf('place');
  const nameIdx  = header.indexOf('NAME');
  const out = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const state = String(row[stateIdx]).padStart(2, '0');
    const place = String(row[placeIdx]).padStart(5, '0');
    const geoid = state + place;
    if (!out[geoid]) out[geoid] = { geoid, state_fips: state, place_fips: place, name: row[nameIdx], vars: {} };
    for (let j = 0; j < header.length; j++) {
      const h = header[j];
      if (h === 'NAME' || h === 'state' || h === 'place') continue;
      const v = row[j];
      if (v == null || v === '') { out[geoid].vars[h] = null; continue; }
      const n = Number(v);
      // ACS sentinel (e.g. -666666666 for "not available"): treat as null.
      if (!Number.isFinite(n) || n < -1_000_000) { out[geoid].vars[h] = null; continue; }
      out[geoid].vars[h] = n;
    }
  }
  return out;
}

// Fetch all variables for one state, merging across endpoints and batches.
async function fetchStateAllVars(year, stateFips) {
  /** @type {Record<string, any>} */
  const merged = {};
  for (const endpoint of ['detailed', 'subject', 'profile']) {
    const batches = batchCodes(codesByEndpoint[endpoint]);
    for (let b = 0; b < batches.length; b++) {
      const url = apiUrl(year, endpoint, batches[b], stateFips);
      console.log(`  GET ${endpoint} batch ${b + 1}/${batches.length} (${batches[b].length} vars)`);
      const data = await fetchJson(url);
      const parsed = parseResponse(data);
      for (const [geoid, place] of Object.entries(parsed)) {
        if (!merged[geoid]) {
          merged[geoid] = { geoid: place.geoid, state_fips: place.state_fips, place_fips: place.place_fips, name: place.name, vars: {} };
        }
        Object.assign(merged[geoid].vars, place.vars);
      }
    }
  }
  return merged;
}

// ── Place → primary county crosswalk ──────────────────────────────
// Census publishes a place-county relationship file. For places that span
// counties, we pick the county containing the largest share of the place
// population.
const RELATIONSHIP_URLS = [
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/place/tab20_place_county20_natl.txt',
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/place_county/tab20_place_county20_natl.txt',
];

async function fetchPlaceCountyCrosswalk() {
  for (const url of RELATIONSHIP_URLS) {
    try {
      console.log(`Fetching place-county relationship: ${url}`);
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const text = await res.text();
      console.log(`Downloaded ${text.length.toLocaleString()} bytes.`);
      return parseCrosswalk(text);
    } catch (e) {
      console.warn(`  ${e.message}`);
    }
  }
  console.warn('WARNING: Place-county crosswalk fetch failed; HUD AMI will not be inherited.');
  return {};
}

function parseCrosswalk(text) {
  // Pipe-delimited per Census convention. Columns include OID_PLACE, GEOID_PLACE,
  // NAMELSAD_PLACE, GEOID_COUNTY, NAMELSAD_COUNTY, AREALAND_PART, POPULATION_PART, etc.
  // Naming has varied across vintages — detect columns case-insensitively.
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const sep = lines[0].includes('|') ? '|' : (lines[0].includes('\t') ? '\t' : ',');
  const header = lines[0].split(sep).map(s => s.trim());
  const ci = (re) => header.findIndex(h => re.test(h));
  const placeIdx  = ci(/^GEOID_PLACE$|^GEOID_PLACE_20$|^GEOID20_PLACE$/i);
  const countyIdx = ci(/^GEOID_COUNTY$|^GEOID_COUNTY_20$|^GEOID20_COUNTY$/i);
  const popIdx    = ci(/POPULATION_PART|POP20_PART|POPULATION/i);
  if (placeIdx < 0 || countyIdx < 0) {
    console.warn('  Could not identify crosswalk columns:', header.slice(0, 10).join(', '));
    return {};
  }
  /** @type {Record<string, {county: string, pop: number}>} */
  const best = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    const place  = String(cols[placeIdx] || '').padStart(7, '0');
    const county = String(cols[countyIdx] || '').padStart(5, '0');
    const pop    = popIdx >= 0 ? Number(cols[popIdx]) : 0;
    if (place.length !== 7 || county.length !== 5) continue;
    if (!best[place] || (Number.isFinite(pop) && pop > best[place].pop)) {
      best[place] = { county, pop: Number.isFinite(pop) ? pop : 0 };
    }
  }
  const out = {};
  for (const [place, { county }] of Object.entries(best)) out[place] = county;
  return out;
}

// ─── MAIN ─────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.warn('WARNING: CENSUS_API_KEY not set. Census API rate-limits unauthenticated requests.');
    console.warn('         For the small Georgia pilot this is usually fine, but get a free key at');
    console.warn('         https://api.census.gov/data/key_signup.html before going national.');
  }
  console.log(`States: ${STATES.length === ALL_STATE_FIPS.length ? 'all (50 + DC)' : STATES.join(',')}`);
  console.log(`Population threshold: ≥${MIN_POP.toLocaleString()}`);

  const crosswalk = await fetchPlaceCountyCrosswalk();
  console.log(`Place→county crosswalk loaded for ${Object.keys(crosswalk).length.toLocaleString()} places.`);

  // Find a year that responds successfully (try the candidate list in order).
  let activeYear = null;
  for (const year of YEAR_CANDIDATES) {
    try {
      const probe = await fetchJson(apiUrl(year, 'detailed', ['B01003_001E'], STATES[0]));
      if (Array.isArray(probe) && probe.length > 1) {
        activeYear = year;
        console.log(`Using ACS5 vintage ${year}.`);
        break;
      }
    } catch (e) {
      console.warn(`  Year ${year} probe failed: ${e.message}`);
    }
  }
  if (!activeYear) {
    console.error('All ACS5 year candidates failed. Aborting.');
    process.exit(1);
  }

  /** @type {Record<string, any>} */
  const allPlaces = {};
  for (const state of STATES) {
    console.log(`\nFetching state ${state}...`);
    const placesInState = await fetchStateAllVars(activeYear, state);
    let kept = 0, filtered = 0;
    for (const [geoid, place] of Object.entries(placesInState)) {
      const pop = place.vars['B01003_001E'];
      if (pop == null || pop < MIN_POP) { filtered++; continue; }
      place.parent_county_fips = crosswalk[geoid] || null;
      place.acs_year = activeYear;
      allPlaces[geoid] = place;
      kept++;
    }
    console.log(`  State ${state}: ${kept} places kept, ${filtered} below pop threshold.`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    vintage: `ACS 5-year ${activeYear}`,
    acs_year: activeYear,
    min_population: MIN_POP,
    states_requested: STATES,
    place_count: Object.keys(allPlaces).length,
    places: allPlaces,
  }, null, 2));

  console.log(`\n✓ Wrote ${Object.keys(allPlaces).length} places to ${OUT_FILE}`);

  // Sample diagnostic
  const samples = Object.values(allPlaces).slice(0, 5);
  if (samples.length) {
    console.log('\n── Sample places ──');
    for (const p of samples) {
      const pop = p.vars['B01003_001E'];
      const inc = p.vars['S1901_C01_012E'];
      const val = p.vars['DP04_0089E'];
      console.log(`  ${p.geoid} ${p.name.padEnd(40)} pop=${pop?.toLocaleString() ?? '—'} ` +
                  `MHI=${inc != null ? '$' + inc.toLocaleString() : '—'} ` +
                  `value=${val != null ? '$' + val.toLocaleString() : '—'} ` +
                  `parent=${p.parent_county_fips ?? '—'}`);
    }
    console.log('──────────────────\n');
  }
}

main().catch(err => {
  console.error('fetch-acs-places failed:', err);
  process.exit(1);
});
