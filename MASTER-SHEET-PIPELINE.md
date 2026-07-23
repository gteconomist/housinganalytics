# Master Sheet generator — census pipeline (v4 foundation)

**Session date:** 2026-07-23 · **Scope chosen:** build the data pipeline first; core-ACS tabs only.

## What this delivers

A working, validated multi-vintage ACS pipeline that reproduces the census
portion of your *Master Working Data Sheet* for any target place, its
auto-derived county / MSA / state, and a chosen set of peer cities. Proven on
the Chamblee example: **55 of 55 validation checks against the sheet pass** —
every internally-consistent number matches to the dollar / the person across
2015, 2020, and 2024.

### Files (new)

- `src/data/acs-vintage-crosswalk.js` — the single source of truth. 60 core-ACS
  fields (age cohorts, median age, race/ethnicity, per-capita & household
  income, income by tenure, unemployment, labor-force participation,
  educational attainment, 16-19 dropout, housing tenure, household size, home
  value, gross rent overall + by bedroom, vacancy composition, structure type),
  each mapped to Census API variables with a `derive()` and a stability flag.
  Modeled on the existing `variable-map.js`; any future ACS reshuffle is a
  one-file change.
- `scripts/fetch-acs-vintages.mjs` — geography-flexible puller (place / county /
  MSA-CBSA / state) that fetches every field for all vintages, batching under
  the Census API's 50-variable limit. Reads `CENSUS_API_KEY` from `.env`.
- `scripts/build-master-sheet.mjs` — assembler: raw → per-geography, per-vintage
  values plus the 2015→2024 % change the sheet reports.
- `scripts/validate.mjs` — diffs output against ground-truth transcribed from the
  sheet. Kept as a regression guard for future vintages.
- `out/acs-raw.json`, `out/master-sheet-data.json` — the fetched + assembled
  Chamblee-example data.

## Reference geographies resolved

Chamblee place `15172`, DeKalb County `13089`, Atlanta MSA (CBSA) `12060`,
Georgia `13`; peers Brookhaven `10944`, Doraville `23536`, Dunwoody `24768`,
Sandy Springs `68516`.

## Findings — where the sheet's own numbers need a decision from you

The validation surfaced several places where the sheet uses a non-standard or
inconsistent definition. The pipeline follows the *correct* ACS convention and
flags these; tell me which behavior you want the generator to reproduce.

1. **Community Profile "MHI" is per-capita income, not median household income.**
   Its 26,455 / 38,920 / 48,653 are ACS **B19301 per-capita income** to the
   dollar — the real median household income (B19013) is 47,379 / 66,607 /
   84,452 and lives on the Labor Force tab. The generator pulls both and labels
   them correctly.

2. **Educational attainment is displayed cumulatively.** The sheet's "HS
   Graduate" column = *HS-or-higher* (16,855) and "Some College" = *some-college
   -or-higher* (13,270). Its "Bachelor's+" column actually holds the
   **graduate/professional-degree** count (4,163), not bachelor's-or-higher
   (which is 10,067). The pipeline outputs all of: less-than-HS, HS-or-higher,
   some-college-or-higher, bachelor's-or-higher, and graduate/professional — so
   you can render whichever the sheet should show.

3. **Vacant "Other"** on the sheet = total vacant − for-rent − for-sale-only
   (634), broader than the single ACS "other vacant" line. Pipeline matches the
   sheet's definition.

4. **Race/ethnicity 2024 doesn't reconcile.** The sheet's Chamblee 2024 race row
   sums to ~135% (White 34.4 + Black 18.2 + Asian 8.7 + Two+ 8.4 + Hispanic
   65.3). Only Black (~18.3%) and 2015 White (35.8%) match canonical ACS. The
   pipeline produces standard B03002 shares that sum to 100% (White 31.5,
   Black 18.3, Asian 10.3, Other 0.2, Two+ 2.9, Hispanic 36.8 for 2024). Worth a
   look at the Social Explorer source cells.

5. **Mid-vintage age drift.** 2015 and 2024 age cohorts match ACS5 exactly; the
   sheet's "2020" column differs modestly from ACS5 2020 (a Social Explorer
   revision — e.g. under-18 6,585 vs ACS5's 7,130). Endpoints are exact.

6. **By-bedroom median rent is null for Chamblee 2015** — genuine ACS
   suppression for a small place in the older vintage; overall median rent is
   present. Needs a "no data" treatment in the sheet.

## Not yet built (remaining core-ACS + deferred)

- **Income by age cohort** (Labor Force tab, ACS **B19037**) — the one core-ACS
  table not yet in the crosswalk; it needs the 16-bucket × 4-age-band mapping.
- **Place → county → MSA auto-resolution.** Right now each geography carries an
  explicit API selector. Automating "give me a place, get its county + MSA +
  state" needs the Census delineation crosswalk (a known, public file; also the
  v4 §4.1 MSA-rollup dependency).
- **Deferred by scope:** HUD FMR income limits + CHAS cost burden, LEHD OnTheMap
  commuting, and the Woods & Poole / ARC / Georgia-OPB forecasts.

## To run it yourself

Add your key to a repo-root `.env` (already gitignored):

```
CENSUS_API_KEY=<your 40-char key>
```

Then: `node scripts/fetch-acs-vintages.mjs && node scripts/build-master-sheet.mjs`.
