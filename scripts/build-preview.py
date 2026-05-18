#!/usr/bin/env python3
"""
build-preview.py
────────────────
Generates a single self-contained HTML file (preview/muscogee-county.html)
that renders the same layout as the Astro County Profile page, but with the
county data embedded inline so it can be opened directly from the filesystem.

This exists so the user can review the design and chart choices without
needing to run a build server. Once approved, the Astro version takes over
on GitHub Pages.
"""
import json
from pathlib import Path

import os

ROOT       = Path(__file__).resolve().parents[1]
# County FIPS can be set via PREVIEW_COUNTY env var; defaults to Muscogee.
COUNTY     = os.environ.get('PREVIEW_COUNTY', '13215')
SRC_TOKENS = ROOT / 'src' / 'styles' / 'tokens.css'
SRC_FORMAT = ROOT / 'src' / 'lib' / 'format.js'
COUNTY_FILE = ROOT / 'src' / 'data' / 'generated' / 'counties' / f'{COUNTY}.json'
OUT_DIR    = ROOT / 'preview'

tokens_css   = SRC_TOKENS.read_text()
county       = json.loads(COUNTY_FILE.read_text())
state        = county['_context']['state']
national     = county['_context']['national']

# Build a filename like "13215-muscogee-county.html"
_slug      = county['county_name'].lower().replace(' ', '-').replace(',', '')
OUT_FILE   = OUT_DIR / f'{COUNTY}-{_slug}.html'


def fmt_money(v):
    if v is None: return '—'
    return '${:,.0f}'.format(v)
def fmt_int(v):
    if v is None: return '—'
    return '{:,.0f}'.format(v)
def fmt_pct(v):
    if v is None: return '—'
    return '{:.1f}%'.format(v)
def fmt_ratio(v):
    if v is None: return '—'
    return '{:.2f}'.format(v)


def pct(part, whole):
    if part is None or whole is None or whole == 0: return 0
    return (part / whole) * 100


tot_units    = county.get('units_total') or 0
tot_occupied = county.get('tenure_total_occupied') or 0
tot_pop      = county.get('population_total') or 0

mhi          = county.get('hh_income_median')
workforce_low  = mhi * 0.80 if mhi else None
workforce_high = mhi * 1.20 if mhi else None


def race_share(field):
    return pct(county.get(field), tot_pop)


chart_data = {
    'race': {
        'labels': ['White', 'Black', 'Asian', 'Two or more', 'Other / NHPI / AIAN'],
        'county': [
            race_share('race_white'),
            race_share('race_black'),
            race_share('race_asian'),
            race_share('race_two_plus'),
            race_share('race_other') + race_share('race_aian') + race_share('race_nhpi'),
        ],
    },
    'tenure': {
        'labels': ['Owner-occupied', 'Renter-occupied'],
        'values': [
            pct(county.get('tenure_owner_occupied'), tot_occupied),
            pct(county.get('tenure_renter_occupied'), tot_occupied),
        ],
    },
    'structure': {
        'labels': ['SFD', 'SFA', '2 units', '3-4', '5-9', '10-19', '20-49', '50+', 'Mobile', 'Other'],
        'values': [
            pct(county.get('structure_1_detached'), tot_units),
            pct(county.get('structure_1_attached'), tot_units),
            pct(county.get('structure_2'),          tot_units),
            pct(county.get('structure_3_4'),        tot_units),
            pct(county.get('structure_5_9'),        tot_units),
            pct(county.get('structure_10_19'),      tot_units),
            pct(county.get('structure_20_49'),      tot_units),
            pct(county.get('structure_50_plus'),    tot_units),
            pct(county.get('structure_mobile'),     tot_units),
            pct(county.get('structure_other'),      tot_units),
        ],
    },
    'yearBuilt': {
        'labels': ['Pre-1940', '1940-59', '1960-79', '1980-99', '2000-09', '2010-19', '2020+'],
        'values': [
            county.get('year_built_1939_earlier'),
            county.get('year_built_1940_59'),
            county.get('year_built_1960_79'),
            county.get('year_built_1980_99'),
            county.get('year_built_2000_09'),
            county.get('year_built_2010_19'),
            county.get('year_built_2020_plus'),
        ],
    },
    'bedrooms': {
        'units': [
            county.get('br_0'), county.get('br_1'), county.get('br_2'),
            county.get('br_3'), county.get('br_4'), county.get('br_5_plus'),
        ],
    },
    'hhSize': {
        'values': [
            county.get('hh_size_1'), county.get('hh_size_2'),
            county.get('hh_size_3'), county.get('hh_size_4_plus'),
        ],
    },
    'homeValue': {
        'labels': ['<$50K', '$50-99K', '$100-150K', '$150-200K', '$200-300K', '$300-500K', '$500K-1M', '$1M+'],
        'values': [
            county.get('value_lt_50k'), county.get('value_50_99k'), county.get('value_100_150k'),
            county.get('value_150_200k'), county.get('value_200_300k'), county.get('value_300_500k'),
            county.get('value_500_1m'), county.get('value_1m_plus'),
        ],
    },
    'rentByBR': {
        'labels': ['Studio', '1 BR', '2 BR', '3 BR', '4 BR', '5+ BR'],
        'values': [
            county.get('rent_median_0br'), county.get('rent_median_1br'),
            county.get('rent_median_2br'), county.get('rent_median_3br'),
            county.get('rent_median_4br'), county.get('rent_median_5br'),
        ],
    },
    'renterBurden': {
        'labels': ['<10%', '10-14%', '15-19%', '20-24%', '25-29%', '30-34%', '35-39%', '40-49%', '50%+'],
        'values': [
            county.get('rent_burden_lt_10'), county.get('rent_burden_10_14'),
            county.get('rent_burden_15_19'), county.get('rent_burden_20_24'),
            county.get('rent_burden_25_29'), county.get('rent_burden_30_34'),
            county.get('rent_burden_35_39'), county.get('rent_burden_40_49'),
            county.get('rent_burden_50_plus'),
        ],
    },
    'ownerBurden': {
        'labels': ['<$20K', '$20-35K', '$35-50K', '$50-75K', '$75K+'],
        'values': [
            county.get('cb_owner_30_plus_lt20k'),  county.get('cb_owner_30_plus_20_35k'),
            county.get('cb_owner_30_plus_35_50k'), county.get('cb_owner_30_plus_50_75k'),
            county.get('cb_owner_30_plus_75k_plus'),
        ],
    },
    'tenureAge': {
        'labels': ['<35', '35-44', '45-54', '55-64', '65-74', '75-84', '85+'],
        'owners': [
            county.get('owner_age_under35'), county.get('owner_age_35_44'),
            county.get('owner_age_45_54'),  county.get('owner_age_55_64'),
            county.get('owner_age_65_74'),  county.get('owner_age_75_84'),
            county.get('owner_age_85_plus'),
        ],
        'renters': [
            county.get('renter_age_under35'), county.get('renter_age_35_44'),
            county.get('renter_age_45_54'),   county.get('renter_age_55_64'),
            county.get('renter_age_65_74'),   county.get('renter_age_75_84'),
            county.get('renter_age_85_plus'),
        ],
    },
    'incomeByTenure': {
        'labels': ['<$5K', '$5-10K', '$10-15K', '$15-20K', '$20-25K', '$25-35K',
                   '$35-50K', '$50-75K', '$75-100K', '$100-150K', '$150K+'],
        'owners': [
            county.get('oi_lt_5k'), county.get('oi_5_10k'), county.get('oi_10_15k'),
            county.get('oi_15_20k'), county.get('oi_20_25k'), county.get('oi_25_35k'),
            county.get('oi_35_50k'), county.get('oi_50_75k'), county.get('oi_75_100k'),
            county.get('oi_100_150k'), county.get('oi_150k_plus'),
        ],
        'renters': [
            county.get('ri_lt_5k'), county.get('ri_5_10k'), county.get('ri_10_15k'),
            county.get('ri_15_20k'), county.get('ri_20_25k'), county.get('ri_25_35k'),
            county.get('ri_35_50k'), county.get('ri_50_75k'), county.get('ri_75_100k'),
            county.get('ri_100_150k'), county.get('ri_150k_plus'),
        ],
    },
    'education': {
        'labels': ['<9th', '9-12', 'HS grad', 'Some col.', 'Assoc.', "Bachelor's", 'Graduate'],
        'values': [
            county.get('edu_lt_9th'), county.get('edu_9_12_no_diploma'),
            county.get('edu_hs_grad'), county.get('edu_some_college'),
            county.get('edu_associates'), county.get('edu_bachelors'),
            county.get('edu_graduate'),
        ],
    },
}

# Format the HTML.  Using triple-quoted string with .format() would conflict
# with literal '{}' in JS, so we just concatenate with f-strings carefully.

html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{county['county_name']}, {county['state_name']} — housinganalytics.org preview</title>
  <link rel="preconnect" href="https://rsms.me/" />
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
  <style>
{tokens_css}

/* Preview-only page styles (mirror of the Astro page) */
.site-header {{
  background: var(--color-navy);
  color: var(--text-on-dark);
  border-bottom: 4px solid var(--color-gold);
}}
.site-header__inner {{
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-5);
}}
.brand {{
  color: var(--text-on-dark); text-decoration: none; font-weight: var(--fw-bold);
  font-size: var(--fs-lg); letter-spacing: -0.02em;
}}
.brand span {{ color: var(--color-gold); }}
.site-nav {{ display: flex; gap: var(--space-5); }}
.site-nav a {{
  color: var(--text-on-dark); text-decoration: none; font-size: var(--fs-sm);
  font-weight: var(--fw-medium); border-bottom: 2px solid transparent; padding-bottom: 2px;
}}
.site-nav a:hover {{ border-bottom-color: var(--color-gold); }}

.county-hero {{
  background: var(--bg-section);
  padding: var(--space-7) 0 var(--space-6);
  border-bottom: 1px solid var(--border-soft);
}}
.county-hero h1 {{ font-size: var(--fs-3xl); margin-bottom: var(--space-2); }}
.county-hero__lede {{ font-size: var(--fs-md); margin-bottom: var(--space-6); }}

.kpis {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}}
.kpi {{
  background: var(--bg-card); border-left: 3px solid var(--color-gold);
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
  box-shadow: var(--shadow-soft);
}}
.kpi__label {{ font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: var(--space-1); }}
.kpi__value {{ font-size: var(--fs-xl); font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }}
.kpi__delta {{ font-size: var(--fs-xs); margin-top: 2px; }}

.report-section {{ padding-top: var(--space-7); }}
.section-head {{ margin-bottom: var(--space-5); }}
.section-head h2 {{ margin-bottom: var(--space-2); }}

.grid {{ display: grid; gap: var(--space-4); margin-bottom: var(--space-4); }}
.grid-2 {{ grid-template-columns: 1fr 1fr; }}
.grid-3 {{ grid-template-columns: repeat(3, 1fr); }}
@media (max-width: 800px) {{ .grid-2, .grid-3 {{ grid-template-columns: 1fr; }} }}

.card {{
  background: var(--bg-card); border: 1px solid var(--border-soft);
  border-radius: var(--radius-md); padding: var(--space-5);
  box-shadow: var(--shadow-soft);
}}
.card h3 {{ font-size: var(--fs-lg); margin-bottom: var(--space-3); }}
.card h4 {{ font-size: var(--fs-md); margin-bottom: var(--space-2); }}
.card figcaption, .card .muted {{ font-size: var(--fs-sm); }}
.big-num {{ font-size: var(--fs-2xl); font-weight: var(--fw-semibold); color: var(--text-primary); margin: 0; font-variant-numeric: tabular-nums; }}

.workforce__bands {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin-bottom: var(--space-4); }}
.workforce__bands > div {{ display: flex; flex-direction: column; gap: var(--space-1); }}
.workforce__bands strong {{ font-size: var(--fs-xl); color: var(--text-primary); }}

.aff-inputs {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3); margin: var(--space-4) 0;
}}
.aff-inputs label {{
  display: flex; flex-direction: column; gap: var(--space-1);
  font-size: var(--fs-sm); color: var(--text-muted);
}}
.aff-inputs input {{
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-muted); border-radius: var(--radius-sm);
  font-family: inherit; font-size: var(--fs-base);
  background: var(--bg-page);
}}
.aff-results {{
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4);
  padding: var(--space-4); background: var(--bg-section); border-radius: var(--radius-sm);
}}
.aff-results strong {{ font-size: var(--fs-2xl); color: var(--text-primary); display: block; }}

.methodology {{ background: var(--bg-section); border-radius: var(--radius-md); padding: var(--space-4) var(--space-5); margin-bottom: var(--space-7); }}
.methodology summary {{ cursor: pointer; font-weight: var(--fw-medium); color: var(--text-primary); }}
.methodology p {{ margin-top: var(--space-3); }}

.site-footer {{
  border-top: 1px solid var(--border-soft); padding: var(--space-7) 0;
  margin-top: var(--space-9); background: var(--bg-section);
}}

canvas {{ max-width: 100%; height: 280px !important; }}

.preview-banner {{
  background: var(--color-amber); color: var(--color-navy);
  text-align: center; padding: var(--space-2); font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}}
  </style>
</head>
<body>
  <div class="preview-banner">
    Preview of housinganalytics.org · {county['county_name']}, {county['state_name']} ·
    self-contained HTML for design review
  </div>

  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="#"><span class="brand__mark">housing<span>analytics</span>.org</span></a>
      <nav class="site-nav">
        <a href="#">Counties</a><a href="#">Compare</a><a href="#">States</a><a href="#">About</a>
      </nav>
    </div>
  </header>

  <main>

    <section class="county-hero">
      <div class="container">
        <p class="eyebrow">{county['state_name']} · GEOID {county['geoid']}</p>
        <h1>{county['county_name']}</h1>
        <p class="county-hero__lede muted">
          2024 ACS 5-year estimates · population {fmt_int(county['population_total'])} ·
          {fmt_int(county['units_total'])} housing units
        </p>

        <div class="kpis">
          <div class="kpi"><div class="kpi__label">Median household income</div>
            <div class="kpi__value">{fmt_money(county['hh_income_median'])}</div>
            <div class="kpi__delta muted">State {fmt_money(state['hh_income_median'])}</div></div>
          <div class="kpi"><div class="kpi__label">Median home value</div>
            <div class="kpi__value">{fmt_money(county['value_median'])}</div>
            <div class="kpi__delta muted">State {fmt_money(state['value_median'])}</div></div>
          <div class="kpi"><div class="kpi__label">Median gross rent</div>
            <div class="kpi__value">{fmt_money(county['rent_median'])}</div>
            <div class="kpi__delta muted">State {fmt_money(state['rent_median'])}</div></div>
          <div class="kpi"><div class="kpi__label">Homeownership rate</div>
            <div class="kpi__value">{fmt_pct(county['homeownership_rate'])}</div>
            <div class="kpi__delta muted">State {fmt_pct(state['homeownership_rate'])}</div></div>
          <div class="kpi"><div class="kpi__label">Renter cost-burden rate</div>
            <div class="kpi__value">{fmt_pct(county['renter_cost_burden_rate'])}</div>
            <div class="kpi__delta muted">&ge;30% of income</div></div>
          <div class="kpi"><div class="kpi__label">Owner cost-burden rate</div>
            <div class="kpi__value">{fmt_pct(county['owner_cost_burden_rate'])}</div>
            <div class="kpi__delta muted">&ge;30% of income</div></div>
          <div class="kpi"><div class="kpi__label">Vacancy rate</div>
            <div class="kpi__value">{fmt_pct(county['vacancy_rate'])}</div>
            <div class="kpi__delta muted">All housing units</div></div>
          <div class="kpi"><div class="kpi__label">Price-to-income ratio</div>
            <div class="kpi__value">{fmt_ratio(county['price_to_income_ratio'])}</div>
            <div class="kpi__delta muted">Affordable: 2.0–3.0</div></div>
        </div>
      </div>
    </section>

    <section class="container report-section">
      <header class="section-head">
        <p class="eyebrow">Section 1</p>
        <h2>Community Profile</h2>
        <p class="muted">Population, demographics, household composition, and income.</p>
      </header>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Racial composition</h3>
          <canvas data-chart="race"></canvas>
          <figcaption class="muted">{county['county_name']} share of total population, by race.</figcaption>
        </figure>
        <figure class="card">
          <h3>Educational attainment (population 25+)</h3>
          <canvas data-chart="education"></canvas>
          <figcaption class="muted">
            {fmt_pct(county['bachelors_plus_rate'])} hold a bachelor's degree or higher
            (state: {fmt_pct(state['bachelors_plus_rate'])}).
          </figcaption>
        </figure>
      </div>

      <div class="grid grid-3">
        <div class="card">
          <h4>Households</h4>
          <p class="big-num">{fmt_int(county['hh_total_s1101'])}</p>
          <p class="muted">Average size: {fmt_ratio(county['hh_avg_size'])} people</p>
        </div>
        <div class="card">
          <h4>Households with children</h4>
          <p class="big-num">{fmt_int(county['hh_with_children'])}</p>
          <p class="muted">{fmt_pct(pct(county.get('hh_with_children'), county.get('hh_total_s1101')))} of households</p>
        </div>
        <div class="card">
          <h4>Per-capita income</h4>
          <p class="big-num">{fmt_money(county['per_capita_income'])}</p>
          <p class="muted">Poverty rate: {fmt_pct(county['poverty_rate'])}</p>
        </div>
      </div>
    </section>

    <section class="container report-section">
      <header class="section-head">
        <p class="eyebrow">Section 2</p>
        <h2>Residential Market Analysis</h2>
        <p class="muted">Housing stock characteristics — tenure, type, age, size, vacancy, rents.</p>
      </header>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Tenure</h3>
          <canvas data-chart="tenure"></canvas>
          <figcaption class="muted">
            {fmt_pct(county['homeownership_rate'])} owner-occupied
            vs. state average {fmt_pct(state['homeownership_rate'])}.
          </figcaption>
        </figure>
        <figure class="card">
          <h3>Structure type</h3>
          <canvas data-chart="structure"></canvas>
          <figcaption class="muted">
            Single-family share {fmt_pct(county['single_family_share'])} ·
            Missing middle (2–19 units) {fmt_pct(county['missing_middle_share'])}.
          </figcaption>
        </figure>
      </div>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Housing stock by decade</h3>
          <canvas data-chart="yearBuilt"></canvas>
          <figcaption class="muted">
            {fmt_pct(county['aging_stock_share'])} built before 1980 ·
            Median structure age {fmt_ratio(county['structure_median_age'])} yrs.
          </figcaption>
        </figure>
        <figure class="card">
          <h3>Housing size mismatch</h3>
          <canvas data-chart="sizeMismatch"></canvas>
          <figcaption class="muted">
            Bedroom distribution vs. household size — a common diagnostic of housing supply/demand alignment.
          </figcaption>
        </figure>
      </div>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Home value distribution</h3>
          <canvas data-chart="homeValue"></canvas>
          <figcaption class="muted">
            Owner-occupied homes by value bracket. Median: {fmt_money(county['value_median'])}.
          </figcaption>
        </figure>
        <figure class="card">
          <h3>Median rent by bedroom</h3>
          <canvas data-chart="rentByBR"></canvas>
          <figcaption class="muted">
            Overall median gross rent: {fmt_money(county['rent_median'])}.
          </figcaption>
        </figure>
      </div>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Renters by age</h3>
          <canvas data-chart="renterAge"></canvas>
          <figcaption class="muted">Number of renter householders by age bracket.</figcaption>
        </figure>
        <figure class="card">
          <h3>Owners by age</h3>
          <canvas data-chart="ownerAge"></canvas>
          <figcaption class="muted">Number of owner householders by age bracket.</figcaption>
        </figure>
      </div>
    </section>

    <section class="container report-section">
      <header class="section-head">
        <p class="eyebrow">Section 3</p>
        <h2>Workforce Housing Needs Assessment</h2>
        <p class="muted">Affordability, cost burden, and housing options in the workforce income range.</p>
      </header>

      <div class="card">
        <h3>Workforce income range (80%–120% of median household income)</h3>
        <div class="workforce__bands">
          <div><span class="muted">80% MHI</span><strong>{fmt_money(workforce_low)}</strong></div>
          <div><span class="muted">100% MHI</span><strong>{fmt_money(mhi)}</strong></div>
          <div><span class="muted">120% MHI</span><strong>{fmt_money(workforce_high)}</strong></div>
        </div>
        <p class="muted">
          A household at 100% MHI in {county['county_name']} should be able to afford a home up to roughly
          <strong id="aff-price-mhi">—</strong>, assuming the standard 30% housing budget.
        </p>
      </div>

      <div class="card">
        <h3>Affordability calculator</h3>
        <p class="muted">Follows the standard 30%-of-gross-income affordability rule.</p>
        <div class="aff-inputs">
          <label>Household income
            <input type="number" id="aff-income" value="{int(mhi or 50000)}" step="1000" min="0" />
          </label>
          <label>Interest rate (%)
            <input type="number" id="aff-rate" value="7.0" step="0.1" min="0" max="20" />
          </label>
          <label>Down payment (%)
            <input type="number" id="aff-down" value="5" step="1" min="0" max="100" />
          </label>
          <label>Taxes &amp; insurance / yr ($)
            <input type="number" id="aff-ti" value="2500" step="100" min="0" />
          </label>
        </div>
        <div class="aff-results">
          <div><span class="muted">Affordable monthly cost</span><strong id="aff-monthly">—</strong></div>
          <div><span class="muted">Affordable home price</span><strong id="aff-price">—</strong></div>
        </div>
      </div>

      <div class="grid grid-2">
        <figure class="card">
          <h3>Renter cost burden</h3>
          <canvas data-chart="renterBurden"></canvas>
          <figcaption class="muted">
            {fmt_pct(county['renter_cost_burden_rate'])} of renter households spend ≥30% of income on rent
            ({fmt_pct(county['renter_severe_cost_burden_rate'])} spend ≥50%).
          </figcaption>
        </figure>
        <figure class="card">
          <h3>Owner cost burden by income</h3>
          <canvas data-chart="ownerBurden"></canvas>
          <figcaption class="muted">
            {fmt_pct(county['owner_cost_burden_rate'])} of homeowners spend ≥30% of income on housing.
          </figcaption>
        </figure>
      </div>

      <figure class="card">
        <h3>Household income — owners vs renters</h3>
        <canvas data-chart="incomeByTenure"></canvas>
        <figcaption class="muted">
          Distribution of household income for owner-occupied (navy) and renter-occupied (gold) households.
        </figcaption>
      </figure>
    </section>

    <section class="container report-section">
      <details class="methodology">
        <summary>Methodology &amp; sources</summary>
        <p>All figures derive from the 2024 American Community Survey 5-year estimates. State and
        national comparisons are population-weighted aggregates of county-level estimates (an approximation).</p>
        <p>The affordability calculator uses a 30% housing-budget rule with a 30-year mortgage. Defaults
        are 7% interest, 5% down, $2,500/year taxes and insurance, and 0.5% PMI — adjustable above.</p>
        <p class="muted">GEOID: {county['geoid']} · source: <code>Full Housing Data Table.xlsx</code></p>
      </details>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p class="muted">Data: American Community Survey, 2024 5-year estimates.
      </p>
      <p class="muted"><small>housinganalytics.org · preview build</small></p>
    </div>
  </footer>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const chartData = {json.dumps(chart_data)};
const county = {json.dumps({k: county.get(k) for k in ['county_name', 'state_name', 'hh_income_median', 'value_median']})};

const css = getComputedStyle(document.documentElement);
const C = {{
  navy:  css.getPropertyValue('--color-navy').trim(),
  gold:  css.getPropertyValue('--color-gold').trim(),
  teal:  css.getPropertyValue('--color-teal').trim(),
  blue:  css.getPropertyValue('--color-blue').trim(),
  lteal: css.getPropertyValue('--color-light-teal').trim(),
  purple:css.getPropertyValue('--color-purple').trim(),
  lime:  css.getPropertyValue('--color-lime').trim(),
  red:   css.getPropertyValue('--color-red').trim(),
  amber: css.getPropertyValue('--color-amber').trim(),
  char:  css.getPropertyValue('--color-charcoal').trim(),
}};
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = C.char;
Chart.defaults.borderColor = '#e6e2d2';

function mk(sel, cfg) {{
  const el = document.querySelector('canvas[data-chart="' + sel + '"]');
  if (el) new Chart(el, cfg);
}}
const pctOpts = (max) => ({{ scales: {{ y: {{ beginAtZero: true, max, ticks: {{ callback: v => v + '%' }} }} }}, plugins: {{ legend: {{ position: 'top' }} }} }});
const countOpts = () => ({{ scales: {{ y: {{ beginAtZero: true }} }}, plugins: {{ legend: {{ display: false }} }} }});
const moneyOpts = () => ({{ scales: {{ y: {{ beginAtZero: true, ticks: {{ callback: v => '$' + v.toLocaleString() }} }} }}, plugins: {{ legend: {{ display: false }} }} }});

mk('race', {{
  type: 'bar',
  data: {{ labels: chartData.race.labels,
          datasets: [{{ label: 'Share of population', data: chartData.race.county, backgroundColor: C.navy, borderRadius: 4 }}] }},
  options: pctOpts(100),
}});
mk('education', {{
  type: 'bar',
  data: {{ labels: chartData.education.labels,
          datasets: [{{ data: chartData.education.values, backgroundColor: C.gold, borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('tenure', {{
  type: 'doughnut',
  data: {{ labels: chartData.tenure.labels,
          datasets: [{{ data: chartData.tenure.values, backgroundColor: [C.navy, C.gold] }}] }},
  options: {{ plugins: {{ legend: {{ position: 'bottom' }} }} }},
}});
mk('structure', {{
  type: 'bar',
  data: {{ labels: chartData.structure.labels,
          datasets: [{{ data: chartData.structure.values, backgroundColor: C.teal, borderRadius: 4 }}] }},
  options: pctOpts(),
}});
mk('yearBuilt', {{
  type: 'bar',
  data: {{ labels: chartData.yearBuilt.labels,
          datasets: [{{ data: chartData.yearBuilt.values, backgroundColor: C.blue, borderRadius: 4 }}] }},
  options: countOpts(),
}});

const brTotal = chartData.bedrooms.units.reduce((a,b) => a + (b||0), 0) || 1;
const hhTotal = chartData.hhSize.values.reduce((a,b) => a + (b||0), 0) || 1;
const brPct = chartData.bedrooms.units.map(v => (v||0)/brTotal*100);
const hhPct = chartData.hhSize.values.map(v => (v||0)/hhTotal*100);
mk('sizeMismatch', {{
  type: 'bar',
  data: {{ labels: ['Studio/1BR · 1 person', '2BR · 2 person', '3BR · 3 person', '4+BR · 4+ person'],
          datasets: [
            {{ label: 'Housing units (% by bedroom)', data: [brPct[0]+brPct[1], brPct[2], brPct[3], brPct[4]+brPct[5]], backgroundColor: C.navy, borderRadius: 4 }},
            {{ label: 'Households (% by size)',       data: hhPct, backgroundColor: C.gold, borderRadius: 4 }},
          ] }},
  options: pctOpts(),
}});
mk('homeValue', {{
  type: 'bar',
  data: {{ labels: chartData.homeValue.labels,
          datasets: [{{ data: chartData.homeValue.values, backgroundColor: C.purple, borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('rentByBR', {{
  type: 'bar',
  data: {{ labels: chartData.rentByBR.labels,
          datasets: [{{ data: chartData.rentByBR.values, backgroundColor: C.teal, borderRadius: 4 }}] }},
  options: moneyOpts(),
}});
mk('renterAge', {{
  type: 'bar',
  data: {{ labels: chartData.tenureAge.labels,
          datasets: [{{ data: chartData.tenureAge.renters, backgroundColor: C.gold, borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('ownerAge', {{
  type: 'bar',
  data: {{ labels: chartData.tenureAge.labels,
          datasets: [{{ data: chartData.tenureAge.owners, backgroundColor: C.navy, borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('renterBurden', {{
  type: 'bar',
  data: {{ labels: chartData.renterBurden.labels,
          datasets: [{{ data: chartData.renterBurden.values,
            backgroundColor: chartData.renterBurden.labels.map((_, i) => i < 5 ? C.lteal : (i < 8 ? C.amber : C.red)),
            borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('ownerBurden', {{
  type: 'bar',
  data: {{ labels: chartData.ownerBurden.labels,
          datasets: [{{ data: chartData.ownerBurden.values, backgroundColor: C.amber, borderRadius: 4 }}] }},
  options: countOpts(),
}});
mk('incomeByTenure', {{
  type: 'bar',
  data: {{ labels: chartData.incomeByTenure.labels,
          datasets: [
            {{ label: 'Owners',  data: chartData.incomeByTenure.owners,  backgroundColor: C.navy, borderRadius: 4 }},
            {{ label: 'Renters', data: chartData.incomeByTenure.renters, backgroundColor: C.gold, borderRadius: 4 }},
          ] }},
  options: {{ ...countOpts(), plugins: {{ legend: {{ position: 'top' }} }} }},
}});

// Affordability calculator
function recalc(income, rate, downPct, ti) {{
  const monthlyBudget = (income * 0.30) / 12;
  const monthlyTaxIns = ti / 12;
  const monthlyRate = (rate / 100) / 12;
  const n = 360;
  const pmiMonthlyRate = 0.005 / 12;
  const piFactor = monthlyRate === 0
    ? (1 / n)
    : (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  const principal = (monthlyBudget - monthlyTaxIns) / (piFactor + pmiMonthlyRate);
  const price = principal > 0 ? principal / (1 - downPct / 100) : 0;
  return {{ monthlyBudget, price: Math.max(0, price) }};
}}
function fmt$(v) {{ return '$' + Math.round(v).toLocaleString(); }}
function update() {{
  const inc  = parseFloat(document.getElementById('aff-income').value) || 0;
  const rate = parseFloat(document.getElementById('aff-rate').value)   || 0;
  const dp   = parseFloat(document.getElementById('aff-down').value)   || 0;
  const ti   = parseFloat(document.getElementById('aff-ti').value)     || 0;
  const r = recalc(inc, rate, dp, ti);
  document.getElementById('aff-monthly').textContent = fmt$(r.monthlyBudget);
  document.getElementById('aff-price').textContent   = fmt$(r.price);
}}
['aff-income', 'aff-rate', 'aff-down', 'aff-ti'].forEach(id => {{
  document.getElementById(id).addEventListener('input', update);
}});
update();
if (county.hh_income_median) {{
  document.getElementById('aff-price-mhi').textContent = fmt$(recalc(county.hh_income_median, 7, 5, 2500).price);
}}
</script>
</body>
</html>"""

OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE.write_text(html)
print(f'Wrote {OUT_FILE} ({len(html):,} chars)')
