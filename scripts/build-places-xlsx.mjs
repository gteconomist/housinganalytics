#!/usr/bin/env node
/**
 * build-places-xlsx.mjs
 *
 * Builds "Full Housing Data Table - Places.xlsx" — the static, one-time-per-
 * vintage pull of ACS 5-year estimates for all U.S. incorporated places
 * (cities, towns, villages, boroughs, municipios) with population ≥ 5,000.
 *
 * Mirrors the column shape of the counties workbook so build-data.mjs (or a
 * thin wrapper around it) can consume the file the same way it consumes
 * "Full Housing Data Table.xlsx".
 *
 * Replaces the per-build `npm run places` step (which hits the Census API
 * ~600 times every build). ACS only updates once a year, so we pull once
 * and check in the XLSX.
 *
 * Env vars:
 *   CENSUS_API_KEY   recommended (free signup at
 *                    https://api.census.gov/data/key_signup.html)
 *   CENSUS_YEAR      ACS5 vintage year (default: 2024)
 *   PLACE_MIN_POP    Skip places below this population (default: 5000)
 *   CENSUS_STATE     'all' (default), or comma-separated state FIPS for testing
 *
 * Run:
 *   CENSUS_API_KEY=… node scripts/build-places-xlsx.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { VARIABLES, MHC_COMPONENTS } from '../src/data/variable-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_FILE   = join(ROOT, 'Full Housing Data Table - Places.xlsx');
const CACHE_FILE = join(ROOT, 'scripts', '.places-raw-cache.json');

const API_KEY  = process.env.CENSUS_API_KEY || '';
const YEAR     = parseInt(process.env.CENSUS_YEAR || '2024', 10);
const MIN_POP  = parseInt(process.env.PLACE_MIN_POP || '5000', 10);

const ALL_STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
  '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40','41','42','44','45','46','47','48',
  '49','50','51','53','54','55','56',
];

const STATE_INPUT = (process.env.CENSUS_STATE || 'all').trim();
const STATES = STATE_INPUT.toLowerCase() === 'all'
  ? ALL_STATE_FIPS
  : STATE_INPUT.split(',').map(s => s.trim().padStart(2, '0')).filter(Boolean);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org places build)',
  'Accept': 'application/json, text/plain, */*',
};

// ─── Build the master column order. Must match Row 11/12 of counties workbook. ───
// Counts column B = Area Name (NAME), column C = FIPS (Geo_geoid_), column D+ = ACS codes
// in the order VARIABLES was declared (excluding DERIVED). Build-data.mjs identifies
// columns by the ACS code in row 12 — order itself doesn't matter to the build, but
// keeping it identical makes the file diff-friendly with the counties workbook.
const dataVars = VARIABLES.filter(v => v.acs && v.acs !== 'DERIVED');
const ACS_CODES = dataVars.map(v => v.acs);
const PLAIN_LABELS = dataVars.map(v => v.label);

// MHC components are referenced by build-data.mjs from a separate map; the
// counties XLSX includes them as visible columns too. Mirror that.
const mhcComponentCodes = [];
const mhcComponentLabels = [];
const seenInVars = new Set(ACS_CODES);
for (const [bucket, codes] of Object.entries(MHC_COMPONENTS)) {
  for (const c of codes) {
    if (seenInVars.has(c)) continue;
    seenInVars.add(c);
    mhcComponentCodes.push(c);
    mhcComponentLabels.push(`MHC component (${bucket}): ${c}`);
  }
}

const FULL_CODES  = [...ACS_CODES, ...mhcComponentCodes];
const FULL_LABELS = [...PLAIN_LABELS, ...mhcComponentLabels];

console.log(`Pulling ${FULL_CODES.length} ACS variables for ≥${MIN_POP.toLocaleString()}-pop incorporated places, ${YEAR} ACS5.`);

// ─── Endpoint routing ───────────────────────────────────────────────
function endpointFor(code) {
  if (code.startsWith('DP')) return 'profile';
  if (code.startsWith('S'))  return 'subject';
  return 'detailed';
}

const codesByEndpoint = { detailed: [], subject: [], profile: [] };
for (const code of FULL_CODES) codesByEndpoint[endpointFor(code)].push(code);
console.log(`  detailed=${codesByEndpoint.detailed.length} subject=${codesByEndpoint.subject.length} profile=${codesByEndpoint.profile.length}`);

const BATCH_SIZE = 45; // Census soft cap ~50 vars/call
function batchCodes(codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) out.push(codes.slice(i, i + BATCH_SIZE));
  return out;
}

function apiUrl(year, endpoint, vars, stateFips) {
  const path = endpoint === 'detailed' ? `${year}/acs/acs5` : `${year}/acs/acs5/${endpoint}`;
  const params = new URLSearchParams();
  params.set('get', ['NAME', ...vars].join(','));
  params.set('for', 'place:*');
  params.set('in',  `state:${stateFips}`);
  if (API_KEY) params.set('key', API_KEY);
  return `https://api.census.gov/data/${path}?${params.toString()}`;
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }
    return res.json();
  } catch (e) {
    if (attempt < 3) {
      const wait = 500 * attempt;
      console.warn(`    retry ${attempt} after ${wait}ms (${e.message})`);
      await new Promise(r => setTimeout(r, wait));
      return fetchJson(url, attempt + 1);
    }
    throw e;
  }
}

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
    if (!out[geoid]) out[geoid] = { geoid, name: row[nameIdx], vars: {} };
    for (let j = 0; j < header.length; j++) {
      const h = header[j];
      if (h === 'NAME' || h === 'state' || h === 'place') continue;
      const v = row[j];
      if (v == null || v === '') { out[geoid].vars[h] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < -1_000_000) { out[geoid].vars[h] = null; continue; }
      out[geoid].vars[h] = n;
    }
  }
  return out;
}

async function fetchStateAllVars(year, stateFips) {
  const merged = {};
  for (const endpoint of ['detailed', 'subject', 'profile']) {
    const batches = batchCodes(codesByEndpoint[endpoint]);
    for (let b = 0; b < batches.length; b++) {
      const url = apiUrl(year, endpoint, batches[b], stateFips);
      console.log(`  GET ${endpoint} batch ${b + 1}/${batches.length} (${batches[b].length} vars)`);
      const data = await fetchJson(url);
      const parsed = parseResponse(data);
      for (const [geoid, place] of Object.entries(parsed)) {
        if (!merged[geoid]) merged[geoid] = { geoid: place.geoid, name: place.name, vars: {} };
        Object.assign(merged[geoid].vars, place.vars);
      }
    }
  }
  return merged;
}

// ─── Incorporated-places filter via Census Gazetteer ───────────────
// LSAD 57 = CDP (unincorporated). We exclude those. Everything else with a
// FUNCSTAT of 'A' (active, governmentally functioning) is incorporated.
//
// We also use the Gazetteer's POP column to apply the population threshold
// when ACS reports null/zero population (rare but happens for tiny places).
const GAZ_YEAR = process.env.GAZETTEER_YEAR || String(YEAR);
const GAZ_URLS = [
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZ_YEAR}_Gazetteer/${GAZ_YEAR}_Gaz_place_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZ_YEAR}_Gazetteer/${GAZ_YEAR}_gaz_place_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip`,
];

async function fetchZip(urls) {
  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url, {
        headers: { ...HEADERS, 'Accept': 'application/zip, application/octet-stream, */*' },
        redirect: 'follow',
      });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      console.log(`Downloaded ${buf.length.toLocaleString()} bytes.`);
      return buf;
    } catch (e) { console.warn(`  ${e.message}`); }
  }
  return null;
}

function extractFirstTxtFromZip(buf) {
  let i = 0;
  while (i < buf.length - 30) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) break;
    const compressed = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    const compressionMethod = buf.readUInt16LE(i + 8);
    if (name.toLowerCase().endsWith('.txt')) {
      const data = buf.slice(dataStart, dataStart + compressed);
      if (compressionMethod === 0) return data.toString('utf8');
      if (compressionMethod === 8) return inflateRawSync(data).toString('utf8');
    }
    i = dataStart + compressed;
  }
  return null;
}

async function buildIncorporatedSet() {
  const zip = await fetchZip(GAZ_URLS);
  if (!zip) {
    console.warn('WARNING: Gazetteer fetch failed — falling back to NAME-suffix CDP filter only.');
    return null;
  }
  const text = extractFirstTxtFromZip(zip);
  if (!text) {
    console.warn('WARNING: Gazetteer ZIP parsed but no .txt found — falling back to NAME-suffix CDP filter.');
    return null;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t').map(s => s.trim());
  const geoidIdx    = header.findIndex(h => /^GEOID$/i.test(h));
  const lsadIdx     = header.findIndex(h => /^LSAD$/i.test(h));
  const funcstatIdx = header.findIndex(h => /^FUNCSTAT$/i.test(h));
  if (geoidIdx < 0 || lsadIdx < 0) {
    console.warn('WARNING: Gazetteer columns unexpected:', header.slice(0, 10).join(','));
    return null;
  }
  // Census LSAD codes for incorporated places:
  //   12 = municipio (PR)        21 = borough          25 = city
  //   37 = municipality          39 = (alt municipality) 43 = town
  //   47 = village               49 = city/borough     51 = consolidated gov
  //   53 = corporation           55 = unified gov
  // 57 = CDP (excluded).
  const INCORPORATED_LSAD = new Set(['12','21','25','37','39','43','47','49','51','53','55']);
  const set = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const geoid    = (cols[geoidIdx] || '').trim().padStart(7, '0');
    const lsad     = (cols[lsadIdx] || '').trim().padStart(2, '0');
    const funcstat = funcstatIdx >= 0 ? (cols[funcstatIdx] || '').trim().toUpperCase() : 'A';
    if (geoid.length !== 7) continue;
    if (!INCORPORATED_LSAD.has(lsad)) continue;     // excludes CDPs (LSAD 57)
    if (funcstat && funcstat !== 'A' && funcstat !== 'B') continue; // active govts only
    set.add(geoid);
  }
  console.log(`Incorporated-places whitelist: ${set.size.toLocaleString()} GEOIDs`);
  return set;
}

// ─── Place → primary county crosswalk ──────────────────────────────
// HUD publishes AMI at COUNTY level. Place pages inherit AMI from the
// county containing the largest share of the place's population. We bake
// the resulting `parent_county_fips` into the XLSX as a column so the
// build pipeline doesn't need network access at build time.
const CROSSWALK_URLS = [
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/place_county/tab20_place_county20_natl.txt',
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/place/tab20_place_county20_natl.txt',
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/tab20_place_county20_natl.txt',
  'https://www2.census.gov/geo/docs/maps-data/data/rel/place_county/tab_place_county_natl.txt',
];

async function fetchCrosswalk() {
  for (const url of CROSSWALK_URLS) {
    try {
      console.log(`Fetching place-county crosswalk: ${url}`);
      const res = await fetch(url, {
        headers: { ...HEADERS, 'Accept': 'text/plain, application/octet-stream, */*' },
        redirect: 'follow',
      });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const text = await res.text();
      console.log(`  Downloaded ${text.length.toLocaleString()} bytes.`);
      const xw = parseCrosswalkText(text);
      if (Object.keys(xw).length > 0) return xw;
    } catch (e) { console.warn(`  ${e.message}`); }
  }
  console.warn('WARNING: All crosswalk URLs failed. parent_county_fips will be empty;');
  console.warn('         place pages will not show the HUD workforce-housing section.');
  return {};
}

function parseCrosswalkText(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const sep = lines[0].includes('|') ? '|' : (lines[0].includes('\t') ? '\t' : ',');
  const header = lines[0].split(sep).map(s => s.trim());
  const ci = (re) => header.findIndex(h => re.test(h));
  const placeIdx  = ci(/^GEOID_PLACE$|^GEOID_PLACE_20$|^GEOID20_PLACE$/i);
  const countyIdx = ci(/^GEOID_COUNTY$|^GEOID_COUNTY_20$|^GEOID20_COUNTY$/i);
  const popIdx    = ci(/POPULATION_PART|POP20_PART|POPULATION/i);
  if (placeIdx < 0 || countyIdx < 0) return {};
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
  for (const [p, { county }] of Object.entries(best)) out[p] = county;
  return out;
}

// ─── Build the XLSX ────────────────────────────────────────────────
function buildWorkbook(places, crosswalk) {
  // Sort places: state FIPS, then name (matches counties workbook ordering).
  const rows = Object.values(places).sort((a, b) => {
    const sa = a.geoid.slice(0, 2), sb = b.geoid.slice(0, 2);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // SheetJS aoa_to_sheet: row 0 is XLSX row 1, etc.
  // Counties file shape:
  //   row 1-4: empty
  //   row 5:   col C=2024, col D="Five-year estimate"
  //   row 6-9: empty
  //   row 10:  col C=1, col D=2, col E=3, … (column numbers, used by Alfie for reference)
  //   row 11:  col B="Area Name",  col C="FIPS",        col D+ = plain labels
  //   row 12:  col B="NAME",       col C="Geo_geoid_",  col D+ = ACS codes
  //   row 13+: data — col A empty, col B=NAME, col C=GEOID (text), col D+ = numeric values
  const aoa = [];
  const pad = (n) => new Array(n).fill(null);

  // rows 1-4: empty
  for (let i = 0; i < 4; i++) aoa.push([]);

  // row 5: vintage banner
  const row5 = pad(2); // skip A, B
  row5.push(YEAR, 'Five-year estimate');
  aoa.push(row5);

  // rows 6-9: empty
  for (let i = 0; i < 4; i++) aoa.push([]);

  // row 10: column numbers starting at col C
  const row10 = pad(2);
  for (let i = 0; i < FULL_CODES.length; i++) row10.push(i + 1);
  aoa.push(row10);

  // row 11: plain labels (col D = "Parent County FIPS" — used by build-data.mjs
  //         to inherit HUD AMI from the county containing the place)
  const row11 = [null, 'Area Name', 'FIPS', 'Parent County FIPS', ...FULL_LABELS];
  aoa.push(row11);

  // row 12: ACS codes ("parent_county_fips" is a sentinel header build-data.mjs
  //         recognizes alongside the standard ACS codes)
  const row12 = [null, 'NAME', 'Geo_geoid_', 'parent_county_fips', ...FULL_CODES];
  aoa.push(row12);

  // row 13+: data
  for (const place of rows) {
    const parent = crosswalk[place.geoid] || null;
    const dataRow = [null, place.name, place.geoid, parent];
    for (const code of FULL_CODES) {
      const v = place.vars[code];
      dataRow.push(v == null ? null : v);
    }
    aoa.push(dataRow);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Force FIPS (col C) and Parent County FIPS (col D) to render as text so
  // leading zeros survive.
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 12; r <= range.e.r; r++) {                 // 12 = 0-indexed row 13
    for (const c of [2, 3]) {                              // col C and col D
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.v != null) {
        cell.t = 's';
        cell.v = String(cell.v);
        cell.w = String(cell.v);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  let all;

  // If a cache from a prior run exists, reuse it. Lets us iterate on XLSX
  // formatting without re-spending 7 minutes pulling from the Census API.
  // Delete scripts/.places-raw-cache.json to force a fresh pull.
  if (existsSync(CACHE_FILE)) {
    console.log(`Using cached raw pull from ${CACHE_FILE}`);
    console.log(`(delete that file to force a fresh API pull)`);
    all = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(all).length.toLocaleString()} places from cache.`);
  } else {
    if (!API_KEY) {
      console.warn('WARNING: CENSUS_API_KEY not set. Census throttles unauthenticated requests heavily.');
    }
    const incorporated = await buildIncorporatedSet();

    all = {};
    for (let s = 0; s < STATES.length; s++) {
      const state = STATES[s];
      console.log(`\n[${s + 1}/${STATES.length}] State ${state}`);
      const placesInState = await fetchStateAllVars(YEAR, state);
      let kept = 0, dropPop = 0, dropCDP = 0;
      for (const [geoid, place] of Object.entries(placesInState)) {
        const pop = place.vars['B01003_001E'];
        if (pop == null || pop < MIN_POP) { dropPop++; continue; }
        if (incorporated && !incorporated.has(geoid)) {
          // Belt-and-suspenders: skip names ending in CDP too, in case gazetteer is stale
          dropCDP++; continue;
        }
        if (!incorporated && /\bCDP\b/.test(place.name || '')) { dropCDP++; continue; }
        all[geoid] = place;
        kept++;
      }
      console.log(`  kept=${kept} dropped(pop<${MIN_POP})=${dropPop} dropped(CDP/unincorp)=${dropCDP}`);
    }

    console.log(`\nTotal incorporated places ≥${MIN_POP.toLocaleString()} pop: ${Object.keys(all).length.toLocaleString()}`);
    writeFileSync(CACHE_FILE, JSON.stringify(all));
    console.log(`Cached raw pull to ${CACHE_FILE}`);
  }

  // Fetch the place→county crosswalk (small, fast, doesn't hit Census API
  // limits — separate www2 host). Used to bake parent_county_fips into the XLSX
  // so the site build pipeline doesn't need network access.
  const crosswalk = await fetchCrosswalk();
  console.log(`Crosswalk loaded for ${Object.keys(crosswalk).length.toLocaleString()} places.`);

  const wb = buildWorkbook(all, crosswalk);
  // Use buffer-write rather than XLSX.writeFile — the latter's path-based
  // sync writer chokes on larger sheets in some SheetJS builds.
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  writeFileSync(OUT_FILE, buf);
  console.log(`\n✓ Wrote ${OUT_FILE} (${buf.length.toLocaleString()} bytes)`);
}

main().catch(err => {
  console.error('build-places-xlsx failed:', err);
  process.exit(1);
});
