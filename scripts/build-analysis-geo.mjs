// build-analysis-geo.mjs (PILOT)
// Pulls ACS 2018-2022 5-yr cost-burden + supply tables for all places+counties
// in the pilot states, stores RAW counts per geography (affordability math runs
// client-side), bundles one file per state into public/analysis-data/.
// Env: CENSUS_API_KEY, STATES (comma FIPS, default pilot GA,NC,TN).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as _resolve } from 'node:path';

const KEY = process.env.CENSUS_API_KEY;
const YEAR = 2022; // ACS 2018-2022 5-yr — the vintage HUD CHAS is built from
const STATES = (process.env.STATES || '13,37,47').split(',').map(s => s.trim().padStart(2,'0'));
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = _resolve(__dirname, '..', 'public/analysis-data');

// Tables we pull whole (group()) then slice by known offsets.
const TABLES = ['B25074','B25095','B25118','B25063','B25075','B25003','B19013','B25064','B25077'];

const num = v => { const n = Number(v); return (v==null||!Number.isFinite(n)||n<=-666666666)?0:n; };

async function pull(table, forC, inC) {
  const p = new URLSearchParams();
  p.set('get', `group(${table})`); p.set('for', forC); if (inC) p.set('in', inC); p.set('key', KEY);
  const url = `https://api.census.gov/data/${YEAR}/acs/acs5?${p}`;
  for (let a=0;a<4;a++){
    const r = await fetch(url);
    if (r.status===204) return [];
    if (r.ok) return r.json();
    await new Promise(z=>setTimeout(z,400));
  }
  throw new Error(`fetch failed ${table} ${forC}`);
}

// pull one table for all geographies of one level in a state -> Map geoid->{NAME, vars}
async function pullLevel(table, level, st){
  const forC = level==='place' ? 'place:*' : 'county:*';
  const json = await pull(table, forC, `state:${st}`);
  const out = new Map();
  if (!json.length) return out;
  const h = json[0];
  const si=h.indexOf('state'), pi=h.indexOf(level);
  const ni=h.indexOf('NAME');
  for (const row of json.slice(1)){
    const geoid = row[si] + row[pi];
    const rec = {};
    h.forEach((k,i)=>{ if(k.endsWith('E')) rec[k]=row[i]; });
    out.set(geoid, {name: row[ni], vars: rec});
  }
  return out;
}

// --- model builder from raw vars for one geography ---
const V = (vars, t, i) => num(vars[`${t}_${String(i).padStart(3,'0')}E`]);
const REN_STARTS=[2,11,20,29,38,47,56];          // B25074 income brackets
const OWN_STARTS=[2,11,20,29,38,47,56,65];        // B25095 income brackets
function burdenTriplet(vars, table, starts){
  const total=[],burd=[],sev=[];
  for(const s of starts){
    total.push(Math.round(V(vars,table,s)));
    burd.push(Math.round(V(vars,table,s+4)+V(vars,table,s+5)+V(vars,table,s+6)+V(vars,table,s+7)));
    sev.push(Math.round(V(vars,table,s+7)));
  }
  return {total,burd,sev};
}
function buildModel(vars){
  const ren = burdenTriplet(vars,'B25074',REN_STARTS);
  const own = burdenTriplet(vars,'B25095',OWN_STARTS);
  // rent distribution B25063 cash-rent bands 003..026 (24 bands)
  const rentBands=[]; for(let i=3;i<=26;i++) rentBands.push(Math.round(V(vars,'B25063',i)));
  // value distribution B25075 002..027 (26 bands)
  const valBands=[]; for(let i=2;i<=27;i++) valBands.push(Math.round(V(vars,'B25075',i)));
  // owner HH by income B25118 003..013 (11 brackets)
  const ownInc=[]; for(let i=3;i<=13;i++) ownInc.push(Math.round(V(vars,'B25118',i)));
  return {
    mhi: Math.round(V(vars,'B19013',1)),
    medRent: Math.round(V(vars,'B25064',1)),
    medValue: Math.round(V(vars,'B25077',1)),
    tenure: {total:Math.round(V(vars,'B25003',1)), owner:Math.round(V(vars,'B25003',2)), renter:Math.round(V(vars,'B25003',3))},
    ren, own, rentBands, valBands, ownInc,
  };
}

function stripState(n){ return (n||'').replace(/,\s*[^,]+$/,'').trim(); }

async function run(){
  if(!KEY) throw new Error('CENSUS_API_KEY not set');
  mkdirSync(_resolve(OUT,'states'),{recursive:true});
  const placeIndex=[], countyIndex=[]; let stateName={};
  // state names once
  const sj = await pull('B19013','state:*',null);
  const sh=sj[0], sni=sh.indexOf('NAME'), ssi=sh.indexOf('state');
  for(const row of sj.slice(1)) stateName[row[ssi]]=row[sni];

  for(const st of STATES){
    const bundle={places:{},counties:{}};
    for(const level of ['place','county']){
      // pull all tables for this level+state, merge by geoid
      const merged=new Map();
      for(const t of TABLES){
        const m=await pullLevel(t,level,st);
        for(const [gid,{name,vars}] of m){
          if(!merged.has(gid)) merged.set(gid,{name,vars:{}});
          Object.assign(merged.get(gid).vars,vars);
        }
      }
      for(const [gid,{name,vars}] of merged){
        const model=buildModel(vars);
        if(model.tenure.total<1) continue; // skip empty
        const tgt = level==='place'?bundle.places:bundle.counties;
        tgt[gid]={name:stripState(name),model};
        const idxRec={geoid:gid,name:stripState(name),state_fips:st,state_name:stateName[st]||null};
        (level==='place'?placeIndex:countyIndex).push(idxRec);
      }
      console.log(`  ${stateName[st]} ${level}: ${Object.keys(level==='place'?bundle.places:bundle.counties).length}`);
    }
    writeFileSync(_resolve(OUT,`states/${st}.json`), JSON.stringify(bundle));
  }
  placeIndex.sort((a,b)=>a.name.localeCompare(b.name));
  countyIndex.sort((a,b)=>a.name.localeCompare(b.name));
  writeFileSync(_resolve(OUT,'index.json'), JSON.stringify({
    vintage:'ACS 2018-2022 5-year', generated_states:STATES,
    places:placeIndex, counties:countyIndex
  }));
  console.log(`\nWrote ${STATES.length} state bundles, ${placeIndex.length} places + ${countyIndex.length} counties to index.`);
}
run().catch(e=>{console.error(e);process.exit(1)});
