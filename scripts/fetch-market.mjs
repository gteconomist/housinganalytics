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
 * Value: Zillow ZHVI COUNTY + CITY. NOT a substitute for the Redfin price and never
 *   merged with it — see the note above zhvi() for why. Carried as its own field.
 *
 * Outputs: { asOf, metros:{id:{zori,name}}, zips:{zip:{zori}},
 *            redfinCounty:{"name|st":{price,period}}, redfinCity:{"name|st":{price,period}},
 *            zhviCounty:{"name|st":{hval,hvalAsOf}}, zhviCountyFips:{"13089":{hval,hvalAsOf}},
 *            zhviCity:{"name|st":{hval,hvalAsOf}}, _diag:{...} }
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
// ZHVI mid-tier (35th–65th pct), SFR+condo, smoothed + seasonally adjusted.
const ZHVI_COUNTY = 'https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv';
const ZHVI_CITY   = 'https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv';

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

// COUNTY key that KEEPS the suffix. normKey() strips it, which collapses every independent
// city onto its namesake county — "St. Louis city" and "St. Louis County" both became
// "st. louis|mo", and last-row-wins silently put the county's price on the city (same for
// Baltimore, Richmond, Fairfax and ~38 more VA independent cities). Redfin's county REGION
// carries the suffix ("Tyler County, WV") and so do Census county names ("Fairfax city"),
// so an exact full-name key separates them. MUST stay byte-identical to the rfCountyKey in
// refresh-market.mjs and build-analysis-geo.mjs.
const rfCountyKey = (region, st) =>
  String(region || '').toLowerCase().replace(/,.*$/, '').replace(/\s+/g, ' ').trim() + '|' + String(st || '').toLowerCase();

// Loose (suffix-stripped) index over the full-key map, keeping ONLY keys that exactly one
// county collapses to. Ambiguous ones are dropped rather than resolved arbitrarily: a geography
// whose full name doesn't match upstream now reads "—" instead of reading confidently wrong.
function looseCountyIndex(full) {
  const n = {}, loose = {}, ambiguous = [];
  for (const rec of Object.values(full)) { const lk = normKey(rec.region, rec.st); n[lk] = (n[lk] || 0) + 1; }
  for (const rec of Object.values(full)) { const lk = normKey(rec.region, rec.st); if (n[lk] === 1) loose[lk] = rec; }
  for (const [lk, c] of Object.entries(n)) if (c > 1) ambiguous.push(lk);
  return { loose, ambiguous: ambiguous.sort() };
}

// stream a gzipped Redfin tracker; keep latest All-Residential (property_type_id=-1,
// non-seasonally-adjusted) median_sale_price per region. Fields are quoted + UPPERCASE.
const unq = (v) => (v == null ? '' : String(v).replace(/^"|"$/g, ''));
async function redfinTracker(url, keyFn) {
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
    const k = keyFn(region, st), cur = latest[k];
    // region + st are retained so a looser index can be derived without re-reading the file.
    if (!cur || per > cur.period || (per === cur.period && dur > cur.dur)) latest[k] = { price: Math.round(price), period: per, dur, region, st };
  }
  return { latest, sample, rows: seen };
}

/**
 * ZHVI — Zillow Home Value Index, mid-tier (35th–65th percentile), SFR + condo/co-op,
 * 3-month smoothed and seasonally adjusted.
 *
 * READ BEFORE USING THIS INTERCHANGEABLY WITH THE REDFIN PRICE — it is not the same
 * measure and the two must stay in separate fields:
 *   - Redfin median_sale_price = the median of homes that ACTUALLY CLOSED in the period.
 *     A transaction fact, but composition-driven and very noisy in small geographies.
 *   - ZHVI = a MODELED typical value across all homes with a Zestimate, sold or not.
 *     Tier-controlled and smoothed, so it is the stable series for trends and peers.
 * ZHVI also excludes multifamily (sfrcondo), while ZORI above includes it (sfrcondomfr) —
 * so a price-to-rent built from these two is not strictly one universe. Footnote it.
 *
 * Same CSV shape as ZORI: id columns, then one column per month. Counties carry
 * StateCodeFIPS + MunicipalCodeFIPS, so those join on exact GEOID instead of by name.
 */
async function zhvi(url, level) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = Buffer.from(await res.arrayBuffer()).toString('utf8');
  const lines = txt.split('\n').filter(Boolean);
  const head = splitCsv(lines[0], ',');
  const iName = head.indexOf('RegionName'), iSt = head.indexOf('State');
  const iSFips = head.indexOf('StateCodeFIPS'), iCFips = head.indexOf('MunicipalCodeFIPS');
  const iFirstDate = head.findIndex((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  if (iName < 0 || iSt < 0 || iFirstDate < 0) throw new Error(`unexpected ZHVI header: ${head.slice(0, 10).join(',')}`);
  const rows = {}, byFips = {};
  let asOf = null, kept = 0, fipsKept = 0;
  for (const l of lines.slice(1)) {
    const c = splitCsv(l, ',');
    // Walk back to the most recent non-empty month — coverage tails off for small
    // geographies, so the final column is often blank for exactly the places we care about.
    let v = null, when = null;
    for (let i = Math.min(c.length, head.length) - 1; i >= iFirstDate; i--) {
      if (c[i] === '') continue;
      const n = Number(c[i]);
      if (Number.isFinite(n) && n > 0) { v = Math.round(n); when = head[i]; break; }
    }
    if (v == null) continue;
    if (!asOf || when > asOf) asOf = when;
    const rec = { hval: v, hvalAsOf: when };
    rows[normKey(c[iName], c[iSt])] = rec; kept++;
    if (level === 'county' && iSFips >= 0 && iCFips >= 0) {
      const f = String(c[iSFips] || '').trim().padStart(2, '0') + String(c[iCFips] || '').trim().padStart(3, '0');
      if (/^\d{5}$/.test(f)) { byFips[f] = rec; fipsKept++; }
    }
  }
  return { asOf, rows, byFips, kept, fipsKept };
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = { asOf: {}, metros: {}, zips: {}, redfinCounty: {}, redfinCity: {}, zhviCounty: {}, zhviCountyFips: {}, zhviCity: {}, _diag: {} };
  try { const m = await zori(ZORI_METRO, 'RegionID'); out.asOf.zori = m.asOf; out.metros = m.rows; console.log(`ZORI metro: ${Object.keys(m.rows).length} regions, latest ${m.asOf}`); } catch (e) { console.warn(`ZORI metro failed: ${e.message}`); }
  try { const z = await zori(ZORI_ZIP, 'RegionName'); for (const [zip, r] of Object.entries(z.rows)) out.zips[zip] = { zori: r.zori }; console.log(`ZORI zip: ${Object.keys(z.rows).length} zips`); } catch (e) { console.warn(`ZORI zip failed: ${e.message}`); }
  // Counties key on the FULL name (suffix kept) so independent cities stay distinct from their
  // namesake county; the suffix-stripped map is derived and kept only where unambiguous.
  try {
    const r = await redfinTracker(RF_COUNTY, rfCountyKey);
    out.redfinCountyFull = r.latest;
    const { loose, ambiguous } = looseCountyIndex(r.latest);
    out.redfinCounty = loose;
    out._diag.county = { sample: r.sample, rows: r.rows, kept: Object.keys(r.latest).length, looseKept: Object.keys(loose).length, ambiguous };
    console.log(`Redfin county: ${Object.keys(r.latest).length} regions (of ${r.rows} rows); ${ambiguous.length} name collisions now resolved by full name${ambiguous.length ? ` (e.g. ${ambiguous.slice(0, 4).join(', ')})` : ''}`);
  } catch (e) { console.warn(`Redfin county failed: ${e.message}`); }
  // Cities key loosely on purpose: Redfin's city REGION carries NO suffix ("Campbell, TX")
  // while Census place names do ("Acworth city"), so stripping is what makes them join at all.
  try {
    const r = await redfinTracker(RF_CITY, normKey);
    out.redfinCity = r.latest;
    out._diag.city = { sample: r.sample, rows: r.rows, kept: Object.keys(r.latest).length };
    console.log(`Redfin city: ${Object.keys(r.latest).length} regions (of ${r.rows} rows)`);
  } catch (e) { console.warn(`Redfin city failed: ${e.message}`); }
  out.asOf.redfin = 'latest period_end per region';
  for (const [label, url, key] of [['county', ZHVI_COUNTY, 'zhviCounty'], ['city', ZHVI_CITY, 'zhviCity']]) {
    try {
      const r = await zhvi(url, label);
      out[key] = r.rows;
      if (label === 'county') out.zhviCountyFips = r.byFips;
      if (!out.asOf.zhvi || (r.asOf && r.asOf > out.asOf.zhvi)) out.asOf.zhvi = r.asOf;
      out._diag['zhvi_' + label] = { kept: r.kept, fipsKept: r.fipsKept, asOf: r.asOf };
      console.log(`ZHVI ${label}: ${r.kept} regions${label === 'county' ? ` (${r.fipsKept} with FIPS)` : ''}, latest ${r.asOf}`);
    } catch (e) { console.warn(`ZHVI ${label} failed: ${e.message}`); }
  }
  writeFileSync(join(OUT_DIR, 'market.json'), JSON.stringify(out));
  console.log('✓ Wrote src/data/generated/market.json');
  const de = out.redfinCountyFull[rfCountyKey('DeKalb County', 'GA')], ch = out.redfinCity[normKey('Chamblee', 'GA')];
  console.log('  DeKalb County median sale:', de && ('$' + de.price.toLocaleString()));
  console.log('  Chamblee median sale:', ch && ('$' + ch.price.toLocaleString()));
  // The collision regression check: these four must no longer be two identical pairs.
  for (const [nm, st] of [['Fairfax city', 'VA'], ['Fairfax County', 'VA'], ['St. Louis city', 'MO'], ['St. Louis County', 'MO'], ['Baltimore city', 'MD'], ['Baltimore County', 'MD']]) {
    const rec = out.redfinCountyFull[rfCountyKey(nm, st)];
    console.log(`  ${(nm + ', ' + st).padEnd(22)} ${rec ? '$' + rec.price.toLocaleString() : '— (no Redfin row)'}`);
  }
  const deV = out.zhviCountyFips['13089'] || out.zhviCounty[normKey('DeKalb County', 'GA')], chV = out.zhviCity[normKey('Chamblee', 'GA')];
  console.log('  DeKalb County ZHVI:', deV && ('$' + deV.hval.toLocaleString() + ' @ ' + deV.hvalAsOf));
  console.log('  Chamblee ZHVI:', chV && ('$' + chV.hval.toLocaleString() + ' @ ' + chV.hvalAsOf));
}
run().catch((e) => { console.error(e); process.exit(1); });
