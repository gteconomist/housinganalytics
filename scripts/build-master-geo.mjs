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
// Served from /master-data (NOT under the gated /data/* prefix). The PAGE
// (/master-sheet) is gated by Cloudflare Access so a login is required to use
// the tool, but the browser must be able to fetch this JSON directly — a
// fetch() to an Access-gated path returns a login redirect, not the data. This
// is public Census data, so serving it un-gated is fine.
const OUT_DIR = resolve(ROOT, 'public/master-data');
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
  mkdirSync(resolve(OUT_DIR, 'states'), { recursive: true });
  const places = JSON.parse(readFileSync(resolve(XWALK_DIR, 'crosswalk-places.json'), 'utf8'));
  const { cbsa_name, county2cbsa } = JSON.parse(readFileSync(resolve(XWALK_DIR, 'crosswalk-cbsa.json'), 'utf8'));

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

  const stripState = (n) => (n || '').replace(/,\s*[^,]+$/, '').trim();

  // BUNDLE geographies into FEW files. GitHub Pages will not reliably serve tens
  // of thousands of tiny files (the per-geo approach produced ~11k and Pages
  // silently dropped them), so consolidate to one bundle per state
  // (states/<fips>.json = that state's places + counties) plus national
  // cbsas.json and us-states.json. ~55 files total. The browser fetches only the
  // few bundles a given generation needs.
  const stateBundles = {};
  const ensure = (st) => (stateBundles[st] ||= { places: {}, counties: {} });
  for (const gid of Object.keys(places)) {
    const rec = levels.place.by[gid]; if (!rec) continue;
    ensure(gid.slice(0, 2)).places[gid] = { name: places[gid].name, byVintage: assembleGeo(rec.v) };
  }
  for (const gid of Object.keys(levels.county.by)) {
    ensure(gid.slice(0, 2)).counties[gid] = { name: levels.county.by[gid].name, byVintage: assembleGeo(levels.county.by[gid].v) };
  }
  let counts = { states: 0, places: 0, counties: 0, cbsas: 0 };
  for (const [st, bundle] of Object.entries(stateBundles)) {
    writeFileSync(resolve(OUT_DIR, `states/${st}.json`), JSON.stringify(bundle));
    counts.states++; counts.places += Object.keys(bundle.places).length; counts.counties += Object.keys(bundle.counties).length;
  }
  const cbsas = {};
  for (const gid of Object.keys(levels.cbsa.by)) { cbsas[gid] = { name: cbsa_name[gid] || levels.cbsa.by[gid].name, byVintage: assembleGeo(levels.cbsa.by[gid].v) }; counts.cbsas++; }
  writeFileSync(resolve(OUT_DIR, 'cbsas.json'), JSON.stringify(cbsas));
  const usStates = {};
  for (const gid of Object.keys(levels.state.by)) usStates[gid] = { name: levels.state.by[gid].name, byVintage: assembleGeo(levels.state.by[gid].v) };
  writeFileSync(resolve(OUT_DIR, 'us-states.json'), JSON.stringify(usStates));

  // index: city picker (places) + county picker (counties) + crosswalk
  const cityIndex = Object.values(places)
    .filter((p) => levels.place.by[p.geoid])
    .map((p) => ({ geoid: p.geoid, name: p.name, state_fips: p.state_fips, county_fips: p.county_fips,
      county_name: stripState(levels.county.by[p.county_fips]?.name) || null, cbsa: p.cbsa, cbsa_title: p.cbsa_title,
      state_name: levels.state.by[p.state_fips]?.name || null, pop: p.pop }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const countyIndex = Object.keys(levels.county.by)
    .map((gid) => ({ geoid: gid, name: stripState(levels.county.by[gid].name), state_fips: gid.slice(0, 2),
      state_name: levels.state.by[gid.slice(0, 2)]?.name || null,
      cbsa: county2cbsa[gid]?.cbsa || null, cbsa_title: county2cbsa[gid]?.cbsa_title || null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.state_name?.localeCompare(b.state_name));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify({ vintages: VINTAGES, generated_states: STATES, places: cityIndex, counties: countyIndex }));

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
  console.log('Wrote', counts.states, 'state bundles (', counts.places, 'places +', counts.counties, 'counties ),', counts.cbsas, 'cbsas + us-states.json + index.json + schema.json');
}

run();
