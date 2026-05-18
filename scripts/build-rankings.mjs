#!/usr/bin/env node
/**
 * build-rankings.mjs
 *
 * Produces a single compact file that powers the Rankings page.
 *
 * Reads every county JSON written by build-data.mjs, extracts the metric set
 * defined in src/data/metric-metadata.js, and writes:
 *
 *   src/data/generated/rankings.json   (canonical)
 *   public/data/rankings.json          (mirror — fetched by the page at runtime)
 *
 * Row format is array-of-arrays to keep the payload small (3,222 counties ×
 * ~150 metrics is ~3 MB as object-of-objects; flattening cuts that roughly
 * in half before gzip).
 *
 * Run order: must come AFTER build-data.mjs, which wipes src/data/generated/
 * before regenerating the per-county files.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { METRICS, METRIC_GROUPS, POP_TIERS, tierForPop } from '../src/data/metric-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const COUNTIES   = join(ROOT, 'src', 'data', 'generated', 'counties');
const OUT_FILE   = join(ROOT, 'src', 'data', 'generated', 'rankings.json');
const PUBLIC_DIR = join(ROOT, 'public', 'data');
const PUBLIC_OUT = join(PUBLIC_DIR, 'rankings.json');

console.log(`Reading per-county JSON from ${COUNTIES}...`);
const files = (await readdir(COUNTIES)).filter(f => f.endsWith('.json')).sort();
console.log(`Found ${files.length} county files.`);

// Header columns: identity fields first, then every metric in METRICS order.
// Metrics are written in METRIC_GROUPS order so the column index in `rows`
// matches the picker order on the page (small but nice).
const groupOrder = new Map(METRIC_GROUPS.map((g, i) => [g, i]));
const metricsSorted = [...METRICS].sort((a, b) => {
  const ga = groupOrder.get(a.group) ?? 999;
  const gb = groupOrder.get(b.group) ?? 999;
  if (ga !== gb) return ga - gb;
  // Stable within group: preserve declaration order
  return METRICS.indexOf(a) - METRICS.indexOf(b);
});
const metricFields = metricsSorted.map(m => m.field);
const idCols = ['geoid', 'county_name', 'state_name', 'state_fips', 'slug', 'state_slug', 'pop_tier'];
const HEADERS = [...idCols, ...metricFields];

const rows = [];
let skipped = 0;
for (const file of files) {
  const c = JSON.parse(await readFile(join(COUNTIES, file), 'utf8'));
  if (!c.geoid) { skipped++; continue; }

  // Pull HUD AMI fields out of the nested object so they become first-class
  // sortable columns. The metadata uses hud_ami_4p_100/80/120; map them here.
  const hudAmi = c.hud_ami || {};
  c.hud_ami_4p_100 = hudAmi.ami_100_4p ?? null;
  c.hud_ami_4p_80  = hudAmi.ami_80_4p  ?? null;
  c.hud_ami_4p_120 = hudAmi.ami_120_4p ?? null;

  const row = [
    c.geoid,
    c.county_name,
    c.state_name,
    c.state_fips,
    c.slug,
    c.state_slug,
    tierForPop(c.population_total),
  ];
  for (const f of metricFields) {
    const v = c[f];
    // Null/undefined become null; numbers pass through. JSON.stringify will
    // shorten long floats — round to 4 dp for percentages and ratios to keep
    // the file lean without visibly affecting display.
    if (v == null || !Number.isFinite(v)) {
      row.push(null);
    } else {
      row.push(Math.round(v * 10000) / 10000);
    }
  }
  rows.push(row);
}

console.log(`Built ${rows.length} rows (skipped ${skipped}).`);

// Sort rows by state then county for a deterministic default order.
rows.sort((a, b) => {
  const sa = a[2] || '', sb = b[2] || '';
  if (sa !== sb) return sa.localeCompare(sb);
  return (a[1] || '').localeCompare(b[1] || '');
});

const payload = {
  generated_at: new Date().toISOString(),
  county_count: rows.length,
  metric_count: metricFields.length,
  headers: HEADERS,
  id_columns: idCols,
  metrics: metricsSorted,        // [{ field, label, group, format, source }]
  pop_tiers: POP_TIERS,          // [{ key, label, min, max }]
  rows,
};

// JSON output: compact (no pretty-printing) since this file ships to the browser.
// Replace Infinity (in pop_tiers) with a JSON-safe sentinel before stringifying.
const replacer = (_k, v) => (v === Infinity ? 1e15 : v);
const json = JSON.stringify(payload, replacer);

if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true });
await writeFile(OUT_FILE,   json);
await writeFile(PUBLIC_OUT, json);

const kb = (json.length / 1024).toFixed(0);
console.log(`✓ Wrote ${rows.length} rows × ${metricFields.length} metrics — ${kb} KB`);
console.log(`  → ${OUT_FILE}`);
console.log(`  → ${PUBLIC_OUT}`);
