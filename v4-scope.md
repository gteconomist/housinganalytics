# housinganalytics.org — v4 Scope

**Status:** Draft v0.3 — all build estimates re-cast in chat-session terms (v0.2 used developer-weeks, which is the wrong unit for how housinganalytics.org actually gets built)
**Author:** Claude, with Alfie
**Date:** 2026-05-23
**Predecessors shipped:** v1 (county profiles), v2 (compare), v3 (rankings, BLS QCEW, map, place lookups, Word/PDF export)

---

## 1. Theme

v1–v3 turned the ACS Excel into a navigable, exportable, county-level reference. v4 should move the site **from snapshot to story**: add the time dimension, surround ACS with current and forward-looking data, give analysts interpretive lift, and let users carry the site's output into their own work.

Concretely, v4 organizes around four pillars:

1. **Time** — ACS trends, change callouts, simple projections.
2. **Context** — HUD FMR, building permits, migration, subsidized supply, jobs-housing balance.
3. **Interpretation** — peer counties, composite housing-stress index, auto-narrative on each profile, affordability calculator.
4. **Output & reach** — MSA/state rollups, saved/shareable views, embeddable chart snippets.

The Tier-1 trio (ACS trends + HUD FMR + peer counties) is the anchor release. Tier-2 is the value-multiplier layer. Tier-3 is the spread/UX polish that pushes the site outside its current audience.

---

## 2. Tier 1 — Anchor release

These three features alone justify a v4 label. Recommended scope for first cut.

### 2.1 ACS 5-year trend lines

**Concept.** Pull the last four ACS 5-year vintages (2015–19, 2017–21, 2019–23, 2020–24) and surface time-series for a carefully curated subset of headline metrics that are demonstrably comparable across vintages.

**Analyst value.** Today the site answers "what is it?" Adding trends answers "is it getting worse, and how fast?" That single question is in nearly every ED memo and grant narrative.

#### Data approach — curated, not blanket

Alfie's review on 2026-05-23 flagged the core risk: ACS adds new tables, shifts categorical bins, and re-bases dollar variables between vintages. A blanket "trend all 297 variables" pull would produce data-soup an analyst couldn't defend. The trend layer is therefore built on five disciplined moves:

1. **Curated headline list — ~20 stable metrics only.** Initial set, approved by Alfie:
   - *Demographics & income:* total population, median age, median HH income, median family income, per capita income.
   - *Housing market:* total housing units, vacancy rate, homeownership rate, median home value, median gross rent, median monthly owner costs (with mortgage), median monthly owner costs (without mortgage), median rooms, median bedrooms.
   - *Affordability & burden:* renter cost burden 30%+, renter cost burden 50%+, owner cost burden 30%+, owner cost burden 50%+.
   - *Education:* high-school+ share, bachelor's+ share.

   Everything else stays in the snapshot view, not the trend view. The list may shrink during build if any variable fails the crosswalk audit (next bullet).

2. **Variable-level vintage crosswalk.** New file `src/data/acs-vintage-crosswalk.js`, modeled on the existing `variable-map.js`. Each trend-eligible variable maps to its table ID per vintage with a status flag: `stable` / `inflation-adjust` / `bin-aggregated` / `break`. The build script emits trend data only for variables marked OK in every vintage being plotted. Any future ACS reshuffle becomes a one-file change.

3. **Explicit CPI handling on dollar variables.** Pull BLS CPI-U annual averages, store as a small lookup table, convert each vintage's nominal dollars to a common year (latest, 2024). The trend page surfaces a "Real (2024 $)" / "Nominal" toggle on the chart header. Default to real.

4. **Break markers, not fake continuity.** Where a bin definition genuinely changes mid-series and we can't credibly bridge it, the line breaks at that vintage and a footnote names the change. Better to lose two years than to mislead.

5. **Geography awareness.** Connecticut planning regions get their own trend lines starting the 2022 vintage; pre-2022 lines show the old counties; a footnote names the split. Same pattern for Alaska borough changes.

#### UX — five layers, layered for clutter control

Trends weave into the existing site rather than bolt onto it. Five touchpoints, ordered from highest leverage to lowest:

**Layer 1 — KPI tile augmentation.** Each of the 8 headline tiles on the county profile gains a 4-point sparkline beneath the value and a delta tag (e.g. `↑ 4.2%/yr`). Sparkline shape is neutral; delta color encodes direction-of-good per metric (rising income green, rising rent amber, rising cost burden red). Adds ~25 vertical pixels per tile. Single highest-leverage change in v4 — puts the time dimension on the first thing every visitor sees.

**Layer 2 — "Change at a glance" mini-section.** Three narrative callouts auto-selected per county based on largest standardized movement. Plain language with a single embedded number plus a rank ("Median gross rent up 24% since 2015–19 — the 47th largest increase nationally"). Lives between the KPI strip and Section 1, ~150 vertical pixels. Provides quotable lines for press and grant work.

**Layer 3 — Dedicated `/county/{state}/{slug}/trends` page.** Full small-multiples grid of the curated 18–22 metrics, grouped into three families: Demographics & income / Housing market / Affordability & burden. Real/Nominal toggle at the page header. Each small multiple expands to a detail view with axes, MOE on hover, and source line. Linked from the profile via a single "View 10-year trends →" button above the KPI strip.

**Layer 4 — Compare page trend overlay.** Existing chip picker stays. New "Show 10-year trend" toggle next to the metric selector. When active, the bar chart flips to a multi-line trend chart with one line per selected county, same colors, same source line. No new mode, no new page.

**Layer 5 — Rankings "biggest movers" mode.** New "Order by" dropdown next to the metric picker: "Current value" (today's behavior) or "5-year change." When set to change, the table re-sorts by trend magnitude and the top-10 chart shows change rather than level.

The mockup shown in chat on 2026-05-23 captures the visual feel of Layers 1–3. Compare overlay and Rankings mode follow the existing pattern of those pages — view toggles on the existing UI.

#### Files to add / touch

*Data pipeline:*
- `scripts/fetch-acs-vintages.mjs` — new puller, one vintage per run, cached to `src/data/raw/acs/{vintage}/`.
- `scripts/fetch-cpi.mjs` — new, BLS CPI-U annual averages, small JSON output.
- `src/data/acs-vintage-crosswalk.js` — new, variable→table-per-vintage with status flags.
- `scripts/build-trends.mjs` — new, joins vintages on county FIPS, applies the crosswalk, computes real-dollar variants, emits `src/data/generated/trends/{fips}.json` plus `src/data/generated/trends-summary.json` (the auto-selected callouts).

*Components:*
- `src/components/Sparkline.astro` — new, 4-point inline SVG sparkline + delta tag.
- `src/components/TrendChart.astro` — new line chart in house style, MOE-on-hover, real/nominal aware.
- `src/components/ChangeAtAGlance.astro` — new, renders the 3 auto-selected narrative callouts.

*Pages:*
- `src/pages/county/[state]/[slug].astro` — augment KPI tiles with sparklines; insert ChangeAtAGlance between KPI strip and Section 1; add "View 10-year trends →" button.
- `src/pages/county/[state]/[slug]/trends.astro` — new, the dedicated trends page.
- `src/pages/compare.astro` — add "Show 10-year trend" toggle, multi-line trend chart variant.
- `src/pages/rankings.astro` — add "Order by" dropdown ("Current value" / "5-year change").

#### Build estimate

3–4 chat sessions:
- *Session 1 — Data pipeline.* Vintage puller, CPI puller, crosswalk file with the curated 20 metrics, `build-trends.mjs`. Includes the crosswalk audit pass where Claude flags any variable that fails the per-vintage check and Alfie weighs in.
- *Session 2 — Profile integration.* Sparkline component, KPI tile augmentation, ChangeAtAGlance callouts on the profile, "View 10-year trends →" button wired up. Visible result: profile carries the time dimension.
- *Session 3 — Dedicated trends page.* New `/county/{state}/{slug}/trends` route, TrendChart component, small-multiples grid grouped into the three families, real/nominal toggle.
- *Session 4 — Compare overlay + Rankings biggest-movers.* Two smaller wins folded together; could plausibly happen alongside Session 3 if energy allows.

#### Dependencies

None blocking, but trends shares the JSON-splitting cross-cutting work (see section 6) — `trends.json` should be a separate lazy-loaded file from `profile.json` from day one to keep per-page bundle size under control.

#### Open risks

- Crosswalk audit needs Alfie's economist eyes once the build script flags variables that fail the per-vintage check. Budget a half-day review pass before locking the curated list.
- Connecticut and Alaska break markers — confirm Alfie is OK with broken lines + footnotes rather than interpolation.
- MOE display on the small-multiple charts — show as a faint band, or on-hover tooltip only? (Recommendation: tooltip only on small multiples; faint band on the expanded detail view.)

---

### 2.2 HUD FMR + Census Building Permits overlay

**Concept.** Two adjacent data layers, shipped together because they cover the same "what's happening now" gap that ACS leaves.

- **HUD Fair Market Rents** — annual, current-year, county-level (some FMR areas span multiple counties; need disaggregation).
- **Census Building Permits Survey (BPS)** — monthly, county-level, units permitted by structure type.

**Analyst value.** ACS rent figures lag 2–4 years; FMR shows what HUD says rent is right now. BPS is a leading indicator of housing supply — pair it with population growth and you can flag counties where housing isn't keeping up.

**Data source.**
- HUD FMR API (free, no key needed): `https://www.huduser.gov/portal/dataset/fmr-api.html`.
- Census BPS: monthly Excel files at `https://www.census.gov/construction/bps/`.

**Files to add / touch.**
- `scripts/fetch-hud-fmr.mjs` — new. We already have `fetch-hud-ami.mjs` as a pattern.
- `scripts/fetch-bps.mjs` — new. Monthly file, annual rollup.
- `scripts/build-data.mjs` — extend to join FMR and BPS into the per-county JSON.
- `src/components/FmrPanel.astro` — small comparison panel: ACS gross rent vs current FMR by bedroom count.
- `src/components/PermitsChart.astro` — bar chart of permits by year (last 5), with population growth line overlay.
- `src/pages/county/[state]/[slug].astro` — add both components to profile.
- `src/pages/rankings.astro` — add "permits per 1,000 households" ranking.

**Build estimate.** 2 sessions — one for FMR (HUD API puller, FmrPanel, profile integration), one for BPS (Census puller, PermitsChart, profile integration, rankings entry). Could collapse to 1 if both pipelines come up cleanly.

**Dependencies.** None.

**Risks / open questions.**
- HUD FMR areas are not always county-aligned (rural FMR areas span counties; metro FMR areas cover whole MSAs). The crosswalk file from HUD handles this but adds a step.
- BPS only covers permit-issuing places, so some rural counties have incomplete coverage. Need a "no data" treatment.

---

### 2.3 Peer county benchmarking

**Concept.** For each county, auto-suggest 5–10 statistically similar peers. Replace the user's guess in the Compare tool with a recommended set.

**Analyst value.** "Who should I compare us to?" is the most-asked question in ED. Surfacing peers based on population, median income, urban/rural, region, and industry mix removes the politics of peer selection and gives the analyst a defensible starting point.

**Approach.**
- Feature vector per county: log-population, median HH income, % rural, Census region, dominant QCEW supersector (already in data), median age, % owner-occupied.
- Standardize, compute pairwise Euclidean distance, keep top-10 nearest neighbors per county.
- Pre-compute at build time (one-shot Python script). No runtime computation.

**Files to add / touch.**
- `scripts/build-peers.py` — new. Reads existing county JSONs, emits `src/data/generated/peers/{fips}.json` (list of `[fips, distance, label]`).
- `src/components/PeerPanel.astro` — new. Renders peer list with quick-jump links and a "Compare all" button that prefills the Compare page.
- `src/pages/county/[state]/[slug].astro` — add peer panel.
- `src/pages/compare.astro` — accept a `?peers={fips}` query param to prefill peer comparison.

**Build estimate.** 1–2 sessions. Session 1: `build-peers.py` + PeerPanel component + profile integration + Compare prefill. Session 2 (optional): tuning pass on the feature set and weights once you've spot-checked the suggested peers for 20 counties you know well. Rural Iowa shouldn't peer to suburban NJ just because the numbers happen to align — that's the test the algorithm has to pass.

**Dependencies.** None, but pairs naturally with trends (2.1) — peers + trends = "are we falling behind our peers?"

**Risks / open questions.**
- Tuning is subjective. Recommend you spot-check 20 counties you know well before locking the algorithm.
- Should peers be national, or restricted to same-region/state? Default national, with a toggle.

---

## 3. Tier 2 — High-value adds

Strong candidates if Tier 1 lands well and there's appetite for a second v4 sprint.

### 3.1 Composite housing-stress index

**Concept.** Z-score and weighted sum of: cost-burden share, rent-to-income, vacancy, owner-occupied % change, median home value / median income. Output a 0–100 stress score and rank.

**Value.** A single, defensible number that headlines press, council briefings, and grant intros. Map and rankings both get a new dimension.

**Approach.** Pure computation on existing data — no new pulls.

**Files.** `scripts/build-index.mjs`, `src/components/IndexBadge.astro`, additions to rankings and map.

**Estimate.** 1 session. Pure computation on existing data — variable selection, z-scoring, weighting, rankings entry, IndexBadge component.

**Risks.** Index weighting is a political artifact — be ready to defend it. Document the methodology in About.

### 3.2 IRS SOI county-to-county migration

**Concept.** Annual IRS migration tables: who moved in, who moved out, total AGI carried in/out.

**Value.** "Where are people moving?" is a top-three ED question and the answer is rarely on hand. The income dimension lets you say "we're losing wealth" or "we're gaining young earners," which lands harder than raw counts.

**Data source.** IRS SOI county migration data (free, annual Excel: `https://www.irs.gov/statistics/soi-tax-stats-migration-data`).

**Files.** `scripts/fetch-irs-migration.mjs`, new component for top-5 origins/destinations, additions to county profile.

**Estimate.** 1–2 sessions. Session 1: fetcher + per-county migration data + top-origin/destination component. Session 2 (likely): suppression handling for low-volume counties + rankings integration.

**Risks.** IRS suppresses small flows (< 20 returns). Counties with low volume will look sparse.

### 3.3 LEHD LODES — jobs-housing balance

**Concept.** Where do residents of this county work, and where do its jobs come from? Plus wage tiers.

**Value.** Surfaces commuter sheds, lets you compute a real jobs-to-housing ratio, and identifies counties that are workforce dormitories vs job centers.

**Data source.** LEHD LODES (free, annual): `https://lehd.ces.census.gov/data/`.

**Files.** `scripts/fetch-lodes.py` (heavier — block-level files, needs aggregation), components for top-5 work counties and resident counties, profile additions.

**Estimate.** 2–3 sessions. LODES is the biggest pipeline lift in v4 because of the block-level aggregation. Session 1: pull + aggregate to county. Session 2: components and profile integration. Session 3 (likely): jobs-housing ratio computation and rankings entry.

**Risks.** LODES vintages are not always current; document the lag.

### 3.4 HUD subsidized housing overlay

**Concept.** LIHTC properties, public housing units, HCV (voucher) usage per county.

**Value.** Affordability conversations are incomplete without supply-side context. ED analysts working on housing trust funds or LIHTC applications need this.

**Data source.** HUD LIHTC property database, Picture of Subsidized Households dataset. Free.

**Files.** `scripts/fetch-hud-assisted.mjs`, new "Subsidized supply" section on profiles, addition to rankings.

**Estimate.** 1 session for the basic integration (HUD CSV pull + subsidized supply section + rankings entry). A second session if you want PHA-to-county crosswalk for voucher data.

**Risks.** LIHTC database lags. Voucher data is at PHA, not county — need a crosswalk.

### 3.5 Auto-narrative — "What this means"

**Concept.** A 2–3 paragraph plain-language summary on each county profile, generated at build time. Talks like an analyst would in a brief.

**Approach.** Templated rather than free-form LLM, so it stays static-site-friendly and you can audit every sentence. Sentence templates fire based on conditions (e.g., "Cost burden in {county} is the {rank} highest in {state}" if rank < 20).

**Value.** Half the visitors will never look at the charts — they want to skim and quote. The narrative gives them the quote.

**Files.** `scripts/build-narrative.mjs`, narrative renderer in profile page.

**Estimate.** 1–2 sessions. Most of the work is writing 30–50 sentence templates and condition rules. One session to build the engine + initial templates, plus a calibration pass with you on the output to tune tone before going live.

**Risks.** Tone calibration — has to read like an economist, not a chatbot. Worth a tight review pass with you.

### 3.6 Affordability calculator widget

**Concept.** A small interactive: rate slider, down-payment %, target DTI → "income needed to buy the median home in {county}." Plus the inverse: at the median local income, what home price is affordable?

**Value.** Embeddable, sharable, instantly intuitive to a non-economist audience.

**Files.** `src/components/AffordabilityCalc.astro` (client-side JS, no new pipeline work — uses median home value already in profile).

**Estimate.** 1 session — it's a self-contained client-side widget with no pipeline work.

**Risks.** None major. Just be explicit about assumptions (PITI vs P&I, insurance %, tax %).

---

## 4. Tier 3 — Reach and UX

Lower priority than Tier 2 in analyst impact, but they widen the audience and reduce friction for the people already using the site.

### 4.1 MSA / state rollups

New URL routes `/msa/[cbsa]` and `/state/[abbr]` that aggregate underlying county data. ED practitioners often work at MSA level. 1–2 sessions, gated by sourcing the MSA→county crosswalk (Census delineation file, already public).

### 4.2 Saved / shareable views

URL-encode current selections and filters on Compare, Rankings, and Map. Adds a "Copy link" button. 1 session. Pure frontend.

### 4.3 Embeddable chart snippets

Each chart gets a "Get embed code" affordance that produces an iframe URL pointing at a stripped-down page. Lets analysts drop a live chart into a council memo or partner site. 1 session.

### 4.4 Equity view (cost burden, ownership by race/ethnicity)

Pull additional ACS variables disaggregated by race/ethnicity, surface as a sub-panel. Politically valuable, technically a moderate pipeline lift. 2 sessions because it expands the ACS variable list (you're at 297; this adds ~40–60).

---

## 5. Recommended phasing

*All estimates below are in **chat sessions**, not developer-weeks. Your v3 features each shipped in a single session, so a session is roughly one substantial sitting of focused work with Claude. Calendar pace — whether you do four in a week or four across two months — is yours.*

**Phase 1 — v4.0 (Anchor):** ACS trends + HUD FMR + BPS + Peer counties. **6–8 sessions** (trends 3–4, FMR 1, BPS 1, peers 1–2). Ship as a single release with a real announcement.

**Phase 2 — v4.1 (Interpretation):** Composite index + Auto-narrative + Affordability calculator. **3–4 sessions** (index 1, narrative 1–2, calculator 1). These three reinforce each other on the profile page.

**Phase 3 — v4.2 (Context expansion):** IRS migration + HUD subsidized supply. **2–3 sessions** (migration 1–2, LIHTC 1).

**Phase 4 — v4.3 (Reach):** MSA/state rollups + saved views + embeds. **3–4 sessions** (rollups 1–2, saved views 1, embeds 1).

**Deferred to v5 candidate:** LEHD LODES (2–3 sessions), equity view (2 sessions). Both are valuable but their pipeline weight makes them better as a focused future release.

**Total v4 if all phases ship: 14–19 sessions.** Phase 1 alone is the meaningful version bump.

---

## 6. Cross-cutting work that touches every phase

Things worth budgeting once rather than per-feature.

- **Data freshness page.** Add a `/data` route that lists every dataset, vintage, source URL, and last-pulled date. Two days now saves countless future "is this current?" questions.
- **JSON splitting.** With trends + FMR + peers + permits, the per-county JSON will balloon. Recommend splitting into `profile.json` + `trends.json` + `peers.json`, lazy-loaded. The trends file in particular (4 vintages × ~20 metrics × MOE) should never be bundled into the main profile payload — keep it behind the "View 10-year trends" click or fetch it after the page is interactive.
- **Chart house style audit.** Trend lines and the affordability calculator are new chart types. Confirm they conform to the existing house style (square markers, no gridlines, black text, source line) before they spread.
- **Performance.** 3,222 county pages × 4 vintages × N new charts is a real build-time concern. May need to flip to on-demand rendering or pre-built JSON + client-side rendering for some panels. Worth a small spike before Phase 1.

---

## 7. Resolved in v0.2 (2026-05-23)

- **ACS variable-change handling.** Curated list + crosswalk file + CPI conversion + break markers + geography awareness. See section 2.1.
- **Trend UX shape.** Five-layer approach (sparkline-augmented KPI tiles → "Change at a glance" callouts → dedicated trends page → Compare overlay → Rankings biggest-movers). Mockup in chat 2026-05-23.

## 8. Still open — questions for you

1. **Anchor confirmation.** Sign off on Tier 1 as the v4.0 release scope, or swap something in/out?
2. **MOE on trend charts.** Tooltip only on small multiples, faint band on the expanded detail view — OK as the default treatment?
3. **Peer scope.** National peers by default, or in-state only? (Claude's recommendation: national with a toggle.)
4. **Narrative tone.** Are you willing to do a calibration pass on 5–10 generated narratives before they go live, or do you want to skip auto-narrative entirely to avoid the curation overhead?
5. **Phase 1 timing.** Fixed-week plan, or build incrementally and ship as features go green?
6. **Anything missing.** Is there a v4 idea you'd already had in mind that's not here?

---

*End of scope. Mark up directly in this file or send notes; I'll cut a v0.3 when you next pick this up.*
