# housinganalytics.org — v5 Scope (Re-baseline)

**Status:** Draft v0.1 — a re-baseline. Records what actually shipped through mid-2026 and re-sequences the unbuilt v4 plan into a v5 organized around Analysis.
**Author:** Claude, with Alfie
**Date:** 2026-07-25
**Supersedes framing of:** v4-scope.md (2026-05-23)

---

## 0. Why re-baseline

`v4-scope.md` named a Tier-1 "anchor" of **ACS trends + HUD FMR/permits + peer counties** as the release that would earn the v4 label. Development since May took a different — and arguably higher-value — path, and the written scope no longer matches the site.

What actually got built after May: an **EIG rebrand**, the **Community Data Sheet generator** (a multi-vintage ACS pipeline feeding an on-site, login-gated Excel export), a full **cities/places expansion** (4,814 city profiles, city rankings, city map, places spreadsheet), the **Housing Stress Index** for both counties and cities, and an **Analysis section**. Of the original v4 scope, only the composite index (Tier 2, §3.1) was delivered — and it was taken past spec.

This document does two things: (1) catalogs what has actually shipped, so the version story is accurate, and (2) folds the unbuilt v4 anchor forward into a v5 sequenced around the analysis direction now in motion (the Housing Stress Index, and the housing-shortage-by-income-cohort study in progress).

---

## 1. What has shipped (as of 2026-07)

**Geographies**
- **Counties** — 3,222 profiles (ACS 2024 5-year), state-level aggregates as context.
- **Cities / places** — 4,814 profiles for every place over 5,000 population; same data shape as counties.

**Tools (interactive exploration)**
- **Compare** — 2–6 counties side by side.
- **Rankings** — county rankings and city rankings, sortable/filterable, CSV export.
- **Maps** — county choropleth and city proportional-dot map, colored by any metric.

**Analysis (pre-built interpretation)**
- **Housing Stress Index** — 0–100 composite for counties and cities, on rankings, maps, and profiles, with a public methodology page.
- **Analysis section** — landing + methodology, scaffolded for more studies.

**Data (raw material for download)**
- **Community Data Sheet generator** — multi-vintage ACS → styled Excel workbook, on-site, login-gated.

**Platform**
- EIG house style (palette, logo, type), grouped-dropdown navigation.
- Data foundation: ACS 2024 5-year, BLS QCEW + OEWS, HUD AMI, Census Gazetteer (land area + centroids).

---

## 2. Information architecture

The site now sorts cleanly into **three buckets**, which the navigation should mirror:

- **Tools** — *you do the exploring.* Explore (directories), Rankings, Maps, Compare.
- **Analysis** — *we did the interpretation.* Indices and studies (HSI; income-cohort study).
- **Data** — *raw material to take away.* Data Sheet, plus a future sources/methodology/freshness page.

Placement rules that follow from this: the **Data Sheet is Data, not Analysis** (it is the input an analyst works from, not a conclusion); **Compare is a Tool, not Analysis** (a sibling of Rankings and Maps).

**Menu today (Model A — grouped, no URL changes):**
Home · Explore ▾ (Counties, Cities) · Rankings ▾ (County, City) · Maps ▾ (County, City) · Compare · Data Sheet · Analysis ▾ (Overview, HSI) · About

**Destination (Model C — tool-first with a geography switcher):** one Rankings / Maps / Compare page each, with a County | City | State toggle, so geographies stop being menu items and become a control. Adopt when the geography set stabilizes; the grouped menu is a stepping stone, not throwaway.

Near-term move: promote **Data Sheet → Data ▾** once the data-sources page exists.

---

## 3. Carried forward from v4 (planned, not built)

Priority order for v5:

1. **ACS 5-year trends** — the old anchor, and the single highest-leverage unbuilt feature. Sparklines on profile KPI tiles, a "change at a glance" callout, a dedicated `/…/trends` page, a Compare overlay, and a Rankings "biggest movers" mode. The data foundation is partly in place: `fetch-acs-vintages.mjs` and `acs-vintage-crosswalk.js` exist (built for the Data Sheet), so this is cheaper now than the original 3–4-session estimate. Still needs `build-trends`, a CPI puller for real-dollar toggling, and the UI.
2. **HUD FMR + Census building permits** — current-year rent and a leading supply indicator, to surround the lagging ACS figures.
3. **Peer counties** — auto-suggested statistically-similar peers to seed the Compare tool.
4. **Tier-2 leftovers** — IRS migration, LEHD LODES (jobs–housing), HUD subsidized-supply overlay, auto-narrative, affordability-calculator widget.
5. **Tier-3 / reach** — MSA and state rollup pages, saved/shareable views, embeddable chart snippets, equity (race/ethnicity) view.

---

## 4. New in the v5 direction

- **Analysis as a first-class pillar.** Housing Stress Index (shipped). **Housing shortage by income cohort** (in progress in a parallel workstream) — the affordable-unit gap at each income band, not a single county-wide figure. Room for further indices and studies under `/analysis`.
- **Cities parity.** City compare, city trends, and a city layer on the unified maps — closing the gap between the counties and cities experiences.
- **Data section.** A `/data` sources-and-freshness page (every dataset, vintage, source, last-pulled date), which also anchors the Data ▾ menu group.

---

## 5. Recommended phasing (v5.x)

- **v5.0 — Analysis pillar.** HSI (done), Analysis section + HSI methodology (done), housing shortage by income cohort. Ship as the analysis release.
- **v5.1 — Trends anchor.** ACS trends across profiles, a trends page, Compare overlay, Rankings movers. Cities included from the start.
- **v5.2 — Current context.** HUD FMR + building permits; peer counties.
- **v5.3 — Reach + parity.** MSA/state rollups, saved views, embeds, city compare.
- **Cross-cutting, do early:** the `/data` sources page; keep per-page JSON split (trends must be lazy-loaded, never bundled into the profile payload); a chart house-style pass on new chart types.

---

## 6. Open questions

1. **Version label.** Call the shipped body "v4, as delivered" and everything here v5 — or fold it all into a single v5 story? (Recommendation: the former; it keeps an honest changelog.)
2. **Cities parity depth.** How far to push city trends/compare vs. keeping cities lighter than counties.
3. **Income-cohort study integration.** Does it live purely under `/analysis`, or also feed a per-profile panel (like the HSI badge)?
4. **When to move to Model C** — i.e., how stable is the geography set (counties, cities, + states/metros?) before collapsing the per-geography pages into toggles.

---

*End of re-baseline. Mark up directly or send notes; I'll cut v0.2 when you next pick this up.*
