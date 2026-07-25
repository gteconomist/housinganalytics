#!/usr/bin/env node
/**
 * fetch-market.mjs — Zillow ZORI + Redfin → src/data/generated/market.json
 *
 * WHY device-run: files.zillowstatic.com and Redfin's S3 block the build
 * sandbox's egress; on your machine they download fine. This is the timeliness
 * OVERLAY layer — current market rents/prices, kept SEPARATE from the ACS
 * structural counts (never blended). The page shows it as "where the market is
 * now" next to the ACS-based affordability thresholds.
 *
 * Outputs market.json keyed by CBSA code (metro) and ZIP:
 *   { asOf, metros: { <cbsa>: { zori, name } }, zips: { <zip>: { zori, redfin_median_sale } } }
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'src', 'data', 'generated');
const UA = { 'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)' };

const ZORI_METRO = 'https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv';
const ZORI_ZIP   = 'https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv';
const REDFIN_ZIP = 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz';

async function getText(url, gz = false) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return gz ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}
// minimal CSV line splitter (handles quoted commas)
function splitLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === delim && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

async function zori(url, idField) {
  const txt = await getText(url);
  const lines = txt.split('\n').filter(Boolean);
  const head = splitLine(lines[0], ',');
  const idIdx = head.indexOf(idField);
  const nameIdx = head.indexOf('RegionName');
  const lastMonth = head[head.length - 1]; // most recent month column
  const rows = {};
  for (const l of lines.slice(1)) {
    const c = splitLine(l, ',');
    const id = c[idIdx]; if (!id) continue;
    const v = Number(c[c.length - 1]);
    rows[id] = { zori: Number.isFinite(v) ? Math.round(v) : null, name: c[nameIdx] };
  }
  return { asOf: lastMonth, rows };
}

async function redfinZip() {
  const txt = await getText(REDFIN_ZIP, true);
  const lines = txt.split('\n').filter(Boolean);
  const head = splitLine(lines[0], '\t');
  const zi = head.indexOf('region');           // e.g. "Zip Code: 30341"
  const pi = head.indexOf('median_sale_price');
  const di = head.indexOf('period_end');
  const latest = {};
  for (const l of lines.slice(1)) {
    const c = splitLine(l, '\t');
    const m = /(\d{5})/.exec(c[zi] || ''); if (!m) continue;
    const zip = m[1], per = c[di], price = Number(c[pi]);
    if (!Number.isFinite(price)) continue;
    if (!latest[zip] || per > latest[zip].period) latest[zip] = { period: per, price: Math.round(price) };
  }
  return latest;
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = { metros: {}, zips: {}, asOf: {} };
  try {
    const m = await zori(ZORI_METRO, 'RegionID'); // NOTE: Zillow uses RegionID, not CBSA — crosswalk applied in build step
    out.asOf.zori = m.asOf;
    for (const [id, r] of Object.entries(m.rows)) out.metros[id] = r;
    console.log(`ZORI metro: ${Object.keys(m.rows).length} regions, latest ${m.asOf}`);
  } catch (e) { console.warn(`ZORI metro failed: ${e.message}`); }
  try {
    const z = await zori(ZORI_ZIP, 'RegionName');
    for (const [zip, r] of Object.entries(z.rows)) out.zips[zip] = { zori: r.zori };
    console.log(`ZORI zip: ${Object.keys(z.rows).length} zips`);
  } catch (e) { console.warn(`ZORI zip failed: ${e.message}`); }
  try {
    const rf = await redfinZip();
    for (const [zip, r] of Object.entries(rf)) (out.zips[zip] ||= {}).redfin_median_sale = r.price;
    out.asOf.redfin = 'latest per-zip period_end';
    console.log(`Redfin zip: ${Object.keys(rf).length} zips`);
  } catch (e) { console.warn(`Redfin failed: ${e.message}`); }
  writeFileSync(join(OUT_DIR, 'market.json'), JSON.stringify(out));
  console.log('✓ Wrote src/data/generated/market.json');
}
run().catch((e) => { console.error(e); process.exit(1); });
