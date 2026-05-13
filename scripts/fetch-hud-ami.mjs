#!/usr/bin/env node
/**
 * fetch-hud-ami.mjs
 *
 * Downloads HUD's Section 8 Income Limits dataset (annual Excel file),
 * parses it, and writes `src/data/generated/hud-ami.json` — a county-FIPS
 * → AMI map that build-data.mjs picks up and embeds in each county JSON.
 *
 * Why a separate step: HUD updates this dataset once a year (around April).
 * Keeping it isolated means we can re-run it without rebuilding the rest
 * of the site, and it gracefully degrades if HUD's URL changes.
 *
 * Override the dataset year by setting HUD_IL_URL in the environment.
 */
import * as XLSX from 'xlsx';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'hud-ami.json');

// HUD publishes annual Section 8 Income Limits. URL pattern:
//   https://www.huduser.gov/portal/datasets/il/il{YY}/Section8-FY{YY}.xlsx
// Update HUD_IL_URL once a year. The build will still succeed if the fetch
// fails — HUD AMI panels just won't appear.
const HUD_URL = process.env.HUD_IL_URL
  || 'https://www.huduser.gov/portal/datasets/il/il25/Section8-FY25.xlsx';

console.log(`Fetching HUD Income Limits from ${HUD_URL}...`);

let buf;
try {
  const res = await fetch(HUD_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${buf.length.toLocaleString()} bytes.`);
} catch (err) {
  console.warn(`WARNING: HUD fetch failed: ${err.message}`);
  console.warn('Site will build without HUD AMI; panels will show "—".');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

let wb;
try {
  wb = XLSX.read(buf, { type: 'buffer' });
} catch (err) {
  console.warn(`WARNING: HUD file did not parse as Excel: ${err.message}`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
if (!rows.length) {
  console.warn('HUD file is empty. Skipping.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

// ── Field-name detection ───────────────────────────────────────────
// HUD has used slightly different column names across years. Detect them
// case-insensitively and tolerate a few variants.
const keys = Object.keys(rows[0]);
const ci = name => keys.find(k => k.toLowerCase() === name.toLowerCase());
const findKey = (...candidates) => candidates.map(ci).find(Boolean) || null;

const stateKey   = findKey('state', 'state_alpha', 'STUSAB');
const countyKey  = findKey('county');
const fipsKey    = findKey('fips2010', 'fips', 'fips_code');
const areaKey    = findKey('Areaname', 'AreaName', 'FMR Area Name', 'area_name');
const mfiKey     = findKey('Median2025', 'Median2024', 'Median_Income', 'median', 'medY1');

if (!fipsKey && !(stateKey && countyKey)) {
  console.error('Could not identify county FIPS columns in HUD file. Available keys:');
  console.error(keys.slice(0, 30).join(', '));
  process.exit(1);
}
if (!mfiKey) {
  console.error('Could not identify Median Family Income column. Available keys:');
  console.error(keys.slice(0, 30).join(', '));
  process.exit(1);
}

console.log(`HUD field detection:`);
console.log(`  state=${stateKey}  county=${countyKey}  fips=${fipsKey}`);
console.log(`  area=${areaKey}    mfi=${mfiKey}`);

function findLimitKey(prefix, hh) {
  return findKey(
    `${prefix}_${hh}`,
    `${prefix}${hh}`,
    `${prefix}_${hh}p`,
    `L${prefix.slice(1)}_${hh}`,
    `${prefix.toUpperCase()}_${hh}`,
  );
}
const LK = {
  l80_2: findLimitKey('l80', 2),
  l80_4: findLimitKey('l80', 4),
  l50_2: findLimitKey('l50', 2),
  l50_4: findLimitKey('l50', 4),
  l30_2: findLimitKey('l30', 2),
  l30_4: findLimitKey('l30', 4),
};
console.log(`  limits: ${JSON.stringify(LK)}`);

function fipsOf(row) {
  if (fipsKey && row[fipsKey] != null) {
    const s = String(row[fipsKey]).replace(/\D/g, '');
    return s.padStart(5, '0').slice(-5);
  }
  if (stateKey && countyKey) {
    const s = String(row[stateKey] ?? '').replace(/\D/g, '').padStart(2, '0');
    const c = String(row[countyKey] ?? '').replace(/\D/g, '').padStart(3, '0');
    return s + c;
  }
  return null;
}

function n(v) {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}
function round50(v) {
  return v == null ? null : Math.round(v / 50) * 50;
}

const out = {};
let skipped = 0;
for (const row of rows) {
  const fips = fipsOf(row);
  if (!fips || fips.length !== 5) { skipped++; continue; }
  const mfi = n(row[mfiKey]);
  if (!mfi) { skipped++; continue; }

  // HUD household-size adjustment for 4-person base → 2-person: 0.80
  const mfi_4p = mfi;
  const mfi_2p = mfi * 0.80;

  // 80% AMI: prefer HUD's published rounded values; fall back to computed.
  const ami_80_2p = n(row[LK.l80_2]) ?? round50(mfi_2p * 0.80);
  const ami_80_4p = n(row[LK.l80_4]) ?? round50(mfi_4p * 0.80);

  // 100% AMI: equals HUD MFI for 4-person; 0.80 × MFI for 2-person.
  const ami_100_2p = mfi_2p;
  const ami_100_4p = mfi_4p;

  // 120% AMI: HUD doesn't publish; standard workforce convention.
  const ami_120_2p = round50(mfi_2p * 1.20);
  const ami_120_4p = round50(mfi_4p * 1.20);

  out[fips] = {
    fmr_area: areaKey ? row[areaKey] : null,
    mfi_4p,
    mfi_2p,
    ami_80_2p,
    ami_80_4p,
    ami_100_2p,
    ami_100_4p,
    ami_120_2p,
    ami_120_4p,
  };
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out, null, 2));
console.log(`✓ Wrote HUD AMI for ${Object.keys(out).length} counties (skipped ${skipped}) to ${OUT_FILE}`);
