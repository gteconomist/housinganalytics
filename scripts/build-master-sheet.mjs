// build-master-sheet.mjs
// ---------------------------------------------------------------------------
// Assembler: turns out/acs-raw.json into per-geography, per-vintage field
// values plus the 2015->2024 change the Master Sheet reports. Output shape
// mirrors the sheet's two-block layout (context geographies + peer cities).
//
// Output: out/master-sheet-data.json
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIELDS } from '../src/data/acs-vintage-crosswalk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../out');

// % change convention matches the sheet: (latest - earliest) / earliest for
// counts/dollars/years; simple difference for rates/shares would mislead, but
// the sheet uses proportional change throughout, so we mirror that and let the
// assembler flag rate fields for the eventual sheet writer.
function pctChange(a, b) {
  if (a == null || b == null || a === 0) return null;
  return (b - a) / Math.abs(a);
}

export function assemble(raw) {
  const { geos, vintages, data } = raw;
  const records = {};
  for (const geo of geos) {
    const byVintage = {};
    for (const y of vintages) {
      const rec = data[y]?.[geo.key];
      const g = (code) => (rec ? rec[code] ?? null : null);
      const row = {};
      for (const f of FIELDS) row[f.id] = rec ? f.derive(g) : null;
      byVintage[y] = row;
    }
    const change = {};
    for (const f of FIELDS) {
      change[f.id] = pctChange(byVintage[vintages[0]][f.id], byVintage[vintages[vintages.length - 1]][f.id]);
    }
    records[geo.key] = { label: geo.label, role: geo.role, byVintage, change };
  }
  return { geos, vintages, records };
}

// Path-safe "run directly" check (works when the repo path contains spaces).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = JSON.parse(readFileSync(resolve(OUT_DIR, 'acs-raw.json'), 'utf8'));
  const assembled = assemble(raw);
  const path = resolve(OUT_DIR, 'master-sheet-data.json');
  writeFileSync(path, JSON.stringify(assembled, null, 2));
  console.log('Wrote', path);
}
