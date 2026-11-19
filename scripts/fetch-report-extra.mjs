#!/usr/bin/env node
/**
 * fetch-report-extra.mjs
 *
 * Census figures the report builder (/report) needs that no other pipeline
 * carries. Writes ONE committed file:  src/data/report-extra.json
 *
 *   ACS 5-year (place + county)
 *     B26001_001E  population in group quarters (prisons, dorms, barracks…)
 *     B01003_001E  total population
 *     margins of error for the five estimates a report leans on hardest:
 *       B19013_001M median household income      B25077_001M median home value
 *       B25064_001M median gross rent            B25001_001M housing units
 *       B25003_003M renter-occupied units        B25004_008M other vacant
 *   2020 Census DHC (place + county): housing units, occupied units,
 *     population, group quarters population.
 *   2010 Census SF1 (county only): the same four — places changed too much
 *     between censuses to compare.
 *
 * WHY: two traps a templated report walks straight into.
 *   1. Group quarters. In a prison or college town a third of the "population"
 *      is not in households, which wrecks age, race, education, per-capita
 *      income and labor-force figures. The report engine flags any geography
 *      where the share is material.
 *   2. The 2010 → 2020 benchmark break. ACS 2011-15 and 2016-20 are controlled
 *      to 2010-based housing-unit estimates; 2020-24 is controlled to the 2020
 *      Census. Where the two censuses disagree badly (Telfair County GA:
 *      7,297 units in 2010, 4,704 in 2020) a "trend" in units or households is
 *      mostly the correction. The engine compares the 2016-20 ACS unit count
 *      with the 2020 Census count and suppresses count trends when they diverge.
 *
 * Committed outside src/data/generated/ because CI does not run this script
 * (it needs the Census key). Stored compact: fixed-order arrays, see `order`.
 *
 * Env:  CENSUS_API_KEY (repo-root .env or environment) · CENSUS_YEAR (2024)
 *       CENSUS_STATE=13[,45]  restrict the run for a smoke test
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'src', 'data', 'report-extra.json');

function envKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return '';
  const m = readFileSync(p, 'utf8').match(/^CENSUS_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
  return m ? m[1].trim() : '';
}
const API_KEY = envKey();
const YEAR = process.env.CENSUS_YEAR || '2024';

const ALL_STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18',
  '19','20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40','41','42','44','45','46','47','48',
  '49','50','51','53','54','55','56','72',
];
const STATES = (process.env.CENSUS_STATE || '').trim()
  ? process.env.CENSUS_STATE.split(',').map((s) => s.trim().padStart(2, '0'))
  : ALL_STATE_FIPS;

const ACS = ['B26001_001E', 'B01003_001E', 'B19013_001M', 'B25077_001M', 'B25064_001M', 'B25001_001M', 'B25003_003M', 'B25004_008M'];
const ACS_ORDER = ['gq', 'pop', 'mhi_moe', 'value_moe', 'rent_moe', 'units_moe', 'renters_moe', 'other_vacant_moe'];
const DEC20 = ['H1_001N', 'H3_002N', 'P1_001N', 'P18_001N'];
const DEC10 = ['H001001', 'H003002', 'P001001', 'P042001'];
const DEC_ORDER = ['units', 'occupied', 'pop', 'gq'];

// Census uses large negative sentinels for "not available / not applicable".
const num = (v) => { const n = Number(v); return v == null || v === '' || !isFinite(n) || n < -1e6 ? null : n; };

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + (API_KEY ? `&key=${API_KEY}` : ''), { redirect: 'follow' });
      if (r.status === 204) return [];
      const t = await r.text();
      if (r.ok && t.trim().startsWith('[')) return JSON.parse(t);
      if (r.status === 400 || r.status === 404) return null;   // table not published for this geography
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

async function pull(dataset, vars, geo, st) {
  const forClause = geo === 'place' ? `place:*&in=state:${st}` : `county:*&in=state:${st}`;
  const rows = await get(`https://api.census.gov/data/${dataset}?get=${vars.join(',')}&for=${forClause}`);
  const out = {};
  if (!rows || rows.length < 2) return out;
  const h = rows[0];
  const iState = h.indexOf('state'), iGeo = h.indexOf(geo);
  for (const r of rows.slice(1)) out[r[iState] + r[iGeo]] = vars.map((v) => num(r[h.indexOf(v)]));
  return out;
}

async function main() {
  if (!API_KEY) { console.error('CENSUS_API_KEY not found (repo-root .env). The 2024 endpoints require it.'); process.exit(1); }
  // Keep only the geographies the site profiles (places 5,000+).
  const idx = JSON.parse(await readFile(join(ROOT, 'public', 'analysis-data', 'index.json'), 'utf8'));
  const keepPlaces = new Set(idx.places.map((p) => p.geoid));

  const places = {}, counties = {};
  for (const st of STATES) {
    const [pa, ca, pd, cd, c10] = await Promise.all([
      pull(`${YEAR}/acs/acs5`, ACS, 'place', st),
      pull(`${YEAR}/acs/acs5`, ACS, 'county', st),
      pull('2020/dec/dhc', DEC20, 'place', st),
      pull('2020/dec/dhc', DEC20, 'county', st),
      pull('2010/dec/sf1', DEC10, 'county', st),
    ]);
    let np = 0;
    for (const [g, a] of Object.entries(pa)) { if (keepPlaces.has(g)) { places[g] = [a, pd[g] || null]; np++; } }
    for (const [g, a] of Object.entries(ca)) counties[g] = [a, cd[g] || null, c10[g] || null];
    console.log(`  ${st}: ${np} places, ${Object.keys(ca).length} counties`);
  }
  const out = {
    vintage: Number(YEAR),
    generated_at: new Date().toISOString(),
    order: { acs: ACS_ORDER, dec: DEC_ORDER, place: ['acs', 'dec20'], county: ['acs', 'dec20', 'dec10'] },
    codes: { acs: ACS, dec20: DEC20, dec10: DEC10 },
    places, counties,
  };
  await writeFile(OUT_FILE, JSON.stringify(out));
  console.log(`Wrote ${OUT_FILE}: ${Object.keys(places).length} places, ${Object.keys(counties).length} counties`);
}
main().catch((e) => { console.error(e); process.exit(1); });
