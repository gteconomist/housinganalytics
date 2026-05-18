// Metric metadata for the Rankings page.
//
// Every field in this list becomes a sortable column on /rankings. Each entry
// supplies:
//   - field:  the property name on a county JSON object
//   - label:  the dropdown label and table column header
//   - group:  optgroup heading (groups related metrics in the picker)
//   - format: 'money' | 'pct' | 'count' | 'ratio' | 'year'
//   - source: short citation, e.g. "ACS 2024, DP04"
//
// Built by merging:
//   1. Raw spreadsheet fields from variable-map.js (most have group already)
//   2. Derived fields computed in build-data.mjs (rates, ratios, shares)
//   3. Land-area + density from gazetteer integration
//   4. HUD AMI integration (one selected band — 4-person, 100%)
//
// When a new field is added to variable-map.js, add a corresponding entry
// here so it shows up in the Rankings picker. Otherwise the Rankings build
// will silently drop fields it doesn't know how to format.

/** @typedef {{ field: string, label: string, group: string, format: 'money'|'pct'|'count'|'ratio'|'year', source: string }} MetricDef */

/** @type {MetricDef[]} */
export const METRICS = [
  // ─── Headline KPIs ────────────────────────────────────────────────
  { field: 'population_total',           label: 'Population',                              group: 'Headline',  format: 'count', source: 'ACS 2024, B01003' },
  { field: 'population_density',         label: 'Population density (per sq. mi.)',        group: 'Headline',  format: 'ratio', source: 'ACS 2024 + Census Gazetteer' },
  { field: 'land_area_sqmi',             label: 'Land area (sq. mi.)',                     group: 'Headline',  format: 'count', source: 'Census Gazetteer' },
  { field: 'hh_income_median',           label: 'Median household income',                 group: 'Headline',  format: 'money', source: 'ACS 2024, S1901' },
  { field: 'value_median',               label: 'Median home value',                       group: 'Headline',  format: 'money', source: 'ACS 2024, DP04' },
  { field: 'rent_median',                label: 'Median gross rent',                       group: 'Headline',  format: 'money', source: 'ACS 2024, B25031' },
  { field: 'homeownership_rate',         label: 'Homeownership rate',                      group: 'Headline',  format: 'pct',   source: 'ACS 2024, DP04 (derived)' },
  { field: 'renter_rate',                label: 'Renter rate',                             group: 'Headline',  format: 'pct',   source: 'ACS 2024, DP04 (derived)' },
  { field: 'vacancy_rate',               label: 'Vacancy rate',                            group: 'Headline',  format: 'pct',   source: 'ACS 2024, B25002 (derived)' },

  // ─── Affordability & burden ───────────────────────────────────────
  { field: 'price_to_income_ratio',         label: 'Price-to-income ratio',                 group: 'Affordability', format: 'ratio', source: 'ACS 2024 (derived)' },
  { field: 'rent_to_income_ratio',          label: 'Rent-to-income ratio',                  group: 'Affordability', format: 'ratio', source: 'ACS 2024 (derived)' },
  { field: 'renter_cost_burden_rate',       label: 'Renter cost burden (30%+ of income)',   group: 'Affordability', format: 'pct',   source: 'ACS 2024, B25070 (derived)' },
  { field: 'renter_severe_cost_burden_rate',label: 'Renter severe cost burden (50%+)',      group: 'Affordability', format: 'pct',   source: 'ACS 2024, B25070 (derived)' },
  { field: 'owner_cost_burden_rate',        label: 'Owner cost burden (30%+ of income)',    group: 'Affordability', format: 'pct',   source: 'ACS 2024, B25106 (derived)' },

  // ─── HUD Area Median Income ───────────────────────────────────────
  { field: 'hud_ami_4p_100',             label: 'HUD AMI — 4-person, 100%',                group: 'HUD AMI', format: 'money', source: 'HUD FY2026 Income Limits' },
  { field: 'hud_ami_4p_80',              label: 'HUD AMI — 4-person, 80%',                 group: 'HUD AMI', format: 'money', source: 'HUD FY2026 Income Limits' },
  { field: 'hud_ami_4p_120',             label: 'HUD AMI — 4-person, 120%',                group: 'HUD AMI', format: 'money', source: 'HUD FY2026 Income Limits' },

  // ─── Income ───────────────────────────────────────────────────────
  { field: 'hh_income_mean',             label: 'Mean household income',                   group: 'Income',  format: 'money', source: 'ACS 2024, S1901' },
  { field: 'per_capita_income',          label: 'Per-capita income',                       group: 'Income',  format: 'money', source: 'ACS 2024, DP03' },
  { field: 'poverty_rate',               label: 'Poverty rate',                            group: 'Income',  format: 'pct',   source: 'ACS 2024, S1701' },
  { field: 'income_median_owner',        label: 'Median income — owner-occupied',          group: 'Income',  format: 'money', source: 'ACS 2024, B25119' },
  { field: 'income_median_renter',       label: 'Median income — renter-occupied',         group: 'Income',  format: 'money', source: 'ACS 2024, B25119' },
  { field: 'income_median_under25',      label: 'Median income — householder under 25',    group: 'Income',  format: 'money', source: 'ACS 2024, B19049' },
  { field: 'income_median_25_44',        label: 'Median income — householder 25–44',       group: 'Income',  format: 'money', source: 'ACS 2024, B19049' },
  { field: 'income_median_45_64',        label: 'Median income — householder 45–64',       group: 'Income',  format: 'money', source: 'ACS 2024, B19049' },
  { field: 'income_median_65_plus',      label: 'Median income — householder 65+',         group: 'Income',  format: 'money', source: 'ACS 2024, B19049' },
  { field: 'earners_0_income',           label: 'Median income — no-earner HH',            group: 'Income',  format: 'money', source: 'ACS 2024, S1903' },
  { field: 'earners_1_income',           label: 'Median income — 1-earner HH',             group: 'Income',  format: 'money', source: 'ACS 2024, S1903' },
  { field: 'earners_2_income',           label: 'Median income — 2-earner HH',             group: 'Income',  format: 'money', source: 'ACS 2024, S1903' },
  { field: 'earners_3_plus_income',      label: 'Median income — 3+ earner HH',            group: 'Income',  format: 'money', source: 'ACS 2024, S1903' },
  { field: 'earners_nonfamily_income',   label: 'Median income — non-family HH',           group: 'Income',  format: 'money', source: 'ACS 2024, S1903' },

  // ─── Housing stock — structure type ───────────────────────────────
  { field: 'units_total',                label: 'Total housing units',                     group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'units_occupied',             label: 'Occupied units',                          group: 'Stock',   format: 'count', source: 'ACS 2024, B25002' },
  { field: 'units_vacant',               label: 'Vacant units',                            group: 'Stock',   format: 'count', source: 'ACS 2024, B25002' },
  { field: 'homeowner_vacancy_rate',     label: 'Homeowner vacancy rate',                  group: 'Stock',   format: 'pct',   source: 'ACS 2024, DP04' },
  { field: 'rental_vacancy_rate',        label: 'Rental vacancy rate',                     group: 'Stock',   format: 'pct',   source: 'ACS 2024, DP04' },
  { field: 'single_family_share',        label: 'Single-family share',                     group: 'Stock',   format: 'pct',   source: 'ACS 2024, B25024 (derived)' },
  { field: 'missing_middle_share',       label: 'Missing middle (2–19 units) share',       group: 'Stock',   format: 'pct',   source: 'ACS 2024, B25024 (derived)' },
  { field: 'aging_stock_share',          label: 'Aging stock (built before 1980)',         group: 'Stock',   format: 'pct',   source: 'ACS 2024, S2504 (derived)' },
  { field: 'structure_median_age',       label: 'Median structure year built',             group: 'Stock',   format: 'year',  source: 'ACS 2024, B25035' },
  { field: 'structure_1_detached',       label: '1, Detached',                             group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_1_attached',       label: '1, Attached',                             group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_2',                label: '2 Units',                                 group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_3_4',              label: '3–4 Units',                               group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_5_9',              label: '5–9 Units',                               group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_10_19',            label: '10–19 Units',                             group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_20_49',            label: '20–49 Units',                             group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_50_plus',          label: '50+ Units',                               group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_mobile',           label: 'Mobile homes',                            group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },
  { field: 'structure_other',            label: 'Boat / RV / Van',                         group: 'Stock',   format: 'count', source: 'ACS 2024, B25024' },

  // ─── Year built ───────────────────────────────────────────────────
  { field: 'year_built_2020_plus',       label: 'Units built 2020+',                       group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_2010_19',         label: 'Units built 2010–19',                     group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_2000_09',         label: 'Units built 2000–09',                     group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_1980_99',         label: 'Units built 1980–99',                     group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_1960_79',         label: 'Units built 1960–79',                     group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_1940_59',         label: 'Units built 1940–59',                     group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },
  { field: 'year_built_1939_earlier',    label: 'Units built 1939 or earlier',             group: 'Year built', format: 'count', source: 'ACS 2024, S2504' },

  // ─── Home value distribution ──────────────────────────────────────
  { field: 'value_lt_50k',               label: 'Homes valued <$50K',                      group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_50_99k',               label: 'Homes valued $50K–$99K',                  group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_100_150k',             label: 'Homes valued $100K–$150K',                group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_150_200k',             label: 'Homes valued $150K–$200K',                group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_200_300k',             label: 'Homes valued $200K–$300K',                group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_300_500k',             label: 'Homes valued $300K–$500K',                group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_500_1m',               label: 'Homes valued $500K–$1M',                  group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },
  { field: 'value_1m_plus',              label: 'Homes valued $1M+',                       group: 'Home values', format: 'count', source: 'ACS 2024, DP04' },

  // ─── Mortgage ─────────────────────────────────────────────────────
  { field: 'mortgage_total',             label: 'Owner-occupied with mortgage',            group: 'Mortgage', format: 'count', source: 'ACS 2024, S2506' },
  { field: 'mortgage_median',            label: 'Median value — mortgaged units',          group: 'Mortgage', format: 'money', source: 'ACS 2024, S2506' },

  // ─── Rent by bedrooms ─────────────────────────────────────────────
  { field: 'rent_median_0br',            label: 'Median rent — studio',                    group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },
  { field: 'rent_median_1br',            label: 'Median rent — 1 BR',                      group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },
  { field: 'rent_median_2br',            label: 'Median rent — 2 BR',                      group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },
  { field: 'rent_median_3br',            label: 'Median rent — 3 BR',                      group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },
  { field: 'rent_median_4br',            label: 'Median rent — 4 BR',                      group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },
  { field: 'rent_median_5br',            label: 'Median rent — 5+ BR',                     group: 'Rent',    format: 'money', source: 'ACS 2024, B25031' },

  // ─── Bedrooms (count of units) ────────────────────────────────────
  { field: 'br_0',                       label: 'Studio units',                            group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },
  { field: 'br_1',                       label: '1 BR units',                              group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },
  { field: 'br_2',                       label: '2 BR units',                              group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },
  { field: 'br_3',                       label: '3 BR units',                              group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },
  { field: 'br_4',                       label: '4 BR units',                              group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },
  { field: 'br_5_plus',                  label: '5+ BR units',                             group: 'Bedrooms', format: 'count', source: 'ACS 2024, B25041' },

  // ─── Tenure ───────────────────────────────────────────────────────
  { field: 'tenure_total_occupied',      label: 'Occupied units (tenure)',                 group: 'Tenure',  format: 'count', source: 'ACS 2024, DP04' },
  { field: 'tenure_owner_occupied',      label: 'Owner-occupied units',                    group: 'Tenure',  format: 'count', source: 'ACS 2024, DP04' },
  { field: 'tenure_renter_occupied',     label: 'Renter-occupied units',                   group: 'Tenure',  format: 'count', source: 'ACS 2024, DP04' },

  // ─── Owner & renter ages ──────────────────────────────────────────
  { field: 'owner_age_under35',          label: 'Owners — under 35',                       group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_35_44',            label: 'Owners — 35–44',                          group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_45_54',            label: 'Owners — 45–54',                          group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_55_64',            label: 'Owners — 55–64',                          group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_65_74',            label: 'Owners — 65–74',                          group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_75_84',            label: 'Owners — 75–84',                          group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'owner_age_85_plus',          label: 'Owners — 85+',                            group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_under35',         label: 'Renters — under 35',                      group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_35_44',           label: 'Renters — 35–44',                         group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_45_54',           label: 'Renters — 45–54',                         group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_55_64',           label: 'Renters — 55–64',                         group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_65_74',           label: 'Renters — 65–74',                         group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_75_84',           label: 'Renters — 75–84',                         group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },
  { field: 'renter_age_85_plus',         label: 'Renters — 85+',                           group: 'Tenure × age', format: 'count', source: 'ACS 2024, S2502' },

  // ─── Households ───────────────────────────────────────────────────
  { field: 'hh_total_s1101',             label: 'Households',                              group: 'Households', format: 'count', source: 'ACS 2024, S1101' },
  { field: 'hh_avg_size',                label: 'Average household size',                  group: 'Households', format: 'ratio', source: 'ACS 2024, S1101' },
  { field: 'hh_with_children',           label: 'Households with children',                group: 'Households', format: 'count', source: 'ACS 2024, S1101' },
  { field: 'hh_size_1',                  label: '1-person households',                     group: 'Households', format: 'count', source: 'ACS 2024, S2501' },
  { field: 'hh_size_2',                  label: '2-person households',                     group: 'Households', format: 'count', source: 'ACS 2024, S2501' },
  { field: 'hh_size_3',                  label: '3-person households',                     group: 'Households', format: 'count', source: 'ACS 2024, S2501' },
  { field: 'hh_size_4_plus',             label: '4+ person households',                    group: 'Households', format: 'count', source: 'ACS 2024, S2501' },
  { field: 'earners_0',                  label: 'No-earner households',                    group: 'Households', format: 'count', source: 'ACS 2024, S1903' },
  { field: 'earners_1',                  label: '1-earner households',                     group: 'Households', format: 'count', source: 'ACS 2024, S1903' },
  { field: 'earners_2',                  label: '2-earner households',                     group: 'Households', format: 'count', source: 'ACS 2024, S1903' },
  { field: 'earners_3_plus',             label: '3+ earner households',                    group: 'Households', format: 'count', source: 'ACS 2024, S1903' },
  { field: 'earners_nonfamily',          label: 'Non-family households',                   group: 'Households', format: 'count', source: 'ACS 2024, S1903' },

  // ─── Monthly housing cost distribution ────────────────────────────
  { field: 'mhc_lt_500',                 label: 'Monthly housing cost <$500',              group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_500_999',                label: 'Monthly housing cost $500–$999',          group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_1000_1499',              label: 'Monthly housing cost $1,000–$1,499',      group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_1500_1999',              label: 'Monthly housing cost $1,500–$1,999',      group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_2000_2499',              label: 'Monthly housing cost $2,000–$2,499',      group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_2500_2999',              label: 'Monthly housing cost $2,500–$2,999',      group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_3000_plus',              label: 'Monthly housing cost $3,000+',            group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },
  { field: 'mhc_no_cash_rent',           label: 'No cash rent',                            group: 'Monthly cost', format: 'count', source: 'ACS 2024, B25104' },

  // ─── Renter cost burden (B25070, raw bucket counts) ───────────────
  { field: 'rent_burden_total',          label: 'Renter households (cost burden universe)', group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_lt_10',          label: 'Rent <10% of income',                     group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_10_14',          label: 'Rent 10–14.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_15_19',          label: 'Rent 15–19.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_20_24',          label: 'Rent 20–24.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_25_29',          label: 'Rent 25–29.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_30_34',          label: 'Rent 30–34.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_35_39',          label: 'Rent 35–39.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_40_49',          label: 'Rent 40–49.9%',                           group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_50_plus',        label: 'Rent 50%+',                               group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },
  { field: 'rent_burden_not_computed',   label: 'Rent burden not computed',                group: 'Rent burden', format: 'count', source: 'ACS 2024, B25070' },

  // ─── Owner cost burden cross-tab (B25106) ─────────────────────────
  { field: 'cb_owner_total',             label: 'Owner cost burden — universe',            group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_30_plus_lt20k',     label: 'Owner 30%+ — income <$20K',               group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_30_plus_20_35k',    label: 'Owner 30%+ — income $20–35K',             group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_30_plus_35_50k',    label: 'Owner 30%+ — income $35–50K',             group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_30_plus_50_75k',    label: 'Owner 30%+ — income $50–75K',             group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_30_plus_75k_plus',  label: 'Owner 30%+ — income $75K+',               group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_owner_zero_negative',     label: 'Owner — zero / negative income',          group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_renter_total',            label: 'Renter cost burden — universe',           group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },
  { field: 'cb_renter_no_cash',          label: 'Renter — no cash rent',                   group: 'Owner cost burden', format: 'count', source: 'ACS 2024, B25106' },

  // ─── Owner income distribution (B25118) ───────────────────────────
  { field: 'oi_lt_5k',                   label: 'Owner income <$5K',                       group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_5_10k',                   label: 'Owner income $5–10K',                     group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_10_15k',                  label: 'Owner income $10–15K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_15_20k',                  label: 'Owner income $15–20K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_20_25k',                  label: 'Owner income $20–25K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_25_35k',                  label: 'Owner income $25–35K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_35_50k',                  label: 'Owner income $35–50K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_50_75k',                  label: 'Owner income $50–75K',                    group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_75_100k',                 label: 'Owner income $75–100K',                   group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_100_150k',                label: 'Owner income $100–150K',                  group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },
  { field: 'oi_150k_plus',               label: 'Owner income $150K+',                     group: 'Owner income',  format: 'count', source: 'ACS 2024, B25118' },

  // ─── Renter income distribution (B25118) ──────────────────────────
  { field: 'ri_lt_5k',                   label: 'Renter income <$5K',                      group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_5_10k',                   label: 'Renter income $5–10K',                    group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_10_15k',                  label: 'Renter income $10–15K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_15_20k',                  label: 'Renter income $15–20K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_20_25k',                  label: 'Renter income $20–25K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_25_35k',                  label: 'Renter income $25–35K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_35_50k',                  label: 'Renter income $35–50K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_50_75k',                  label: 'Renter income $50–75K',                   group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_75_100k',                 label: 'Renter income $75–100K',                  group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_100_150k',                label: 'Renter income $100–150K',                 group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },
  { field: 'ri_150k_plus',               label: 'Renter income $150K+',                    group: 'Renter income', format: 'count', source: 'ACS 2024, B25118' },

  // ─── Education ────────────────────────────────────────────────────
  { field: 'bachelors_plus_rate',        label: "Bachelor's degree or higher",             group: 'Education', format: 'pct',   source: 'ACS 2024, S1501 (derived)' },
  { field: 'edu_lt_9th',                 label: 'Less than 9th grade',                     group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_9_12_no_diploma',        label: '9–12, no diploma',                        group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_hs_grad',                label: 'High school graduate',                    group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_some_college',           label: 'Some college, no degree',                 group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_associates',             label: "Associate's degree",                      group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_bachelors',              label: "Bachelor's degree",                       group: 'Education', format: 'count', source: 'ACS 2024, S1501' },
  { field: 'edu_graduate',               label: 'Graduate / professional degree',          group: 'Education', format: 'count', source: 'ACS 2024, S1501' },

  // ─── Demographics ─────────────────────────────────────────────────
  { field: 'median_age',                 label: 'Median age',                              group: 'Demographics', format: 'ratio', source: 'ACS 2024, DP05' },
  { field: 'race_white',                 label: 'Race — White',                            group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_black',                 label: 'Race — Black',                            group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_aian',                  label: 'Race — AIAN',                             group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_asian',                 label: 'Race — Asian',                            group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_nhpi',                  label: 'Race — NHPI',                             group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_other',                 label: 'Race — Other',                            group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
  { field: 'race_two_plus',              label: 'Race — Two or more',                      group: 'Demographics', format: 'count', source: 'ACS 2024, DP05' },
];

/**
 * Field name → metric definition.
 */
export const METRIC_BY_FIELD = Object.fromEntries(METRICS.map(m => [m.field, m]));

/**
 * Group ordering for the picker (so headings appear in a useful order).
 */
export const METRIC_GROUPS = [
  'Headline',
  'Affordability',
  'HUD AMI',
  'Income',
  'Stock',
  'Home values',
  'Mortgage',
  'Rent',
  'Year built',
  'Bedrooms',
  'Tenure',
  'Tenure × age',
  'Households',
  'Monthly cost',
  'Rent burden',
  'Owner cost burden',
  'Owner income',
  'Renter income',
  'Education',
  'Demographics',
];

/**
 * Population-tier buckets, ordered. The build script tags every county with
 * one of these tiers so the Rankings page can filter without re-bucketing.
 */
export const POP_TIERS = [
  { key: 'small',  label: 'Small (<10K)',           min: 0,        max: 10000 },
  { key: 'mid',    label: 'Mid-sized (10K–50K)',    min: 10000,    max: 50000 },
  { key: 'large',  label: 'Large (50K–250K)',       min: 50000,    max: 250000 },
  { key: 'major',  label: 'Major (250K–1M)',        min: 250000,   max: 1000000 },
  { key: 'metro',  label: 'Metro (1M+)',            min: 1000000,  max: Infinity },
];

export function tierForPop(pop) {
  if (pop == null) return null;
  for (const t of POP_TIERS) {
    if (pop >= t.min && pop < t.max) return t.key;
  }
  return null;
}
