#!/usr/bin/env node
/**
 * fetch-market.mjs — Zillow ZORI + Redfin → src/data/generated/market.json
 *
 * TIMELINESS OVERLAY layer (current market rents/prices), kept SEPARATE from the
 * ACS/CHAS structural counts. DEVICE-RUN (Zillow/Redfin block the build sandbox).
 *
 * Rent: Zillow ZORI (metro RegionName like "Atlanta, GA", + ZIP level).
 * Price: Redfin COUNTY + CITY market trackers (map to Census geos by name+state).
 *   The national ZIP tracker uncompresses past Node's max string length, so we
 *   STREAM-decompress the county/city files line-by-line instead.
 *
 * Outputs: { asOf, metros:{id:{zori,name}}, zips:{zip:{zori}},
 *            redfinCounty:{"name|st":{price,period}}, redfinCity:{"name|st":{price,period}},
 *            _diag:{...} }
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'src', 'data', 'generated');
const UA = { 'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)' };

const ZORI_METRO = 'https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv';
const ZORI_ZIP   = 'https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv';
const RF_COUNTY = 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/county_market_tracker.tsv000.gz';
const RF_CITY   = 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz';

function splitCsv(line, d) { const o = []; let c = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; }

async function zori(url, idField) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = Buffer.from(await res.arrayBuffer()).toString('utf8');
  const lines = txt.split('\n').filter(Boolean);
  const head = splitCsv(lines[0], ','), idIdx = head.indexOf(idField), nameIdx = head.indexOf('RegionName');
  const asOf = head[head.length - 1], rows = {};
  for (const l of lines.slice(1)) { const c = splitCsv(l, ','); const id = c[idIdx]; if (!id) continue; const v = Number(c[c.length - 1]); rows[id] = { zori: Number.isFinite(v) ? Math.round(v) : null, name: c[nameIdx] }; }
  return { asOf, rows };
}

const normKey = (region, st) =>
  String(region || '').toLowerCase().replace(/,.*$/, '').replace(/\s+(county|city|town|village|borough|cdp)$/,'').trim() + '|' + String(st || '').toLowerCase();

// stream a gzipped Redfin tracker; keep latest All-Residential (property_type_id=-1,
// non-seasonally-adjusted) median_sale_price per region. Fields are quoted + UPPERCASE.
const unq = (v) => (v == null ? '' : String(v).replace(/^"|"$/g, ''));
async function redfinTracker(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  let I = null, latest = {}, sample = null, seen = 0;
  for await (const line of rl) {
    const c = line.split('\t');
    if (!I) { const H = c.map((h) => unq(h).toUpperCase());
      I = { region: H.indexOf('REGION'), price: H.indexOf('MEDIAN_SALE_PRICE'), period: H.indexOf('PERIOD_END'),
            ptid: H.indexOf('PROPERTY_TYPE_ID'), st: H.indexOf('STATE_CODE'), sa: H.indexOf('IS_SEASONALLY_ADJUSTED'), dur: H.indexOf('PERIOD_DURATION') };
      continue; }
    seen++;
    if (unq(c[I.ptid]) !== '-1') continue;             // -1 = All Residential
    const sa = unq(c[I.sa]); if (sa !== 'false' && sa !== 'f') continue; // raw, not seasonally adjusted
    const price = Number(unq(c[I.price])); if (!Number.isFinite(price) || price <= 0) continue;
    const region = unq(c[I.region]), st = unq(c[I.st]), per = unq(c[I.period]), dur = Number(unq(c[I.dur])) || 0;
    if (!sample) sample = { region, state_code: st, period_end: per, median_sale_price: price };
    const k = normKey(region, st), cur = latest[k];
    if (!cur || per > cur.period || (per === cur.period && dur > cur.dur)) latest[k] = { price: Math.round(price), period: per, dur };
  }
  return { latest, sample, rows: seen };
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = { asOf: {}, metros: {}, zips: {}, redfinCounty: {}, redfinCity: {}, _diag: {} };
  try { const m = await zori(ZORI_METRO, 'RegionID'); out.asOf.zori = m.asOf; out.metros = m.rows; console.log(`ZORI metro: ${Object.keys(m.rows).length} regions, latest ${m.asOf}`); } catch (e) { console.warn(`ZORI metro failed: ${e.message}`); }
  try { const z = await zori(ZORI_ZIP, 'RegionName'); for (const [zip, r] of Object.entries(z.rows)) out.zips[zip] = { zori: r.zori }; console.log(`ZORI zip: ${Object.keys(z.rows).length} zips`); } catch (e) { console.warn(`ZORI zip failed: ${e.message}`); }
  for (const [label, url, key] of [['county', RF_COUNTY, 'redfinCounty'], ['city', RF_CITY, 'redfinCity']]) {
    try { const r = await redfinTracker(url); out[key] = r.latest; out._diag[label] = { sample: r.sample, rows: r.rows, kept: Object.keys(r.latest).length }; console.log(`Redfin ${label}: ${Object.keys(r.latest).length} regions (of ${r.rows} rows)`); }
    catch (e) { console.warn(`Redfin ${label} failed: ${e.message}`); }
  }
  out.asOf.redfin = 'latest period_end per region';
  writeFileSync(join(OUT_DIR, 'market.json'), JSON.stringify(out));
  console.log('✓ Wrote src/data/generated/market.json');
  const de = out.redfinCounty[normKey('DeKalb County', 'GA')], ch = out.redfinCity[normKey('Chamblee', 'GA')];
  console.log('  DeKalb County median sale:', de && ('$' + de.price.toLocaleString()));
  console.log('  Chamblee median sale:', ch && ('$' + ch.price.toLocaleString()));
}
run().catch((e) => { console.error(e); process.exit(1); });
