// build-master-geo.mjs
// ---------------------------------------------------------------------------
// Build-time generator for the on-site Master Sheet generator page.
//
// Bulk-pulls core-ACS (all VINTAGES) for every place, county, CBSA, and state
// in the target states, assembles the crosswalk FIELDS per geography, and
// writes small per-geography JSON the browser loads on demand:
//
//   public/data/master/index.json                 place picker + crosswalk
//   public/data/master/geo/place-<geoid>.json     { name, byVintage:{yr:{fieldId:val}} }
//   public/data/master/geo/county-<fips>.json
//   public/data/master/geo/cbsa-<code>.json
//   public/data/master/geo/state-<fips>.json
//
// Reads the geography universe from a prebuilt crosswalk (crosswalk-places.json
// + crosswalk-cbsa.json — place->county->CBSA, built once from the Census 2020
// place/county API + the CBSA delineation file).
//
// Env: CENSUS_API_KEY (via .env), STATES (comma FIPS, default '13' Georgia).
// ---------------------------------------------------------------------------
import './lib/load-env.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIELDS, ALL_VARS, VINTAGES } from '../src/data/acs-vintage-crosswalk.js';
import { TABS } from './lib/master-schema.mjs';

const FIELD = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const XWALK_DIR = resolve(ROOT, 'scripts/.master-crosswalk');
const OUT_DIR = resolve(ROOT, 'public/data/master');
const GEO_DIR = resolve(OUT_DIR, 'geo');

const KEY = process.env.CENSUS_API_KEY;
// All 50 states + DC (matches the site's places universe). Override with the
// STATES env var (comma-separated FIPS) for a faster single-state test build.
const ALL_STATES = '01,02,04,05,06,08,09,10,11,12,13,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,44,45,46,47,48,49,50,51,53,54,55,56';
const STATES = (process.env.STATES || ALL_STATES).split(',').map((s) => s.trim().padStart(2, '0'));
const CBSA_KEY = 'metropolitan statistical area/micropolitan statistical area';

const clean = (v) => { const n = Number(v); return v == null || !Number.isFinite(n) || n <= -222222222 ? null : n; };
const batches = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const VARBATCHES = batches(ALL_VARS, 45);

// Pull every geography of one level for one year; merge var-batches by geoid.
async function pullLevel(year, forClause, inClause, geoidFn) {
  const merged = new Map(); // geoid -> {name, vals}
  for (const vb of VARBATCHES) {
    const p = new URLSearchParams();
    p.set('get', ['NAME', ...vb].join(','));
    p.set('for', forClause);
    if (inClause) p.set('in', inClause);
    p.set('key', KEY);
    const url = `https://api.census.gov/data/${year}/acs/acs5?${p.toString()}`;
    let json = null;
    for (let a = 0; a < 3 && !json; a++) {
      const res = await fetch(url);
      if (res.status === 204) { json = []; break; }
      if (res.ok) json = await res.json();
    }
    if (!json || !json.length) continue;
    const header = json[0];
    const idIdx = header.map((h, i) => [h, i]).filter(([h]) => ['state', 'county', 'place', CBSA_KEY].includes(h)).map(([, i]) => i);
    const nameIdx = header.indexOf('NAME');
    for (const row of json.slice(1)) {
      const geoid = geoidFn(header, row);
      if (!merged.has(geoid)) merged.set(geoid, { name: row[nameIdx], vals: {} });
      const rec = merged.get(geoid).vals;
      header.forEach((h, i) => { if (h !== 'NAME' && !idIdx.includes(i)) rec[h] = clean(row[i]); });
    }
  }
  return merged;
}

function assembleGeo(byVintageVals) {
  const byVintage = {};
  for (const y of VINTAGES) {
    const vals = byVintageVals[y] || {};
    const g = (c) => vals[c] ?? null;
    const row = {};
    for (const f of FIELDS) row[f.id] = vals && Object.keys(vals).length ? f.derive(g) : null;
    byVintage[y] = row;
  }
  return byVintage;
}

async function run() {
  if (!KEY) throw new Error('CENSUS_API_KEY not set');
  mkdirSync(GEO_DIR, { recursive: true });
  const places = JSON.parse(readFileSync(resolve(XWALK_DIR, 'crosswalk-places.json'), 'utf8'));
  const { cbsa_name } = JSON.parse(readFileSync(resolve(XWALK_DIR, 'crosswalk-cbsa.json'), 'utf8'));

  // Collect the per-level raw vals across vintages, then assemble + write.
  const levels = {
    place: { by: {}, forC: (st) => 'place:*', inC: (st) => `state:${st}`, gid: (h, r) => r[h.indexOf('state')] + r[h.indexOf('place')] },
    county: { by: {}, forC: (st) => 'county:*', inC: (st) => `state:${st}`, gid: (h, r) => r[h.indexOf('state')] + r[h.indexOf('county')] },
    state: { by: {}, forC: () => 'state:*', inC: () => null, gid: (h, r) => r[h.indexOf('state')] },
    cbsa: { by: {}, forC: () => `${CBSA_KEY}:*`, inC: () => null, gid: (h, r) => r[h.indexOf(CBSA_KEY)] },
  };

  // places + counties: per state; states + cbsa: national once
  for (const y of VINTAGES) {
    for (const st of STATES) {
      for (const lv of ['place', 'county']) {
        const m = await pullLevel(y, levels[lv].forC(st), levels[lv].inC(st), levels[lv].gid);
        for (const [gid, { name, vals }] of m) {
          (levels[lv].by[gid] ||= { name, v: {} }).v[y] = vals;
        }
      }
    }
    for (const lv of ['state', 'cbsa']) {
      const m = await pullLevel(y, levels[lv].forC(), levels[lv].inC(), levels[lv].gid);
      for (const [gid, { name, vals }] of m) {
        (levels[lv].by[gid] ||= { name, v: {} }).v[y] = vals;
      }
    }
    console.log(`  vintage ${y}: place ${Object.keys(levels.place.by).length}, county ${Object.keys(levels.county.by).length}, cbsa ${Object.keys(levels.cbsa.by).length}, state ${Object.keys(levels.state.by).length}`);
  }

  // Which counties / cbsas / states are actually referenced by our places
  const usedCounty = new Set(), usedCbsa = new Set(), usedState = new Set(STATES);
  for (const p of Object.values(places)) { if (p.county_fips) usedCounty.add(p.county_fips); if (p.cbsa) usedCbsa.add(p.cbsa); }

  const write = (prefix, gid, name, by) =>
    writeFileSync(resolve(GEO_DIR, `${prefix}-${gid}.json`), JSON.stringify({ geoid: gid, name, byVintage: assembleGeo(by) }));

  let counts = { place: 0, county: 0, cbsa: 0, state: 0 };
  for (const gid of Object.keys(places)) {
    const rec = levels.place.by[gid]; if (!rec) continue;
    write('place', gid, places[gid].name, rec.v); counts.place++;
  }
  for (const gid of usedCounty) { const rec = levels.county.by[gid]; if (rec) { write('county', gid, rec.name, rec.v); counts.county++; } }
  for (const gid of usedCbsa) { const rec = levels.cbsa.by[gid]; if (rec) { write('cbsa', gid, cbsa_name[gid] || rec.name, rec.v); counts.cbsa++; } }
  for (const gid of usedState) { const rec = levels.state.by[gid]; if (rec) { write('state', gid, rec.name, rec.v); counts.state++; } }

  // index: place picker + crosswalk (only places we actually wrote data for)
  const index = Object.values(places)
    .filter((p) => levels.place.by[p.geoid])
    .map((p) => ({ geoid: p.geoid, name: p.name, state_fips: p.state_fips, county_fips: p.county_fips,
      county_name: levels.county.by[p.county_fips]?.name || null, cbsa: p.cbsa, cbsa_title: p.cbsa_title,
      state_name: levels.state.by[p.state_fips]?.name || null, pop: p.pop }))
    .sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify({ vintages: VINTAGES, generated_states: STATES, places: index }));

  // schema.json — tab/section/field layout the browser generator uses to build
  // the workbook (keeps the on-site generator in sync with build-master-xlsx.mjs).
  const schema = {
    vintages: VINTAGES,
    tabs: TABS.map((t) => ({
      name: t.name,
      sections: t.sections.map((s) => ({
        title: s.title, source: s.source,
        fields: s.fields.map((id) => ({ id, label: FIELD[id].label, unit: FIELD[id].unit })),
      })),
    })),
  };
  writeFileSync(resolve(OUT_DIR, 'schema.json'), JSON.stringify(schema));
  console.log('Wrote', counts.place, 'places,', counts.county, 'counties,', counts.cbsa, 'cbsas,', counts.state, 'states + index.json + schema.json');
}

run();
