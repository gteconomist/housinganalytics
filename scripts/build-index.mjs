#!/usr/bin/env node
/**
 * build-index.mjs
 *
 * Computes the Housing Stress Index (HSI) — a cross-sectional composite that
 * scores every U.S. county on housing affordability stress, 0–100.
 *
 * METHODOLOGY (all component weights live in WEIGHTS below — retune there):
 *   1. Take five per-county affordability metrics, each oriented so that a
 *      HIGHER value means MORE stress.
 *   2. Standardize each metric to a national z-score (mean 0, sd 1 across all
 *      counties with a valid value). A county missing a metric contributes a
 *      neutral z = 0 for that metric (its weight is NOT redistributed).
 *   3. composite = Σ weight_i · z_i.
 *   4. hsi_score = national percentile of the composite, 0–100 (integer).
 *      Percentile (not min–max) so a handful of extreme counties can't
 *      compress everyone else into a narrow band.
 *   5. hsi_rank = dense national rank, 1 = most stressed.
 *
 * DELIBERATE EXCLUSIONS (documented in the output `method` block):
 *   • vacancy_rate — directionally ambiguous (high vacancy can mean distress
 *     AND abandonment OR slack, cheaper supply; low vacancy means a tight,
 *     stressed market). Including it muddies interpretation.
 *   • owner-occupancy / tenure trend — requires multi-vintage trend data that
 *     this cross-sectional build does not carry. Flagged for a trend-aware v2.
 *
 * Run order: AFTER build-rankings.mjs. Reads the canonical rankings.json,
 * writes hsi.json (canonical + public mirror), and injects hsi_score +
 * hsi_rank columns (and their metric descriptors) into both rankings.json
 * files. Re-runnable: existing HSI columns/descriptors are stripped first.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

const RANK_CANON  = join(ROOT, 'src', 'data', 'generated', 'rankings.json');
const RANK_PUBLIC = join(ROOT, 'public', 'data', 'rankings.json');
const HSI_CANON   = join(ROOT, 'src', 'data', 'generated', 'hsi.json');
const HSI_PUBLIC  = join(ROOT, 'public', 'data', 'hsi.json');

// ── Tunable methodology ─────────────────────────────────────────────
// Each entry: field in rankings.json, weight, and human label. All five are
// oriented higher = more stress, so no sign flips are needed. Weights should
// sum to 1.0 (a warning prints if they don't; the composite is unaffected by
// the absolute scale because it is percentile-ranked afterward).
const WEIGHTS = [
  { field: 'renter_cost_burden_rate',        weight: 0.28, label: 'Renter cost burden (30%+ of income)' },
  { field: 'renter_severe_cost_burden_rate', weight: 0.14, label: 'Renter severe cost burden (50%+)' },
  { field: 'owner_cost_burden_rate',         weight: 0.14, label: 'Owner cost burden (30%+ of income)' },
  { field: 'rent_to_income_ratio',           weight: 0.22, label: 'Rent-to-income ratio' },
  { field: 'price_to_income_ratio',          weight: 0.22, label: 'Price-to-income ratio' },
];
const STANDARDIZATION = 'national-zscore';
const SCALE           = 'percentile-0-100';
// Robustness: winsorize each component z-score to +/- Z_CLIP so a single
// degenerate small-sample value (e.g. a 350-person county reading 100% renter
// cost burden) cannot rocket a micro-county to the top of the ranking.
const Z_CLIP          = 3;
// Transparency flag only (does NOT change scores/ranks): a county is marked
// low_confidence when it has fewer than MIN_COMPONENTS valid components or a
// population below LOW_CONF_POP. Surfaced so the UI can caveat thin samples.
const MIN_COMPONENTS  = 3;
const LOW_CONF_POP    = 1000;

const HSI_METRICS = [
  { field: 'hsi_score', label: 'Housing Stress Index (0–100)', group: 'Housing Stress Index', format: 'count',
    source: 'Composite — see hsi.json method block' },
  { field: 'hsi_rank',  label: 'Housing Stress Index — national rank', group: 'Housing Stress Index', format: 'count',
    source: 'Composite — 1 = most stressed' },
];
const HSI_FIELDS = HSI_METRICS.map(m => m.field);

function num(v) { return (v === null || v === undefined || !Number.isFinite(v)) ? null : v; }

function meanStd(values) {
  const v = values.filter(x => x !== null);
  const n = v.length;
  if (n === 0) return { mean: 0, std: 0, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / n; // population sd
  return { mean, std: Math.sqrt(variance), n };
}

async function main() {
  console.log(`Reading ${RANK_CANON}...`);
  const data = JSON.parse(await readFile(RANK_CANON, 'utf8'));

  // Strip any prior HSI injection so this script is idempotent.
  const priorIdx = data.headers.filter(h => HSI_FIELDS.includes(h)).map(h => data.headers.indexOf(h));
  if (priorIdx.length) {
    const keep = data.headers.map((h, i) => !HSI_FIELDS.includes(h) ? i : -1).filter(i => i >= 0);
    data.headers = keep.map(i => data.headers[i]);
    data.rows    = data.rows.map(r => keep.map(i => r[i]));
    data.metrics = data.metrics.filter(m => !HSI_FIELDS.includes(m.field));
  }

  const COL = {};
  data.headers.forEach((h, i) => (COL[h] = i));
  const geoidCol = COL.geoid;

  for (const w of WEIGHTS) {
    if (!(w.field in COL)) {
      throw new Error(`Component field "${w.field}" not found in rankings.json headers. Aborting.`);
    }
  }
  const wsum = WEIGHTS.reduce((a, b) => a + b.weight, 0);
  if (Math.abs(wsum - 1) > 1e-9) {
    console.warn(`WARNING: component weights sum to ${wsum.toFixed(4)}, not 1.0 (composite is percentile-ranked, so this only affects interpretation of raw contributions).`);
  }

  const rows = data.rows;
  const N = rows.length;

  // Per-component national mean/std.
  const stats = {};
  const coverage = {};
  for (const w of WEIGHTS) {
    const col = COL[w.field];
    const vals = rows.map(r => num(r[col]));
    stats[w.field] = meanStd(vals);
    coverage[w.field] = stats[w.field].n;
  }

  // Composite per county.
  const records = rows.map(r => {
    const geoid = r[geoidCol];
    let composite = 0;
    let present = 0;
    const pop = num(r[COL.population_total]);
    const z = {};
    const contrib = {};
    for (const w of WEIGHTS) {
      const raw = num(r[COL[w.field]]);
      const { mean, std } = stats[w.field];
      let zi = (raw === null || std === 0) ? 0 : (raw - mean) / std;
      if (zi >  Z_CLIP) zi =  Z_CLIP;      // winsorize high tail
      if (zi < -Z_CLIP) zi = -Z_CLIP;      // winsorize low tail
      if (raw !== null) present += 1;
      z[w.field] = Number(zi.toFixed(4));
      const c = w.weight * zi;
      contrib[w.field] = Number(c.toFixed(4));
      composite += c;
    }
    const low_confidence = (present < MIN_COMPONENTS) || (pop !== null && pop < LOW_CONF_POP);
    return { geoid, composite, present, pop, low_confidence, z, contrib };
  });

  // Percentile 0–100 over composite (ascending: most stressed = 100).
  const asc = [...records].sort((a, b) => a.composite - b.composite);
  asc.forEach((rec, i) => {
    rec.score = N > 1 ? Math.round((i / (N - 1)) * 100) : 50;
  });
  // Dense national rank, 1 = most stressed. Deterministic tie-break by geoid.
  const desc = [...records].sort((a, b) => (b.composite - a.composite) || String(a.geoid).localeCompare(String(b.geoid)));
  desc.forEach((rec, i) => { rec.rank = i + 1; });

  const byGeoid = new Map(records.map(r => [r.geoid, r]));

  // ── Inject columns + descriptors into rankings.json ───────────────
  data.headers.push(...HSI_FIELDS);
  data.rows = rows.map(r => {
    const rec = byGeoid.get(r[geoidCol]);
    return [...r, rec ? rec.score : null, rec ? rec.rank : null];
  });
  data.metrics.push(...HSI_METRICS);
  data.metric_count = data.metrics.length;
  data.generated_at = new Date().toISOString();

  await writeFile(RANK_CANON, JSON.stringify(data));
  await writeFile(RANK_PUBLIC, JSON.stringify(data));
  console.log(`Injected ${HSI_FIELDS.join(', ')} into rankings.json (canonical + public).`);

  // ── Emit hsi.json ─────────────────────────────────────────────────
  const counties = {};
  for (const rec of records) {
    counties[rec.geoid] = {
      score: rec.score,
      rank: rec.rank,
      composite: Number(rec.composite.toFixed(4)),
      components_present: rec.present,
      low_confidence: rec.low_confidence,
      z: rec.z,
      contrib: rec.contrib,
    };
  }
  const hsi = {
    generated_at: new Date().toISOString(),
    county_count: N,
    method: {
      name: 'Housing Stress Index',
      description: 'Cross-sectional composite of five affordability metrics, national z-scored, weighted, and expressed as a 0–100 national percentile (100 = most stressed).',
      standardization: STANDARDIZATION,
      scale: SCALE,
      components: WEIGHTS.map(w => ({ field: w.field, label: w.label, weight: w.weight,
        national_mean: Number(stats[w.field].mean.toFixed(4)),
        national_sd: Number(stats[w.field].std.toFixed(4)),
        coverage: coverage[w.field] })),
      weight_sum: Number(wsum.toFixed(4)),
      robustness: { z_clip: Z_CLIP, min_components: MIN_COMPONENTS, low_conf_pop: LOW_CONF_POP,
        note: 'Component z-scores winsorized to +/- z_clip. Counties with < min_components valid inputs or population < low_conf_pop are flagged low_confidence (flag only; scores/ranks unaffected).' },
      excluded: [
        { field: 'vacancy_rate', reason: 'Directionally ambiguous — high vacancy can signal distress/abandonment or slack, cheaper supply; low vacancy signals a tight, stressed market.' },
        { field: 'owner_occupancy_trend', reason: 'Requires multi-vintage trend data not present in this cross-sectional build. Flagged for a trend-aware v2.' },
      ],
      caveats: [
        'Small counties carry larger ACS sampling error; z-scores there are noisier.',
        'Renter cost burden (30%+) and renter severe cost burden (50%+) overlap; severe is weighted separately to emphasize acute stress. Collapse by folding its weight into the base term if a non-overlapping specification is preferred.',
      ],
    },
    counties,
  };
  await writeFile(HSI_CANON, JSON.stringify(hsi));
  await writeFile(HSI_PUBLIC, JSON.stringify(hsi));
  console.log(`Wrote hsi.json for ${N} counties (canonical + public).`);
}

main().catch(e => { console.error(e); process.exit(1); });
