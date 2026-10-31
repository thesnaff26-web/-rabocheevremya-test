#!/usr/bin/env python3
"""Download detailed OSM geometry near every archived corridor section."""
import concurrent.futures
import hashlib
import importlib.util
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / 'research' / 'all-geometry'

def main():
    data = json.loads((ROOT / 'rail/corridor.json').read_text())
    boxes = []
    for section in data['sections']:
        ps = section['points']
        for start in range(0, len(ps)-1, 100):
            part = ps[start:start+101]
            boxes.append([round(min(p[1] for p in part)-.025, 5), round(min(p[2] for p in part)-.04, 5),
                          round(max(p[1] for p in part)+.025, 5), round(max(p[2] for p in part)+.04, 5)])
    CACHE.mkdir(parents=True, exist_ok=True)
    def download(item):
        i, group = item
        dest = CACHE / f'group-{i:02}.json'
        query = '[out:json][timeout:90];(' + ''.join('way["railway"="rail"](' + ','.join(map(str, box)) + ');' for box in group) + ');out geom;'
        if not dest.exists():
            url = 'https://overpass-api.de/api/interpreter?' + urllib.parse.urlencode({'data': query})
            for attempt in range(4):
                try:
                    endpoint = 'https://overpass-api.de/api/interpreter' if attempt % 2 == 0 else 'https://overpass.kumi.systems/api/interpreter'
                    url = endpoint + '?' + urllib.parse.urlencode({'data':query})
                    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'RailProfileGeometry/1.0'}), timeout=110) as response:
                        raw = response.read()
                    parsed = json.loads(raw)
                    if parsed.get('remark'): raise ValueError(parsed['remark'])
                    dest.write_bytes(raw)
                    break
                except Exception:
                    if attempt == 3: raise
                    time.sleep(4*(attempt+1))
        parsed = json.loads(dest.read_bytes())
        print(f'{i+1}/{math.ceil(len(boxes)/5)}: {len(parsed["elements"])} ways', flush=True)
        return parsed
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        parts = list(pool.map(download, enumerate([boxes[i:i+5] for i in range(0,len(boxes),5)])))
    elements = {e['id']:e for part in parts for e in part['elements']}
    # Bounding boxes can include remote railways. Retain only ways near the
    # archived corridor; this does not assign or verify their chainage.
    cells = {}
    for section in data['sections']:
        for _, lat, lon in section['points']:
            cells.setdefault((math.floor(lat/.04), math.floor(lon/.04)), []).append((lat,lon))
    def near_corridor(element):
        for p in element['geometry']:
            lat,lon=p['lat'],p['lon']; x,y=math.floor(lat/.04),math.floor(lon/.04)
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    for at,al in cells.get((x+dx,y+dy),[]):
                        if math.hypot((lat-at)*111195,(lon-al)*111195*math.cos(math.radians(lat))) <= 2000:
                            return True
        return False
    elements = {k:e for k,e in elements.items() if near_corridor(e)}
    spec = importlib.util.spec_from_file_location('builder', ROOT / 'scripts/build-rail-geometry.py')
    builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
    raw = json.dumps({'elements':list(elements.values())}).encode()
    result = builder.build(raw)
    result['name'] = 'Ulan-Ude–Khabarovsk detailed railway geometry'
    result['metadata'].update(runtime_enabled=True, status='geometry_only_chainage_from_unverified_archive',
        query_bbox_s_w_n_e=None, source_url='https://overpass-api.de/api/interpreter',
        query_boxes_s_w_n_e=boxes, osm_snapshots=sorted(set(p.get('osm3s',{}).get('timestamp_osm_base','') for p in parts)))
    target = ROOT / 'rail/route-geometry.geojson'
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(json.dumps(result['metadata']['statistics']), flush=True)
    print('SHA256', hashlib.sha256(target.read_bytes()).hexdigest(), 'BYTES', target.stat().st_size, flush=True)

if __name__ == '__main__': main()
