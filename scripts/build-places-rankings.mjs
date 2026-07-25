#!/usr/bin/env node
/**
 * build-places-rankings.mjs
 *
 * City/place edition of build-rankings.mjs. Produces the compact columnar
 * file that powers the City Rankings page — same shape as rankings.json but
 * for the ~4,814 ACS places, with the city Housing Stress Index columns
 * (hsi_score, hsi_rank) appended.
 *
 * Reads src/data/generated/places/*.json (written by build-data.mjs) and
 * src/data/generated/hsi-places.json (written by build-index-places.mjs), so
 * it must run AFTER both.
 *
 * Writes:
 *   src/data/generated/places-rankings.json   (canonical)
 *   public/data/places-rankings.json          (mirror fetched by the page)
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { METRICS, METRIC_GROUPS, POP_TIERS, tierForPop } from '../src/data/metric-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const PLACES     = join(ROOT, 'src', 'data', 'generated', 'places');
const HSI_FILE   = join(ROOT, 'src', 'data', 'generated', 'hsi-places.json');
const OUT_FILE   = join(ROOT, 'src', 'data', 'generated', 'places-rankings.json');
const PUBLIC_DIR = join(ROOT, 'public', 'data');
const PUBLIC_OUT = join(PUBLIC_DIR, 'places-rankings.json');

const HSI_METRICS = [
  { field: 'hsi_score', label: 'Housing Stress Index (0–100)', group: 'Housing Stress Index', format: 'count', source: 'Composite — cities universe; see hsi-places.json' },
  { field: 'hsi_rank',  label: 'Housing Stress Index — city rank', group: 'Housing Stress Index', format: 'count', source: 'Composite — 1 = most stressed city' },
];

console.log(`Reading per-place JSON from ${PLACES}...`);
const files = (await readdir(PLACES)).filter(f => f.endsWith('.json')).sort();
console.log(`Found ${files.length} place files.`);

// City HSI lookup.
let hsi = { places: {} };
if (existsSync(HSI_FILE)) hsi = JSON.parse(await readFile(HSI_FILE, 'utf8'));
else console.warn('WARNING: hsi-places.json not found — hsi columns will be null. Run build-index-places first.');

// Same metric order as the county rankings page.
const groupOrder = new Map(METRIC_GROUPS.map((g, i) => [g, i]));
const metricsSorted = [...METRICS].sort((a, b) => {
  const ga = groupOrder.get(a.group) ?? 999, gb = groupOrder.get(b.group) ?? 999;
  if (ga !== gb) return ga - gb;
  return METRICS.indexOf(a) - METRICS.indexOf(b);
});
const metricFields = metricsSorted.map(m => m.field);
const idCols = ['geoid', 'place_name', 'state_name', 'state_fips', 'slug', 'state_slug', 'pop_tier'];
const HEADERS = [...idCols, ...metricFields, 'hsi_score', 'hsi_rank', 'lat', 'lng'];

const rows = [];
let skipped = 0;
for (const file of files) {
  const c = JSON.parse(await readFile(join(PLACES, file), 'utf8'));
  if (!c.geoid) { skipped++; continue; }

  const hudAmi = c.hud_ami || {};
  c.hud_ami_4p_100 = hudAmi.ami_100_4p ?? null;
  c.hud_ami_4p_80  = hudAmi.ami_80_4p  ?? null;
  c.hud_ami_4p_120 = hudAmi.ami_120_4p ?? null;

  const row = [
    c.geoid,
    c.place_name || c.name,
    c.state_name,
    c.state_fips || String(c.geoid).slice(0, 2),
    c.slug,
    c.state_slug,
    tierForPop(c.population_total),
  ];
  for (const f of metricFields) {
    const v = c[f];
    row.push((v == null || !Number.isFinite(v)) ? null : Math.round(v * 10000) / 10000);
  }
  const h = hsi.places[c.geoid];
  row.push(h ? h.score : null, h ? h.rank : null);
  row.push(Number.isFinite(c.lat) ? c.lat : null, Number.isFinite(c.lng) ? c.lng : null);
  rows.push(row);
}

console.log(`Built ${rows.length} rows (skipped ${skipped}).`);

rows.sort((a, b) => {
  const sa = a[2] || '', sb = b[2] || '';
  if (sa !== sb) return sa.localeCompare(sb);
  return (a[1] || '').localeCompare(b[1] || '');
});

const payload = {
  generated_at: new Date().toISOString(),
  universe: 'cities',
  city_count: rows.length,
  metric_count: metricFields.length + HSI_METRICS.length,
  headers: HEADERS,
  id_columns: idCols,
  metrics: [...metricsSorted, ...HSI_METRICS],
  pop_tiers: POP_TIERS,
  rows,
};

const replacer = (_k, v) => (v === Infinity ? 1e15 : v);
const json = JSON.stringify(payload, replacer);

if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true });
await writeFile(OUT_FILE, json);
await writeFile(PUBLIC_OUT, json);
console.log(`✓ Wrote ${rows.length} city rows × ${metricFields.length + HSI_METRICS.length} metrics — ${(json.length/1024).toFixed(0)} KB`);
