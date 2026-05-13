// ACS variable mapping
//
// This file is the single source of truth for translating ACS variable codes
// (e.g., "B25024_002E") into plain-language field names used everywhere else
// in the codebase. When ACS renames a variable in next year's vintage, update
// the `acs` code below and everything downstream keeps working.
//
// Source: Full Housing Data Table.xlsx
//   Row 11 (Excel) = the `label` field below
//   Row 12 (Excel) = the `acs` field below
//   Columns B (Area Name) and C (FIPS / GeoID) are handled separately.

/** @typedef {{ field: string, label: string, acs: string, group: string }} VarDef */

/** @type {VarDef[]} */
export const VARIABLES = [
  // ── Population & demographics ────────────────────────────────────
  { field: 'population_total',          label: 'Total Population',                       acs: 'B01003_001E', group: 'demographics' },
  { field: 'median_age',                label: 'Median Age',                             acs: 'DP05_0018E',  group: 'demographics' },
  { field: 'race_white',                label: 'White',                                  acs: 'DP05_0037E',  group: 'demographics' },
  { field: 'race_black',                label: 'Black or African American',              acs: 'DP05_0045E',  group: 'demographics' },
  { field: 'race_aian',                 label: 'American Indian / Alaska Native',        acs: 'DP05_0053E',  group: 'demographics' },
  { field: 'race_asian',                label: 'Asian',                                  acs: 'DP05_0061E',  group: 'demographics' },
  { field: 'race_nhpi',                 label: 'Native Hawaiian / Pacific Islander',     acs: 'DP05_0069E',  group: 'demographics' },
  { field: 'race_other',                label: 'Some other race',                        acs: 'DP05_0074E',  group: 'demographics' },
  { field: 'race_two_plus',             label: 'Two or more races',                      acs: 'DP05_0075E',  group: 'demographics' },

  // ── Housing units & occupancy ────────────────────────────────────
  { field: 'units_occupied',            label: 'Occupied Housing Units',                 acs: 'B25002_002E', group: 'occupancy' },
  { field: 'units_vacant',              label: 'Vacant Housing Units',                   acs: 'B25002_003E', group: 'occupancy' },
  { field: 'units_total',               label: 'Total Housing Units',                    acs: 'B25024_001E', group: 'structure' },
  // Homeowner & rental vacancy rates — ACS publishes these as rates directly.
  // Add these two columns to the spreadsheet to see the split on the KPI bar.
  { field: 'homeowner_vacancy_rate',    label: 'Homeowner Vacancy Rate',                 acs: 'DP04_0004E', group: 'occupancy' },
  { field: 'rental_vacancy_rate',       label: 'Rental Vacancy Rate',                    acs: 'DP04_0005E', group: 'occupancy' },

  // ── Structure type (B25024) ──────────────────────────────────────
  { field: 'structure_1_detached',      label: '1, Detached Unit',                       acs: 'B25024_002E', group: 'structure' },
  { field: 'structure_1_attached',      label: '1, Attached Unit',                       acs: 'B25024_003E', group: 'structure' },
  { field: 'structure_2',               label: '2 Units',                                acs: 'B25024_004E', group: 'structure' },
  { field: 'structure_3_4',             label: '3 or 4 Units',                           acs: 'B25024_005E', group: 'structure' },
  { field: 'structure_5_9',             label: '5 to 9 Units',                           acs: 'B25024_006E', group: 'structure' },
  { field: 'structure_10_19',           label: '10 to 19 Units',                         acs: 'B25024_007E', group: 'structure' },
  { field: 'structure_20_49',           label: '20 to 49 Units',                         acs: 'B25024_008E', group: 'structure' },
  { field: 'structure_50_plus',         label: '50+ Units',                              acs: 'B25024_009E', group: 'structure' },
  { field: 'structure_mobile',          label: 'Mobile Home',                            acs: 'B25024_010E', group: 'structure' },
  { field: 'structure_other',           label: 'Boat, RV, Van, etc.',                    acs: 'B25024_011E', group: 'structure' },
  { field: 'structure_median_age',      label: 'Median Structure Age',                   acs: 'B25035_001E', group: 'structure' },

  // ── Home value distribution (DP04) ───────────────────────────────
  { field: 'value_median',              label: 'Median Home Value',                      acs: 'DP04_0089E',  group: 'value' },
  { field: 'value_lt_50k',              label: 'Owner-Occupied Value <$50K',             acs: 'DP04_0081E',  group: 'value' },
  { field: 'value_50_99k',              label: 'Owner-Occupied Value $50K–$99K',         acs: 'DP04_0082E',  group: 'value' },
  { field: 'value_100_150k',            label: 'Owner-Occupied Value $100K–$150K',       acs: 'DP04_0083E',  group: 'value' },
  { field: 'value_150_200k',            label: 'Owner-Occupied Value $150K–$200K',       acs: 'DP04_0084E',  group: 'value' },
  { field: 'value_200_300k',            label: 'Owner-Occupied Value $200K–$300K',       acs: 'DP04_0085E',  group: 'value' },
  { field: 'value_300_500k',            label: 'Owner-Occupied Value $300K–$500K',       acs: 'DP04_0086E',  group: 'value' },
  { field: 'value_500_1m',              label: 'Owner-Occupied Value $500K–$1M',         acs: 'DP04_0087E',  group: 'value' },
  { field: 'value_1m_plus',             label: 'Owner-Occupied Value $1M+',              acs: 'DP04_0088E',  group: 'value' },

  // ── Tenure (DP04) ────────────────────────────────────────────────
  { field: 'tenure_total_occupied',     label: 'Total Occupied Housing Units (DP04)',    acs: 'DP04_0045E',  group: 'tenure' },
  { field: 'tenure_owner_occupied',     label: 'Owner-Occupied Housing Units',           acs: 'DP04_0046E',  group: 'tenure' },
  { field: 'tenure_renter_occupied',    label: 'Renter-Occupied Housing Units',          acs: 'DP04_0047E',  group: 'tenure' },

  // ── Income (S1701, S1901) ────────────────────────────────────────
  { field: 'poverty_rate',              label: 'Poverty Rate (%)',                       acs: 'S1701_C03_006E', group: 'income' },
  { field: 'hh_income_median',          label: 'Median Household Income',                acs: 'S1901_C01_012E', group: 'income' },
  { field: 'hh_income_mean',            label: 'Mean Household Income',                  acs: 'S1901_C01_013E', group: 'income' },
  { field: 'per_capita_income',         label: 'Per Capita Income',                      acs: 'DP03_0088E',     group: 'income' },

  // ── Year built (S2504) ───────────────────────────────────────────
  { field: 'year_built_2020_plus',      label: 'Year Built — 2020 or Later',             acs: 'S2504_C01_009E', group: 'year_built' },
  { field: 'year_built_2010_19',        label: 'Year Built — 2010–19',                   acs: 'S2504_C01_010E', group: 'year_built' },
  { field: 'year_built_2000_09',        label: 'Year Built — 2000–09',                   acs: 'S2504_C01_011E', group: 'year_built' },
  { field: 'year_built_1980_99',        label: 'Year Built — 1980–99',                   acs: 'S2504_C01_012E', group: 'year_built' },
  { field: 'year_built_1960_79',        label: 'Year Built — 1960–79',                   acs: 'S2504_C01_013E', group: 'year_built' },
  { field: 'year_built_1940_59',        label: 'Year Built — 1940–59',                   acs: 'S2504_C01_014E', group: 'year_built' },
  { field: 'year_built_1939_earlier',   label: 'Year Built — 1939 or earlier',           acs: 'S2504_C01_015E', group: 'year_built' },

  // ── Household composition (S1903 / S2501 / S1101) ────────────────
  { field: 'earners_0',                 label: 'No-Earner Households',                   acs: 'S1903_C01_030E', group: 'earners' },
  { field: 'earners_1',                 label: '1-Earner Households',                    acs: 'S1903_C01_031E', group: 'earners' },
  { field: 'earners_2',                 label: '2-Earner Households',                    acs: 'S1903_C01_032E', group: 'earners' },
  { field: 'earners_3_plus',            label: '3+ Earner Households',                   acs: 'S1903_C01_033E', group: 'earners' },
  { field: 'earners_nonfamily',         label: 'Non-Family Households',                  acs: 'S1903_C01_034E', group: 'earners' },
  { field: 'earners_0_income',          label: 'No-Earner Median Income',                acs: 'S1903_C03_030E', group: 'earners' },
  { field: 'earners_1_income',          label: '1-Earner Median Income',                 acs: 'S1903_C03_031E', group: 'earners' },
  { field: 'earners_2_income',          label: '2-Earner Median Income',                 acs: 'S1903_C03_032E', group: 'earners' },
  { field: 'earners_3_plus_income',     label: '3+ Earner Median Income',                acs: 'S1903_C03_033E', group: 'earners' },
  { field: 'earners_nonfamily_income',  label: 'Non-Family Median Income',               acs: 'S1903_C03_034E', group: 'earners' },
  { field: 'hh_total_s1903',            label: 'Total Households (S1903)',               acs: 'S1903_C01_001E', group: 'household' },
  { field: 'hh_size_1',                 label: '1-Person Households',                    acs: 'S2501_C01_002E', group: 'hh_size' },
  { field: 'hh_size_2',                 label: '2-Person Households',                    acs: 'S2501_C01_003E', group: 'hh_size' },
  { field: 'hh_size_3',                 label: '3-Person Households',                    acs: 'S2501_C01_004E', group: 'hh_size' },
  { field: 'hh_size_4_plus',            label: '4+ Person Households',                   acs: 'S2501_C01_005E', group: 'hh_size' },
  { field: 'hh_total_s2501',            label: 'Total Households (S2501)',               acs: 'S2501_C01_001E', group: 'household' },
  { field: 'hh_total_s1101',            label: 'Total Households (S1101)',               acs: 'S1101_C01_001E', group: 'household' },
  { field: 'hh_avg_size',               label: 'Average Household Size',                 acs: 'S1101_C01_002E', group: 'household' },
  { field: 'hh_with_children',          label: 'Households with Children',               acs: 'S1101_C01_005E', group: 'household' },

  // ── Mortgage data ────────────────────────────────────────────────
  { field: 'mortgage_total',            label: 'Total Housing Units with Mortgage',      acs: 'S2506_C01_001E', group: 'mortgage' },
  { field: 'mortgage_median',           label: 'Median Mortgage Payment',                acs: 'S2506_C01_009E', group: 'mortgage' },

  // ── Education (S1501) ────────────────────────────────────────────
  { field: 'edu_lt_9th',                label: 'Less than 9th Grade',                    acs: 'S1501_C01_007E', group: 'education' },
  { field: 'edu_9_12_no_diploma',       label: '9th to 12th Grade, no diploma',          acs: 'S1501_C01_008E', group: 'education' },
  { field: 'edu_hs_grad',               label: 'High School Graduate',                   acs: 'S1501_C01_009E', group: 'education' },
  { field: 'edu_some_college',          label: 'Some College, no degree',                acs: 'S1501_C01_010E', group: 'education' },
  { field: 'edu_associates',            label: "Associate's Degree",                     acs: 'S1501_C01_011E', group: 'education' },
  { field: 'edu_bachelors',             label: "Bachelor's Degree",                      acs: 'S1501_C01_012E', group: 'education' },
  { field: 'edu_graduate',              label: 'Graduate or Professional Degree',        acs: 'S1501_C01_013E', group: 'education' },

  // ── Monthly housing cost (B25104) — coarse-binned for chart ──────
  { field: 'mhc_lt_500',                label: 'Monthly Housing Cost <$500 (sum of <$100..$400-$499)', acs: 'DERIVED', group: 'mhc' },
  { field: 'mhc_500_999',               label: 'Monthly Housing Cost $500–$999',         acs: 'DERIVED',     group: 'mhc' },
  { field: 'mhc_1000_1499',             label: 'Monthly Housing Cost $1,000–$1,499',     acs: 'B25104_012E', group: 'mhc' },
  { field: 'mhc_1500_1999',             label: 'Monthly Housing Cost $1,500–$1,999',     acs: 'B25104_013E', group: 'mhc' },
  { field: 'mhc_2000_2499',             label: 'Monthly Housing Cost $2,000–$2,499',     acs: 'B25104_014E', group: 'mhc' },
  { field: 'mhc_2500_2999',             label: 'Monthly Housing Cost $2,500–$2,999',     acs: 'B25104_015E', group: 'mhc' },
  { field: 'mhc_3000_plus',             label: 'Monthly Housing Cost $3,000+',           acs: 'B25104_016E', group: 'mhc' },
  { field: 'mhc_no_cash_rent',          label: 'No Cash Rent',                           acs: 'B25104_017E', group: 'mhc' },

  // ── Rent (B25031) ────────────────────────────────────────────────
  { field: 'rent_median',               label: 'Median Gross Rent',                      acs: 'B25031_001E', group: 'rent' },
  { field: 'rent_median_0br',           label: 'Median Rent — Studio',                   acs: 'B25031_002E', group: 'rent' },
  { field: 'rent_median_1br',           label: 'Median Rent — 1 Bedroom',                acs: 'B25031_003E', group: 'rent' },
  { field: 'rent_median_2br',           label: 'Median Rent — 2 Bedroom',                acs: 'B25031_004E', group: 'rent' },
  { field: 'rent_median_3br',           label: 'Median Rent — 3 Bedroom',                acs: 'B25031_005E', group: 'rent' },
  { field: 'rent_median_4br',           label: 'Median Rent — 4 Bedroom',                acs: 'B25031_006E', group: 'rent' },
  { field: 'rent_median_5br',           label: 'Median Rent — 5+ Bedroom',               acs: 'B25031_007E', group: 'rent' },

  // ── Rent burden (B25070) ─────────────────────────────────────────
  { field: 'rent_burden_total',         label: 'Renter Households (total)',              acs: 'B25070_001E', group: 'rent_burden' },
  { field: 'rent_burden_lt_10',         label: 'Rent <10% of income',                    acs: 'B25070_002E', group: 'rent_burden' },
  { field: 'rent_burden_10_14',         label: 'Rent 10%–14.9% of income',               acs: 'B25070_003E', group: 'rent_burden' },
  { field: 'rent_burden_15_19',         label: 'Rent 15%–19.9% of income',               acs: 'B25070_004E', group: 'rent_burden' },
  { field: 'rent_burden_20_24',         label: 'Rent 20%–24.9% of income',               acs: 'B25070_005E', group: 'rent_burden' },
  { field: 'rent_burden_25_29',         label: 'Rent 25%–29.9% of income',               acs: 'B25070_006E', group: 'rent_burden' },
  { field: 'rent_burden_30_34',         label: 'Rent 30%–34.9% of income',               acs: 'B25070_007E', group: 'rent_burden' },
  { field: 'rent_burden_35_39',         label: 'Rent 35%–39.9% of income',               acs: 'B25070_008E', group: 'rent_burden' },
  { field: 'rent_burden_40_49',         label: 'Rent 40%–49.9% of income',               acs: 'B25070_009E', group: 'rent_burden' },
  { field: 'rent_burden_50_plus',       label: 'Rent 50%+ of income',                    acs: 'B25070_010E', group: 'rent_burden' },
  { field: 'rent_burden_not_computed',  label: 'Rent burden — Not Computed',             acs: 'B25070_011E', group: 'rent_burden' },

  // ── Owner cost burden (B25106 subset — owner & renter cross-tab) ─
  { field: 'cb_owner_total',            label: 'Owner — Total',                          acs: 'B25106_002E', group: 'cost_burden' },
  { field: 'cb_owner_30_plus_lt20k',    label: 'Owner <$20K, 30%+',                      acs: 'B25106_006E', group: 'cost_burden' },
  { field: 'cb_owner_30_plus_20_35k',   label: 'Owner $20-35K, 30%+',                    acs: 'B25106_010E', group: 'cost_burden' },
  { field: 'cb_owner_30_plus_35_50k',   label: 'Owner $35-50K, 30%+',                    acs: 'B25106_014E', group: 'cost_burden' },
  { field: 'cb_owner_30_plus_50_75k',   label: 'Owner $50-75K, 30%+',                    acs: 'B25106_018E', group: 'cost_burden' },
  { field: 'cb_owner_30_plus_75k_plus', label: 'Owner $75K+, 30%+',                      acs: 'B25106_022E', group: 'cost_burden' },
  { field: 'cb_owner_zero_negative',    label: 'Owner zero or negative income',          acs: 'B25106_023E', group: 'cost_burden' },
  { field: 'cb_renter_total',           label: 'Renter — Total',                         acs: 'B25106_024E', group: 'cost_burden' },
  { field: 'cb_renter_no_cash',         label: 'Renter — No cash rent',                  acs: 'B25106_046E', group: 'cost_burden' },

  // ── Bedrooms (B25041) ────────────────────────────────────────────
  { field: 'br_0',                      label: '0-Bedroom Housing Units',                acs: 'B25041_002E', group: 'bedrooms' },
  { field: 'br_1',                      label: '1-Bedroom Housing Units',                acs: 'B25041_003E', group: 'bedrooms' },
  { field: 'br_2',                      label: '2-Bedroom Housing Units',                acs: 'B25041_004E', group: 'bedrooms' },
  { field: 'br_3',                      label: '3-Bedroom Housing Units',                acs: 'B25041_005E', group: 'bedrooms' },
  { field: 'br_4',                      label: '4-Bedroom Housing Units',                acs: 'B25041_006E', group: 'bedrooms' },
  { field: 'br_5_plus',                 label: '5+ Bedroom Housing Units',               acs: 'B25041_007E', group: 'bedrooms' },

  // ── Owner / renter household income (B25118) ─────────────────────
  { field: 'oi_lt_5k',                  label: 'Owner Income <$5K',                      acs: 'B25118_003E', group: 'owner_income' },
  { field: 'oi_5_10k',                  label: 'Owner Income $5-10K',                    acs: 'B25118_004E', group: 'owner_income' },
  { field: 'oi_10_15k',                 label: 'Owner Income $10-15K',                   acs: 'B25118_005E', group: 'owner_income' },
  { field: 'oi_15_20k',                 label: 'Owner Income $15-20K',                   acs: 'B25118_006E', group: 'owner_income' },
  { field: 'oi_20_25k',                 label: 'Owner Income $20-25K',                   acs: 'B25118_007E', group: 'owner_income' },
  { field: 'oi_25_35k',                 label: 'Owner Income $25-35K',                   acs: 'B25118_008E', group: 'owner_income' },
  { field: 'oi_35_50k',                 label: 'Owner Income $35-50K',                   acs: 'B25118_009E', group: 'owner_income' },
  { field: 'oi_50_75k',                 label: 'Owner Income $50-75K',                   acs: 'B25118_010E', group: 'owner_income' },
  { field: 'oi_75_100k',                label: 'Owner Income $75-100K',                  acs: 'B25118_011E', group: 'owner_income' },
  { field: 'oi_100_150k',               label: 'Owner Income $100-150K',                 acs: 'B25118_012E', group: 'owner_income' },
  { field: 'oi_150k_plus',              label: 'Owner Income $150K+',                    acs: 'B25118_013E', group: 'owner_income' },
  { field: 'ri_lt_5k',                  label: 'Renter Income <$5K',                     acs: 'B25118_015E', group: 'renter_income' },
  { field: 'ri_5_10k',                  label: 'Renter Income $5-10K',                   acs: 'B25118_016E', group: 'renter_income' },
  { field: 'ri_10_15k',                 label: 'Renter Income $10-15K',                  acs: 'B25118_017E', group: 'renter_income' },
  { field: 'ri_15_20k',                 label: 'Renter Income $15-20K',                  acs: 'B25118_018E', group: 'renter_income' },
  { field: 'ri_20_25k',                 label: 'Renter Income $20-25K',                  acs: 'B25118_019E', group: 'renter_income' },
  { field: 'ri_25_35k',                 label: 'Renter Income $25-35K',                  acs: 'B25118_020E', group: 'renter_income' },
  { field: 'ri_35_50k',                 label: 'Renter Income $35-50K',                  acs: 'B25118_021E', group: 'renter_income' },
  { field: 'ri_50_75k',                 label: 'Renter Income $50-75K',                  acs: 'B25118_022E', group: 'renter_income' },
  { field: 'ri_75_100k',                label: 'Renter Income $75-100K',                 acs: 'B25118_023E', group: 'renter_income' },
  { field: 'ri_100_150k',               label: 'Renter Income $100-150K',                acs: 'B25118_024E', group: 'renter_income' },
  { field: 'ri_150k_plus',              label: 'Renter Income $150K+',                   acs: 'B25118_025E', group: 'renter_income' },

  // ── Renter / Owner age (S2502) ───────────────────────────────────
  { field: 'renter_age_under35',        label: 'Renters — Under 35',                     acs: 'S2502_C05_011E', group: 'tenure_age' },
  { field: 'renter_age_35_44',          label: 'Renters — 35–44',                        acs: 'S2502_C05_012E', group: 'tenure_age' },
  { field: 'renter_age_45_54',          label: 'Renters — 45–54',                        acs: 'S2502_C05_013E', group: 'tenure_age' },
  { field: 'renter_age_55_64',          label: 'Renters — 55–64',                        acs: 'S2502_C05_014E', group: 'tenure_age' },
  { field: 'renter_age_65_74',          label: 'Renters — 65–74',                        acs: 'S2502_C05_015E', group: 'tenure_age' },
  { field: 'renter_age_75_84',          label: 'Renters — 75–84',                        acs: 'S2502_C05_016E', group: 'tenure_age' },
  { field: 'renter_age_85_plus',        label: 'Renters — 85+',                          acs: 'S2502_C05_017E', group: 'tenure_age' },
  { field: 'owner_age_under35',         label: 'Owners — Under 35',                      acs: 'S2502_C03_011E', group: 'tenure_age' },
  { field: 'owner_age_35_44',           label: 'Owners — 35–44',                         acs: 'S2502_C03_012E', group: 'tenure_age' },
  { field: 'owner_age_45_54',           label: 'Owners — 45–54',                         acs: 'S2502_C03_013E', group: 'tenure_age' },
  { field: 'owner_age_55_64',           label: 'Owners — 55–64',                         acs: 'S2502_C03_014E', group: 'tenure_age' },
  { field: 'owner_age_65_74',           label: 'Owners — 65–74',                         acs: 'S2502_C03_015E', group: 'tenure_age' },
  { field: 'owner_age_75_84',           label: 'Owners — 75–84',                         acs: 'S2502_C03_016E', group: 'tenure_age' },
  { field: 'owner_age_85_plus',         label: 'Owners — 85+',                           acs: 'S2502_C03_017E', group: 'tenure_age' },
];

/**
 * Build a quick lookup from ACS code → field name.
 */
export const ACS_TO_FIELD = Object.fromEntries(
  VARIABLES
    .filter(v => v.acs && v.acs !== 'DERIVED')
    .map(v => [v.acs, v.field])
);

/**
 * Excel column → field name. Rebuilt by build-data.mjs at runtime by walking
 * the spreadsheet's row 12 and looking up each ACS code in ACS_TO_FIELD.
 */

/**
 * Components used for the coarse monthly-housing-cost buckets:
 *   $0–$499  = sum of B25104_002..006
 *   $500–$999 = sum of B25104_007..011
 */
export const MHC_COMPONENTS = {
  mhc_lt_500:  ['B25104_002E', 'B25104_003E', 'B25104_004E', 'B25104_005E', 'B25104_006E'],
  mhc_500_999: ['B25104_007E', 'B25104_008E', 'B25104_009E', 'B25104_010E', 'B25104_011E'],
};
