#!/usr/bin/env node
/**
 * fetch-permits.mjs
 *
 * Residential building permits by county and year, from the Census Bureau's
 * Building Permits Survey annual county files. Writes ONE committed file:
 *   src/data/permits-county.json
 *
 * This is the public stand-in for the "units under construction / delivered"
 * figures a commercial multifamily service reports. It answers "is anything
 * being built?" for every county in the country.
 *
 * Source: https://www2.census.gov/econ/bps/County/co{YYYY}a.txt  (no key)
 *   columns: date, state FIPS, county FIPS, region, division, name, then
 *   Bldgs/Units/Value triplets for 1-unit, 2-units, 3-4 units, 5+ units
 *   (estimates with imputation), then the same again "as reported".
 *
 * Stored per county as one [single_family, units_in_2_to_4, units_in_5_plus]
 * triple per year. Counties with no row in a year's file get null for that
 * year (not covered by a permit office), which is NOT the same as zero.
 *
 * Env: PERMIT_FIRST_YEAR (2015) · PERMIT_LAST_YEAR (last full calendar year)
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'src', 'data', 'permits-county.json');
const FIRST = Number(process.env.PERMIT_FIRST_YEAR || 2015);
const LAST = Number(process.env.PERMIT_LAST_YEAR || new Date().getFullYear() - 1);

async function year(y) {
  const url = `https://www2.census.gov/econ/bps/County/co${y}a.txt`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

async function main() {
  const years = [], byCounty = {};
  for (let y = FIRST; y <= LAST; y++) {
    const txt = await year(y);
    if (!txt) { console.warn(`  ${y}: file not available, skipped`); continue; }
    const col = years.length; years.push(y);
    let n = 0;
    for (const line of txt.split(/\r?\n/).slice(2)) {
      const f = line.split(',');
      if (f.length < 18 || !/^\d+$/.test(f[1].trim())) continue;
      const fips = f[1].trim().padStart(2, '0') + f[2].trim().padStart(3, '0');
      const u = (i) => Number(f[i]) || 0;
      (byCounty[fips] ||= [])[col] = [u(7), u(10) + u(13), u(16)];
      n++;
    }
    console.log(`  ${y}: ${n} counties`);
  }
  for (const k of Object.keys(byCounty)) for (let i = 0; i < years.length; i++) if (!byCounty[k][i]) byCounty[k][i] = null;
  await writeFile(OUT_FILE, JSON.stringify({
    source: 'U.S. Census Bureau, Building Permits Survey, annual county files',
    generated_at: new Date().toISOString(),
    years, order: ['single_family', 'units_2_to_4', 'units_5_plus'], counties: byCounty,
  }));
  console.log(`Wrote ${OUT_FILE}: ${Object.keys(byCounty).length} counties, ${years[0]}–${years[years.length - 1]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
