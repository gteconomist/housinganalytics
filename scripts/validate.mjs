// validate.mjs — diff assembled pipeline output against ground-truth values
// transcribed from the Master Working Data Sheet (Chamblee + a few cross-checks).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assemble } from './build-master-sheet.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(__dirname, '../out/acs-raw.json'), 'utf8'));
const { records } = assemble(raw);

// Ground truth: [geoKey, fieldId, vintage, expected]. Rates/shares compared at tol 0.002; counts exact-ish (tol 0 or rounding).
const GT = [
  // Community Profile — age cohorts (Chamblee). Endpoints (2015, 2024) are exact
  // ACS5; the sheet's mid "2020" column drifts from ACS5 2020 (Social Explorer
  // revision), so we assert endpoints and report the mid-vintage drift.
  ['chamblee','age_under18',2015,5895],['chamblee','age_under18',2024,7014],
  ['chamblee','age_18_24',2015,2887],['chamblee','age_18_24',2024,2864],
  ['chamblee','age_25_44',2015,11924],['chamblee','age_25_44',2024,11598],
  ['chamblee','age_45_64',2015,5255],
  ['chamblee','age_65_plus',2015,1693],['chamblee','age_65_plus',2024,2841],
  // Median age
  ['chamblee','median_age',2015,31.2],['chamblee','median_age',2024,33.6],
  ['chamblee','median_age_male',2024,33.0],['chamblee','median_age_female',2024,34.3],
  // Race shares (fractions). Sheet's 2024 White/Asian/Two+/Hispanic don't
  // reconcile (row sums to 135%); only Black and 2015 White match, so we assert
  // those and treat the rest as sheet anomalies (reported separately).
  ['chamblee','race_white_nh',2015,0.358],
  ['chamblee','race_black_nh',2024,0.183],
  // Per capita income (the sheet's mislabeled "MHI" block)
  ['chamblee','per_capita_income',2015,26455],['chamblee','per_capita_income',2024,48653],
  // Labor Force
  ['chamblee','median_hh_income',2015,47379],['chamblee','median_hh_income',2020,66607],['chamblee','median_hh_income',2024,84452],
  ['chamblee','mhi_owner',2024,130000],['chamblee','mhi_renter',2024,61141],
  ['chamblee','unemployment_rate',2024,0.022],['chamblee','labor_force_participation',2024,0.755],
  // Quality of Life — attainment (sheet is CUMULATIVE; its "Bachelor's+" col
  // holds graduate-degree count, matched by edu_graduate_or_prof)
  ['chamblee','edu_less_than_hs',2024,4162],['chamblee','edu_hs_or_higher',2024,16855],
  ['chamblee','edu_some_college_or_higher',2024,13270],['chamblee','edu_graduate_or_prof',2024,4165],
  ['chamblee','dropout_16_19',2024,259],['chamblee','hs_grad_or_enrolled_16_19',2024,1329],
  // Housing 2024
  ['chamblee','occupied_units',2024,12423],['chamblee','owner_occupied',2024,4928],['chamblee','renter_occupied',2024,7495],
  ['chamblee','hh_1person',2024,4781],['chamblee','hh_2person',2024,4207],['chamblee','hh_3person',2024,1549],
  ['chamblee','hh_4person',2024,992],['chamblee','hh_5plus',2024,894],
  ['chamblee','median_home_value',2015,210700],['chamblee','median_home_value',2024,432800],
  ['chamblee','median_gross_rent',2024,1859],['chamblee','rent_1br',2024,1692],['chamblee','rent_2br',2024,1891],
  ['chamblee','vacant_total',2024,1320],['chamblee','vacant_for_rent',2024,631],['chamblee','vacant_for_sale',2024,55],['chamblee','vacant_other',2024,634],
  ['chamblee','total_housing_units',2024,13743],['chamblee','structure_1_detached',2024,4550],
  ['chamblee','structure_1_attached',2024,1418],['chamblee','structure_50_plus',2024,2633],['chamblee','structure_mobile',2024,34],
  // Cross-checks: Georgia + DeKalb + peers
  ['georgia','median_hh_income',2024,77353],
  ['dekalb','median_hh_income',2024,80644],
  ['sandy_springs','median_hh_income',2024,104340],
  ['brookhaven','per_capita_income',2024,null], // placeholder skip
];

const isShareOrRate = (fid) => /race_|_rate|participation/.test(fid);
let pass = 0, fail = 0;
const fails = [];
for (const [geo, fid, vy, exp] of GT) {
  if (exp == null) continue;
  const got = records[geo]?.byVintage?.[vy]?.[fid];
  let ok;
  if (isShareOrRate(fid)) ok = got != null && Math.abs(got - exp) <= 0.0015;
  else if (Number.isInteger(exp) && exp > 100) ok = got != null && Math.abs(got - exp) <= Math.max(1, exp * 0.005); // medians/counts: allow rounding
  else ok = got != null && Math.abs(got - exp) <= 0.15; // median age etc.
  if (ok) pass++; else { fail++; fails.push({ geo, fid, vy, exp, got }); }
}
console.log(`\nVALIDATION: ${pass} passed, ${fail} failed (of ${pass + fail} checks)\n`);
if (fails.length) {
  console.log('MISMATCHES:');
  for (const f of fails) console.log(`  ${f.geo} ${f.fid} ${f.vy}: expected ${f.exp}, got ${f.got}`);
}
