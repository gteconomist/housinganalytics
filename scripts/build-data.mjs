#!/usr/bin/env node
/**
 * build-data.mjs
 *
 * Reads `Full Housing Data Table.xlsx`, normalizes every county row,
 * computes derived metrics + state/national aggregates, and writes:
 *
 *   src/data/generated/manifest.json          — index of all counties
 *   src/data/generated/counties/{geoid}.json  — one file per county
 *   src/data/generated/national.json          — national aggregate
 *   src/data/generated/states/{state}.json    — one file per state
 *
 * This script is the only place that knows about Excel layout. Once the
 * spreadsheet is converted, all downstream pages consume JSON only.
 *
 * Spreadsheet layout (per user spec):
 *   Row 11 = plain-language variable labels
 *   Row 12 = ACS variable codes (e.g. B25024_002E)
 *   Row 13+ = data, one row per county
 *   Col B  = county "Area Name"        e.g. "Autauga County, Alabama"
 *   Col C  = "FIPS" / GeoID            e.g. "01001"
 */

import * as XLSX from 'xlsx';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACS_TO_FIELD, MHC_COMPONENTS } from '../src/data/variable-map.js';

// Optional places data (sub-county geographies — cities, towns, CDPs).
// Written by fetch-acs-places.mjs. Loaded BEFORE the wipe so the raw API
// payload survives, then processed alongside counties below.
async function loadPlaces() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'places.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return { places: {}, place_count: 0 };
  }
}

// Optional Gazetteer places data (land area for population density on
// place profile pages).
async function loadGazetteerPlaces() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'gazetteer-places.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return {};
  }
}

// Optional HUD AMI data, written by fetch-hud-ami.mjs. If the file is missing
// or empty, county pages just won't show the HUD panels.
async function loadHudAmi() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'hud-ami.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return {};
  }
}

// Optional Gazetteer data (land area for population density).
async function loadGazetteer() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'gazetteer.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return {};
  }
}

// Optional QCEW data (industry employment + wages). Written by fetch-qcew.mjs.
// Returns the parsed object; build-data attaches `industries` to each county.
async function loadQcew() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'qcew.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return { counties: {} };
  }
}

// Optional OEWS data (per-occupation wages + 10-year jobs change). Written
// by fetch-oews.mjs. Geography is MSA / nonmetropolitan area — every county
// inside a given OEWS area receives the same rows.
async function loadOews() {
  const f = join(__dirname, '..', 'src', 'data', 'generated', 'oews.json');
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return { counties: {} };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT        = join(__dirname, '..');
const SOURCE_XLSX = join(ROOT, 'Full Housing Data Table.xlsx');
const OUT_DIR     = join(ROOT, 'src', 'data', 'generated');
// Mirror copy in public/data/ so the Compare page can fetch counties by FIPS
// at runtime (without Astro module bundling).
const PUBLIC_DIR  = join(ROOT, 'public', 'data');

// ─────────────────────────────────────────────────────────────────
// Read the spreadsheet (cell array of arrays)
// ─────────────────────────────────────────────────────────────────
console.log(`Reading ${SOURCE_XLSX}...`);
const buf = await readFile(SOURCE_XLSX);
const wb  = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
// `blankrows: true` keeps any empty rows so indices match the Excel row numbers.
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true });

// Locate the header row dynamically by looking for the row containing both
// 'NAME' and 'Geo_geoid_' (Excel row 12 in the user's spec, but search makes
// it robust to leading blank rows the parser may have collapsed).
let HEADER_IDX = -1;
for (let i = 0; i < Math.min(rows.length, 50); i++) {
  const r = rows[i];
  if (!r) continue;
  if (r.includes('NAME') && r.includes('Geo_geoid_')) {
    HEADER_IDX = i;
    break;
  }
}
if (HEADER_IDX < 0) {
  throw new Error("Could not locate header row (the row with 'NAME' and 'Geo_geoid_'). Check the spreadsheet structure.");
}
const headerRow = rows[HEADER_IDX];

const NAME_COL  = headerRow.indexOf('NAME');
const GEOID_COL = headerRow.indexOf('Geo_geoid_');

// Build column-index → field-name map.
const colToField = {};
for (let col = 0; col < headerRow.length; col++) {
  const acs = headerRow[col];
  if (acs == null) continue;
  const field = ACS_TO_FIELD[String(acs).trim()];
  if (field) colToField[col] = field;
}

// Pre-compute column indices for derived MHC buckets.
const mhcComponentCols = {};
for (const [outField, codes] of Object.entries(MHC_COMPONENTS)) {
  mhcComponentCols[outField] = codes
    .map(code => headerRow.indexOf(code))
    .filter(i => i >= 0);
}

console.log(`Spreadsheet has ${rows.length} rows, ${headerRow.length} columns.`);
console.log(`Header row found at index ${HEADER_IDX} (Excel row ${HEADER_IDX + 1}).`);
console.log(`Mapped ${Object.keys(colToField).length} ACS-code columns to field names.`);

// Data starts on the row AFTER the header row.
const DATA_START = HEADER_IDX + 1;

// ─────────────────────────────────────────────────────────────────
// Parse each county row
// ─────────────────────────────────────────────────────────────────
function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // ACS sentinel values (e.g. -666666666 "estimate not available"). Treat as null.
  if (n < -1_000_000) return null;
  return n;
}

function pad5(s) {
  const t = String(s ?? '').trim();
  // FIPS may come through as "1001" — re-pad to 5 chars.
  if (/^\d+$/.test(t)) return t.padStart(5, '0');
  return t;
}

const counties = [];
for (let r = DATA_START; r < rows.length; r++) {
  const row = rows[r];
  if (!row) continue;
  const name  = row[NAME_COL];
  const geoid = pad5(row[GEOID_COL]);
  if (!name || !geoid) continue;

  // Parse "Autauga County, Alabama" → { county_name: 'Autauga County', state_name: 'Alabama' }
  const [county_name, state_name] = String(name).split(',').map(s => s.trim());

  /** @type {Record<string, number|null>} */
  const data = {};
  for (const [colStr, field] of Object.entries(colToField)) {
    const col = Number(colStr);
    data[field] = num(row[col]);
  }
  // Derived MHC buckets (sum of components).
  for (const [outField, cols] of Object.entries(mhcComponentCols)) {
    let sum = 0, hasAny = false;
    for (const c of cols) {
      const v = num(row[c]);
      if (v != null) { sum += v; hasAny = true; }
    }
    data[outField] = hasAny ? sum : null;
  }

  counties.push({
    geoid,
    name,
    county_name,
    state_name,
    state_fips: geoid.slice(0, 2),
    ...data,
  });
}
console.log(`Parsed ${counties.length} counties.`);

// ─────────────────────────────────────────────────────────────────
// Derived metrics — computed once, stored alongside raw fields
// ─────────────────────────────────────────────────────────────────
function safeDivide(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}
function pct(a, b) {
  const v = safeDivide(a, b);
  return v == null ? null : v * 100;
}

function addDerived(c) {
  // Homeownership / renter rate
  c.homeownership_rate = pct(c.tenure_owner_occupied, c.tenure_total_occupied);
  c.renter_rate        = pct(c.tenure_renter_occupied, c.tenure_total_occupied);

  // Vacancy rate
  const total_units = (c.units_occupied ?? 0) + (c.units_vacant ?? 0);
  c.vacancy_rate = pct(c.units_vacant, total_units || null);

  // Renter cost burden (B25070): 30%+ = 30-34 + 35-39 + 40-49 + 50+
  const rb_30_plus =
    (c.rent_burden_30_34 ?? 0) +
    (c.rent_burden_35_39 ?? 0) +
    (c.rent_burden_40_49 ?? 0) +
    (c.rent_burden_50_plus ?? 0);
  const rb_severe = c.rent_burden_50_plus ?? 0;
  const rb_denom =
    (c.rent_burden_total ?? 0) - (c.rent_burden_not_computed ?? 0);
  c.renter_cost_burden_rate        = pct(rb_30_plus, rb_denom || null);
  c.renter_severe_cost_burden_rate = pct(rb_severe, rb_denom || null);

  // Owner cost burden (B25106): sum of all 30%+ owner buckets / owner total
  const ob_30_plus =
    (c.cb_owner_30_plus_lt20k ?? 0) +
    (c.cb_owner_30_plus_20_35k ?? 0) +
    (c.cb_owner_30_plus_35_50k ?? 0) +
    (c.cb_owner_30_plus_50_75k ?? 0) +
    (c.cb_owner_30_plus_75k_plus ?? 0);
  const ob_denom = c.cb_owner_total ?? null;
  c.owner_cost_burden_rate = pct(ob_30_plus, ob_denom);

  // Price-to-income ratio (median home value / median HH income)
  c.price_to_income_ratio = safeDivide(c.value_median, c.hh_income_median);

  // Rent-to-income ratio (annualized median rent / median HH income)
  c.rent_to_income_ratio =
    c.rent_median != null && c.hh_income_median
      ? (c.rent_median * 12) / c.hh_income_median
      : null;

  // Aging stock share: built before 1980
  const total_year_built =
    (c.year_built_2020_plus ?? 0) +
    (c.year_built_2010_19 ?? 0) +
    (c.year_built_2000_09 ?? 0) +
    (c.year_built_1980_99 ?? 0) +
    (c.year_built_1960_79 ?? 0) +
    (c.year_built_1940_59 ?? 0) +
    (c.year_built_1939_earlier ?? 0);
  const pre_1980 =
    (c.year_built_1960_79 ?? 0) +
    (c.year_built_1940_59 ?? 0) +
    (c.year_built_1939_earlier ?? 0);
  c.aging_stock_share = pct(pre_1980, total_year_built || null);

  // Single-family share
  const sf = (c.structure_1_detached ?? 0) + (c.structure_1_attached ?? 0);
  c.single_family_share = pct(sf, c.units_total);

  // Missing middle (2 to 19 units)
  const mm =
    (c.structure_2 ?? 0) +
    (c.structure_3_4 ?? 0) +
    (c.structure_5_9 ?? 0) +
    (c.structure_10_19 ?? 0);
  c.missing_middle_share = pct(mm, c.units_total);

  // Educational attainment (bachelors+)
  const edu_total =
    (c.edu_lt_9th ?? 0) +
    (c.edu_9_12_no_diploma ?? 0) +
    (c.edu_hs_grad ?? 0) +
    (c.edu_some_college ?? 0) +
    (c.edu_associates ?? 0) +
    (c.edu_bachelors ?? 0) +
    (c.edu_graduate ?? 0);
  c.bachelors_plus_rate = pct((c.edu_bachelors ?? 0) + (c.edu_graduate ?? 0), edu_total || null);

  // ── Vacancy analytics (B25004 + tenure) ─────────────────────────
  // Census formula for the official vacancy rates (HVR / RVR):
  //   HVR = vacant_for_sale / (owner_occupied + vacant_for_sale)
  //   RVR = vacant_for_rent / (renter_occupied + vacant_for_rent + rented_not_occ)
  // These OVERRIDE whatever DP04_0004E / DP04_0005E held in the spreadsheet
  // (those columns were accidentally loaded with owner/renter unit counts).
  const v_total      = c.vacant_total           ?? 0;
  const v_for_rent   = c.vacant_for_rent        ?? 0;
  const v_rented_no  = c.vacant_rented_not_occ  ?? 0;
  const v_for_sale   = c.vacant_for_sale        ?? 0;
  const v_sold_no    = c.vacant_sold_not_occ    ?? 0;
  const v_seasonal   = c.vacant_seasonal        ?? 0;
  const v_migrant    = c.vacant_migrant         ?? 0;
  const v_other      = c.vacant_other           ?? 0;
  const owner_occ    = c.tenure_owner_occupied  ?? 0;
  const renter_occ   = c.tenure_renter_occupied ?? 0;

  c.homeowner_vacancy_rate = (owner_occ + v_for_sale) > 0
    ? (v_for_sale / (owner_occ + v_for_sale)) * 100
    : null;
  c.rental_vacancy_rate = (renter_occ + v_for_rent + v_rented_no) > 0
    ? (v_for_rent / (renter_occ + v_for_rent + v_rented_no)) * 100
    : null;

  // Frictional = normal market churn (homes actively for-rent / for-sale or
  // already rented/sold but not yet occupied). Structural = units that are
  // not really on the market for primary residents (seasonal, migrant, other).
  c.vacant_frictional = v_for_rent + v_rented_no + v_for_sale + v_sold_no;
  c.vacant_structural = v_seasonal + v_migrant + v_other;
  c.frictional_share  = v_total > 0 ? (c.vacant_frictional / v_total) * 100 : null;
  c.structural_share  = v_total > 0 ? (c.vacant_structural / v_total) * 100 : null;

  // Per-bucket shares of total vacant (for the composition donut).
  if (v_total > 0) {
    c.vacant_for_rent_share      = (v_for_rent  / v_total) * 100;
    c.vacant_rented_not_occ_share = (v_rented_no / v_total) * 100;
    c.vacant_for_sale_share      = (v_for_sale  / v_total) * 100;
    c.vacant_sold_not_occ_share  = (v_sold_no   / v_total) * 100;
    c.vacant_seasonal_share      = (v_seasonal  / v_total) * 100;
    c.vacant_migrant_share       = (v_migrant   / v_total) * 100;
    c.vacant_other_share         = (v_other     / v_total) * 100;
  } else {
    c.vacant_for_rent_share = c.vacant_rented_not_occ_share = c.vacant_for_sale_share =
    c.vacant_sold_not_occ_share = c.vacant_seasonal_share = c.vacant_migrant_share =
    c.vacant_other_share = null;
  }

  // Shares of TOTAL housing stock — these are the "should I worry?" metrics
  // analysts actually flag in housing studies. Above ~10% seasonal = real
  // pressure on year-round residents; above ~5% other-vacant = disinvestment.
  c.seasonal_stock_share = c.units_total > 0 ? (v_seasonal / c.units_total) * 100 : null;
  c.distress_stock_share = c.units_total > 0 ? (v_other    / c.units_total) * 100 : null;

  return c;
}
counties.forEach(addDerived);

// ─────────────────────────────────────────────────────────────────
// Aggregates: national & per-state
// ─────────────────────────────────────────────────────────────────
// For most fields, we sum across counties. Medians require weighting; for v1
// we approximate by computing population-weighted means of the medians and
// flag this clearly. Future versions can replace these with ACS-provided
// state/national totals where available.
const SUM_FIELDS = new Set([
  'population_total', 'units_occupied', 'units_vacant', 'units_total',
  // Vacancy buckets (B25004) — sum at state / national; addDerived() will
  // recompute HVR, RVR, and the share fields from the sums.
  'vacant_total', 'vacant_for_rent', 'vacant_rented_not_occ', 'vacant_for_sale',
  'vacant_sold_not_occ', 'vacant_seasonal', 'vacant_migrant', 'vacant_other',
  'structure_1_detached', 'structure_1_attached', 'structure_2', 'structure_3_4',
  'structure_5_9', 'structure_10_19', 'structure_20_49', 'structure_50_plus',
  'structure_mobile', 'structure_other',
  'tenure_total_occupied', 'tenure_owner_occupied', 'tenure_renter_occupied',
  'year_built_2020_plus', 'year_built_2010_19', 'year_built_2000_09', 'year_built_1980_99',
  'year_built_1960_79', 'year_built_1940_59', 'year_built_1939_earlier',
  'earners_0', 'earners_1', 'earners_2', 'earners_3_plus', 'earners_nonfamily',
  'hh_size_1', 'hh_size_2', 'hh_size_3', 'hh_size_4_plus',
  'hh_total_s2501', 'hh_total_s1101', 'hh_total_s1903', 'hh_with_children',
  'br_0', 'br_1', 'br_2', 'br_3', 'br_4', 'br_5_plus',
  'rent_burden_total', 'rent_burden_lt_10', 'rent_burden_10_14', 'rent_burden_15_19',
  'rent_burden_20_24', 'rent_burden_25_29', 'rent_burden_30_34', 'rent_burden_35_39',
  'rent_burden_40_49', 'rent_burden_50_plus', 'rent_burden_not_computed',
  'cb_owner_total', 'cb_owner_30_plus_lt20k', 'cb_owner_30_plus_20_35k',
  'cb_owner_30_plus_35_50k', 'cb_owner_30_plus_50_75k', 'cb_owner_30_plus_75k_plus',
  'cb_owner_zero_negative', 'cb_renter_total', 'cb_renter_no_cash',
  'edu_lt_9th', 'edu_9_12_no_diploma', 'edu_hs_grad', 'edu_some_college',
  'edu_associates', 'edu_bachelors', 'edu_graduate',
  'value_lt_50k', 'value_50_99k', 'value_100_150k', 'value_150_200k',
  'value_200_300k', 'value_300_500k', 'value_500_1m', 'value_1m_plus',
  'oi_lt_5k', 'oi_5_10k', 'oi_10_15k', 'oi_15_20k', 'oi_20_25k', 'oi_25_35k',
  'oi_35_50k', 'oi_50_75k', 'oi_75_100k', 'oi_100_150k', 'oi_150k_plus',
  'ri_lt_5k', 'ri_5_10k', 'ri_10_15k', 'ri_15_20k', 'ri_20_25k', 'ri_25_35k',
  'ri_35_50k', 'ri_50_75k', 'ri_75_100k', 'ri_100_150k', 'ri_150k_plus',
  'renter_age_under35', 'renter_age_35_44', 'renter_age_45_54', 'renter_age_55_64',
  'renter_age_65_74', 'renter_age_75_84', 'renter_age_85_plus',
  'owner_age_under35', 'owner_age_35_44', 'owner_age_45_54', 'owner_age_55_64',
  'owner_age_65_74', 'owner_age_75_84', 'owner_age_85_plus',
  'mhc_lt_500', 'mhc_500_999', 'mhc_1000_1499', 'mhc_1500_1999', 'mhc_2000_2499',
  'mhc_2500_2999', 'mhc_3000_plus', 'mhc_no_cash_rent',
  'mortgage_total',
  'race_white', 'race_black', 'race_aian', 'race_asian', 'race_nhpi',
  'race_other', 'race_two_plus',
]);

const WEIGHTED_MEDIAN_FIELDS = [
  // field, weight-field
  ['hh_income_median',  'tenure_total_occupied'],
  ['hh_income_mean',    'tenure_total_occupied'],
  ['value_median',      'tenure_owner_occupied'],
  ['rent_median',       'tenure_renter_occupied'],
  ['rent_median_0br',   'br_0'],
  ['rent_median_1br',   'br_1'],
  ['rent_median_2br',   'br_2'],
  ['rent_median_3br',   'br_3'],
  ['rent_median_4br',   'br_4'],
  ['rent_median_5br',   'br_5_plus'],
  ['mortgage_median',   'mortgage_total'],
  ['structure_median_age', 'units_total'],
  ['median_age',        'population_total'],
  ['per_capita_income', 'population_total'],
  ['hh_avg_size',       'tenure_total_occupied'],
  ['poverty_rate',      'population_total'],
];

function aggregate(group, name) {
  const out = { name, type: group[0]?.state_name === undefined ? 'national' : 'state' };
  // Sums
  for (const f of SUM_FIELDS) {
    let s = 0, any = false;
    for (const c of group) {
      const v = c[f];
      if (v != null) { s += v; any = true; }
    }
    out[f] = any ? s : null;
  }
  // Weighted medians (population-weighted approximation)
  for (const [field, weight] of WEIGHTED_MEDIAN_FIELDS) {
    let num = 0, denom = 0;
    for (const c of group) {
      const v = c[field], w = c[weight];
      if (v != null && w != null && w > 0) {
        num   += v * w;
        denom += w;
      }
    }
    out[field] = denom > 0 ? num / denom : null;
  }
  // Re-run derived
  addDerived(out);
  out.county_count = group.length;
  return out;
}

const nationalAgg = aggregate(counties, 'United States');
nationalAgg.type = 'national';

const byState = new Map();
for (const c of counties) {
  if (!byState.has(c.state_name)) byState.set(c.state_name, []);
  byState.get(c.state_name).push(c);
}
const stateAggs = {};
for (const [state, group] of byState) {
  const agg = aggregate(group, state);
  agg.type = 'state';
  agg.state_fips = group[0]?.state_fips ?? null;
  stateAggs[state] = agg;
}

// ─────────────────────────────────────────────────────────────────
// Slugs and routing
// ─────────────────────────────────────────────────────────────────
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
counties.forEach(c => {
  c.slug = slug(c.county_name);
  c.state_slug = slug(c.state_name);
});

// ─────────────────────────────────────────────────────────────────
// Write outputs
// ─────────────────────────────────────────────────────────────────

// Load external data BEFORE we wipe the output directory — these JSON files
// live in src/data/generated/ alongside what we're about to overwrite.
const hudAmi          = await loadHudAmi();
const gazetteer       = await loadGazetteer();
const qcew            = await loadQcew();
const oews            = await loadOews();
const placesRaw       = await loadPlaces();
const gazetteerPlaces = await loadGazetteerPlaces();
console.log(`HUD AMI loaded for ${Object.keys(hudAmi).length} counties.`);
console.log(`Gazetteer loaded for ${Object.keys(gazetteer).length} counties.`);
console.log(`QCEW loaded for ${Object.keys(qcew.counties ?? {}).length} counties ` +
            `(${qcew.vintage_label ?? 'no vintage'}).`);
console.log(`OEWS loaded for ${Object.keys(oews.counties ?? {}).length} counties ` +
            `(${oews.vintage_label ?? 'no vintage'}).`);
console.log(`Places loaded: ${Object.keys(placesRaw.places ?? {}).length} ` +
            `(${placesRaw.vintage ?? 'no vintage'}).`);
console.log(`Gazetteer places loaded for ${Object.keys(gazetteerPlaces).length} places.`);

if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await mkdir(join(OUT_DIR, 'counties'), { recursive: true });
await mkdir(join(OUT_DIR, 'states'),   { recursive: true });
await mkdir(join(OUT_DIR, 'places'),   { recursive: true });
// Public mirror (consumed by the client-side Compare page).
if (existsSync(PUBLIC_DIR)) await rm(PUBLIC_DIR, { recursive: true, force: true });
await mkdir(join(PUBLIC_DIR, 'counties'), { recursive: true });
await mkdir(join(PUBLIC_DIR, 'places'),   { recursive: true });

// Per-county files
for (const c of counties) {
  const stateAgg = stateAggs[c.state_name];
  // Embed lightweight context for the page: just the comparison values.
  c._context = {
    state: stateAgg ? lightContext(stateAgg) : null,
    national: lightContext(nationalAgg),
  };
  // Attach HUD AMI block if available for this FIPS.
  c.hud_ami = hudAmi[c.geoid] ?? null;
  // Attach land area + compute population density if Gazetteer is available.
  const gaz = gazetteer[c.geoid];
  if (gaz?.land_area_sqmi && c.population_total != null) {
    c.land_area_sqmi = gaz.land_area_sqmi;
    c.population_density = c.population_total / gaz.land_area_sqmi;
  } else {
    c.land_area_sqmi = null;
    c.population_density = null;
  }
  // Attach QCEW industry rows if available.
  const ind = qcew.counties?.[c.geoid];
  c.industries = ind ? {
    year: qcew.year ?? null,
    vintage_label: qcew.vintage_label ?? null,
    sectors:    ind.sectors    ?? [],
    subsectors: ind.subsectors ?? [],
  } : null;
  // Attach OEWS occupation rows if available.
  const occ = oews.counties?.[c.geoid];
  c.occupations = occ ? {
    year: oews.year ?? null,
    prior_year: oews.prior_year ?? null,
    vintage_label: oews.vintage_label ?? null,
    rows: occ,
  } : null;
  const json = JSON.stringify(c, null, 2);
  await writeFile(join(OUT_DIR,    'counties', `${c.geoid}.json`), json);
  await writeFile(join(PUBLIC_DIR, 'counties', `${c.geoid}.json`), json);
}

// ─────────────────────────────────────────────────────────────────
// Places (sub-county geographies — cities, towns, CDPs)
// ─────────────────────────────────────────────────────────────────
// Census place names look like "Atlanta city, Georgia" or "North Druid Hills
// CDP, Georgia". Strip the LSAD suffix for the slug only; keep the original
// name visible on the page.
const LSAD_SUFFIX_RE = / (city|town|village|borough|municipality|CDP|township|comunidad|zona urbana)$/i;

function placeSlug(placeName) {
  return slug(placeName.replace(LSAD_SUFFIX_RE, ''));
}

const places = [];
for (const [geoid, raw] of Object.entries(placesRaw.places ?? {})) {
  // Parse "Atlanta city, Georgia" → { place_name: 'Atlanta city', state_name: 'Georgia' }
  const [place_name, state_name] = String(raw.name).split(',').map(s => s.trim());
  if (!place_name || !state_name) continue;

  // Translate raw ACS codes → field names (same registry counties use).
  /** @type {Record<string, number|null>} */
  const data = {};
  for (const [code, fieldName] of Object.entries(ACS_TO_FIELD)) {
    if (code in (raw.vars ?? {})) data[fieldName] = raw.vars[code];
  }
  // Derived MHC buckets — sum of raw component codes the API returned.
  for (const [outField, codes] of Object.entries(MHC_COMPONENTS)) {
    let sum = 0, hasAny = false;
    for (const code of codes) {
      const v = raw.vars?.[code];
      if (v != null) { sum += v; hasAny = true; }
    }
    data[outField] = hasAny ? sum : null;
  }

  const place = {
    geoid,                             // 7-digit (state + place FIPS)
    name: raw.name,
    place_name,
    state_name,
    state_fips: raw.state_fips,
    parent_county_fips: raw.parent_county_fips ?? null,
    acs_year: raw.acs_year ?? null,
    geography_kind: 'place',
    ...data,
  };
  addDerived(place);
  place.slug = placeSlug(place_name);
  place.state_slug = slug(state_name);
  places.push(place);
}

// Detect intra-state slug collisions and disambiguate with the 5-digit place
// FIPS suffix. Rare (<1% of places) but cheap insurance.
{
  const byKey = new Map();
  for (const p of places) {
    const key = `${p.state_slug}/${p.slug}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  for (const [, group] of byKey) {
    if (group.length > 1) {
      for (const p of group) p.slug = `${p.slug}-${p.geoid.slice(2)}`;
    }
  }
}

// Per-place files. Inherit HUD AMI from parent county (HUD publishes income
// limits at county level; places within a county share the same MFI). Hide
// Sections 4 & 5 entirely on place pages — QCEW industries and OEWS wages
// aren't published at place geography and inheriting them would mislead.
let placesWithHud = 0, placesWithGaz = 0;
for (const p of places) {
  const stateAgg = stateAggs[p.state_name];
  p._context = {
    state: stateAgg ? lightContext(stateAgg) : null,
    national: lightContext(nationalAgg),
  };
  p.hud_ami = p.parent_county_fips ? (hudAmi[p.parent_county_fips] ?? null) : null;
  if (p.hud_ami) placesWithHud++;
  const gaz = gazetteerPlaces[p.geoid];
  if (gaz?.land_area_sqmi && p.population_total != null) {
    p.land_area_sqmi = gaz.land_area_sqmi;
    p.population_density = p.population_total / gaz.land_area_sqmi;
    placesWithGaz++;
  } else {
    p.land_area_sqmi = null;
    p.population_density = null;
  }
  // Sections 4 & 5 explicitly null — the place template should not render them.
  p.industries = null;
  p.occupations = null;

  const json = JSON.stringify(p, null, 2);
  await writeFile(join(OUT_DIR,    'places', `${p.geoid}.json`), json);
  await writeFile(join(PUBLIC_DIR, 'places', `${p.geoid}.json`), json);
}
console.log(`✓ Wrote ${places.length} places. HUD AMI inherited for ${placesWithHud}, ` +
            `land area attached for ${placesWithGaz}.`);

function lightContext(a) {
  return {
    name: a.name,
    population_total: a.population_total,
    hh_income_median: a.hh_income_median,
    value_median: a.value_median,
    rent_median: a.rent_median,
    homeownership_rate: a.homeownership_rate,
    renter_rate: a.renter_rate,
    vacancy_rate: a.vacancy_rate,
    renter_cost_burden_rate: a.renter_cost_burden_rate,
    owner_cost_burden_rate: a.owner_cost_burden_rate,
    price_to_income_ratio: a.price_to_income_ratio,
    aging_stock_share: a.aging_stock_share,
    single_family_share: a.single_family_share,
    bachelors_plus_rate: a.bachelors_plus_rate,
  };
}

// Per-state files
for (const [state, agg] of Object.entries(stateAggs)) {
  await writeFile(
    join(OUT_DIR, 'states', `${slug(state)}.json`),
    JSON.stringify(agg, null, 2),
  );
}

// National file
await writeFile(join(OUT_DIR, 'national.json'), JSON.stringify(nationalAgg, null, 2));

// Manifest: list of all counties (slim) for index pages, search, etc.
const manifest = {
  generated_at: new Date().toISOString(),
  source_file: 'Full Housing Data Table.xlsx',
  county_count: counties.length,
  state_count: Object.keys(stateAggs).length,
  place_count: places.length,
  places_vintage: placesRaw.vintage ?? null,
  places_min_population: placesRaw.min_population ?? null,
  states: Object.values(stateAggs).map(s => ({
    name: s.name,
    slug: slug(s.name),
    state_fips: s.state_fips,
    county_count: s.county_count,
    population_total: s.population_total,
  })).sort((a, b) => a.name.localeCompare(b.name)),
  counties: counties.map(c => ({
    geoid: c.geoid,
    name: c.county_name,
    state: c.state_name,
    state_slug: c.state_slug,
    slug: c.slug,
    population_total: c.population_total,
    hh_income_median: c.hh_income_median,
    value_median: c.value_median,
    homeownership_rate: c.homeownership_rate,
  })).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
  places: places.map(p => ({
    geoid: p.geoid,
    name: p.place_name,
    state: p.state_name,
    state_slug: p.state_slug,
    slug: p.slug,
    parent_county_fips: p.parent_county_fips,
    population_total: p.population_total,
    hh_income_median: p.hh_income_median,
    value_median: p.value_median,
    homeownership_rate: p.homeownership_rate,
  })).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
};
await writeFile(join(OUT_DIR,    'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n✓ Wrote ${counties.length} counties, ${places.length} places, ${Object.keys(stateAggs).length} states, 1 national to ${OUT_DIR}`);
console.log(`✓ Mirrored to ${PUBLIC_DIR} for client-side fetch.\n`);
