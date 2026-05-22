#!/usr/bin/env node
/**
 * fetch-gazetteer-places.mjs
 *
 * Downloads the Census Gazetteer places file and writes
 * src/data/generated/gazetteer-places.json — a 7-digit place GEOID →
 * { land_area_sqmi } map used by build-data.mjs to compute population
 * density on place profile pages.
 *
 * Mirrors fetch-gazetteer.mjs (counties); same in-memory ZIP reader, same
 * graceful-degradation pattern. Override the year via GAZETTEER_YEAR env var.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const OUT_DIR    = join(ROOT, 'src', 'data', 'generated');
const OUT_FILE   = join(OUT_DIR, 'gazetteer-places.json');

const YEAR = process.env.GAZETTEER_YEAR || '2024';
const URL_CANDIDATES = [
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer/${YEAR}_Gaz_place_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer/${YEAR}_gaz_place_national.zip`,
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip`,
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
  console.warn('WARNING: All Gazetteer places fetches failed; population density will be unavailable for places.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

function extractFirstTxtFromZip(buf) {
  let i = 0;
  while (i < buf.length - 30) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) break;
    const compressed = buf.readUInt32LE(i + 18);
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
  console.warn('WARNING: Could not extract Gazetteer places .txt from ZIP.');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

// Census Gazetteer places: tab-delimited.
// Columns (typical): USPS  GEOID  ANSICODE  NAME  LSAD  FUNCSTAT  POP/POPULATION
//   HU/HOUSING_UNITS  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG
// GEOID is the 7-digit place code (state FIPS + place FIPS).
const lines = text.split(/\r?\n/).filter(Boolean);
const header = lines[0].split('\t').map(s => s.trim());
const geoidIdx = header.findIndex(h => /^GEOID$/i.test(h));
const sqmiIdx  = header.findIndex(h => /ALAND_SQMI/i.test(h));
if (geoidIdx < 0 || sqmiIdx < 0) {
  console.warn('WARNING: Unexpected Gazetteer places column layout:', header);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
}

const out = {};
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split('\t');
  const geoid = (cols[geoidIdx] || '').trim().padStart(7, '0');
  const sqmi  = parseFloat(cols[sqmiIdx]);
  if (geoid.length === 7 && Number.isFinite(sqmi) && sqmi > 0) {
    out[geoid] = { land_area_sqmi: sqmi };
  }
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out, null, 2));
console.log(`✓ Wrote gazetteer-places (land area) for ${Object.keys(out).length.toLocaleString()} places.`);
