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

## Progress — updated 2026-07-25 (end of build session)

**v4 is closed and delivered.** All work from here is v5.

**Shipped since this doc was drafted (now live):**
- **EIG rebrand** — design tokens remapped to the *logo* palette (orange `#f7941e`, charcoal `#231f20`, warm greys + taupe `#9c867a`) site-wide. New **sales homepage**: Request-access framing (no search), Log-in link (Cloudflare Access), a state-tile HSI hero computed at build from `hsi.json`, a real county profile preview, and a light "marketing" header variant in `Base.astro` (app pages keep the dark nav header).
- **/data** sources & freshness page; Data Sheet promoted to a **Data ▾** menu group.
- **Analysis** section + **HSI methodology** page; grouped dropdown nav (Explore / Rankings / Maps / Data / Analysis).
- **Housing gap study — PILOT** (`/housing-gap`): CHAS-based cost burden + shortage by price point, pilot states GA / NC / TN. Files: `scripts/fetch-chas.mjs`, `scripts/fetch-market.mjs`, `scripts/build-analysis-geo.mjs`, `src/components/HousingGapBlock.astro`, `public/js/housing-gap.js`, `public/analysis-data/`.
- **Income-by-age (B19037)** cross-tab added to the Data Sheet generator.

**v5.0 status:** HSI (counties + cities) ✓ · Analysis section + methodology ✓ · /data ✓ · Housing-gap study — **national ✓ · per-profile card ✓ (2026-07-26)**. v5.0 is feature-complete.

---

## Progress — updated 2026-07-26

**Housing gap is national and on profiles. v5.0 closed.**

- **National rollout.** `build-analysis-geo.mjs` now covers all 52 states: 3,222 counties and the 4,814 profiled cities (places 5,000+ pop, keyed to `manifest.json`). 52 bundles in `public/analysis-data/states/` (~8.7 MB); index carries 4,814 places + 3,222 counties. Places below the profile threshold are deliberately excluded — their ACS cross-tabs are too thin, and indexing every place would make the search index a ~4 MB fetch on page load.
- **Per-profile card.** `src/components/HousingGapCard.astro` mirrors `IndexBadge` and sits beside it in the profile hero (new `.profile-badges` row). Headline = HUD CHAS affordable-and-available shortage at ≤ 50% AMI, plus national rank, renter cost-burden rate, ≤ 30% AMI shortage, widest gap by price point, and a link into the study.
- **Card data is build-time, not fetched.** `src/data/housing-gap-summary.json` (~990 KB) holds one compact record per geography. It lives in `src/data/`, **not** `src/data/generated/` — the latter is gitignored and CI never runs `analysis-geo` (HUD 403s the build sandbox), so a generated-dir path would break the build.
- **Banding.** Each universe is percentile-ranked on the CHAS ≤ 50% AMI shortage per renter household, denominated by CHAS's own renter total. Mixing a CHAS 2018–2022 numerator with an ACS 2020–2024 denominator produced impossible rates wherever the renter base moved between vintages. Under 500 renter households → `thin` flag on the card.
- **Deep links.** `/housing-gap?geo=<geoid>&mode=county|city` opens the study pre-loaded.
- **EIG restyle.** `housing-gap.css` and `housing-gap.js` still carried the GT palette (`#003057` / `#b3a369` / `#e04f39` / `#008c95`); both now resolve from `tokens.css` — the JS reads the custom properties once via `getComputedStyle`, with token values as literal fallbacks.
- **New:** `npm run analysis-summary` (`SUMMARY_ONLY=1`) recomputes the card summary from bundles already on disk — no API calls — for when the band math changes.

**Immediate next (v5.1 — ACS trends):**
1. `build-trends` on top of the existing `fetch-acs-vintages.mjs` + `acs-vintage-crosswalk.js` foundation, plus a CPI puller for real-dollar toggling.
2. Sparklines on profile KPI tiles, a "change at a glance" callout, a `/trends` page, a Compare overlay, and a Rankings "biggest movers" mode — counties and cities together.

**Still open from before:** Request-access `mailto:` → real contact form; confirm the Log-in target in the Cloudflare Access flow.

**Loose ends to close:** Request-access `mailto:` → real contact form; confirm the Log-in target in the Cloudflare Access flow.

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

- **Analysis as a first-class pillar.** Housing Stress Index (shipped). **Housing shortage by income cohort** (in progress in a parallel workstream) — the affordable-unit gap at each income band, not a single county-wide figure. Per §6 it ships in two places: a full study under `/analysis`, and a linked per-profile panel on both county and city profiles, mirroring the HSI badge. Room for further indices and studies under `/analysis`.
- **Full cities parity.** Cities are a first-class geography, not a lighter tier: a city profile — and every tool and study — should be as rich as its county equivalent (city compare, city trends, the income-cohort panel, city layer on the maps). Every v5 feature ships for counties *and* cities together unless a hard data limit prevents it, noted where it does.
- **Data section.** A `/data` sources-and-freshness page (every dataset, vintage, source, last-pulled date), which also anchors the Data ▾ menu group.

---

## 5. Recommended phasing (v5.x)

- **v5.0 — Analysis pillar.** HSI (done), Analysis section + HSI methodology (done), housing shortage by income cohort (study under `/analysis` + a linked per-profile panel, counties and cities). Ship as the analysis release.
- **v5.1 — Trends anchor.** ACS trends across profiles, a trends page, Compare overlay, Rankings movers. Cities included from the start.
- **v5.2 — Current context.** HUD FMR + building permits; peer counties.
- **v5.3 — Reach + parity.** MSA/state rollups, saved views, embeds, city compare.
- **Cross-cutting, do early:** the `/data` sources page; keep per-page JSON split (trends must be lazy-loaded, never bundled into the profile payload); a chart house-style pass on new chart types.

---

## 6. Decisions (2026-07-25) and open questions

**Resolved with Alfie:**
1. **Version label.** The shipped body is recorded as "v4, as delivered"; new work from here is v5 — an honest changelog rather than a retconned single story.
2. **Cities parity.** Cities should be as full and rich as counties wherever the data allows; parity is a goal of every v5 feature, not an afterthought (see §4).
3. **Income-cohort study.** Ships in both forms: a full study under `/analysis`, and a linked per-profile panel on county and city profiles, like the HSI badge.

**Recommendation (trigger-based, agreed direction):**
4. **When to move to Model C.** Rule: *don't write the third copy of a tool — toggle instead.* With two geographies the per-geography pages are cheap; the tipping point is States or Metros arriving as browsable tools, which under Model A would force a third copy of every tool page. Sequence: (1) finish cities parity in the grouped menu (v5.0–v5.1); (2) a dedicated "unify" step collapses Rankings / Maps / Compare into toggle-driven pages on the two at-parity geographies, keeping old URLs as redirects (`/city-rankings` → `/rankings?geo=cities`); (3) add States/Metros as toggle options. Converting two stable, at-parity geographies is the lowest-risk moment and solves the map's two-render-mode problem (polygons vs dots) once.

---

*End of re-baseline. Mark up directly or send notes; I'll cut v0.2 when you next pick this up.*
