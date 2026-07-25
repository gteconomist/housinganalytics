// acs-vintage-crosswalk.js
// ---------------------------------------------------------------------------
// Single source of truth for the CORE-ACS metrics behind the "Master Working
// Data Sheet" community-profile generator (housinganalytics.org v4).
//
// Every field here is derived from published ACS 5-year detailed tables that
// are structurally STABLE across the three vintages we plot: 2015, 2020, 2024
// (i.e. the 2011-2015, 2016-2020, 2020-2024 ACS5 releases). Where a field
// needs live confirmation of exact line numbers, it is marked status:'verify'
// and the assembler/validation pass will confirm it against known sheet values.
//
// Design: the sheet reports COUNTS and computes % change 2015->2024 itself, so
// most fields return raw counts/dollars/years and the assembler adds the delta.
// Shares (race, structure %) are returned as fractions of the relevant total.
//
// Consumed by: scripts/fetch-acs-vintages.mjs (which vars to request) and
// scripts/build-master-sheet.mjs (how to derive each field).
// ---------------------------------------------------------------------------

export const VINTAGES = [2015, 2020, 2024];

// ---- B01001 Sex by Age: age-cohort line numbers (male + female mirror) -----
// Male total = 002; female total = 026. Female lines mirror male at +24 offset.
const pad = (n) => String(n).padStart(3, '0');
const b01001 = (maleLines) =>
  maleLines.flatMap((m) => [`B01001_${pad(m)}E`, `B01001_${pad(m + 24)}E`]);

const AGE = {
  under18: [3, 4, 5, 6],            // <5, 5-9, 10-14, 15-17
  a18_24:  [7, 8, 9, 10],           // 18-19, 20, 21, 22-24
  a25_44:  [11, 12, 13, 14],        // 25-29 .. 40-44
  a45_64:  [15, 16, 17, 18, 19],    // 45-49 .. 62-64
  a65plus: [20, 21, 22, 23, 24, 25],// 65-66 .. 85+
};

// helper: sum a list of codes from the getter, treating nulls / negatives
// (ACS uses large negative sentinels like -666666666 for "no data") as null.
const sum = (g, codes) => {
  let t = 0, any = false;
  for (const c of codes) {
    const v = g(c);
    if (v != null) { t += v; any = true; }
  }
  return any ? t : null;
};
const ratio = (num, den) => (num != null && den != null && den !== 0 ? num / den : null);

// ---- B19037 Age of Householder by Household Income -------------------------
// A cross-tab, not a simple set of columns: the Master Sheet's "Income by Age
// Cohort" block shows, for each age cohort, the SHARE of that cohort's
// households falling in each of five income bands (each cohort's five shares
// sum to 100%). The ACS table has 16 income brackets per cohort; we collapse
// them into the sheet's five bands. Validated to the third decimal against the
// hand-made sheet for Chamblee / DeKalb / Atlanta MSA / Georgia (2024).
//
// Table layout: _001 total; each cohort has a subtotal line then its 16
// brackets. Cohort subtotals: Under 25 = _002, 25-44 = _019, 45-64 = _036,
// 65+ = _053. Bucket offsets below are relative to each cohort's subtotal.
export const B19037_COHORTS = [
  { id: 'u25',   label: 'Under 25', base: 2 },
  { id: 'a2544', label: '25-44',    base: 19 },
  { id: 'a4564', label: '45-64',    base: 36 },
  { id: 'a65p',  label: '65+',      base: 53 },
];
export const B19037_BUCKETS = [
  { label: '<$25,000',        offs: [1, 2, 3, 4] },        // <10k,10-14,15-19,20-24k
  { label: '$25,000-$49,999', offs: [5, 6, 7, 8, 9] },     // 25-29 .. 45-49k
  { label: '$50,000-$74,999', offs: [10, 11] },            // 50-59, 60-74k
  { label: '$75,000-$99,999', offs: [12] },                // 75-99k
  { label: '$100,000+',       offs: [13, 14, 15, 16] },    // 100-124 .. 200k+
];
const b19 = (n) => `B19037_${pad(n)}E`;
// One share field per (cohort, bucket); field id = `incage_<cohort>_<bucketIdx>`.
// The matrix renderers reconstruct these ids from the cohort id + bucket index.
const INCOME_AGE_FIELDS = B19037_COHORTS.flatMap((coh) =>
  B19037_BUCKETS.map((bk, j) => ({
    id: `incage_${coh.id}_${j}`, tab: 'Labor Force',
    label: `${coh.label}: ${bk.label}`, unit: 'share', status: 'stable',
    vars: [b19(coh.base), ...bk.offs.map((o) => b19(coh.base + o))],
    derive: (g) => ratio(sum(g, bk.offs.map((o) => b19(coh.base + o))), g(b19(coh.base))),
  })),
);

// ---------------------------------------------------------------------------
// FIELD DEFINITIONS
// tab      -> which Master-Sheet tab the field feeds
// label    -> human label as it should read on the sheet
// unit     -> count | dollars | years | rate | share
// status   -> stable | verify   (verify = confirm line numbers vs known values)
// vars     -> Census variable codes to request
// derive(g)-> compute the value from a code->number getter for one geo+vintage
// ---------------------------------------------------------------------------
export const FIELDS = [
  // ---------------- Community Profile ----------------
  { id: 'age_under18', tab: 'Community Profile', label: 'Under 18', unit: 'count', status: 'stable',
    vars: b01001(AGE.under18), derive: (g) => sum(g, b01001(AGE.under18)) },
  { id: 'age_18_24', tab: 'Community Profile', label: '18-24', unit: 'count', status: 'stable',
    vars: b01001(AGE.a18_24), derive: (g) => sum(g, b01001(AGE.a18_24)) },
  { id: 'age_25_44', tab: 'Community Profile', label: '25-44', unit: 'count', status: 'stable',
    vars: b01001(AGE.a25_44), derive: (g) => sum(g, b01001(AGE.a25_44)) },
  { id: 'age_45_64', tab: 'Community Profile', label: '45-64', unit: 'count', status: 'stable',
    vars: b01001(AGE.a45_64), derive: (g) => sum(g, b01001(AGE.a45_64)) },
  { id: 'age_65_plus', tab: 'Community Profile', label: '65+', unit: 'count', status: 'stable',
    vars: b01001(AGE.a65plus), derive: (g) => sum(g, b01001(AGE.a65plus)) },

  { id: 'median_age', tab: 'Community Profile', label: 'Median Age', unit: 'years', status: 'stable',
    vars: ['B01002_001E'], derive: (g) => g('B01002_001E') },
  { id: 'median_age_male', tab: 'Community Profile', label: 'Male Median Age', unit: 'years', status: 'stable',
    vars: ['B01002_002E'], derive: (g) => g('B01002_002E') },
  { id: 'median_age_female', tab: 'Community Profile', label: 'Female Median Age', unit: 'years', status: 'stable',
    vars: ['B01002_003E'], derive: (g) => g('B01002_003E') },

  // B03002 Hispanic-or-Latino by Race. Shares of total population.
  // "Other NH" on the sheet = AIAN NH + NHPI NH + Some-other-race NH (005+007+008).
  { id: 'race_white_nh', tab: 'Community Profile', label: 'White NH (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_003E'], derive: (g) => ratio(g('B03002_003E'), g('B03002_001E')) },
  { id: 'race_black_nh', tab: 'Community Profile', label: 'Black NH (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_004E'], derive: (g) => ratio(g('B03002_004E'), g('B03002_001E')) },
  { id: 'race_asian_nh', tab: 'Community Profile', label: 'Asian NH (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_006E'], derive: (g) => ratio(g('B03002_006E'), g('B03002_001E')) },
  { id: 'race_other_nh', tab: 'Community Profile', label: 'Other NH (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_005E', 'B03002_007E', 'B03002_008E'],
    derive: (g) => ratio(sum(g, ['B03002_005E', 'B03002_007E', 'B03002_008E']), g('B03002_001E')) },
  { id: 'race_two_plus_nh', tab: 'Community Profile', label: 'Two+ Races NH (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_009E'], derive: (g) => ratio(g('B03002_009E'), g('B03002_001E')) },
  { id: 'race_hispanic', tab: 'Community Profile', label: 'Hispanic/Latino (%)', unit: 'share', status: 'stable',
    vars: ['B03002_001E', 'B03002_012E'], derive: (g) => ratio(g('B03002_012E'), g('B03002_001E')) },

  // NOTE: the sheet's Community-Profile "MHI" block is actually PER CAPITA
  // INCOME (B19301), confirmed to the dollar against Chamblee 2015/2020/2024.
  { id: 'per_capita_income', tab: 'Community Profile', label: 'Per Capita Income', unit: 'dollars', status: 'stable',
    vars: ['B19301_001E'], derive: (g) => g('B19301_001E') },

  // ---------------- Labor Force ----------------
  { id: 'median_hh_income', tab: 'Labor Force', label: 'Median Household Income', unit: 'dollars', status: 'stable',
    vars: ['B19013_001E'], derive: (g) => g('B19013_001E') },
  { id: 'mhi_owner', tab: 'Labor Force', label: 'Owner-Occupied MHI', unit: 'dollars', status: 'stable',
    vars: ['B25119_002E'], derive: (g) => g('B25119_002E') },
  { id: 'mhi_renter', tab: 'Labor Force', label: 'Renter-Occupied MHI', unit: 'dollars', status: 'stable',
    vars: ['B25119_003E'], derive: (g) => g('B25119_003E') },

  // B23025 Employment Status (pop 16+). 002 in-LF, 003 civilian-LF, 005 unemployed.
  { id: 'unemployment_rate', tab: 'Labor Force', label: 'Unemployment Rate', unit: 'rate', status: 'stable',
    vars: ['B23025_003E', 'B23025_005E'], derive: (g) => ratio(g('B23025_005E'), g('B23025_003E')) },
  { id: 'labor_force_participation', tab: 'Labor Force', label: 'Labor Force Participation Rate', unit: 'rate', status: 'stable',
    vars: ['B23025_001E', 'B23025_002E'], derive: (g) => ratio(g('B23025_002E'), g('B23025_001E')) },

  // Income by Age Cohort (B19037) — see B19037_COHORTS/B19037_BUCKETS above.
  // Rendered as a 2024-only cross-tab (age cohort × income band) by the matrix
  // section on the Labor Force tab; derived for every vintage regardless.
  ...INCOME_AGE_FIELDS,

  // ---------------- Quality of Life (ACS attainment tables) ----------------
  // B15003 Educational Attainment for pop 25+.
  // IMPORTANT: the Master Sheet displays attainment CUMULATIVELY ("X or higher"),
  // confirmed against Chamblee 2024: its "HS Graduate" col = HS-or-higher (16,855)
  // and "Some College" col = some-college-or-higher (13,270). We therefore output
  // cumulative fields to match the sheet, plus keep the true partition available.
  // (The sheet's "Bachelor's+" value = graduate/professional degrees only, an
  //  apparent mislabel; edu_bachelors_or_higher below is the correct 10,067.)
  { id: 'edu_less_than_hs', tab: 'Quality of Life', label: 'Less than HS', unit: 'count', status: 'stable',
    vars: Array.from({ length: 15 }, (_, i) => `B15003_${pad(2 + i)}E`), // 002..016
    derive: (g) => sum(g, Array.from({ length: 15 }, (_, i) => `B15003_${pad(2 + i)}E`)) },
  { id: 'edu_hs_or_higher', tab: 'Quality of Life', label: 'HS Graduate or Higher', unit: 'count', status: 'stable',
    // total pop 25+ (B15003_001) minus less-than-HS (002..016)
    vars: ['B15003_001E', ...Array.from({ length: 15 }, (_, i) => `B15003_${pad(2 + i)}E`)],
    derive: (g) => { const t = g('B15003_001E'); const l = sum(g, Array.from({ length: 15 }, (_, i) => `B15003_${pad(2 + i)}E`)); return t != null && l != null ? t - l : null; } },
  { id: 'edu_some_college_or_higher', tab: 'Quality of Life', label: 'Some College or Higher', unit: 'count', status: 'stable',
    // some college/assoc (019-021) + bachelors+ (022-025)
    vars: ['B15003_019E', 'B15003_020E', 'B15003_021E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E'],
    derive: (g) => sum(g, ['B15003_019E', 'B15003_020E', 'B15003_021E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E']) },
  { id: 'edu_bachelors_or_higher', tab: 'Quality of Life', label: "Bachelor's Degree or Higher", unit: 'count', status: 'stable',
    vars: ['B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E'],
    derive: (g) => sum(g, ['B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E']) },
  { id: 'edu_graduate_or_prof', tab: 'Quality of Life', label: 'Graduate/Professional Degree', unit: 'count', status: 'stable',
    // what the sheet's "Bachelor's+" column actually holds (023+024+025)
    vars: ['B15003_023E', 'B15003_024E', 'B15003_025E'],
    derive: (g) => sum(g, ['B15003_023E', 'B15003_024E', 'B15003_025E']) },

  // B14005 School enrollment/attainment for pop 16-19.
  // Dropout = "not enrolled in school, not high school graduate" = male 012 +
  // female 026 subtotals (validated =259 for Chamblee 2024).
  { id: 'dropout_16_19', tab: 'Quality of Life', label: 'Dropouts (16-19)', unit: 'count', status: 'stable',
    vars: ['B14005_012E', 'B14005_026E'], derive: (g) => sum(g, ['B14005_012E', 'B14005_026E']) },
  { id: 'hs_grad_or_enrolled_16_19', tab: 'Quality of Life', label: 'HS Graduates/Enrolled (16-19)', unit: 'count', status: 'stable',
    // enrolled (male 003 + female 017) + not-enrolled-HS-grad (male 008 + female 022)
    vars: ['B14005_003E', 'B14005_017E', 'B14005_008E', 'B14005_022E'],
    derive: (g) => sum(g, ['B14005_003E', 'B14005_017E', 'B14005_008E', 'B14005_022E']) },

  // ---------------- Housing (ACS portions) ----------------
  { id: 'occupied_units', tab: 'Housing', label: 'Occupied Housing Units', unit: 'count', status: 'stable',
    vars: ['B25003_001E'], derive: (g) => g('B25003_001E') },
  { id: 'owner_occupied', tab: 'Housing', label: 'Owner Occupied', unit: 'count', status: 'stable',
    vars: ['B25003_002E'], derive: (g) => g('B25003_002E') },
  { id: 'renter_occupied', tab: 'Housing', label: 'Renter Occupied', unit: 'count', status: 'stable',
    vars: ['B25003_003E'], derive: (g) => g('B25003_003E') },

  // B25009 Tenure by Household Size. Owner 003-009 (1..7+), renter 011-017.
  { id: 'hh_1person', tab: 'Housing', label: '1-Person Household', unit: 'count', status: 'stable',
    vars: ['B25009_003E', 'B25009_011E'], derive: (g) => sum(g, ['B25009_003E', 'B25009_011E']) },
  { id: 'hh_2person', tab: 'Housing', label: '2-Person Household', unit: 'count', status: 'stable',
    vars: ['B25009_004E', 'B25009_012E'], derive: (g) => sum(g, ['B25009_004E', 'B25009_012E']) },
  { id: 'hh_3person', tab: 'Housing', label: '3-Person Household', unit: 'count', status: 'stable',
    vars: ['B25009_005E', 'B25009_013E'], derive: (g) => sum(g, ['B25009_005E', 'B25009_013E']) },
  { id: 'hh_4person', tab: 'Housing', label: '4-Person Household', unit: 'count', status: 'stable',
    vars: ['B25009_006E', 'B25009_014E'], derive: (g) => sum(g, ['B25009_006E', 'B25009_014E']) },
  { id: 'hh_5plus', tab: 'Housing', label: '5+ Person Household', unit: 'count', status: 'stable',
    vars: ['B25009_007E', 'B25009_008E', 'B25009_009E', 'B25009_015E', 'B25009_016E', 'B25009_017E'],
    derive: (g) => sum(g, ['B25009_007E', 'B25009_008E', 'B25009_009E', 'B25009_015E', 'B25009_016E', 'B25009_017E']) },

  { id: 'median_home_value', tab: 'Housing', label: 'Median Home Value', unit: 'dollars', status: 'stable',
    vars: ['B25077_001E'], derive: (g) => g('B25077_001E') },

  { id: 'median_gross_rent', tab: 'Housing', label: 'Median Gross Rent', unit: 'dollars', status: 'stable',
    vars: ['B25064_001E'], derive: (g) => g('B25064_001E') },
  { id: 'rent_no_bedroom', tab: 'Housing', label: 'Median Gross Rent: No Bedroom', unit: 'dollars', status: 'stable',
    vars: ['B25031_002E'], derive: (g) => g('B25031_002E') },
  { id: 'rent_1br', tab: 'Housing', label: 'Median Gross Rent: 1 Bedroom', unit: 'dollars', status: 'stable',
    vars: ['B25031_003E'], derive: (g) => g('B25031_003E') },
  { id: 'rent_2br', tab: 'Housing', label: 'Median Gross Rent: 2 Bedrooms', unit: 'dollars', status: 'stable',
    vars: ['B25031_004E'], derive: (g) => g('B25031_004E') },
  { id: 'rent_3br', tab: 'Housing', label: 'Median Gross Rent: 3 Bedrooms', unit: 'dollars', status: 'stable',
    vars: ['B25031_005E'], derive: (g) => g('B25031_005E') },
  { id: 'rent_4br', tab: 'Housing', label: 'Median Gross Rent: 4 Bedrooms', unit: 'dollars', status: 'stable',
    vars: ['B25031_006E'], derive: (g) => g('B25031_006E') },
  { id: 'rent_5plus_br', tab: 'Housing', label: 'Median Gross Rent: 5+ Bedrooms', unit: 'dollars', status: 'stable',
    vars: ['B25031_007E'], derive: (g) => g('B25031_007E') },

  // B25004 Vacancy Status. 001 total, 002 for-rent, 004 for-sale-only, 008 other.
  { id: 'vacant_total', tab: 'Housing', label: 'Vacant Housing Units', unit: 'count', status: 'stable',
    vars: ['B25004_001E'], derive: (g) => g('B25004_001E') },
  { id: 'vacant_for_rent', tab: 'Housing', label: 'Vacant: For Rent', unit: 'count', status: 'stable',
    vars: ['B25004_002E'], derive: (g) => g('B25004_002E') },
  { id: 'vacant_for_sale', tab: 'Housing', label: 'Vacant: For Sale Only', unit: 'count', status: 'stable',
    vars: ['B25004_004E'], derive: (g) => g('B25004_004E') },
  // Sheet's "Other Vacant" = total vacant minus for-rent minus for-sale-only
  // (i.e. it folds rented/sold-awaiting-occupancy, seasonal, migrant, and the
  //  ACS "other vacant" line together). Matches sheet's 634 for Chamblee 2024.
  { id: 'vacant_other', tab: 'Housing', label: 'Vacant: Other Vacant', unit: 'count', status: 'stable',
    vars: ['B25004_001E', 'B25004_002E', 'B25004_004E'],
    derive: (g) => { const t = g('B25004_001E'), r = g('B25004_002E'), s = g('B25004_004E'); return t != null ? t - (r || 0) - (s || 0) : null; } },

  // Homeowner vacancy rate = for-sale-only / (owner-occ + for-sale-only).
  // Rental vacancy rate = for-rent / (renter-occ + for-rent).
  { id: 'homeowner_vacancy_rate', tab: 'Housing', label: 'Homeowner Vacancy Rate', unit: 'rate', status: 'stable',
    vars: ['B25003_002E', 'B25004_004E'],
    derive: (g) => ratio(g('B25004_004E'), sum(g, ['B25003_002E', 'B25004_004E'])) },
  { id: 'rental_vacancy_rate', tab: 'Housing', label: 'Rental Vacancy Rate', unit: 'rate', status: 'stable',
    vars: ['B25003_003E', 'B25004_002E'],
    derive: (g) => ratio(g('B25004_002E'), sum(g, ['B25003_003E', 'B25004_002E'])) },

  // B25024 Units in Structure. 001 total; 002 1-detached ... 011 boat/RV/van.
  { id: 'total_housing_units', tab: 'Housing', label: 'Total Housing Units', unit: 'count', status: 'stable',
    vars: ['B25024_001E'], derive: (g) => g('B25024_001E') },
  { id: 'structure_1_detached', tab: 'Housing', label: 'Single-Family Detached', unit: 'count', status: 'stable',
    vars: ['B25024_002E'], derive: (g) => g('B25024_002E') },
  { id: 'structure_1_attached', tab: 'Housing', label: 'Townhome (1-Attached)', unit: 'count', status: 'stable',
    vars: ['B25024_003E'], derive: (g) => g('B25024_003E') },
  { id: 'structure_2', tab: 'Housing', label: 'Duplex (2 units)', unit: 'count', status: 'stable',
    vars: ['B25024_004E'], derive: (g) => g('B25024_004E') },
  { id: 'structure_3_4', tab: 'Housing', label: '3 or 4 units', unit: 'count', status: 'stable',
    vars: ['B25024_005E'], derive: (g) => g('B25024_005E') },
  { id: 'structure_5_9', tab: 'Housing', label: '5 to 9 units', unit: 'count', status: 'stable',
    vars: ['B25024_006E'], derive: (g) => g('B25024_006E') },
  { id: 'structure_10_19', tab: 'Housing', label: '10 to 19 units', unit: 'count', status: 'stable',
    vars: ['B25024_007E'], derive: (g) => g('B25024_007E') },
  { id: 'structure_20_49', tab: 'Housing', label: '20 to 49 units', unit: 'count', status: 'stable',
    vars: ['B25024_008E'], derive: (g) => g('B25024_008E') },
  { id: 'structure_50_plus', tab: 'Housing', label: '50 or More units', unit: 'count', status: 'stable',
    vars: ['B25024_009E'], derive: (g) => g('B25024_009E') },
  { id: 'structure_mobile', tab: 'Housing', label: 'Mobile Home', unit: 'count', status: 'stable',
    vars: ['B25024_010E'], derive: (g) => g('B25024_010E') },
  { id: 'structure_boat_rv', tab: 'Housing', label: 'Boat, RV, Van, Etc.', unit: 'count', status: 'stable',
    vars: ['B25024_011E'], derive: (g) => g('B25024_011E') },
];

// Union of every Census variable code we must request (deduped).
export const ALL_VARS = [...new Set(FIELDS.flatMap((f) => f.vars))];

// Export helpers so the assembler can reuse the null-safe math.
export { sum, ratio };
