// build-master-xlsx.mjs
// ---------------------------------------------------------------------------
// Writes a formatted .xlsx that mirrors the CORE-ACS tabs of the "Master
// Working Data Sheet" (Community Profile / Labor Force / Quality of Life /
// Housing), populated from out/master-sheet-data.json for the target place, its
// county / MSA / state, and the chosen peer cities.
//
// Uses SheetJS (the repo's existing xlsx dependency) so the same code can run
// in-browser for the future website generator. Community-edition SheetJS writes
// number formats (cell.z) and merges but not fonts/fills, so styling is limited
// to layout + number formats; that's sufficient for a data workbook.
//
// Output: out/Master Sheet - <Target>.xlsx
// Run: node scripts/build-master-xlsx.mjs   (or npm run master-xlsx)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { FIELDS } from '../src/data/acs-vintage-crosswalk.js';
import { TABS } from './lib/master-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../out');

const FIELD = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

// ---- number formats by unit -----------------------------------------------
const zFor = (unit) =>
  unit === 'dollars' ? '$#,##0'
  : unit === 'years' ? '0.0'
  : unit === 'share' || unit === 'rate' ? '0.0%'
  : '#,##0'; // count
const Z_CHG = '0.0%;(0.0%)';

// change convention matching the hand-made sheet: percentage-point DIFFERENCE
// for shares/rates, PROPORTIONAL change for counts/dollars/years.
function changeFor(unit, a, b) {
  if (a == null || b == null) return null;
  if (unit === 'share' || unit === 'rate') return b - a;
  if (a === 0) return null;
  return (b - a) / Math.abs(a);
}

// Tab/section/field layout is imported from ./lib/master-schema.mjs (shared
// with build-master-geo.mjs so the on-site generator stays in sync).

// ---- worksheet building ----------------------------------------------------
// We accumulate rows as arrays of {v,z} (or plain strings) and convert with a
// small helper that respects per-cell number formats and merges.
function buildSheet(tab, model) {
  const { records, vintages } = model;
  const target = Object.values(records).find((r) => r.role === 'target');
  const contextKeys = ['target', 'county', 'msa', 'state']
    .map((role) => Object.keys(records).find((k) => records[k].role === role))
    .filter(Boolean);
  const peerKeys = Object.keys(records)
    .filter((k) => records[k].role === 'target' || records[k].role === 'peer')
    .sort((a, b) => records[a].label.localeCompare(records[b].label));

  const rows = [];   // array of arrays of cells (cell = {v,z,t} | string | null)
  const merges = []; // {s:{r,c},e:{r,c}}
  const cols = 2 + Math.max(...TABS.flatMap((t) => t.sections.map((s) => s.fields.length * (vintages.length + 1))), 8);

  const push = (arr) => rows.push(arr);
  const S = (v) => (v == null ? '' : { v, t: 's' }); // string cell
  const N = (v, z) => (v == null ? '' : { v, t: 'n', z }); // number cell

  // Title band
  push([S(`${tab.name} — ${target ? target.label : ''}`)]);
  push([S(`Target: ${target ? target.label : ''}   ·   Comparison: ${peerKeys.filter((k)=>records[k].role==='peer').map((k)=>records[k].label).join(', ')}   ·   ACS 5-Year vintages: ${vintages.join(' / ')}`)]);
  push([]);

  for (const section of tab.sections) {
    const flds = section.fields.map((id) => FIELD[id]);
    // Section title
    const titleRow = rows.length;
    push([S(section.title)]);
    // field-label header (row 1) spanning (vintages+1) cols each, starting col C (index 2)
    const h1 = ['', ''];
    flds.forEach((f, i) => {
      const start = 2 + i * (vintages.length + 1);
      h1[start] = S(f.label);
      for (let j = 1; j <= vintages.length; j++) h1[start + j] = '';
      merges.push({ s: { r: rows.length, c: start }, e: { r: rows.length, c: start + vintages.length } });
    });
    push(h1);
    // vintage header (row 2)
    const h2 = ['', S('Geography')];
    flds.forEach((f, i) => {
      const start = 2 + i * (vintages.length + 1);
      vintages.forEach((y, j) => (h2[start + j] = S(String(y))));
      h2[start + vintages.length] = S('% Change');
    });
    push(h2);

    const emitGeoRow = (key) => {
      const r = records[key];
      const arr = ['', S(r.label)];
      flds.forEach((f, i) => {
        const start = 2 + i * (vintages.length + 1);
        vintages.forEach((y, j) => (arr[start + j] = N(r.byVintage[y][f.id], zFor(f.unit))));
        const chg = changeFor(f.unit, r.byVintage[vintages[0]][f.id], r.byVintage[vintages[vintages.length - 1]][f.id]);
        arr[start + vintages.length] = N(chg, Z_CHG);
      });
      push(arr);
    };

    push([S('  Geographic context')]);
    contextKeys.forEach(emitGeoRow);
    push([]);
    push([S('  Comparison communities')]);
    peerKeys.forEach(emitGeoRow);
    push([]);
    push(['', S(`Source: ${section.source}`)]);
    push([]);
  }

  // Convert to worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === '' || c == null ? null : (typeof c === 'object' ? c.v : c)))));
  // apply cell types + number formats
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    if (c && typeof c === 'object') {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      ws[addr] = { t: c.t, v: c.v };
      if (c.z) ws[addr].z = c.z;
    }
  }));
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 2 }, { wch: 22 }, ...Array.from({ length: cols }, () => ({ wch: 11 }))];
  return ws;
}

function buildNotes(model) {
  const notes = [
    ['Master Working Data Sheet — census (core-ACS) generator'],
    [`Generated for target: ${Object.values(model.records).find((r) => r.role === 'target')?.label}`],
    [`ACS 5-Year vintages: ${model.vintages.join(', ')}`],
    [],
    ['Geographies'],
    ['  Target place, plus its county / MSA / state (auto-context) and the chosen comparison cities.'],
    [],
    ['Conventions & findings (differences from the original hand-made sheet)'],
    ['  1. "Per Capita Income" on Community Profile = ACS B19301. The original sheet labeled this "MHI"; the actual median household income (B19013) is on the Labor Force tab.'],
    ['  2. Educational attainment is cumulative ("HS or higher", "Some College or higher"). The original "Bachelor\'s+" column held the graduate/professional-degree count, shown here as "Graduate/Professional".'],
    ['  3. Vacant "Other" = total vacant − for-rent − for-sale-only (broader than the single ACS other-vacant line).'],
    ['  4. Change columns: percentage-point difference for shares/rates; proportional change for counts, dollars, and ages.'],
    ['  5. Some cells may be blank where ACS suppressed the estimate (small place / older vintage), e.g. median rent by bedroom.'],
    [],
    ['Not included in this core-ACS cut (deferred)'],
    ['  Income by age cohort (B19037); HUD FMR & CHAS cost burden; LEHD OnTheMap commuting; Woods & Poole / ARC / Georgia-OPB forecasts; SchoolDigger; Zillow; crime.'],
    [],
    ['Source: U.S. Census Bureau, American Community Survey 5-Year Estimates (api.census.gov). Generated by housinganalytics.org.'],
  ];
  return XLSX.utils.aoa_to_sheet(notes);
}

function build(model) {
  const wb = XLSX.utils.book_new();
  for (const tab of TABS) XLSX.utils.book_append_sheet(wb, buildSheet(tab, model), tab.name);
  XLSX.utils.book_append_sheet(wb, buildNotes(model), 'Notes');
  return wb;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = JSON.parse(readFileSync(resolve(OUT_DIR, 'master-sheet-data.json'), 'utf8'));
  const target = Object.values(model.records).find((r) => r.role === 'target')?.label || 'Target';
  const wb = build(model);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `Master Sheet - ${target}.xlsx`);
  // Use XLSX.write -> Buffer + Node fs (the ESM build doesn't wire fs into
  // XLSX.writeFile; this path is also reusable in the browser via a Blob).
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path, buf);
  console.log('Wrote', path);
}

export { build };
