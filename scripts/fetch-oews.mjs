#!/usr/bin/env node
/**
 * fetch-oews.mjs
 *
 * Downloads BLS Occupational Employment and Wage Statistics (OEWS) for the
 * Metropolitan and Nonmetropolitan area level, plus a 10-year-prior vintage
 * for the change calculation, plus the county→OEWS-area crosswalk. Writes:
 *
 *   src/data/generated/oews.json
 *     {
 *       year,
 *       prior_year,
 *       vintage_label,
 *       counties: {
 *         "13215": [
 *           { soc, title, jobs, jobs_prior, hourly, annual, soc_changed },
 *           ...
 *         ]
 *       }
 *     }
 *
 * Geography caveat: OEWS doesn't publish at county level. Every county is
 * mapped to its MSA (via 2023 OMB delineations) or to a multi-county
 * nonmetropolitan area defined by BLS. All counties inside the same area
 * receive the same wages and job counts. The chart caption discloses this.
 *
 * Override years via OEWS_YEAR / OEWS_PRIOR_YEAR env vars.
 *
 * Why this script does three downloads:
 *   • The current-year OEWS MSA bundle (jobs + wages, latest).
 *   • The 10-year-prior OEWS MSA bundle (for the change column).
 *   • The area definitions workbook (county FIPS → AREA code).
 */
import * as XLSX from 'xlsx';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'oews.json');

// Defaults: latest is May (current_year - 1) since OEWS publishes in April for
// the prior survey period. As of May 2026 the latest is May 2025; 10-yr prior is May 2015.
const YEAR       = process.env.OEWS_YEAR       || '2025';
const PRIOR_YEAR = process.env.OEWS_PRIOR_YEAR || String(Number(YEAR) - 10);

// ─────────────────────────────────────────────────────────────────
// Curated essential-worker occupation list. SOC codes are 2018-SOC
// (what current OEWS publishes). When the prior vintage uses 2010 SOC,
// `priorSoc` lists the equivalent code(s) to look up — multiple codes
// indicate an employment-weighted aggregation (e.g. Fast Food and Counter
// Workers, 35-3023, was 35-3021 + 35-3022 in 2010 SOC).
// ─────────────────────────────────────────────────────────────────
const OCCUPATIONS = [
  { soc: '35-3023', title: 'Fast Food and Counter Workers',           priorSoc: ['35-3021', '35-3022'] },
  { soc: '41-2011', title: 'Cashiers' },
  { soc: '41-2031', title: 'Retail Salespersons' },
  { soc: '31-1131', title: 'Home Health and Personal Care Aides',     priorSoc: ['31-1011', '31-1014'] },
  { soc: '39-9011', title: 'Childcare Workers' },
  { soc: '37-2011', title: 'Janitors and Cleaners' },
  { soc: '43-9061', title: 'Office Clerks, General' },
  { soc: '43-3071', title: 'Tellers' },
  { soc: '35-3031', title: 'Waiters and Waitresses' },
  { soc: '47-2061', title: 'Construction Laborers' },
  { soc: '49-9071', title: 'Maintenance and Repair Workers, General' },
  { soc: '33-2011', title: 'Firefighters' },
  { soc: '47-2031', title: 'Carpenters' },
  { soc: '53-3032', title: 'Heavy and Tractor-Trailer Truck Drivers' },
  { soc: '29-2043', title: 'Paramedics',                              priorSoc: ['29-2041'] },
  { soc: '33-3051', title: 'Police and Sheriff\'s Patrol Officers' },
  { soc: '25-2021', title: 'Elementary School Teachers, Except Special Education' },
  { soc: '47-2152', title: 'Plumbers, Pipefitters, and Steamfitters' },
  { soc: '47-2111', title: 'Electricians' },
  { soc: '29-1141', title: 'Registered Nurses' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)',
  'Accept': 'application/zip, application/octet-stream, */*',
};

async function fetchBytes(urls, label) {
  for (const url of urls) {
    try {
      console.log(`  Trying ${url}`);
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) { console.warn(`    HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) { console.warn('    Empty body'); continue; }
      console.log(`    Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
      return buf;
    } catch (e) {
      console.warn(`    ${e.message}`);
    }
  }
  console.warn(`WARNING: All ${label} fetches failed.`);
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Mini ZIP walker (same as fetch-qcew). Calls onEntry(name, data).
// ─────────────────────────────────────────────────────────────────
function walkZip(buf, onEntry) {
  let i = 0, entries = 0;
  while (i < buf.length - 30) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) break;
    const compressionMethod = buf.readUInt16LE(i + 8);
    const compressed   = buf.readUInt32LE(i + 18);
    const nameLen      = buf.readUInt16LE(i + 26);
    const extraLen     = buf.readUInt16LE(i + 28);
    const name         = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart    = i + 30 + nameLen + extraLen;
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
    if (entries > 100_000) break;
  }
}

function num(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // OEWS disclosure codes — wage/emp not available.
  if (s === '*' || s === '**' || s === '#' || s === '~') return null;
  const n = Number(s.replace(/[,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Case-insensitive column lookup tolerating whitespace + underscore variants.
function findCol(header, ...candidates) {
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '_');
  const nh = header.map(norm);
  for (const c of candidates) {
    const i = nh.indexOf(norm(c));
    if (i >= 0) return i;
  }
  return -1;
}

// Find an XLSX entry inside a downloaded ZIP, parse with SheetJS, return rows.
function readFirstXlsxFromZip(zipBuf) {
  let rows = null;
  walkZip(zipBuf, (name, data) => {
    if (rows) return;
    if (!/\.xlsx$/i.test(name) && !/\.xls$/i.test(name)) return;
    // Skip "MSA_dl_table_layout.xlsx" or similar layout helper files.
    if (/layout/i.test(name)) return;
    const wb = XLSX.read(data, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
    console.log(`  Parsed ${name} (${rows.length.toLocaleString()} rows)`);
  });
  return rows;
}

// ─────────────────────────────────────────────────────────────────
// Step 1: Area definitions — county FIPS → AREA code.
// ─────────────────────────────────────────────────────────────────
console.log('\n[1/3] Fetching area definitions...');
const areaDefBuf = await fetchBytes([
  `https://www.bls.gov/oes/area_definitions_m${YEAR}.xlsx`,
  `https://www.bls.gov/oes/area_definitions_m${Number(YEAR) - 1}.xlsx`,
  `https://www.bls.gov/oes/area_definitions_m${Number(YEAR) - 2}.xlsx`,
], 'area definitions');

const fipsToArea = {}; // "13215" -> "0017980" (OEWS AREA code, 7-char)
if (areaDefBuf) {
  const wb = XLSX.read(areaDefBuf, { type: 'buffer' });
  // Try every sheet — BLS sometimes splits MSAs and nonmetropolitan areas across tabs.
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false });
    if (!rows.length) continue;
    // Find the header row (some workbooks have title rows above the header).
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = (rows[i] ?? []).map(c => String(c ?? '').toLowerCase());
      if (r.some(c => /msa code|cbsa code|area code|area_code/.test(c)) &&
          r.some(c => /fips|county code|cnty/.test(c))) { h = i; break; }
    }
    if (h < 0) continue;
    const header = rows[h].map(c => String(c ?? ''));
    const cArea  = findCol(header, 'MSA Code', 'CBSA Code', 'Area Code', 'AREA');
    // FIPS column has many possible spellings.
    const cFips  = findCol(header, 'FIPS', 'County FIPS', 'County Code',
                            'FIPS Code', 'cnty_code', 'FIPS Code', 'County Code (FIPS)');
    if (cArea < 0 || cFips < 0) continue;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      let area = String(r[cArea] ?? '').replace(/\D/g, '');
      let fips = String(r[cFips] ?? '').replace(/\D/g, '');
      if (!area || !fips) continue;
      // OEWS area codes are 7 chars (zero-padded). County FIPS is 5 chars.
      area = area.padStart(7, '0');
      fips = fips.padStart(5, '0');
      if (fips.length !== 5) continue;
      // Allow either MSA-style (00 + CBSA) or NMA-style codes.
      fipsToArea[fips] = area;
    }
  }
  console.log(`  Built crosswalk for ${Object.keys(fipsToArea).length.toLocaleString()} counties.`);
} else {
  console.warn('  Continuing without area definitions — output will be empty.');
}

// ─────────────────────────────────────────────────────────────────
// Step 2: Parse OEWS MSA bundle for a given year → AREA → SOC → row.
// ─────────────────────────────────────────────────────────────────
async function fetchAndParseOews(year, isPrior) {
  console.log(`\n[${isPrior ? '3' : '2'}/3] Fetching OEWS May ${year}...`);
  const zipBuf = await fetchBytes([
    `https://www.bls.gov/oes/special-requests/oesm${String(year).slice(-2)}ma.zip`,
  ], `OEWS May ${year}`);
  if (!zipBuf) return { byArea: new Map(), year: null };

  const rows = readFirstXlsxFromZip(zipBuf);
  if (!rows || rows.length < 2) {
    console.warn('  Could not find a usable XLSX inside the OEWS zip.');
    return { byArea: new Map(), year: null };
  }
  const header = rows[0].map(c => String(c ?? ''));
  const I = {
    area:    findCol(header, 'AREA', 'area_code', 'area'),
    type:    findCol(header, 'AREA_TYPE', 'area_type'),
    soc:     findCol(header, 'OCC_CODE', 'occ_code', 'soc_code'),
    title:   findCol(header, 'OCC_TITLE', 'occ_title'),
    group:   findCol(header, 'O_GROUP', 'o_group', 'OCC_GROUP'),
    emp:     findCol(header, 'TOT_EMP', 'tot_emp'),
    hMean:   findCol(header, 'H_MEAN', 'h_mean'),
    aMean:   findCol(header, 'A_MEAN', 'a_mean'),
    hMedian: findCol(header, 'H_MEDIAN', 'h_pct50', 'h_median'),
    aMedian: findCol(header, 'A_MEDIAN', 'a_pct50', 'a_median'),
  };
  console.log(`  Resolved OEWS columns: ${JSON.stringify(I)}`);
  if (I.area < 0 || I.soc < 0 || I.emp < 0) {
    console.warn('  Critical columns missing; aborting parse.');
    return { byArea: new Map(), year: null };
  }

  const byArea = new Map(); // areaCode -> Map(soc -> {emp, hMean, aMean})
  let kept = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    let area = String(r[I.area] ?? '').replace(/\D/g, '');
    if (!area) continue;
    area = area.padStart(7, '0');
    const soc = String(r[I.soc] ?? '').trim();
    if (!soc || soc === '00-0000') continue;
    const emp     = num(r[I.emp]);
    const hMean   = num(r[I.hMean]);
    const aMean   = num(r[I.aMean]);
    const hMedian = num(r[I.hMedian]);
    const aMedian = num(r[I.aMedian]);
    let entry = byArea.get(area);
    if (!entry) { entry = new Map(); byArea.set(area, entry); }
    entry.set(soc, { emp, hMean, aMean, hMedian, aMedian });
    kept++;
  }
  console.log(`  Indexed ${kept.toLocaleString()} (area, occupation) cells across ${byArea.size.toLocaleString()} areas.`);
  return { byArea, year: String(year) };
}

const current = await fetchAndParseOews(YEAR, false);
const prior   = await fetchAndParseOews(PRIOR_YEAR, true);

// ─────────────────────────────────────────────────────────────────
// Step 3: Build per-county output rows.
// For prior-year lookup, try the same SOC; if not found and the
// occupation has a `priorSoc` crosswalk, sum emp + employment-weighted
// average wages across the listed prior-SOC codes.
// ─────────────────────────────────────────────────────────────────
function lookupPrior(areaMap, occ) {
  if (!areaMap) return null;
  const same = areaMap.get(occ.soc);
  if (same && same.emp != null) return { ...same, soc_changed: false };
  if (!occ.priorSoc) return null;
  let empSum = 0, hSum = 0, hW = 0, aSum = 0, aW = 0;
  let any = false;
  for (const s of occ.priorSoc) {
    const r = areaMap.get(s);
    if (!r) continue;
    if (r.emp != null) { empSum += r.emp; any = true; }
    if (r.hMean != null && r.emp != null) { hSum += r.hMean * r.emp; hW += r.emp; }
    if (r.aMean != null && r.emp != null) { aSum += r.aMean * r.emp; aW += r.emp; }
  }
  if (!any) return null;
  return {
    emp: empSum,
    hMean: hW > 0 ? hSum / hW : null,
    aMean: aW > 0 ? aSum / aW : null,
    soc_changed: true,
  };
}

const out = {
  year: current.year ?? YEAR,
  prior_year: prior.year ?? PRIOR_YEAR,
  vintage_label: `BLS OEWS May ${current.year ?? YEAR}` +
                 (prior.year ? ` (10-year change vs. May ${prior.year})` : ''),
  generated_at: new Date().toISOString(),
  occupations: OCCUPATIONS.map(o => ({ soc: o.soc, title: o.title })),
  county_count: 0,
  counties: {},
};

if (current.byArea.size === 0 || Object.keys(fipsToArea).length === 0) {
  console.warn('No usable current OEWS data or no crosswalk — writing empty output.');
} else {
  for (const [fips, area] of Object.entries(fipsToArea)) {
    const cur = current.byArea.get(area);
    if (!cur) continue;
    const pri = prior.byArea.get(area) ?? null;
    const rowsOut = [];
    for (const occ of OCCUPATIONS) {
      const c = cur.get(occ.soc);
      if (!c || c.emp == null) {
        // Don't include occupations with no current-year employment data for the area.
        rowsOut.push({ soc: occ.soc, title: occ.title, jobs: null, jobs_prior: null,
                       jobs_change: null, jobs_pct_change: null,
                       hourly: null, annual: null, soc_changed: false });
        continue;
      }
      const p = lookupPrior(pri, occ);
      const jobs        = Math.round(c.emp);
      const hourly      = c.hMean ?? c.hMedian ?? null;
      const annual      = c.aMean ?? c.aMedian ?? null;
      const jobs_prior  = p && p.emp != null ? Math.round(p.emp) : null;
      const jobs_change = jobs_prior != null ? jobs - jobs_prior : null;
      const jobs_pct_change = (jobs_prior != null && jobs_prior > 0)
        ? (jobs - jobs_prior) / jobs_prior * 100 : null;
      rowsOut.push({
        soc: occ.soc,
        title: occ.title,
        jobs,
        jobs_prior,
        jobs_change,
        jobs_pct_change,
        hourly: hourly != null ? Math.round(hourly * 100) / 100 : null,
        annual: annual != null ? Math.round(annual) : null,
        soc_changed: p?.soc_changed ?? false,
      });
    }
    out.counties[fips] = rowsOut;
    out.county_count++;
  }
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out));
const fileSize = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(1);
console.log(`\n✓ Wrote OEWS for ${out.county_count.toLocaleString()} counties — ${fileSize} MB.`);

// Spot-check
const samples = ['13215', '13293', '01073', '06037', '36061', '48201'];
console.log('\n── Sample county top occupations ──');
for (const fips of samples) {
  const rows = out.counties[fips];
  if (!rows || !rows.length) { console.log(`  ${fips}: no data`); continue; }
  const withWage = rows.filter(r => r.annual != null);
  withWage.sort((a, b) => b.annual - a.annual);
  const top = withWage.slice(0, 3);
  console.log(`  ${fips}: ${top.map(r =>
    `${r.title.slice(0, 24)} $${(r.annual ?? 0).toLocaleString()}`).join(' | ')}`);
}
console.log('──────────────────────────────────\n');
