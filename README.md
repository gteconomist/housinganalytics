# housinganalytics.org

ACS housing data for every U.S. county, presented in the structure of an economic-development housing study.

## What this is

A static website that turns the [American Community Survey](https://www.census.gov/programs-surveys/acs) into the figures, tables, and plain-language summaries an economic-development analyst would otherwise spend days assembling per county. Inspired by housing studies produced by [Georgia Tech CEDR / Enterprise Innovation Institute](https://cedr.gatech.edu/) and similar regional research organizations.

The site replaces the spreadsheet-wrangling and chart-making portion of a housing study. It does **not** replace subscription data sources (Zillow, CoStar, Lightcast, Woods & Poole), GIS work, or stakeholder qualitative research.

## Data

- **Source**: `Full Housing Data Table.xlsx` — 2024 ACS 5-year estimates, ~297 variables across 3,222 U.S. counties.
- **Update cadence**: annual. Drop in next year's spreadsheet, commit, and the site rebuilds.
- **ACS variable mapping**: `src/data/variable-map.ts` is the single source of truth for translating ACS variable codes (e.g., `B25024_002E`) into plain-language field names (`structure_1_detached`). When ACS renames a variable, update this file only.

## Architecture

- **Framework**: [Astro](https://astro.build) — static site generator with selective interactivity.
- **Charts**: [Chart.js](https://www.chartjs.org) loaded only on pages that need it.
- **Hosting**: GitHub Pages with `housinganalytics.org` as a custom domain.
- **Deployment**: GitHub Actions builds and deploys on every push to `main` (see `.github/workflows/deploy.yml`).

## Local development

```bash
npm install
npm run dev     # builds data, starts dev server at http://localhost:4321
npm run build   # builds data, produces production site in ./dist
```

The `npm run data` step reads the Excel spreadsheet and writes per-county JSON files to `src/data/generated/` (gitignored). Astro consumes these at build time.

## Project structure

```
.
├── Full Housing Data Table.xlsx   # data source — committed to repo
├── public/                        # static assets + CNAME for custom domain
├── scripts/
│   └── build-data.mjs             # Excel → JSON loader
├── src/
│   ├── components/                # reusable UI (KpiTile, BarChart, etc.)
│   ├── data/
│   │   ├── variable-map.ts        # ACS variable code → field name mapping
│   │   └── generated/             # per-county JSON (gitignored, built fresh)
│   ├── layouts/                   # page shells
│   ├── lib/                       # helpers (formatters, derived metrics)
│   ├── pages/                     # routes (one file per page, dynamic routes for counties)
│   └── styles/
│       └── tokens.css             # brand palette + typography
└── .github/workflows/deploy.yml   # GitHub Actions → Pages
```

## Brand palette

- Primary: `#003057` navy, `#b3a369` gold, `#FFFFFF` white
- Secondary: `#eaa000` amber, `#f9f6e5` cream, `#d6dbd4` sage, `#545b5a` charcoal
- Tertiary (charts): `#008c95` teal, `#3a5dae` blue, `#64ccc9` light teal, `#5f249f` purple, `#a4d233` lime, `#e04f39` orange-red

## Roadmap

**v1 (in progress)**: County profile pages, design system, build pipeline, GitHub Actions deploy.

**v1.1**: Comparison view (multi-county side-by-side), national rankings table, `.xlsx` exports, PNG chart exports.

**v2**: User-defined regions with shareable URLs, national choropleth map, `.docx` / PDF full-profile exports, strategies/recommendations library.

**v3**: Census API integration for city/place-level lookups by geoid; BLS QCEW integration for industry wage tables.
