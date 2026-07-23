// fetch-acs-vintages.mjs
// ---------------------------------------------------------------------------
// Multi-vintage ACS 5-year puller for the Master-Sheet community-profile
// generator. Given a target place, its parent county / MSA / state, and a set
// of peer places, it fetches every core-ACS variable (see
// src/data/acs-vintage-crosswalk.js) for each geography across all VINTAGES,
// batching under the Census API's 50-variable-per-call limit.
//
// Output: out/acs-raw.json  ->  { [vintage]: { [geoKey]: { CODE: number|null } } }
//
// Env:
//   CENSUS_API_KEY   required (40-char hex). Falls back to /tmp/.census_key.
//
// Geographies are driven by a config object (GEOS below) so the same script
// serves any target/peer set. Place->county and place->MSA resolution is a
// published Census crosswalk (delineation file) handled upstream; here each
// geography carries an explicit API selector, which is unambiguous.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ALL_VARS, VINTAGES } from '../src/data/acs-vintage-crosswalk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../out');

// ---- Chamblee reference config (target + auto geographies + chosen peers) ---
export const GEOS = [
  { key: 'chamblee',      role: 'target', label: 'Chamblee',        sel: { place: '15172', state: '13' } },
  { key: 'dekalb',        role: 'county', label: 'DeKalb County',   sel: { county: '089', state: '13' } },
  { key: 'atlanta_msa',   role: 'msa',    label: 'Atlanta MSA',     sel: { cbsa: '12060' } },
  { key: 'georgia',       role: 'state',  label: 'Georgia',         sel: { state: '13' } },
  { key: 'brookhaven',    role: 'peer',   label: 'Brookhaven',      sel: { place: '10944', state: '13' } },
  { key: 'doraville',     role: 'peer',   label: 'Doraville',       sel: { place: '23536', state: '13' } },
  { key: 'dunwoody',      role: 'peer',   label: 'Dunwoody',        sel: { place: '24768', state: '13' } },
  { key: 'sandy_springs', role: 'peer',   label: 'Sandy Springs',   sel: { place: '68516', state: '13' } },
];

const CBSA_KEY = 'metropolitan statistical area/micropolitan statistical area';

// Build the ?for=...&in=... portion of the query for a geography selector.
function geoParams(sel) {
  if (sel.place) return { for: `place:${sel.place}`, in: `state:${sel.state}` };
  if (sel.county) return { for: `county:${sel.county}`, in: `state:${sel.state}` };
  if (sel.cbsa) return { for: `${CBSA_KEY}:${sel.cbsa}`, in: null };
  if (sel.state) return { for: `state:${sel.state}`, in: null };
  throw new Error('Unrecognized geography selector: ' + JSON.stringify(sel));
}

function getKey() {
  let k = process.env.CENSUS_API_KEY;
  if (!k) { try { k = readFileSync('/tmp/.census_key', 'utf8').trim(); } catch { /* ignore */ } }
  if (!k) throw new Error('CENSUS_API_KEY not set (and /tmp/.census_key absent).');
  return k;
}

// ACS uses large negative sentinels for "no data" / annotation flags. Treat
// anything <= -222222222 (and non-numeric) as null.
function clean(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= -222222222) return null;
  return n;
}

function batch(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBatch(year, vars, gp, key) {
  const params = new URLSearchParams();
  params.set('get', ['NAME', ...vars].join(','));
  params.set('for', gp.for);
  if (gp.in) params.set('in', gp.in);
  params.set('key', key);
  const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
  const res = await fetch(url);
  if (res.status === 204) return null; // no rows for this geography/year
  if (!res.ok) throw new Error(`ACS ${year} ${gp.for}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const [header, row] = json; // single-geo query -> one data row
  if (!row) return null;
  const rec = {};
  header.forEach((h, i) => { if (h !== 'NAME' && !['state', 'county', 'place', CBSA_KEY].includes(h)) rec[h] = clean(row[i]); });
  return rec;
}

export async function fetchAll(geos = GEOS, { verbose = true } = {}) {
  const key = getKey();
  const batches = batch(ALL_VARS, 45);
  const out = {};
  for (const year of VINTAGES) {
    out[year] = {};
    for (const geo of geos) {
      const gp = geoParams(geo.sel);
      const rec = {};
      let present = false;
      for (const b of batches) {
        const part = await fetchBatch(year, b, gp, key);
        if (part) { Object.assign(rec, part); present = true; }
      }
      out[year][geo.key] = present ? rec : null;
      if (verbose) process.stdout.write(`  ${year} ${geo.label}: ${present ? Object.keys(rec).length + ' vars' : 'NO DATA'}\n`);
    }
  }
  return out;
}

// Run directly: node scripts/fetch-acs-vintages.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Fetching ${ALL_VARS.length} ACS vars x ${VINTAGES.length} vintages x ${GEOS.length} geographies...`);
  const data = await fetchAll();
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, 'acs-raw.json');
  writeFileSync(path, JSON.stringify({ geos: GEOS, vintages: VINTAGES, data }, null, 2));
  console.log('Wrote', path);
}
