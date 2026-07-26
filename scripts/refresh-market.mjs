#!/usr/bin/env node
/**
 * refresh-market.mjs — refresh ONLY the market overlay (model.market) inside the
 * already-built public/analysis-data bundles, from a fresh market.json. Leaves
 * ACS + CHAS data untouched. Uses only Node built-ins — no Census key, no deps.
 * Run order (CI): fetch-market.mjs → refresh-market.mjs → commit public/analysis-data.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATES_DIR = resolve(ROOT, 'public/analysis-data/states');
const INDEX = resolve(ROOT, 'public/analysis-data/index.json');

const FIPS_USPS = { '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY' };
const mNormKey = (region, st) => String(region || '').toLowerCase().replace(/,.*$/, '').replace(/\s+(county|city|town|village|borough|cdp)$/, '').trim() + '|' + String(st || '').toLowerCase();

const marketPath = resolve(ROOT, 'src/data/generated/market.json');
if (!existsSync(marketPath)) { console.error('market.json not found — run `node scripts/fetch-market.mjs` first.'); process.exit(1); }
const MARKET = JSON.parse(readFileSync(marketPath, 'utf8'));
const _hasData = Object.keys(MARKET.metros || {}).length > 0 || Object.keys(MARKET.redfinCity || {}).length > 0 || Object.keys(MARKET.redfinCounty || {}).length > 0;
if (!_hasData) { console.error('market.json has no ZORI/Redfin data — aborting so the existing overlay is not wiped.'); process.exit(1); }
const PLACESX = JSON.parse(readFileSync(resolve(ROOT, 'scripts/.master-crosswalk/crosswalk-places.json'), 'utf8'));
const cbx = JSON.parse(readFileSync(resolve(ROOT, 'scripts/.master-crosswalk/crosswalk-cbsa.json'), 'utf8'));
const COUNTY2CBSA = cbx.county2cbsa || {}, CBSA_NAME = cbx.cbsa_name || {};

const metroKey = (nm) => { const [c, st] = String(nm).split(',').map((x) => (x || '').trim()); return st ? c.toLowerCase() + '|' + st.toLowerCase().split('-')[0] : null; };
const cbsaKey  = (t)  => { const [c, st] = String(t).split(',').map((x) => (x || '').trim()); return st ? c.split('-')[0].toLowerCase() + '|' + st.split('-')[0].toLowerCase() : null; };
const zoriByKey = {}; for (const r of Object.values(MARKET.metros || {})) { const k = metroKey(r.name); if (k && r.zori != null) zoriByKey[k] = r.zori; }
const ZORI_BY_CBSA = {}; for (const [code, title] of Object.entries(CBSA_NAME)) { const k = cbsaKey(title); if (k && zoriByKey[k] != null) ZORI_BY_CBSA[code] = zoriByKey[k]; }

function buildMarket(gid, cleanName, level, st) {
  const abbr = FIPS_USPS[st] || '';
  const cbsa = level === 'place' ? (PLACESX[gid] && PLACESX[gid].cbsa) : (COUNTY2CBSA[gid] && COUNTY2CBSA[gid].cbsa);
  const rent = cbsa ? (ZORI_BY_CBSA[cbsa] ?? null) : null;
  const pk = mNormKey(cleanName, abbr);
  const pr = level === 'place' ? (MARKET.redfinCity && MARKET.redfinCity[pk]) : (MARKET.redfinCounty && MARKET.redfinCounty[pk]);
  if (rent == null && !pr) return null;
  return { rent, rentAsOf: (MARKET.asOf && MARKET.asOf.zori) || null, price: pr ? pr.price : null, priceAsOf: pr ? pr.period : null, cbsaTitle: cbsa ? (CBSA_NAME[cbsa] || null) : null };
}

let files = 0, updated = 0;
for (const f of readdirSync(STATES_DIR).filter((x) => x.endsWith('.json'))) {
  const st = f.replace('.json', '');
  const bundle = JSON.parse(readFileSync(join(STATES_DIR, f), 'utf8'));
  for (const [level, coll] of [['place', bundle.places], ['county', bundle.counties]]) {
    for (const [gid, rec] of Object.entries(coll || {})) {
      const mk = buildMarket(gid, rec.name, level, st);
      rec.model.market = mk;
      if (mk) updated++;
    }
  }
  writeFileSync(join(STATES_DIR, f), JSON.stringify(bundle));
  files++;
}
if (existsSync(INDEX)) { const idx = JSON.parse(readFileSync(INDEX, 'utf8')); idx.market_updated = (MARKET.asOf && MARKET.asOf.zori) || null; writeFileSync(INDEX, JSON.stringify(idx)); }
console.log(`refresh-market: ${updated} geographies updated across ${files} state files; ZORI asOf ${MARKET.asOf && MARKET.asOf.zori}`);
