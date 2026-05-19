#!/usr/bin/env node
/**
 * fetch-qcew.mjs
 *
 * Downloads BLS Quarterly Census of Employment and Wages (QCEW) annual
 * averages, "by-area" CSV zip. Filters each county file to NAICS sector
 * (agglvl 74) and 3-digit subsector (agglvl 75) rows, rolls the per-
 * ownership rows up to all-ownerships totals, and writes:
 *
 *   src/data/generated/qcew.json
 *     { year, vintage_label, counties: { fips: { sectors:[...], subsectors:[...] } } }
 *
 * The build-data step picks this file up (like hud-ami.json and
 * gazetteer.json) and attaches `county.industries` to each county JSON.
 *
 * Override the year via QCEW_YEAR env var.
 *
 * Why by-area and not the singlefile zip:
 *   • Smaller download (~30–50 MB compressed vs ~200+ MB for the singlefile).
 *   • Per-area CSVs include industry_title — singlefile excludes the title
 *     columns, which would force a second lookup file.
 *   • Iterating CSV files one-at-a-time keeps peak memory low.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'qcew.json');

// QCEW annual averages release pattern. Default to last full year.
const YEAR = process.env.QCEW_YEAR || '2024';

const URL_CANDIDATES = [
  `https://data.bls.gov/cew/data/files/${YEAR}/csv/${YEAR}_annual_by_area.zip`,
  // Fallbacks if BLS hasn't published the requested year yet.
  `https://data.bls.gov/cew/data/files/${Number(YEAR) - 1}/csv/${Number(YEAR) - 1}_annual_by_area.zip`,
  `https://data.bls.gov/cew/data/files/${Number(YEAR) - 2}/csv/${Number(YEAR) - 2}_annual_by_area.zip`,
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)',
  'Accept': 'application/zip, application/octet-stream, */*',
};

async function fetchZip(urls) {
  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) { console.warn('  Empty body'); continue; }
      // Detect the year from the resolved URL so vintage_label is accurate.
      const m = url.match(/\/files\/(\d{4})\//);
      const resolvedYear = m ? m[1] : YEAR;
      console.log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB from ${url}.`);
      return { buf, year: resolvedYear };
    } catch (e) {
      console.warn(`  ${e.message}`);
    }
  }
  return null;
}

const result = await fetchZip(URL_CANDIDATES);
if (!result) {
  console.warn('WARNING: All QCEW fetches failed; industry section will be unavailable.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ counties: {} }, null, 2));
  process.exit(0);
}
const { buf: zipBuf, year: resolvedYear } = result;

// ─────────────────────────────────────────────────────────────────
// Mini ZIP walker — iterates entries via local file headers. Suitable
// for well-formed government ZIPs (same pattern fetch-gazetteer uses).
// Calls `onEntry(name, data)` for each entry; data is the inflated bytes.
// ─────────────────────────────────────────────────────────────────
function walkZip(buf, onEntry) {
  let i = 0, entries = 0;
  while (i < buf.length - 30) {
    // PK\x03\x04 = local file header
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) break;
    const compressionMethod = buf.readUInt16LE(i + 8);
    let compressed   = buf.readUInt32LE(i + 18);
    let uncompressed = buf.readUInt32LE(i + 22);
    const nameLen    = buf.readUInt16LE(i + 26);
    const extraLen   = buf.readUInt16LE(i + 28);
    const name       = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart  = i + 30 + nameLen + extraLen;

    // Skip directory entries (filenames ending with '/').
    if (!name.endsWith('/')) {
      const compData = buf.slice(dataStart, dataStart + compressed);
      let data;
      if (compressionMethod === 0)      data = compData;
      else if (compressionMethod === 8) data = inflateRawSync(compData);
      else { i = dataStart + compressed; continue; }
      onEntry(name, data);
    }
    i = dataStart + compressed;
    entries++;
    if (entries > 100_000) break; // safety
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────
// CSV parser — handles quoted fields with embedded commas (industry
// titles like "Industries not classified" + state names with commas).
// ─────────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────
// Per-county aggregation:
//   key = (area_fips, industry_code, agglvl_code)
//   For each key, prefer own_code='0' (Total Covered) if present.
//   Otherwise sum own_codes 1+2+3+5 (Fed, State, Local, Private) —
//   skip 8/9 to avoid double-counting (those are pre-summed totals).
// ─────────────────────────────────────────────────────────────────
const OWN_DETAIL = new Set(['1', '2', '3', '5']);
const counties = {};      // fips -> { sectors: Map, subsectors: Map }

// Resolve a header column name across possible variants. BLS docs say
// `annual_avg_estabs` but some recent vintages publish `annual_avg_estabs_count`,
// and pre-2017 files used `qtrly_estabs_count` quarterly-style names. Be tolerant.
function findCol(header, ...candidates) {
  const norm = s => String(s).trim().toLowerCase().replace(/[\s_]+/g, '_');
  const nh = header.map(norm);
  for (const c of candidates) {
    const i = nh.indexOf(norm(c));
    if (i >= 0) return i;
  }
  return -1;
}

let _headerLogged = false;

function processCountyCsv(csvText, expectedFips) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const I = {
    area:       findCol(header, 'area_fips'),
    own:        findCol(header, 'own_code'),
    industry:   findCol(header, 'industry_code'),
    agglvl:     findCol(header, 'agglvl_code'),
    indTitle:   findCol(header, 'industry_title'),
    estabs:     findCol(header, 'annual_avg_estabs', 'annual_avg_estabs_count', 'qtrly_estabs', 'qtrly_estabs_count'),
    emp:        findCol(header, 'annual_avg_emplvl', 'annual_avg_emplvl_count'),
    wages:      findCol(header, 'total_annual_wages'),
    wkly:       findCol(header, 'annual_avg_wkly_wage'),
    pay:        findCol(header, 'avg_annual_pay'),
  };
  // One-shot startup diagnostic so we can verify column resolution in the build log.
  if (!_headerLogged) {
    _headerLogged = true;
    console.log('QCEW header sample:', header.slice(0, 30).join(' | '));
    console.log('QCEW resolved column indices:', JSON.stringify(I));
    if (I.estabs < 0) {
      console.warn('WARN: annual_avg_estabs column not found — establishments will be 0. ' +
                   'Header was: ' + header.join(','));
    }
  }
  if (I.area < 0 || I.agglvl < 0 || I.industry < 0 || I.emp < 0) return null;

  // Per (industry_code, agglvl_code) bucket within this county.
  // We hold both an "own_code=0 row" (if present) and an accumulator over
  // own_codes 1/2/3/5; we pick the better one at flush time.
  const buckets = new Map();

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const rowFips = cols[I.area];
    if (expectedFips && rowFips !== expectedFips) continue;
    const agglvl = cols[I.agglvl];
    if (agglvl !== '74' && agglvl !== '75') continue;
    const own  = cols[I.own];
    const ind  = cols[I.industry];

    const emp   = num(cols[I.emp]);
    const wages = num(cols[I.wages]);
    const ests  = num(cols[I.estabs]);
    const title = (cols[I.indTitle] || '').replace(/^"|"$/g, '');

    const k = `${ind}|${agglvl}`;
    let b = buckets.get(k);
    if (!b) {
      b = { ind, agglvl, title, total_row: null, summed: { emp: 0, wages: 0, ests: 0, hasAny: false } };
      buckets.set(k, b);
    }
    if (!b.title && title) b.title = title;

    if (own === '0') {
      // Best single source: take it directly (BLS-computed all-ownerships total).
      b.total_row = { emp, wages, ests };
    } else if (OWN_DETAIL.has(own)) {
      if (emp != null)   { b.summed.emp   += emp;   b.summed.hasAny = true; }
      if (wages != null) { b.summed.wages += wages; b.summed.hasAny = true; }
      if (ests != null)  { b.summed.ests  += ests;  b.summed.hasAny = true; }
    }
  }
  return buckets;
}

// Filename → 5-digit FIPS. Patterns like:
//   "2024.annual 01001 Autauga County, Alabama.csv"
//   "allhlcsv/2024.annual 01001 Autauga County, Alabama.csv"
function fipsFromName(name) {
  // Take the basename, then grab the first 5-digit token.
  const base = name.split('/').pop();
  const m = base.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

// Walk the zip.
console.log('Walking ZIP and extracting county CSVs (agglvl 74/75 only)...');
let countyFilesSeen = 0;
let totalRows = 0;

walkZip(zipBuf, (name, data) => {
  if (!name.toLowerCase().endsWith('.csv')) return;
  const fips = fipsFromName(name);
  if (!fips) return;
  if (fips.endsWith('000')) return; // state-level slice, skip
  // Don't bother decoding the whole CSV if we don't recognize the fips.
  countyFilesSeen++;

  const text = data.toString('utf8');
  const buckets = processCountyCsv(text, fips);
  if (!buckets) return;

  if (!counties[fips]) counties[fips] = { sectors: [], subsectors: [] };

  for (const [, b] of buckets) {
    let emp, wages, ests;
    if (b.total_row && b.total_row.emp != null) {
      ({ emp, wages, ests } = b.total_row);
    } else if (b.summed.hasAny) {
      emp = b.summed.emp; wages = b.summed.wages; ests = b.summed.ests;
    } else {
      continue;
    }
    if (!emp || emp <= 0) continue;
    // Compute pay; sometimes total_annual_wages is suppressed (null) so pay null.
    const avg_annual_pay = (wages != null && emp > 0) ? wages / emp : null;
    const avg_weekly_wage = (avg_annual_pay != null) ? avg_annual_pay / 52 : null;
    const row = {
      naics: b.ind,
      title: b.title || b.ind,
      emp:   Math.round(emp),
      estabs: ests != null ? Math.round(ests) : null,
      total_annual_wages: wages != null ? Math.round(wages) : null,
      avg_annual_pay:    avg_annual_pay != null ? Math.round(avg_annual_pay) : null,
      avg_weekly_wage:   avg_weekly_wage != null ? Math.round(avg_weekly_wage) : null,
    };
    if (b.agglvl === '74') counties[fips].sectors.push(row);
    else                   counties[fips].subsectors.push(row);
    totalRows++;
  }
});

console.log(`Saw ${countyFilesSeen.toLocaleString()} county-level CSV entries, ` +
            `kept ${totalRows.toLocaleString()} industry rows across ` +
            `${Object.keys(counties).length.toLocaleString()} counties.`);

// Sort each county's arrays by employment (descending) so the page can
// show the largest sectors first without per-render sorting.
for (const fips of Object.keys(counties)) {
  counties[fips].sectors.sort((a, b) => (b.emp ?? 0) - (a.emp ?? 0));
  counties[fips].subsectors.sort((a, b) => (b.emp ?? 0) - (a.emp ?? 0));
}

const out = {
  year: resolvedYear,
  vintage_label: `BLS QCEW Annual Averages, ${resolvedYear}`,
  generated_at: new Date().toISOString(),
  county_count: Object.keys(counties).length,
  counties,
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out));
const fileSize = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(1);
console.log(`✓ Wrote QCEW (${resolvedYear}) for ${out.county_count} counties — ${fileSize} MB.`);

// Spot-check
const samples = ['13215', '13293', '01073', '06037', '36061', '48201'];
console.log('\n── Sample county industry top-sector ──');
for (const fips of samples) {
  const c = counties[fips];
  if (!c || !c.sectors.length) { console.log(`  ${fips}: no data`); continue; }
  const top = c.sectors[0];
  console.log(`  ${fips}: top sector "${top.title}" (NAICS ${top.naics}) — ` +
              `${top.emp.toLocaleString()} jobs, avg pay $${(top.avg_annual_pay ?? 0).toLocaleString()}`);
}
console.log('──────────────────────────\n');
