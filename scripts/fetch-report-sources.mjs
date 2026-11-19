#!/usr/bin/env node
/**
 * fetch-report-sources.mjs — public sources the Word report needs beyond the ACS.
 *   npm run report-sources   →   src/data/report-sources.json   (committed)
 *
 *   fmr        HUD Fair Market Rents, county level (annual xlsx)
 *   inventory  Subsidized and income-restricted apartment properties, from HUD's
 *              open-data feature services: LIHTC, HUD-assisted multifamily,
 *              public housing developments and USDA rural housing
 *   hpi        FHFA annual county House Price Index (xlsx)
 *   mortgage   Freddie Mac 30-year fixed rate, latest week (csv)
 *
 * RUN IT ON THE MAC, like `npm run market`: HUD, FHFA and Freddie Mac refuse the
 * cloud sandbox.  Each source is fetched independently.  If one fails, the
 * section already in report-sources.json is kept and the failure is printed, so
 * a bad day at one agency never wipes the others.  Override any URL with the
 * env var named beside it.
 */
import * as XLSX from 'xlsx';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data', 'report-sources.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)', Accept: '*/*' };
const YY = String(new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0)).slice(2);   // HUD fiscal year starts Oct 1

const URLS = {
  fmr: process.env.HUD_FMR_URL ? [process.env.HUD_FMR_URL] : [YY, String(+YY - 1)].flatMap((y) => [`https://www.huduser.gov/portal/datasets/fmr/fmr20${y}/FY${y}_FMRs_revised.xlsx`, `https://www.huduser.gov/portal/datasets/fmr/fmr20${y}/FY${y}_FMRs.xlsx`]),
  hpi: process.env.FHFA_HPI_URL ? [process.env.FHFA_HPI_URL] : ['https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx', 'https://www.fhfa.gov/hpi/download/annually/hpi_at_county.xlsx', 'https://www.fhfa.gov/hpi/download/annually/hpi_at_bdl_county.xlsx', 'https://www.fhfa.gov/hpi/download/annual/hpi_at_bdl_county.xlsx'],
  hpiPage: 'https://www.fhfa.gov/data/hpi/datasets?tab=additional-data',
  pmms: [process.env.PMMS_URL || 'https://www.freddiemac.com/pmms/docs/PMMS_history.csv'],
  arcgis: process.env.HUD_ARCGIS || 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services',
};

async function get(urls, as) {
  let last;
  for (const u of urls) {
    try { const r = await fetch(u, { headers: UA, redirect: 'follow' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { url: u, body: as === 'text' ? await r.text() : Buffer.from(await r.arrayBuffer()) }; }
    catch (e) { last = new Error(`${u}: ${e.message}`); }
  }
  throw last;
}
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null; };

// ── HUD Fair Market Rents ────────────────────────────────────────────────
async function fmr() {
  const { url, body } = await get(URLS.fmr);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(body).Sheets[XLSX.read(body).SheetNames[0]], { defval: null });
  if (!rows.length) throw new Error('FMR workbook is empty');
  const keys = Object.keys(rows[0]), find = (re) => keys.find((k) => re.test(k));
  const kF = find(/^fips/i) || find(/fips/i), kB = [0, 1, 2, 3, 4].map((b) => find(new RegExp(`^fmr[_ ]?${b}$`, 'i')) || find(new RegExp(`fmr.*${b}`, 'i'))), kP = find(/^pop/i);
  if (!kF || kB.some((k) => !k)) throw new Error(`FMR columns not recognised: ${keys.join(', ')}`);
  const counties = {}, pop = {};
  for (const r of rows) {
    const fips = String(r[kF] ?? '').replace(/\D/g, '').padStart(10, '0').slice(0, 5); if (!/^\d{5}$/.test(fips) || fips === '00000') continue;
    const p = kP ? num(r[kP]) || 0 : 0;
    // New England reports by town: keep the most populous town's row as the county figure.
    if (counties[fips] && p <= (pop[fips] || 0)) continue;
    counties[fips] = kB.map((k) => num(r[k])); pop[fips] = p;
  }
  const fy = (url.match(/FY(\d\d)/i) || [])[1];
  return { year: fy ? `FY20${fy}` : '', source: url, counties };
}

// ── Subsidized apartment inventory (HUD open data) ───────────────────────
async function layer(name, fields) {
  const out = [], page = 2000;
  for (let off = 0; ; off += page) {
    const u = `${URLS.arcgis}/${name}/FeatureServer/0/query?where=1%3D1&outFields=${fields.join(',')}&returnGeometry=false&orderByFields=OBJECTID&resultOffset=${off}&resultRecordCount=${page}&f=json`;
    const j = JSON.parse((await get([u], 'text')).body);
    if (j.error) throw new Error(`${name}: ${j.error.message}`);
    const f = j.features || []; out.push(...f.map((x) => x.attributes));
    if (f.length < page && !j.exceededTransferLimit) break;
    if (!f.length) break;
  }
  return out;
}
const GEO = ['COUNTY_LEVEL', 'PLACE_LEVEL', 'PLACE_INC2KX'];
const fipsOf = (a) => { const c = String(a.COUNTY_LEVEL ?? '').replace(/\D/g, ''); return c.length >= 4 ? c.padStart(5, '0').slice(-5) : null; };
// PLACE_LEVEL is state + place FIPS.  Unincorporated addresses carry a placeholder, which simply matches no city.
const placeOf = (a) => { const p = String(a.PLACE_LEVEL ?? '').replace(/\D/g, ''); return p.length >= 6 && !/9{5}$/.test(p) ? p.padStart(7, '0').slice(-7) : null; };
const title = (s) => String(s || '').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ii|Iii|Iv|Llc|Lp|Usda|Hud)\b/g, (m) => m.toUpperCase());
const keyOf = (s) => String(s || '').toLowerCase().replace(/\b(apartments?|apts?|the|homes?|housing|village|villas?|estates?|phase|ltd|lp|llc|inc)\b/g, '').replace(/[^a-z0-9]/g, '');
const year = (v) => { const n = Number(v); if (n > 1900 && n < 2100) return String(n); if (n > 1e11) return String(new Date(n).getUTCFullYear()); return ''; };

async function inventory() {
  const [lihtc, mf, ph, usda] = await Promise.all([
    layer('LIHTC', ['PROJECT', 'PROJ_CTY', 'STD_CITY', 'N_UNITS', 'LI_UNITS', 'YR_PIS', 'TRGT_ELD', 'FMHA_515', 'NONPROG', ...GEO]),
    layer('MULTIFAMILY_PROPERTIES_ASSISTED', ['PROPERTY_NAME_TEXT', 'STD_CITY', 'PLACED_BASE_CITY_NAME_TEXT', 'TOTAL_UNIT_COUNT', 'TOTAL_ASSISTED_UNIT_COUNT', 'PROGRAM_TYPE1', 'IS_202_811_IND', 'IS_SEC8_IND', 'OCCUPANCY_DATE', ...GEO]),
    layer('Public_Housing_Developments', ['PROJECT_NAME', 'STD_CITY', 'FORMAL_PARTICIPANT_NAME', 'TOTAL_DWELLING_UNITS', 'TOTAL_UNITS', ...GEO]),
    layer('USDA_Rural_Housing_Assets', ['PROJECT_NAME', 'PRJ_ADDRESS_CITY', 'STD_CITY', 'TOTAL_UNITS', 'RA_UNITS', 'RENTAL_DESIGNATION', ...GEO]),
  ]);
  const items = [];   // { fips, place, name, built, units, programs:Set }
  const cityOf = (a) => String(a.STD_CITY || a.PROJ_CTY || a.PRJ_ADDRESS_CITY || a.PLACED_BASE_CITY_NAME_TEXT || '').trim().toUpperCase();
  const push = (a, name, built, units, program) => { const fips = fipsOf(a); if (!fips || !name || !(units > 0)) return; items.push({ fips, place: placeOf(a), city: cityOf(a), name: title(name).replace(/\bApts?\b/g, 'Apartments'), built, units, programs: new Set([program]) }); };
  const unnamed = (n) => !n || /unnamed|^project$|^n\/?a$/i.test(String(n).trim());
  const usdaKind = { fa: 'family', el: 'elderly', mx: 'mixed', cg: 'congregate', gh: 'group home' };
  for (const a of lihtc) { if (String(a.NONPROG) === '1') continue; push(a, a.PROJECT, year(a.YR_PIS), num(a.N_UNITS) || num(a.LI_UNITS), `Tax credit (LIHTC)${String(a.TRGT_ELD) === '1' ? ', senior' : ''}`); }
  for (const a of mf) push(a, a.PROPERTY_NAME_TEXT, year(a.OCCUPANCY_DATE), num(a.TOTAL_UNIT_COUNT) || num(a.TOTAL_ASSISTED_UNIT_COUNT), String(a.IS_202_811_IND).toUpperCase().startsWith('Y') ? 'HUD Section 202/811' : `HUD-assisted${a.PROGRAM_TYPE1 ? ' (' + String(a.PROGRAM_TYPE1).trim() + ')' : ''}`);
  for (const a of ph) push(a, unnamed(a.PROJECT_NAME) ? a.FORMAL_PARTICIPANT_NAME : a.PROJECT_NAME, '', num(a.TOTAL_DWELLING_UNITS) || num(a.TOTAL_UNITS), 'Public housing');
  for (const a of usda) push(a, a.PROJECT_NAME, '', num(a.TOTAL_UNITS), (() => { const k = String(a.RENTAL_DESIGNATION || '').trim().toLowerCase().slice(0, 2); return `USDA Section 515${usdaKind[k] ? ', ' + usdaKind[k] : ''}`; })());
  // The same property often sits in two programs (tax credits layered on a USDA or HUD loan): merge by name within a county.
  const merged = new Map();
  for (const it of items) {
    const k = it.fips + '|' + (keyOf(it.name) || it.name.toLowerCase()), m = merged.get(k);
    if (!m) { merged.set(k, it); continue; }
    m.units = Math.max(m.units, it.units); m.built = m.built || it.built; m.place = m.place || it.place; m.city = m.city || it.city; it.programs.forEach((p) => m.programs.add(p));
  }
  // Second pass: the agencies name the same property differently ("Heritage Villas" / "Heritage Villas of Helena",
  // or an owner's name in one file).  Within a county, merge when one name contains the other, or when two
  // records from different programs share a city and a unit count.
  const byCounty = {};
  for (const [k, it] of merged) (byCounty[it.fips] ||= []).push([k, it]);
  for (const list of Object.values(byCounty)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i], [kb, b] = list[j]; if (!merged.has(ka) || !merged.has(kb)) continue;
      const na = keyOf(a.name), nb = keyOf(b.name), shared = [...a.programs].some((p) => b.programs.has(p));
      // A name that differs only by a phase marker (II, 2, B) is a separate phase, not a duplicate.
      const [lo, hi] = na.length <= nb.length ? [na, nb] : [nb, na], extra = hi.replace(lo, '');
      const contains = lo.length >= 6 && hi.includes(lo) && !/^(i{1,3}|iv|v|vi{1,3}|ix|x|\d+|[a-e])$/.test(extra);
      // Same city and unit count under different programs counts as one property only when the names share a real word.
      const wordsOf = (n) => new Set(n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !/^(apartments?|homes?|housing|village|villas?|estates?|phase|manor|place|park|court|senior|family|limited|mgmt|management|properties|partners|associates)$/.test(w)));
      const wa = wordsOf(a.name), twin = !shared && a.city && a.city === b.city && a.units === b.units && a.units >= 8 && ([...wordsOf(b.name)].some((w) => wa.has(w)) || /\b(Lp|Llc|Ltd|Mgmt|Inc)\b/i.test(a.name + ' ' + b.name));
      if (!contains && !twin) continue;
      const keep = a.units >= b.units ? a : b, drop = keep === a ? b : a;
      if (/\b(Lp|Llc|Ltd|Mgmt|Inc)\b/i.test(keep.name) && !/\b(Lp|Llc|Ltd|Mgmt|Inc)\b/i.test(drop.name)) keep.name = drop.name;
      keep.built = keep.built || drop.built; keep.place = keep.place || drop.place; keep.city = keep.city || drop.city; drop.programs.forEach((p) => keep.programs.add(p));
      merged.delete(keep === a ? kb : ka);
    }
  }
  const counties = {};
  for (const it of merged.values()) (counties[it.fips] ||= []).push([it.name, it.built, it.units, [...it.programs].join('; '), it.place, it.city]);
  for (const l of Object.values(counties)) l.sort((a, z) => z[2] - a[2]);
  return { source: 'HUD open data: LIHTC, Multifamily Properties - Assisted, Public Housing Developments, USDA Rural Housing Assets', counts: { lihtc: lihtc.length, hud_multifamily: mf.length, public_housing: ph.length, usda: usda.length, properties: Object.values(counties).reduce((n, l) => n + l.length, 0) }, counties };
}

// ── FHFA annual county House Price Index ─────────────────────────────────
async function hpi() {
  let found = [];
  try { const html = (await get([URLS.hpiPage], 'text')).body; found = [...html.matchAll(/href="([^"]*count[^"]*\.xlsx[^"]*)"/gi)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), URLS.hpiPage).href); } catch (e) { /* fall back to the known addresses */ }
  const { url, body } = await get([...found, ...URLS.hpi]);
  const wb = XLSX.read(body), aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const h = aoa.findIndex((r) => r && r.some((c) => /fips/i.test(String(c))) && r.some((c) => /^year$/i.test(String(c).trim())));
  if (h < 0) throw new Error('FHFA header row not found');
  const head = aoa[h].map((c) => String(c ?? '').trim()), iF = head.findIndex((c) => /fips/i.test(c)), iY = head.findIndex((c) => /^year$/i.test(c)), iH = head.findIndex((c) => /^hpi$/i.test(c));
  if (iH < 0) throw new Error(`FHFA HPI column not found: ${head.join(', ')}`);
  const series = {}; let maxY = 0;
  for (const r of aoa.slice(h + 1)) { const f = String(r[iF] ?? '').replace(/\D/g, '').padStart(5, '0'), y = num(r[iY]), v = num(r[iH]); if (!/^\d{5}$/.test(f) || !y || !v) continue; (series[f] ||= {})[y] = v; if (y > maxY) maxY = y; }
  const from = maxY - 6, counties = {};
  for (const [f, s] of Object.entries(series)) if (s[maxY] && s[from]) counties[f] = [from, maxY, Math.round((s[maxY] / s[from] - 1) * 1000) / 10];
  return { source: url, from, to: maxY, counties };
}

// ── Freddie Mac 30-year fixed rate ───────────────────────────────────────
async function mortgage() {
  const { body } = await get(URLS.pmms, 'text');
  const lines = body.trim().split(/\r?\n/), head = lines[0].split(',').map((c) => c.trim().toLowerCase()), i30 = head.findIndex((c) => /pmms30$|^30|30.*fixed/.test(c)), iD = head.findIndex((c) => /date/.test(c));
  if (i30 < 0) throw new Error(`PMMS columns not recognised: ${head.join(', ')}`);
  for (let k = lines.length - 1; k > 0; k--) { const c = lines[k].split(','), v = num(c[i30]); if (v) { const d = new Date(c[iD < 0 ? 0 : iD]); return { rate: Math.round(v * 100) / 1e4, date: isNaN(d) ? c[0] : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), source: 'Freddie Mac Primary Mortgage Market Survey' }; } }
  throw new Error('No PMMS rate found');
}

const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => ({}));
const out = { ...prev, asOf: new Date().toISOString().slice(0, 10) };
let failed = 0;
for (const [name, fn] of Object.entries({ fmr, inventory, hpi, mortgage })) {
  try {
    out[name] = await fn();
    const n = out[name].counties ? Object.keys(out[name].counties).length + ' counties' : JSON.stringify(out[name]);
    console.log(`✓ ${name}: ${n}${out[name].counts ? ' ' + JSON.stringify(out[name].counts) : ''}`);
  } catch (e) { failed++; console.log(`✗ ${name}: ${e.message}${prev[name] ? ' (kept the earlier data)' : ' (no data for this source yet)'}`); }
}
await writeFile(OUT, JSON.stringify(out));
console.log(`report-sources: wrote ${OUT}${failed ? `, ${failed} source(s) failed` : ''}`);
// Spot check the pipeline was built against: Telfair County, Georgia.
const t = '13271';
console.log('Telfair County check:', JSON.stringify({ fmr: out.fmr?.counties?.[t], hpi: out.hpi?.counties?.[t] || null, inventory: out.inventory?.counties?.[t] }));
