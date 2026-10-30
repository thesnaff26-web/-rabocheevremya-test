#!/usr/bin/env python3
"""Prepare OSM railway geometry for evaluation; does not invent railway chainage."""
import argparse
import collections
import hashlib
import json
import math
import statistics
import urllib.parse
import urllib.request
from pathlib import Path

BBOX = [53.6, 119.6, 54.3, 123.1]  # south, west, north, east
QUERY = '[out:json][timeout:40];(way["railway"="rail"](53.6,119.6,54.3,123.1);node["railway"="milestone"](53.6,119.6,54.3,123.1););out geom;'
SOURCE = 'https://overpass-api.de/api/interpreter?' + urllib.parse.urlencode({'data': QUERY})


def distance(a, b):
    return math.hypot((a[0]-b[0])*111195, (a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))


def build(raw):
    source = json.loads(raw)
    if source.get('remark'):
        raise ValueError('Incomplete Overpass response: ' + source['remark'])
    features, seen, lengths, vertices = [], set(), [], set()
    counts = collections.Counter()
    for element in source['elements']:
        tags = element.get('tags', {})
        if element['type'] != 'way' or tags.get('railway') != 'rail':
            continue
        if element['id'] in seen:
            raise ValueError('Duplicate way')
        seen.add(element['id'])
        points = [(float(p['lat']), float(p['lon'])) for p in element['geometry']]
        if len(points) < 2 or any(not math.isfinite(v) for p in points for v in p):
            raise ValueError('Invalid geometry')
        if len(element['nodes']) != len(points):
            raise ValueError('Missing node geometry')
        vertices.update(points)
        kind = tags.get('service', 'main' if tags.get('usage') == 'main' else 'unspecified')
        counts[kind] += 1
        if kind == 'main':
            lengths.extend(distance(a, b) for a, b in zip(points, points[1:]))
        properties = {k: v for k, v in tags.items() if k in {
            'railway', 'usage', 'service', 'name', 'ref', 'railway:track_ref',
            'oneway', 'bridge', 'tunnel', 'layer', 'operator', 'gauge', 'electrified'}}
        properties['osm_way_id'] = element['id']
        features.append({'type': 'Feature', 'id': 'way/' + str(element['id']),
                         'properties': properties,
                         'geometry': {'type': 'LineString', 'coordinates': [[lon, lat] for lat, lon in points]}})
    if not features:
        raise ValueError('No railways returned')
    lengths.sort()
    stats = {'ways': len(features), 'unique_vertices': len(vertices), 'ways_by_service': dict(counts),
             'milestones': sum(e.get('tags', {}).get('railway') == 'milestone' for e in source['elements']),
             'main_track_refs': sum('railway:track_ref' in f['properties'] for f in features if f['properties'].get('usage') == 'main' and 'service' not in f['properties']),
             'main_segment_median_m': round(statistics.median(lengths), 1),
             'main_segment_p95_m': round(lengths[int(.95*len(lengths))], 1),
             'main_segment_max_m': round(max(lengths), 1)}
    result = {'type': 'FeatureCollection', 'name': 'Mogocha–Urusha railway geometry research',
              'metadata': {'status': 'geometry_only_not_chainage_verified', 'runtime_enabled': False,
                           'attribution': '© OpenStreetMap contributors', 'license': 'ODbL-1.0',
                           'license_url': 'https://www.openstreetmap.org/copyright',
                           'source_url': SOURCE, 'query_bbox_s_w_n_e': BBOX,
                           'osm_snapshot': source.get('osm3s', {}).get('timestamp_osm_base'),
                           'raw_sha256': hashlib.sha256(raw).hexdigest(), 'statistics': stats},
              'features': features}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='Previously downloaded Overpass JSON')
    parser.add_argument('--download', action='store_true', help='Download public OSM data from Overpass')
    parser.add_argument('--output', type=Path, default=Path('rail/research/mogocha-urusha-osm.geojson'))
    args = parser.parse_args()
    if bool(args.input) == args.download:
        parser.error('Choose exactly one of --input or --download')
    if args.input:
        raw = args.input.read_bytes()
    else:
        request = urllib.request.Request(SOURCE, headers={'User-Agent': 'RailProfileResearch/1.0'})
        with urllib.request.urlopen(request, timeout=55) as response:
            raw = response.read()
    result = build(raw)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(args.output)
    print(json.dumps(result['metadata']['statistics'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
