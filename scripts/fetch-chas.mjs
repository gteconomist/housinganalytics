#!/usr/bin/env node
/**
 * fetch-chas.mjs — HUD CHAS 2018-2022 → src/data/generated/chas.json
 *
 * Computes the RENTER "affordable AND available" shortage by HAMFI income tier
 * (≤30% ELI, ≤50% VLI, ≤80% LI) from CHAS Table 15C — renter-occupied units
 * cross-tabbed by rent affordability (RHUD30/50/80) × occupant household income.
 * "Available" removes affordable units occupied by higher-income households —
 * the refinement plain ACS can't produce. Also emits an availability RATIO per
 * tier (affordable-and-available ÷ affordable) so the page can apply CHAS's
 * structural insight to current ACS 2020-2024 counts (CHAS lags ACS ~2 yrs).
 *
 * DEVICE-RUN (HUD 403s from the build sandbox). Uses the CSVs already extracted
 * under src/data/generated/.chas-work/<code>/<code>/ (re-downloads only if
 * missing). Requires system `unzip` for the download path. Env: none.
 *
 * Cell mapping (Table 15C, "has complete kitchen & plumbing" subtotals,
 * bedrooms=All) VALIDATED against DeKalb (est1=120,005=ACS renters; rent tiers
 * sum to est3) and Chamblee, 2026-07-25.
 */
import { writeFileSync, mkdirSync, readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'generated');
const WORK = join(OUT_DIR, '.chas-work');
const BASE = process.env.CHAS_BASE || 'https://www.huduser.gov/PORTAL/datasets/cp';
const SUMLEVELS = { county: '050', place: '160' };
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)', 'Accept': 'application/zip, */*' };

// ── Table 15C layout (validated) ───────────────────────────────────────────
const RENT_BASE = { R30: 4, R50: 25, R80: 46, R80p: 67 };      // rent affordability tiers
const INC_OFF   = { All: 0, I30: 1, I50: 5, I80: 9, I100: 13, I100p: 17 }; // occupant income offset
const ALLRENT = ['R30', 'R50', 'R80', 'R80p'];
const CUTS = {                                                  // cumulative HAMFI cutoffs
  eli: { rents: ['R30'],             incs: ['I30'] },
  vli: { rents: ['R30', 'R50'],       incs: ['I30', 'I50'] },
  li:  { rents: ['R30', 'R50', 'R80'], incs: ['I30', 'I50', 'I80'] },
};
const estNum = (base, off) => RENT_BASE[base] + INC_OFF[off];
// every est column we need
const NEEDED = new Set();
for (const b of Object.keys(RENT_BASE)) for (const o of Object.keys(INC_OFF)) NEEDED.add(estNum(b, o));

function parseLine(line) { // quote-aware CSV split (place names contain commas)
  const out = []; let cur = '', q = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

// download+extract one summary level if its Table15C isn't already present
function ensureExtract(code) {
  const dir = join(WORK, code);
  const t15c = join(dir, code, 'Table15C.csv');
  if (existsSync(t15c)) return t15c;
  // also handle flat extraction (no nested <code>/ subdir)
  const flat = join(dir, 'Table15C.csv');
  if (existsSync(flat)) return flat;
  return null; // caller downloads
}

async function download(code, dir) {
  const url = `${BASE}/2018thru2022-${code}-csv.zip`;
  console.log(`Downloading ${url} …`);
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dir, { recursive: true });
  const zp = join(dir, '_chas.zip'); writeFileSync(zp, buf);
  execFileSync('unzip', ['-o', '-q', zp, '-d', dir]);
}

function computeGeo(vals) { // vals: {estNum: int}
  const cell = (b, o) => vals[estNum(b, o)] || 0;
  const out = { renterTotal: cell('R30', 'All') + cell('R50', 'All') + cell('R80', 'All') + cell('R80p', 'All') };
  for (const [key, { rents, incs }] of Object.entries(CUTS)) {
    const hh  = ALLRENT.reduce((s, r) => s + incs.reduce((t, i) => t + cell(r, i), 0), 0);
    const aff = rents.reduce((s, r) => s + cell(r, 'All'), 0);
    const aau = rents.reduce((s, r) => s + incs.reduce((t, i) => t + cell(r, i), 0), 0);
    out[key] = { hh, affordable: aff, affAndAvail: aau, shortage: hh - aau,
                 availRatio: aff > 0 ? +(aau / aff).toFixed(4) : null };
  }
  return out;
}

function processLevel(t15cPath) {
  const text = readFileSync(t15cPath, 'latin1');
  const lines = text.split('\n');
  const hdr = parseLine(lines[0]);
  const geoidIdx = hdr.indexOf('geoid');
  const estIdx = {}; // estNum -> column index
  hdr.forEach((h, i) => { const m = /^T15C_est(\d+)$/.exec(h); if (m && NEEDED.has(+m[1])) estIdx[+m[1]] = i; });
  const result = {};
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li]) continue;
    const row = parseLine(lines[li]);
    const gid = row[geoidIdx]; if (!gid || !gid.includes('US')) continue;
    const key = gid.split('US')[1]; // 0500000US13089 -> 13089 ; 1600000US1315172 -> 1315172
    const vals = {};
    for (const [n, idx] of Object.entries(estIdx)) vals[+n] = parseInt(row[idx] || '0', 10) || 0;
    result[key] = computeGeo(vals);
  }
  return result;
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = { vintage: 'CHAS 2018-2022', tenure: 'renter', measure: 'affordable-and-available (Table 15C)', geos: {} };
  for (const [level, code] of Object.entries(SUMLEVELS)) {
    let path = ensureExtract(code);
    if (!path) { try { await download(code, join(WORK, code)); path = ensureExtract(code); } catch (e) { console.warn(`  ${level}: ${e.message} — skipped`); continue; } }
    if (!path) { console.warn(`  ${level}: Table15C.csv not found — skipped`); continue; }
    const geos = processLevel(path);
    Object.assign(out.geos, geos);
    console.log(`  ${level}: ${Object.keys(geos).length} geographies`);
  }
  writeFileSync(join(OUT_DIR, 'chas.json'), JSON.stringify(out));
  const n = Object.keys(out.geos).length;
  console.log(`\n✓ Wrote src/data/generated/chas.json (${n} geographies).`);
  const de = out.geos['13089'], ch = out.geos['1315172'];
  if (de) console.log(`  DeKalb ELI: ${de.eli.hh} HH, ${de.eli.affAndAvail} aff&avail, shortage ${de.eli.shortage}`);
  if (ch) console.log(`  Chamblee ELI: ${ch.eli.hh} HH, ${ch.eli.affAndAvail} aff&avail, shortage ${ch.eli.shortage}`);
}
run().catch((e) => { console.error(e); process.exit(1); });
