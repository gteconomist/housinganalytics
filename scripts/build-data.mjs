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
 */

import * as XLSX from 'xlsx';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACS_TO_FIELD, MHC_COMPONENTS } from '../src/data/variable-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const SOURCE_XLSX = join(ROOT, 'Full Housing Data Table.xlsx');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');

console.log(`Reading ${SOURCE_XLSX}...`);
const buf = await readFile(SOURCE_XLSX);
const wb  = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true });

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
  throw new Error("Could not locate header row (the row with 'NAME' and 'Geo_geoid_').");
}
const headerRow = rows[HEADER_IDX];
const NAME_COL  = headerRow.indexOf('NAME');
const GEOID_COL = headerRow.indexOf('Geo_geoid_');

const colToField = {};
for (let col = 0; col < headerRow.length; col++) {
  const acs = headerRow[col];
  if (acs == null) continue;
  const field = ACS_TO_FIELD[String(acs).trim()];
  if (field) colToField[col] = field;
}

const mhcComponentCols = {};
for (const [outField, codes] of Object.entries(MHC_COMPONENTS)) {
  mhcComponentCols[outField] = codes
    .map(code => headerRow.indexOf(code))
    .filter(i => i >= 0);
}

console.log(`Spreadsheet has ${rows.length} rows, ${headerRow.length} columns.`);
console.log(`Header row found at index ${HEADER_IDX} (Excel row ${HEADER_IDX + 1}).`);
console.log(`Mapped ${Object.keys(colToField).length} ACS-code columns to field names.`);

const DATA_START = HEADER_IDX + 1;

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < -1_000_000) return null;
  return n;
}

function pad5(s) {
  const t = String(s ?? '').trim();
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
  const [county_name, state_name] = String(name).split(',').map(s => s.trim());
  const data = {};
  for (const [colStr, field] of Object.entries(colToField)) {
    const col = Number(colStr);
    data[field] = num(row[col]);
  }
  for (const [outField, cols] of Object.entries(mhcComponentCols)) {
    let sum = 0, hasAny = false;
    for (const c of cols) {
      const v = num(row[c]);
      if (v != null) { sum += v; hasAny = true; }
    }
    data[outField] = hasAny ? sum : null;
  }
  counties.push({
    geoid, name, county_name, state_name,
    state_fips: geoid.slice(0, 2),
    ...data,
  });
}
console.log(`Parsed ${counties.length} counties.`);

function safeDivide(a, b) { if (a == null || b == null || b === 0) return null; return a / b; }
function pct(a, b) { const v = safeDivide(a, b); return v == null ? null : v * 100; }

function addDerived(c) {
  c.homeownership_rate = pct(c.tenure_owner_occupied, c.tenure_total_occupied);
  c.renter_rate        = pct(c.tenure_renter_occupied, c.tenure_total_occupied);
  const total_units = (c.units_occupied ?? 0) + (c.units_vacant ?? 0);
  c.vacancy_rate = pct(c.units_vacant, total_units || null);
  const rb_30_plus = (c.rent_burden_30_34 ?? 0) + (c.rent_burden_35_39 ?? 0) + (c.rent_burden_40_49 ?? 0) + (c.rent_burden_50_plus ?? 0);
  const rb_severe = c.rent_burden_50_plus ?? 0;
  const rb_denom = (c.rent_burden_total ?? 0) - (c.rent_burden_not_computed ?? 0);
  c.renter_cost_burden_rate        = pct(rb_30_plus, rb_denom || null);
  c.renter_severe_cost_burden_rate = pct(rb_severe, rb_denom || null);
  const ob_30_plus = (c.cb_owner_30_plus_lt20k ?? 0) + (c.cb_owner_30_plus_20_35k ?? 0) + (c.cb_owner_30_plus_35_50k ?? 0) + (c.cb_owner_30_plus_50_75k ?? 0) + (c.cb_owner_30_plus_75k_plus ?? 0);
  c.owner_cost_burden_rate = pct(ob_30_plus, c.cb_owner_total ?? null);
  c.price_to_income_ratio = safeDivide(c.value_median, c.hh_income_median);
  c.rent_to_income_ratio = c.rent_median != null && c.hh_income_median ? (c.rent_median * 12) / c.hh_income_median : null;
  const total_year_built = (c.year_built_2020_plus ?? 0) + (c.year_built_2010_19 ?? 0) + (c.year_built_2000_09 ?? 0) + (c.year_built_1980_99 ?? 0) + (c.year_built_1960_79 ?? 0) + (c.year_built_1940_59 ?? 0) + (c.year_built_1939_earlier ?? 0);
  const pre_1980 = (c.year_built_1960_79 ?? 0) + (c.year_built_1940_59 ?? 0) + (c.year_built_1939_earlier ?? 0);
  c.aging_stock_share = pct(pre_1980, total_year_built || null);
  const sf = (c.structure_1_detached ?? 0) + (c.structure_1_attached ?? 0);
  c.single_family_share = pct(sf, c.units_total);
  const mm = (c.structure_2 ?? 0) + (c.structure_3_4 ?? 0) + (c.structure_5_9 ?? 0) + (c.structure_10_19 ?? 0);
  c.missing_middle_share = pct(mm, c.units_total);
  const edu_total = (c.edu_lt_9th ?? 0) + (c.edu_9_12_no_diploma ?? 0) + (c.edu_hs_grad ?? 0) + (c.edu_some_college ?? 0) + (c.edu_associates ?? 0) + (c.edu_bachelors ?? 0) + (c.edu_graduate ?? 0);
  c.bachelors_plus_rate = pct((c.edu_bachelors ?? 0) + (c.edu_graduate ?? 0), edu_total || null);
  return c;
}
counties.forEach(addDerived);

const SUM_FIELDS = new Set([
  'population_total','units_occupied','units_vacant','units_total',
  'structure_1_detached','structure_1_attached','structure_2','structure_3_4','structure_5_9','structure_10_19','structure_20_49','structure_50_plus','structure_mobile','structure_other',
  'tenure_total_occupied','tenure_owner_occupied','tenure_renter_occupied',
  'year_built_2020_plus','year_built_2010_19','year_built_2000_09','year_built_1980_99','year_built_1960_79','year_built_1940_59','year_built_1939_earlier',
  'earners_0','earners_1','earners_2','earners_3_plus','earners_nonfamily',
  'hh_size_1','hh_size_2','hh_size_3','hh_size_4_plus','hh_total_s2501','hh_total_s1101','hh_total_s1903','hh_with_children',
  'br_0','br_1','br_2','br_3','br_4','br_5_plus',
  'rent_burden_total','rent_burden_lt_10','rent_burden_10_14','rent_burden_15_19','rent_burden_20_24','rent_burden_25_29','rent_burden_30_34','rent_burden_35_39','rent_burden_40_49','rent_burden_50_plus','rent_burden_not_computed',
  'cb_owner_total','cb_owner_30_plus_lt20k','cb_owner_30_plus_20_35k','cb_owner_30_plus_35_50k','cb_owner_30_plus_50_75k','cb_owner_30_plus_75k_plus','cb_owner_zero_negative','cb_renter_total','cb_renter_no_cash',
  'edu_lt_9th','edu_9_12_no_diploma','edu_hs_grad','edu_some_college','edu_associates','edu_bachelors','edu_graduate',
  'value_lt_50k','value_50_99k','value_100_150k','value_150_200k','value_200_300k','value_300_500k','value_500_1m','value_1m_plus',
  'oi_lt_5k','oi_5_10k','oi_10_15k','oi_15_20k','oi_20_25k','oi_25_35k','oi_35_50k','oi_50_75k','oi_75_100k','oi_100_150k','oi_150k_plus',
  'ri_lt_5k','ri_5_10k','ri_10_15k','ri_15_20k','ri_20_25k','ri_25_35k','ri_35_50k','ri_50_75k','ri_75_100k','ri_100_150k','ri_150k_plus',
  'renter_age_under35','renter_age_35_44','renter_age_45_54','renter_age_55_64','renter_age_65_74','renter_age_75_84','renter_age_85_plus',
  'owner_age_under35','owner_age_35_44','owner_age_45_54','owner_age_55_64','owner_age_65_74','owner_age_75_84','owner_age_85_plus',
  'mhc_lt_500','mhc_500_999','mhc_1000_1499','mhc_1500_1999','mhc_2000_2499','mhc_2500_2999','mhc_3000_plus','mhc_no_cash_rent',
  'mortgage_total','race_white','race_black','race_aian','race_asian','race_nhpi','race_other','race_two_plus',
]);

const WEIGHTED_MEDIAN_FIELDS = [
  ['hh_income_median','tenure_total_occupied'],['hh_income_mean','tenure_total_occupied'],
  ['value_median','tenure_owner_occupied'],['rent_median','tenure_renter_occupied'],
  ['rent_median_0br','br_0'],['rent_median_1br','br_1'],['rent_median_2br','br_2'],
  ['rent_median_3br','br_3'],['rent_median_4br','br_4'],['rent_median_5br','br_5_plus'],
  ['mortgage_median','mortgage_total'],['structure_median_age','units_total'],
  ['median_age','population_total'],['per_capita_income','population_total'],
  ['hh_avg_size','tenure_total_occupied'],['poverty_rate','population_total'],
];

function aggregate(group, name) {
  const out = { name };
  for (const f of SUM_FIELDS) {
    let s = 0, any = false;
    for (const c of group) { const v = c[f]; if (v != null) { s += v; any = true; } }
    out[f] = any ? s : null;
  }
  for (const [field, weight] of WEIGHTED_MEDIAN_FIELDS) {
    let num = 0, denom = 0;
    for (const c of group) {
      const v = c[field], w = c[weight];
      if (v != null && w != null && w > 0) { num += v * w; denom += w; }
    }
    out[field] = denom > 0 ? num / denom : null;
  }
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

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
counties.forEach(c => { c.slug = slug(c.county_name); c.state_slug = slug(c.state_name); });

if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await mkdir(join(OUT_DIR, 'counties'), { recursive: true });
await mkdir(join(OUT_DIR, 'states'), { recursive: true });

function lightContext(a) {
  return {
    name: a.name, population_total: a.population_total, hh_income_median: a.hh_income_median,
    value_median: a.value_median, rent_median: a.rent_median,
    homeownership_rate: a.homeownership_rate, renter_rate: a.renter_rate,
    vacancy_rate: a.vacancy_rate, renter_cost_burden_rate: a.renter_cost_burden_rate,
    owner_cost_burden_rate: a.owner_cost_burden_rate, price_to_income_ratio: a.price_to_income_ratio,
    aging_stock_share: a.aging_stock_share, single_family_share: a.single_family_share,
    bachelors_plus_rate: a.bachelors_plus_rate,
  };
}

for (const c of counties) {
  const stateAgg = stateAggs[c.state_name];
  c._context = { state: stateAgg ? lightContext(stateAgg) : null, national: lightContext(nationalAgg) };
  await writeFile(join(OUT_DIR, 'counties', `${c.geoid}.json`), JSON.stringify(c, null, 2));
}
for (const [state, agg] of Object.entries(stateAggs)) {
  await writeFile(join(OUT_DIR, 'states', `${slug(state)}.json`), JSON.stringify(agg, null, 2));
}
await writeFile(join(OUT_DIR, 'national.json'), JSON.stringify(nationalAgg, null, 2));

const manifest = {
  generated_at: new Date().toISOString(),
  source_file: 'Full Housing Data Table.xlsx',
  county_count: counties.length,
  state_count: Object.keys(stateAggs).length,
  states: Object.values(stateAggs).map(s => ({
    name: s.name, slug: slug(s.name), state_fips: s.state_fips,
    county_count: s.county_count, population_total: s.population_total,
  })).sort((a, b) => a.name.localeCompare(b.name)),
  counties: counties.map(c => ({
    geoid: c.geoid, name: c.county_name, state: c.state_name,
    state_slug: c.state_slug, slug: c.slug,
    population_total: c.population_total, hh_income_median: c.hh_income_median,
    value_median: c.value_median, homeownership_rate: c.homeownership_rate,
  })).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
};
await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n✓ Wrote ${counties.length} counties, ${Object.keys(stateAggs).length} states, 1 national to ${OUT_DIR}\n`);
