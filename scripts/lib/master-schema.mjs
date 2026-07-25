// master-schema.mjs — the tab/section/field layout of the Master Sheet's
// core-ACS tabs. Pure data (no dependencies) so both the xlsx writer
// (build-master-xlsx.mjs) and the data generator (build-master-geo.mjs) can
// import it without pulling in SheetJS.
export const TABS = [
  { name: 'Community Profile', sections: [
    { title: 'Age Distribution (population by cohort)', source: 'ACS 5-Year, U.S. Census Bureau table B01001',
      fields: ['age_under18', 'age_18_24', 'age_25_44', 'age_45_64', 'age_65_plus'] },
    { title: 'Median Age', source: 'ACS 5-Year, table B01002',
      fields: ['median_age', 'median_age_male', 'median_age_female'] },
    { title: 'Race / Ethnicity (share of total population)', source: 'ACS 5-Year, table B03002. NH = not Hispanic/Latino. "Other NH" = AIAN + NHPI + some-other-race NH.',
      fields: ['race_white_nh', 'race_black_nh', 'race_asian_nh', 'race_other_nh', 'race_two_plus_nh', 'race_hispanic'] },
    { title: 'Per Capita Income', source: 'ACS 5-Year, table B19301. (On the original sheet this block was labeled "MHI" but the values are per-capita income; median household income is on the Labor Force tab.)',
      fields: ['per_capita_income'] },
  ]},
  { name: 'Labor Force', sections: [
    { title: 'Median Household Income (overall and by tenure)', source: 'ACS 5-Year, tables B19013 (overall) and B25119 (by tenure)',
      fields: ['median_hh_income', 'mhi_owner', 'mhi_renter'] },
    { title: 'Unemployment Rate', source: 'ACS 5-Year, table B23025 (unemployed / civilian labor force)',
      fields: ['unemployment_rate'] },
    { title: 'Labor Force Participation Rate', source: 'ACS 5-Year, table B23025 (in labor force / population 16+)',
      fields: ['labor_force_participation'] },
    // Cross-tab section (kind:'matrix'): age cohort (rows) × income band (cols),
    // values = share of households within each cohort (rows sum to 100%). Single
    // vintage. Field ids reconstructed as `incage_<cohort.id>_<bucketIndex>`.
    { title: 'Income by Age Cohort', kind: 'matrix', vintage: 2024,
      source: 'ACS 5-Year, U.S. Census Bureau table B19037. Each value is the share of an age cohort’s households in that income band (rows sum to 100%). Shown for 2024 (2020–2024 ACS 5-Year).',
      cohorts: [
        { id: 'u25',   label: 'Under 25' },
        { id: 'a2544', label: '25-44' },
        { id: 'a4564', label: '45-64' },
        { id: 'a65p',  label: '65+' },
      ],
      buckets: [
        { label: '<$25,000' }, { label: '$25,000-$49,999' }, { label: '$50,000-$74,999' },
        { label: '$75,000-$99,999' }, { label: '$100,000+' },
      ] },
  ]},
  { name: 'Quality of Life', sections: [
    { title: 'Educational Attainment (population 25+, cumulative)', source: 'ACS 5-Year, table B15003. Columns are cumulative ("or higher"), matching the original sheet. "Graduate/Professional" is what the original sheet placed in its "Bachelor\'s+" column.',
      fields: ['edu_less_than_hs', 'edu_hs_or_higher', 'edu_some_college_or_higher', 'edu_bachelors_or_higher', 'edu_graduate_or_prof'] },
    { title: 'High School Status, Ages 16–19', source: 'ACS 5-Year, table B14005. Dropout = not enrolled and not a high-school graduate.',
      fields: ['dropout_16_19', 'hs_grad_or_enrolled_16_19'] },
  ]},
  { name: 'Housing', sections: [
    { title: 'Tenure (occupied units)', source: 'ACS 5-Year, table B25003',
      fields: ['occupied_units', 'owner_occupied', 'renter_occupied'] },
    { title: 'Household Size', source: 'ACS 5-Year, table B25009 (owner + renter)',
      fields: ['hh_1person', 'hh_2person', 'hh_3person', 'hh_4person', 'hh_5plus'] },
    { title: 'Median Home Value', source: 'ACS 5-Year, table B25077',
      fields: ['median_home_value'] },
    { title: 'Median Gross Rent (overall and by bedroom)', source: 'ACS 5-Year, tables B25064 (overall) and B25031 (by bedroom). Blank = ACS suppressed (insufficient sample).',
      fields: ['median_gross_rent', 'rent_no_bedroom', 'rent_1br', 'rent_2br', 'rent_3br', 'rent_4br', 'rent_5plus_br'] },
    { title: 'Vacancy', source: 'ACS 5-Year, table B25004. "Other Vacant" = total vacant − for-rent − for-sale-only (matches original sheet).',
      fields: ['vacant_total', 'vacant_for_rent', 'vacant_for_sale', 'vacant_other', 'homeowner_vacancy_rate', 'rental_vacancy_rate'] },
    { title: 'Units in Structure', source: 'ACS 5-Year, table B25024',
      fields: ['total_housing_units', 'structure_1_detached', 'structure_1_attached', 'structure_2', 'structure_3_4', 'structure_5_9', 'structure_10_19', 'structure_20_49', 'structure_50_plus', 'structure_mobile', 'structure_boat_rv'] },
  ]},
];
