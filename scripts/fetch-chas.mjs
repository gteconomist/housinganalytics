#!/usr/bin/env node
/**
 * fetch-chas.mjs  —  HUD CHAS 2018-2022 (place + county) → src/data/generated/chas.json
 *
 * WHY device-run: HUD (huduser.gov) blocks non-browser egress and the build
 * sandbox has no open network, so — like fetch-hud-ami.mjs — this runs on your
 * machine as part of the pipeline.
 *
 * WHAT it adds beyond ACS: CHAS cross-tabs households by income (as % of HAMFI)
 * against the affordability of their unit, which yields the "affordable AND
 * available" gap (units affordable to a tier that AREN'T already occupied by
 * higher-income households) — the headline-grade shortage figure. Plain ACS
 * only gives the "affordable" measure.
 *
 * FIRST RUN = DIAGNOSTIC. CHAS changed its table layout / disclosure-avoidance
 * suppressions in recent vintages, and the exact CSV filenames + column codes
 * (e.g. T7_est#) can't be verified from the build sandbox. So on first run this
 * prints the CSV file list, each file's header, and a Chamblee sample row, then
 * writes chas-raw.json. Send me that diagnostic and I'll lock the CELL_MAP below;
 * after that the script emits the finished chas.json the page consumes.
 *
 * Requires: system `unzip` (present on macOS). Env: none.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'generated');

// CHAS 2018-2022 bulk downloads by summary level (050 = county, 160 = place).
// Override the vintage via CHAS_BASE if HUD advances it.
const BASE = process.env.CHAS_BASE || 'https://www.huduser.gov/PORTAL/datasets/cp';
const SUMLEVELS = { county: '050', place: '160' };
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)', 'Accept': 'application/zip, application/octet-stream, */*' };

// TODO(after first-run diagnostic): map CHAS table cells → the fields the page needs.
// Filled once we see the real headers. Kept here so integration is a one-file edit.
const CELL_MAP = null;

async function download(url) {
  console.log(`Downloading ${url} …`);
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty body');
  console.log(`  ${buf.length.toLocaleString()} bytes`);
  return buf;
}

function unzipTo(buf, dir) {
  mkdirSync(dir, { recursive: true });
  const zp = join(dir, 'chas.zip');
  writeFileSync(zp, buf);
  execFileSync('unzip', ['-o', '-q', zp, '-d', dir]);
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
}

function parseCsvHeader(path) {
  const txt = readFileSync(path, 'utf8');
  const nl = txt.indexOf('\n');
  const header = txt.slice(0, nl).trim().split(',').map((s) => s.replace(/^"|"$/g, ''));
  const firstRows = txt.split('\n').slice(1, 4).map((r) => r.trim());
  return { header, firstRows };
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const diagnostic = {};
  const raw = {};
  for (const [level, code] of Object.entries(SUMLEVELS)) {
    const url = `${BASE}/2018thru2022-${code}-csv.zip`;
    let buf;
    try { buf = await download(url); }
    catch (e) {
      console.warn(`  WARNING ${level}: ${e.message}. Skipping (page will fall back to ACS-only for ${level}).`);
      continue;
    }
    const work = join(tmpdir(), `chas-${code}`);
    let csvs;
    try { csvs = unzipTo(buf, work); }
    catch (e) { console.warn(`  unzip failed (${e.message}). Is \`unzip\` installed?`); continue; }

    console.log(`\n── ${level} (sumlevel ${code}): ${csvs.length} CSV files ──`);
    diagnostic[level] = {};
    for (const f of csvs) {
      const { header, firstRows } = parseCsvHeader(join(work, f));
      diagnostic[level][f] = { header, sample: firstRows };
      console.log(`  ${f}: ${header.length} cols → ${header.slice(0, 8).join(', ')}${header.length > 8 ? ' …' : ''}`);
    }
    // If CELL_MAP is set (post-diagnostic), compute finished records here.
    // Until then we keep the raw CSVs' path for the follow-up mapping step.
    raw[level] = { dir: work, files: csvs };
    try { rmSync(join(work, 'chas.zip')); } catch {}
  }

  if (!CELL_MAP) {
    writeFileSync(join(OUT_DIR, 'chas-diagnostic.json'), JSON.stringify(diagnostic, null, 2));
    console.log(`\n✓ First-run diagnostic written to src/data/generated/chas-diagnostic.json`);
    console.log(`  Send that file back and I'll finalize the cell mapping, then this script emits chas.json.`);
    return;
  }
  // (post-mapping compute path — added once CELL_MAP is known)
}
run().catch((e) => { console.error(e); process.exit(1); });
