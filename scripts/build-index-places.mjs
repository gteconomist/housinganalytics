#!/usr/bin/env node
/**
 * build-index-places.mjs
 *
 * City/place edition of the Housing Stress Index. Identical methodology to
 * scripts/build-index.mjs, but the reference distribution is the ~4,800
 * ACS places (cities), NOT counties — a city scoring 100 is the most-stressed
 * *city*, not most-stressed vs. counties. The two indices are separate scales.
 *
 * Notes vs. the county build:
 *   • Reads the per-place generated JSON directly (there is no aggregated
 *     places rankings.json — city rankings are a separate roadmap item).
 *   • The places universe has no sub-5,000-population entries, so the
 *     small-sample distortion that forced winsorizing on counties barely
 *     applies here; the ±3 clip is retained for consistency. The
 *     low_confidence flag keys on component coverage only (no pop floor).
 *   • Writes hsi-places.json (canonical + public mirror), keyed by geoid.
 *     Does NOT touch any rankings.json.
 *
 * Run order: AFTER build-data.mjs (which writes src/data/generated/places/).
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

const PLACES_DIR   = join(ROOT, 'src', 'data', 'generated', 'places');
const OUT_CANON    = join(ROOT, 'src', 'data', 'generated', 'hsi-places.json');
const OUT_PUBLIC   = join(ROOT, 'public', 'data', 'hsi-places.json');

// Same five components and weights as the county index (retune here if a
// city-specific weighting is preferred — e.g. leaning harder on rent-to-income).
const WEIGHTS = [
  { field: 'renter_cost_burden_rate',        weight: 0.28, label: 'Renter cost burden (30%+ of income)' },
  { field: 'renter_severe_cost_burden_rate', weight: 0.14, label: 'Renter severe cost burden (50%+)' },
  { field: 'owner_cost_burden_rate',         weight: 0.14, label: 'Owner cost burden (30%+ of income)' },
  { field: 'rent_to_income_ratio',           weight: 0.22, label: 'Rent-to-income ratio' },
  { field: 'price_to_income_ratio',          weight: 0.22, label: 'Price-to-income ratio' },
];
const STANDARDIZATION = 'national-zscore (cities universe)';
const SCALE           = 'percentile-0-100';
const Z_CLIP          = 3;
const MIN_COMPONENTS  = 3;   // low_confidence flag if fewer valid components

function num(v) { return (v === null || v === undefined || !Number.isFinite(v)) ? null : v; }

function meanStd(values) {
  const v = values.filter(x => x !== null);
  const n = v.length;
  if (n === 0) return { mean: 0, std: 0, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

async function main() {
  console.log(`Reading per-place JSON from ${PLACES_DIR}...`);
  const files = (await readdir(PLACES_DIR)).filter(f => f.endsWith('.json'));
  const places = [];
  for (const f of files) {
    const o = JSON.parse(await readFile(join(PLACES_DIR, f), 'utf8'));
    if (o && o.geoid) places.push(o);
  }
  const N = places.length;
  console.log(`Loaded ${N} places.`);

  const wsum = WEIGHTS.reduce((a, b) => a + b.weight, 0);
  if (Math.abs(wsum - 1) > 1e-9) console.warn(`WARNING: weights sum to ${wsum.toFixed(4)}, not 1.0.`);

  // Per-component mean/std across the cities universe.
  const stats = {}, coverage = {};
  for (const w of WEIGHTS) {
    const vals = places.map(p => num(p[w.field]));
    stats[w.field] = meanStd(vals);
    coverage[w.field] = stats[w.field].n;
  }

  const records = places.map(p => {
    let composite = 0, present = 0;
    const z = {}, contrib = {};
    for (const w of WEIGHTS) {
      const raw = num(p[w.field]);
      const { mean, std } = stats[w.field];
      let zi = (raw === null || std === 0) ? 0 : (raw - mean) / std;
      if (zi >  Z_CLIP) zi =  Z_CLIP;
      if (zi < -Z_CLIP) zi = -Z_CLIP;
      if (raw !== null) present += 1;
      z[w.field] = Number(zi.toFixed(4));
      const c = w.weight * zi;
      contrib[w.field] = Number(c.toFixed(4));
      composite += c;
    }
    return {
      geoid: p.geoid,
      name: p.place_name || p.name,
      state_name: p.state_name,
      pop: num(p.population_total),
      composite, present,
      low_confidence: present < MIN_COMPONENTS,
      z, contrib,
    };
  });

  // Percentile 0–100 (most stressed = 100) + dense rank (1 = most stressed).
  const asc = [...records].sort((a, b) => a.composite - b.composite);
  asc.forEach((r, i) => { r.score = N > 1 ? Math.round((i / (N - 1)) * 100) : 50; });
  const desc = [...records].sort((a, b) => (b.composite - a.composite) || String(a.geoid).localeCompare(String(b.geoid)));
  desc.forEach((r, i) => { r.rank = i + 1; });

  const out = {
    generated_at: new Date().toISOString(),
    universe: 'cities',
    city_count: N,
    method: {
      name: 'Housing Stress Index (cities)',
      description: 'Cross-sectional composite of five affordability metrics, z-scored across the ~4,800 ACS places (cities), winsorized to ±3, weighted, and expressed as a 0–100 percentile within the cities universe (100 = most stressed city). Not comparable to the county index — different reference distribution.',
      standardization: STANDARDIZATION,
      scale: SCALE,
      components: WEIGHTS.map(w => ({ field: w.field, label: w.label, weight: w.weight,
        universe_mean: Number(stats[w.field].mean.toFixed(4)),
        universe_sd: Number(stats[w.field].std.toFixed(4)),
        coverage: coverage[w.field] })),
      weight_sum: Number(wsum.toFixed(4)),
      robustness: { z_clip: Z_CLIP, min_components: MIN_COMPONENTS,
        note: 'Places universe has no sub-5,000-population entries, so small-sample distortion is minimal; ±3 clip retained for consistency. low_confidence flags coverage < min_components only.' },
      excluded: [
        { field: 'vacancy_rate', reason: 'Directionally ambiguous.' },
        { field: 'owner_occupancy_trend', reason: 'Requires multi-vintage data not in this cross-section.' },
      ],
    },
    places: {},
  };
  for (const r of records) {
    out.places[r.geoid] = {
      score: r.score, rank: r.rank,
      composite: Number(r.composite.toFixed(4)),
      components_present: r.present,
      low_confidence: r.low_confidence,
      z: r.z, contrib: r.contrib,
    };
  }

  await writeFile(OUT_CANON, JSON.stringify(out));
  await writeFile(OUT_PUBLIC, JSON.stringify(out));
  console.log(`Wrote hsi-places.json for ${N} cities (canonical + public).`);

  // Quick face-validity print.
  const byRank = [...records].sort((a, b) => a.rank - b.rank);
  console.log('\nMost stressed cities:');
  byRank.slice(0, 8).forEach(r => console.log(`  #${r.rank} score ${r.score}  ${r.name}, ${r.state_name}  (pop ${r.pop})`));
  console.log('Least stressed cities:');
  byRank.slice(-5).forEach(r => console.log(`  #${r.rank} score ${r.score}  ${r.name}, ${r.state_name}  (pop ${r.pop})`));
}

main().catch(e => { console.error(e); process.exit(1); });
