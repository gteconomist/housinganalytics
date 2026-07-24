import json, os, urllib.request, urllib.parse, concurrent.futures as cf
import openpyxl

KEY=open('/tmp/.census_key').read().strip()
STATES=os.environ.get('STATES','13').split(',')   # GA pilot default
MIN_POP=int(os.environ.get('MIN_POP','5000'))

def api(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.load(r)
        except Exception:
            continue
    return None

# 1. county -> CBSA (metro only) from delineation
wb=openpyxl.load_workbook('cbsa_delineation.xlsx', read_only=True)
ws=wb.active
rows=list(ws.iter_rows(values_only=True))
hdr=[str(c) for c in rows[2]]
ci={h:i for i,h in enumerate(hdr)}
county2cbsa={}
cbsa_name={}
for r in rows[3:]:
    if not r or r[ci['CBSA Code']] is None: continue
    cbsa=str(r[ci['CBSA Code']]).strip()
    title=str(r[ci['CBSA Title']]).strip()
    typ=str(r[ci['Metropolitan/Micropolitan Statistical Area']] or '')
    st=str(r[ci['FIPS State Code']]).strip().zfill(2)
    co=str(r[ci['FIPS County Code']]).strip().zfill(3)
    fips=st+co
    county2cbsa[fips]={'cbsa':cbsa,'cbsa_title':title,'metro':typ.startswith('Metropolitan')}
    cbsa_name[cbsa]=title
print('delineation: %d counties mapped, %d CBSAs'%(len(county2cbsa),len(cbsa_name)))

# 2. per state: list places (name+pop), then per-place primary county
places={}
for st in STATES:
    lst=api(f'https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=place:*&in=state:{st}&key={KEY}')
    if not lst: continue
    cand=[]
    for row in lst[1:]:
        name,pop,state,place=row
        pop=int(pop) if pop and pop.lstrip('-').isdigit() else 0
        if pop>=MIN_POP:
            cand.append((state+place, name, state, place, pop))
    print(f'state {st}: {len(cand)} places >= {MIN_POP} pop')
    def county_for(item):
        geoid,name,state,place,pop=item
        d=api(f'https://api.census.gov/data/2020/dec/pl?get=P1_001N&for=county%20(or%20part):*&in=state:{state}&in=place:{place}&key={KEY}')
        best=None
        if d:
            for rr in d[1:]:
                cpop=int(rr[0]) if rr[0] and rr[0].lstrip('-').isdigit() else 0
                cfips=state+rr[-1]
                if best is None or cpop>best[1]: best=(cfips,cpop)
        return geoid,name,state,pop,(best[0] if best else None)
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for geoid,name,state,pop,cfips in ex.map(county_for,cand):
            cb=county2cbsa.get(cfips,{})
            places[geoid]={'geoid':geoid,'name':name.replace(', Georgia','').strip(),
                'state_fips':state,'pop':pop,'county_fips':cfips,
                'cbsa':cb.get('cbsa'),'cbsa_title':cb.get('cbsa_title'),'cbsa_metro':cb.get('metro')}

print('total places resolved:',len(places))
for pl in ['1315172','1310944','1323536','1324768','1368516']:
    p=places.get(pl); print(' ',pl,'->',p['name'] if p else None,'| county',p['county_fips'] if p else None,'| cbsa',p['cbsa_title'] if p else None)

json.dump(places, open('crosswalk-places.json','w'))
json.dump({'county2cbsa':county2cbsa,'cbsa_name':cbsa_name}, open('crosswalk-cbsa.json','w'))
print('wrote crosswalk-places.json, crosswalk-cbsa.json')
