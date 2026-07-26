// build-analysis-geo.mjs — NATIONAL
// Pulls ACS 2020-2024 5-yr cost-burden + supply tables for every county and every
// profiled city (the 4,814 places in manifest.json, i.e. 5,000+ population), stores
// RAW counts per geography (affordability math runs client-side), and bundles one
// file per state into public/analysis-data/. Also emits a compact per-geography
// summary (src/data/housing-gap-summary.json — committed, unlike src/data/generated/) so
// profile pages can render the gap card at build time without fetching a state bundle.
//
// Env: CENSUS_API_KEY (falls back to repo-root .env), STATES (comma FIPS; default =
// every state in manifest.json), CONCURRENCY (default 6).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as _resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = _resolve(__dirname, '..');
const OUT = _resolve(ROOT, 'public/analysis-data');
const GEN = _resolve(ROOT, 'src/data/generated');

// --- API key: env, else repo-root .env ---
let KEY = process.env.CENSUS_API_KEY;
if (!KEY && existsSync(_resolve(ROOT, '.env'))) {
  const m = /^\s*CENSUS_API_KEY\s*=\s*"?([^"\s]+)"?/m.exec(readFileSync(_resolve(ROOT, '.env'), 'utf8'));
  if (m) KEY = m[1];
}

const YEAR = 2024; // ACS 2020-2024 5-yr — matches the rest of the site (CHAS layered separately)
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

const MANIFEST = JSON.parse(readFileSync(_resolve(GEN, 'manifest.json'), 'utf8'));
// Only build for places that actually have a profile on the site (5,000+ pop).
const PLACE_KEEP = new Set(MANIFEST.places.map((p) => p.geoid));
const ALL_STATES = [...new Set(MANIFEST.counties.map((c) => c.geoid.slice(0, 2)))].sort();
const STATES = (process.env.STATES ? process.env.STATES.split(',').map((s) => s.trim().padStart(2, '0')) : ALL_STATES);

// Tables we pull whole (group()) then slice by known offsets.
const TABLES = ['B25074', 'B25095', 'B25118', 'B25063', 'B25075', 'B25003', 'B19013', 'B25064', 'B25077'];

const num = (v) => { const n = Number(v); return (v == null || !Number.isFinite(n) || n <= -666666666) ? 0 : n; };
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));

async function pull(table, forC, inC) {
  const p = new URLSearchParams();
  p.set('get', `group(${table})`); p.set('for', forC); if (inC) p.set('in', inC); p.set('key', KEY);
  const url = `https://api.census.gov/data/${YEAR}/acs/acs5?${p}`;
  let lastErr = null;
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(url);
      if (r.status === 204) return [];          // no such geography at this level
      if (r.ok) return await r.json();
      if (r.status === 400) {                    // table genuinely unavailable for this geo
        const t = await r.text();
        if (/unknown variable|error: unknown/i.test(t)) return [];
      }
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) { lastErr = e; }
    await sleep(500 * (a + 1));
  }
  throw new Error(`fetch failed ${table} ${forC} ${inC || ''}: ${lastErr && lastErr.message}`);
}

// pull one table for all geographies of one level in a state -> Map geoid->{NAME, vars}
async function pullLevel(table, level, st) {
  const forC = level === 'place' ? 'place:*' : 'county:*';
  const json = await pull(table, forC, `state:${st}`);
  const out = new Map();
  if (!json.length) return out;
  const h = json[0];
  const si = h.indexOf('state'), pi = h.indexOf(level), ni = h.indexOf('NAME');
  for (const row of json.slice(1)) {
    const geoid = row[si] + row[pi];
    if (level === 'place' && !PLACE_KEEP.has(geoid)) continue;   // profiled cities only
    const rec = {};
    h.forEach((k, i) => { if (k.endsWith('E')) rec[k] = row[i]; });
    out.set(geoid, { name: row[ni], vars: rec });
  }
  return out;
}

// run async jobs with a small concurrency cap
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// --- model builder from raw vars for one geography ---
const V = (vars, t, i) => num(vars[`${t}_${String(i).padStart(3, '0')}E`]);
const REN_STARTS = [2, 11, 20, 29, 38, 47, 56];          // B25074 income brackets
const OWN_STARTS = [2, 11, 20, 29, 38, 47, 56, 65];      // B25095 income brackets
function burdenTriplet(vars, table, starts) {
  const total = [], burd = [], sev = [];
  for (const s of starts) {
    total.push(Math.round(V(vars, table, s)));
    burd.push(Math.round(V(vars, table, s + 4) + V(vars, table, s + 5) + V(vars, table, s + 6) + V(vars, table, s + 7)));
    sev.push(Math.round(V(vars, table, s + 7)));
  }
  return { total, burd, sev };
}
function buildModel(vars) {
  const ren = burdenTriplet(vars, 'B25074', REN_STARTS);
  const own = burdenTriplet(vars, 'B25095', OWN_STARTS);
  const rentBands = []; for (let i = 3; i <= 26; i++) rentBands.push(Math.round(V(vars, 'B25063', i)));  // B25063 003..026
  const valBands = []; for (let i = 2; i <= 27; i++) valBands.push(Math.round(V(vars, 'B25075', i)));    // B25075 002..027
  const ownInc = []; for (let i = 3; i <= 13; i++) ownInc.push(Math.round(V(vars, 'B25118', i)));        // B25118 003..013
  return {
    mhi: Math.round(V(vars, 'B19013', 1)),
    medRent: Math.round(V(vars, 'B25064', 1)),
    medValue: Math.round(V(vars, 'B25077', 1)),
    tenure: { total: Math.round(V(vars, 'B25003', 1)), owner: Math.round(V(vars, 'B25003', 2)), renter: Math.round(V(vars, 'B25003', 3)) },
    ren, own, rentBands, valBands, ownInc,
  };
}

// ── summary math — mirrors public/js/housing-gap.js at its DEFAULT assumptions ──
const DEFAULTS = { rate: 0.067, down: 0.10, ti: 0.015, pmi: 0.005, front: 0.30 };
const REN_INC_B = [[0, 10000], [10000, 20000], [20000, 35000], [35000, 50000], [50000, 75000], [75000, 100000], [100000, Infinity]];
const RENT_BANDS_B = [[0, 99], [100, 149], [150, 199], [200, 249], [250, 299], [300, 349], [350, 399], [400, 449], [450, 499],
  [500, 549], [550, 599], [600, 649], [650, 699], [700, 749], [750, 799], [800, 899], [900, 999],
  [1000, 1249], [1250, 1499], [1500, 1999], [2000, 2499], [2500, 2999], [3000, 3499], [3500, 6000]];
const REN_TIERS = [20000, 35000, 50000, 75000];
function cumLE(bands, counts, X) {
  let t = 0;
  for (let i = 0; i < bands.length; i++) {
    const [lo, hi] = bands[i], n = counts[i] || 0;
    if (hi <= X) t += n;
    else if (lo > X) continue;
    else t += n * Math.max(0, Math.min(1, (X - lo) / (hi - lo + 1)));
  }
  return t;
}
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
function summarize(model) {
  const A = DEFAULTS;
  const renT = sum(model.ren.total), renB = sum(model.ren.burd), renS = sum(model.ren.sev);
  let peak = null;
  for (const cut of REN_TIERS) {
    const hh = cumLE(REN_INC_B, model.ren.total, cut);
    const units = cumLE(RENT_BANDS_B, model.rentBands, A.front * cut / 12);
    const gap = Math.round(hh - units);
    if (!peak || gap > peak.gap) peak = { cut, gap };
  }
  const c = model.chas;
  return {
    rt: renT,                                                   // renter households (ACS 2020–2024)
    crt: c ? c.renterTotal : null,                               // renter households (CHAS 2018–2022)
    rb: renT ? +(renB / renT * 100).toFixed(1) : null,           // % renters cost-burdened
    rs: renS,                                                    // severely burdened renters
    pg: peak ? peak.gap : null, pc: peak ? peak.cut : null,      // peak rental gap + its income tier
    eli: c && c.eli ? c.eli.shortage : null,                     // CHAS affordable-and-available shortage
    vli: c && c.vli ? c.vli.shortage : null,
    li: c && c.li ? c.li.shortage : null,
  };
}

// Rank + band each universe on the ≤50% AMI shortage per renter household. The
// denominator is CHAS's OWN renter total, not the ACS one — mixing vintages
// (CHAS 2018–2022 numerator ÷ ACS 2020–2024 denominator) produces impossible
// rates in places whose renter base moved between the two.
const THIN_RENTERS = 500;   // below this, flag the card rather than trusting the rate
function rankUniverse(recs) {
  const scored = Object.entries(recs)
    .filter(([, s]) => s.vli != null && s.crt > 0)
    .map(([gid, s]) => ({ gid, rate: s.vli / s.crt }))
    .sort((a, b) => b.rate - a.rate);
  const n = scored.length;
  scored.forEach((x, i) => {
    const rec = recs[x.gid];
    rec.rank = i + 1;
    rec.score = Math.max(0, Math.min(100, Math.round((1 - i / n) * 100)));
    if (rec.crt < THIN_RENTERS) rec.thin = 1;
  });
  return n;
}

function stripState(n) { return (n || '').replace(/,\s*[^,]+$/, '').trim(); }

function writeSummary(summary) {
  summary.counties_count = rankUniverse(summary.counties);
  summary.places_count = rankUniverse(summary.places);
  summary.vintage = { acs: 'ACS 2020–2024 5-year', chas: 'HUD CHAS 2018–2022' };
  summary.assumptions = DEFAULTS;
  summary.thin_renters = THIN_RENTERS;
  writeFileSync(_resolve(ROOT, 'src/data/housing-gap-summary.json'), JSON.stringify(summary));
  console.log(`Summary: ${summary.counties_count} ranked counties, ${summary.places_count} ranked places.`);
}

// SUMMARY_ONLY=1 — recompute the profile-card summary from the state bundles
// already on disk (no API calls). Use after changing the summary/band math.
function summaryOnly() {
  const summary = { places: {}, counties: {} };
  for (const st of STATES) {
    const f = _resolve(OUT, `states/${st}.json`);
    if (!existsSync(f)) { console.warn(`  ${st}: bundle missing — skipped`); continue; }
    const b = JSON.parse(readFileSync(f, 'utf8'));
    for (const [gid, r] of Object.entries(b.places || {})) summary.places[gid] = summarize(r.model);
    for (const [gid, r] of Object.entries(b.counties || {})) summary.counties[gid] = summarize(r.model);
  }
  writeSummary(summary);
}

async function run() {
  if (process.env.SUMMARY_ONLY) return summaryOnly();
  if (!KEY) throw new Error('CENSUS_API_KEY not set (env or repo-root .env)');
  let CHAS = {};
  const chasPath = _resolve(GEN, 'chas.json');
  if (existsSync(chasPath)) { try { CHAS = JSON.parse(readFileSync(chasPath, 'utf8')).geos || {}; console.log(`CHAS: merged ${Object.keys(CHAS).length} geos`); } catch (e) { console.warn('CHAS load failed:', e.message); } }
  else console.log('CHAS: chas.json not found — bundles built ACS-only');

  // ---- Market overlay (Zillow ZORI rent via metro/CBSA + Redfin price by name) ----
  const FIPS_USPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR' };
  const mNormKey = (region, st) => String(region || '').toLowerCase().replace(/,.*$/, '').replace(/\s+(county|city|town|village|borough|cdp)$/, '').trim() + '|' + String(st || '').toLowerCase();
  let MARKET = {}, PLACESX = {}, COUNTY2CBSA = {}, CBSA_NAME = {}, ZORI_BY_CBSA = {};
  try {
    MARKET = JSON.parse(readFileSync(_resolve(GEN, 'market.json'), 'utf8'));
    PLACESX = JSON.parse(readFileSync(_resolve(__dirname, '.master-crosswalk/crosswalk-places.json'), 'utf8'));
    const cbx = JSON.parse(readFileSync(_resolve(__dirname, '.master-crosswalk/crosswalk-cbsa.json'), 'utf8'));
    COUNTY2CBSA = cbx.county2cbsa || {}; CBSA_NAME = cbx.cbsa_name || {};
    // ZORI metro name "City, ST" -> key; CBSA title "City-...-..., ST" -> same key; join to cbsa code
    const metroKey = (nm) => { const [c, st] = String(nm).split(',').map((x) => (x || '').trim()); return st ? c.toLowerCase() + '|' + st.toLowerCase().split('-')[0] : null; };
    const cbsaKey = (t) => { const [c, st] = String(t).split(',').map((x) => (x || '').trim()); return st ? c.split('-')[0].toLowerCase() + '|' + st.split('-')[0].toLowerCase() : null; };
    const zoriByKey = {}; for (const r of Object.values(MARKET.metros || {})) { const k = metroKey(r.name); if (k && r.zori != null) zoriByKey[k] = r.zori; }
    for (const [code, title] of Object.entries(CBSA_NAME)) { const k = cbsaKey(title); if (k && zoriByKey[k] != null) ZORI_BY_CBSA[code] = zoriByKey[k]; }
    console.log(`MARKET: ${Object.keys(MARKET.redfinCity || {}).length} city + ${Object.keys(MARKET.redfinCounty || {}).length} county prices; ${Object.keys(ZORI_BY_CBSA).length} CBSA rents`);
  } catch (e) { console.log('MARKET: market.json/crosswalk not found — bundles built without overlay (' + e.message + ')'); }
  const buildMarket = (gid, cleanName, level, st) => {
    const abbr = FIPS_USPS[st] || ''; const cbsa = level === 'place' ? (PLACESX[gid] && PLACESX[gid].cbsa) : (COUNTY2CBSA[gid] && COUNTY2CBSA[gid].cbsa);
    const rent = cbsa ? (ZORI_BY_CBSA[cbsa] ?? null) : null;
    const pk = mNormKey(cleanName, abbr); const pr = level === 'place' ? (MARKET.redfinCity && MARKET.redfinCity[pk]) : (MARKET.redfinCounty && MARKET.redfinCounty[pk]);
    if (rent == null && !pr) return null;
    return { rent, rentAsOf: (MARKET.asOf && MARKET.asOf.zori) || null, price: pr ? pr.price : null, priceAsOf: pr ? pr.period : null, cbsaTitle: cbsa ? (CBSA_NAME[cbsa] || null) : null };
  };

  mkdirSync(_resolve(OUT, 'states'), { recursive: true });
  const placeIndex = [], countyIndex = [];
  const summary = { places: {}, counties: {} };
  let stateName = {};
  const sj = await pull('B19013', 'state:*', null);
  const sh = sj[0], sni = sh.indexOf('NAME'), ssi = sh.indexOf('state');
  for (const row of sj.slice(1)) stateName[row[ssi]] = row[sni];

  console.log(`\nBuilding ${STATES.length} states — ${PLACE_KEEP.size} profiled places + all counties.\n`);
  let done = 0;
  for (const st of STATES) {
    const bundle = { places: {}, counties: {} };
    for (const level of ['place', 'county']) {
      // pull all tables for this level+state in parallel, merge by geoid
      const results = await mapLimit(TABLES, CONCURRENCY, (t) => pullLevel(t, level, st));
      const merged = new Map();
      for (const m of results) {
        for (const [gid, { name, vars }] of m) {
          if (!merged.has(gid)) merged.set(gid, { name, vars: {} });
          Object.assign(merged.get(gid).vars, vars);
        }
      }
      for (const [gid, { name, vars }] of merged) {
        const model = buildModel(vars);
        if (model.tenure.total < 1) continue;
        model.chas = CHAS[gid] || null;
        model.market = buildMarket(gid, stripState(name), level, st);
        const tgt = level === 'place' ? bundle.places : bundle.counties;
        tgt[gid] = { name: stripState(name), model };
        (level === 'place' ? placeIndex : countyIndex).push({ geoid: gid, name: stripState(name), state_fips: st, state_name: stateName[st] || null });
        (level === 'place' ? summary.places : summary.counties)[gid] = summarize(model);
      }
    }
    writeFileSync(_resolve(OUT, `states/${st}.json`), JSON.stringify(bundle));
    done++;
    console.log(`[${String(done).padStart(2)}/${STATES.length}] ${stateName[st] || st}: ${Object.keys(bundle.places).length} places, ${Object.keys(bundle.counties).length} counties`);
  }

  placeIndex.sort((a, b) => a.name.localeCompare(b.name));
  countyIndex.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(_resolve(OUT, 'index.json'), JSON.stringify({
    vintage: 'ACS 2020-2024 5-year', generated_states: STATES,
    places: placeIndex, counties: countyIndex,
  }));

  writeSummary(summary);

  console.log(`\nWrote ${STATES.length} state bundles, ${placeIndex.length} places + ${countyIndex.length} counties to index.`);
  console.log(`Summary: ${summary.counties_count} ranked counties, ${summary.places_count} ranked places.`);
}
run().catch((e) => { console.error(e); process.exit(1); });
