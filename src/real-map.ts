import osmtogeojson from 'osmtogeojson';
import * as clipping from './real-clipping';
import { MAX_MAP_BUILDINGS, MAX_MAP_POINTS } from '../server/map-limits.mjs';
import { project, clipLine, segmentStrip, coastWater, ringArea, buildingHeight, type Point, type Polygon, type RealMap, type MapResponse } from './real-geometry';
export type { RealMap, MapResponse } from './real-geometry';

// Centimetre precision prevents coincident OSM edges from creating sub-atomic
// slivers in polygon boolean operations on a 20 km projected coordinate range.
function snapPolygons(polygons: Polygon[]): Polygon[] {
  return polygons.map(p => p.map(r => r.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100] as Point).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])).filter(r => r.length >= 4)).filter(p => p.length > 0);
}

function regionalSurfaces(map: RealMap, progress: (message: string) => void) {
  const e = map.size / 2, cell = 500, count = Math.ceil(map.size / cell);
  const bucket = (polygons: Polygon[]) => {
    const cells = new Map<string, Polygon[]>();
    for (const polygon of polygons) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of polygon[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      for (let x = Math.max(0, Math.floor((minX + e) / cell)); x <= Math.min(count - 1, Math.floor((maxX + e) / cell)); x++) for (let z = Math.max(0, Math.floor((minZ + e) / cell)); z <= Math.min(count - 1, Math.floor((maxZ + e) / cell)); z++) { const key = `${x},${z}`, list = cells.get(key) ?? []; list.push(polygon); cells.set(key, list); }
    }
    return cells;
  };
  const waters = bucket(map.water), parks = bucket(map.parks); map.water = []; map.land = []; map.parks = [];
  for (let x = 0; x < count; x++) {
    progress(`Берега и парки: ${Math.round(x / count * 100)}%…`);
    for (let z = 0; z < count; z++) {
      const a = -e + x * cell, b = -e + z * cell, c = Math.min(e, a + cell), d = Math.min(e, b + cell), key = `${x},${z}`;
      const tile: Polygon = [[[a, b], [c, b], [c, d], [a, d], [a, b]]];
      const water = waters.has(key) ? clipping.intersection(waters.get(key)!, tile) : [];
      const land = water.length ? clipping.difference(tile, water) : [tile];
      map.water.push(...water); map.land.push(...land);
      if (land.length && parks.has(key)) map.parks.push(...clipping.intersection(parks.get(key)!, land));
    }
  }
}

function mapFeatures(osm: MapResponse['osm']) {
  const elements = (osm as { elements: any[] }).elements;
  const native = elements.filter(e => e.type !== 'cc_way');
  const compact = elements.some(e => e.type === 'cc_way');
  // Native relations carry their member geometry. Converting them separately
  // avoids the converter's quadratic cross-relation membership scans.
  const geo = compact ? { features: native.flatMap(item => osmtogeojson({ elements: [item] }, { flatProperties: true }).features) } : osmtogeojson({ elements: native }, { flatProperties: true });
  const members = new Set(native.filter(e => e.type === 'relation' && (e.tags?.building || e.tags?.natural || e.tags?.waterway)).flatMap(e => (e.members ?? []).filter((m: any) => m.type === 'way').map((m: any) => m.ref)));
  for (const item of elements) if (item.type === 'cc_way' && !members.has(item.id)) {
    const tags = Object.fromEntries(Object.entries(item.tags ?? {}).filter(([, value]) => value));
    let geometry = item.geometry;
    if (!geometry || geometry.type !== 'LineString') continue;
    const points = geometry.coordinates;
    const closed = points.length >= 4 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    if (closed && (tags.building || tags.landuse || tags.leisure || ['water', 'wood'].includes(String(tags.natural)) || tags.waterway === 'riverbank')) geometry = { type: 'Polygon', coordinates: [points] };
    geo.features.push({ type: 'Feature', id: `way/${item.id}`, properties: tags, geometry });
  }
  return geo.features;
}

export function convertRealMap(data: MapResponse, name: string, progress: (message: string) => void = () => {}): RealMap {
  progress('Обрабатываем контуры зданий и улицы…');
  const e = data.size / 2, square: Polygon = [[[-e, -e], [e, -e], [e, e], [-e, e], [-e, -e]]];
  const map: RealMap = { ...data, name, buildings: [], roads: [], land: [], water: [], parks: [], trees: [], rivers: [], estimatedHeights: 0 };
  // Do not retain the unprojected OSM payload in the playable world.
  delete (map as RealMap & { osm?: unknown }).osm;
  const features = mapFeatures(data.osm), coasts: Point[][] = [];
  progress(`Получено объектов: ${features.length.toLocaleString('ru')}. Подготавливаем геометрию…`);
  let processed = 0;
  for (const feature of features) {
    if (++processed % 10000 === 0) progress(`Контуры карты: ${Math.round(processed / features.length * 100)}%…`);
    const tags = feature.properties ?? {}, geometry = feature.geometry;
    const point = (p: number[]) => project(p[0], p[1], data.lon, data.lat).map(v => Math.round(v * 100) / 100) as Point;
    if (geometry.type === 'Point') { const p = point(geometry.coordinates); if (tags.natural === 'tree' && Math.abs(p[0]) <= e && Math.abs(p[1]) <= e) map.trees.push(p); continue; }
    const polygons: Polygon[] = geometry.type === 'Polygon' ? [geometry.coordinates.map(r => r.map(point))] : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(p => p.map(r => r.map(point))) : [];
    const lines: Point[][] = geometry.type === 'LineString' ? [geometry.coordinates.map(point)] : geometry.type === 'MultiLineString' ? geometry.coordinates.map(r => r.map(point)) : [];
    if (tags.natural === 'coastline') coasts.push(...lines);
    if (tags.highway) for (const line of lines) for (const points of clipLine(line, e)) {
      const drive = !['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway', 'construction', 'proposed'].includes(tags.highway);
      const width = Math.min(28, Math.max(2, Number.parseFloat(tags.width) || Number(tags.lanes) * 3.2 || (['motorway', 'trunk', 'primary'].includes(tags.highway) ? 13 : drive ? 7 : 2.4)));
      if (tags.tunnel !== 'yes') map.roads.push({ points, width, drive, bridge: tags.bridge === 'yes' || Number(tags.layer) > 0 });
    }
    if (tags.waterway && !['dam', 'weir', 'drain'].includes(tags.waterway)) for (const line of lines) for (const points of clipLine(line, e)) {
      const width = Math.min(200, Number.parseFloat(tags.width) || (tags.waterway === 'river' ? 24 : 6));
      if (tags.waterway === 'river' || tags.waterway === 'canal') map.rivers.push(points);
      for (let i = 1; i < points.length; i++) map.water.push(segmentStrip(points[i - 1], points[i], width));
    }
    for (const polygon of polygons) {
      const clipped = polygon.every(r => r.every(p => Math.abs(p[0]) <= e && Math.abs(p[1]) <= e)) ? [polygon] : clipping.intersection(polygon, square) as Polygon[];
      for (const rings of clipped) {
        if (!rings[0]?.length || ringArea(rings[0]) < 3) continue;
        if (tags.building && tags.building !== 'no') {
          const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
          const id = String(feature.id); const height = buildingHeight(tags, id);
          map.buildings.push({ id, rings, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: Math.max(.5, maxX - minX), depth: Math.max(.5, maxZ - minZ), ...height });
          if (!height.knownHeight) map.estimatedHeights++;
        } else if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir') map.water.push(rings);
        else if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse || tags.natural === 'wood') map.parks.push(rings);
      }
    }
  }
  // Join split coastline ways before clipping; endpoints inside the selection
  // are not enough to infer an ocean and are deliberately left unfilled.
  let joined = true;
  while (joined) { joined = false; outer: for (let i = 0; i < coasts.length; i++) for (let j = 0; j < coasts.length; j++) if (i !== j && Math.hypot(coasts[i].at(-1)![0] - coasts[j][0][0], coasts[i].at(-1)![1] - coasts[j][0][1]) < .1) { coasts[i].push(...coasts[j].slice(1)); coasts.splice(j, 1); joined = true; break outer; } }
  for (const line of coasts) map.water.push(...coastWater(line, e));
  if (map.buildings.length > MAX_MAP_BUILDINGS || map.buildings.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0) > MAX_MAP_POINTS) throw new Error('Этот участок слишком плотный. Выберите меньший размер карты.');
  progress('Собираем берега, реки и озёра…');
  map.water = snapPolygons(map.water);
  if (data.size > 3000) { regionalSurfaces(map, progress); return map; }
  map.water = map.water.length ? snapPolygons(clipping.intersection(clipping.union(map.water), square) as Polygon[]) : [];
  map.land = map.water.length ? clipping.difference(square, map.water) as Polygon[] : [square];
  progress('Собираем парки и леса…');
  map.parks = map.parks.length && map.land.length ? clipping.intersection(clipping.union(map.parks), map.land) as Polygon[] : [];
  return map;
}
