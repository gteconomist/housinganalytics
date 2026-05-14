#!/usr/bin/env node
/**
 * fetch-gazetteer.mjs
 *
 * Downloads the Census Gazetteer counties file (tab-delimited) and writes
 * src/data/generated/gazetteer.json — a county-FIPS → { land_area_sqmi }
 * map used by build-data.mjs to compute population density.
 *
 * The Gazetteer publishes annually. Override the year via GAZETTEER_YEAR env var.
 * The file is small (~150 KB) so this is cheap to refresh.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'gazetteer.json');

const YEAR = process.env.GAZETTEER_YEAR || '2024';
// Gazetteer file naming has varied; we try a few patterns.
const URL_CANDIDATES = [
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer/${YEAR}_Gaz_counties_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer/${YEAR}_gaz_counties_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip`,
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (housinganalytics.org build pipeline)',
  'Accept': 'application/zip, application/octet-stream, */*',
};

async function fetchZip(urls) {
  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) { console.warn('  Empty body'); continue; }
      console.log(`Downloaded ${buf.length.toLocaleString()} bytes.`);
      return buf;
    } catch (e) {
      console.warn(`  ${e.message}`);
    }
  }
  return null;
}

const zipBuf = await fetchZip(URL_CANDIDATES);
if (!zipBuf) {
  console.warn('WARNING: All Gazetteer fetches failed; population density will be unavailable.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

// Minimal in-memory ZIP reader — we only need the single .txt entry inside.
// Format: PK\x03\x04 local file header (30 bytes) + filename + extra + data.
function extractFirstTxtFromZip(buf) {
  let i = 0;
  while (i < buf.length - 30) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) break;
    const compressed = buf.readUInt32LE(i + 18);
    const uncompressed = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    const compressionMethod = buf.readUInt16LE(i + 8);

    if (name.endsWith('.txt')) {
      const data = buf.slice(dataStart, dataStart + compressed);
      if (compressionMethod === 0) return data.toString('utf8');
      if (compressionMethod === 8) return inflateRawSync(data).toString('utf8');
    }
    i = dataStart + compressed;
  }
  return null;
}

const text = extractFirstTxtFromZip(zipBuf);
if (!text) {
  console.warn('WARNING: Could not extract Gazetteer .txt from ZIP.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

// Census Gazetteer counties: tab-delimited, columns:
//   USPS  GEOID  ANSICODE  NAME  POP10/POPULATION  HU10/HOUSING_UNITS  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG
// Header in row 1. GEOID is 5-digit FIPS. ALAND_SQMI is land area in square miles.
const lines = text.split(/\r?\n/).filter(Boolean);
const header = lines[0].split('\t').map(s => s.trim());
const geoidIdx = header.findIndex(h => /^GEOID$/i.test(h));
const sqmiIdx  = header.findIndex(h => /ALAND_SQMI/i.test(h));
if (geoidIdx < 0 || sqmiIdx < 0) {
  console.warn('WARNING: Unexpected Gazetteer column layout:', header);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

const out = {};
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split('\t');
  const geoid = (cols[geoidIdx] || '').trim().padStart(5, '0');
  const sqmi  = parseFloat(cols[sqmiIdx]);
  if (geoid.length === 5 && Number.isFinite(sqmi) && sqmi > 0) {
    out[geoid] = { land_area_sqmi: sqmi };
  }
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out, null, 2));
console.log(`✓ Wrote gazetteer (land area) for ${Object.keys(out).length} counties.`);
