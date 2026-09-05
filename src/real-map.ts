import osmtogeojson from 'osmtogeojson';
import clipping from 'polygon-clipping';
import { project, clipLine, segmentStrip, coastWater, ringArea, buildingHeight, type Point, type Polygon, type RealMap, type MapResponse } from './real-geometry';
export type { RealMap, MapResponse } from './real-geometry';

export function convertRealMap(data: MapResponse, name: string): RealMap {
  const e = data.size / 2, square: Polygon = [[[-e, -e], [e, -e], [e, e], [-e, e], [-e, -e]]];
  const map: RealMap = { ...data, name, buildings: [], roads: [], land: [], water: [], parks: [], trees: [], rivers: [], estimatedHeights: 0 };
  // Do not retain the unprojected OSM payload in the playable world.
  delete (map as RealMap & { osm?: unknown }).osm;
  const geo = osmtogeojson(data.osm, { flatProperties: true }), coasts: Point[][] = [];
  for (const feature of geo.features) {
    const tags = feature.properties ?? {}, geometry = feature.geometry;
    const point = (p: number[]) => project(p[0], p[1], data.lon, data.lat);
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
      const clipped = clipping.intersection(polygon, square) as Polygon[];
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
  if (map.buildings.length > 3500 || map.buildings.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0) > 100000) throw new Error('Этот участок слишком плотный. Выберите меньший размер карты.');
  map.water = map.water.length ? clipping.intersection(clipping.union(map.water), square) as Polygon[] : [];
  map.land = map.water.length ? clipping.difference(square, map.water) as Polygon[] : [square];
  map.parks = map.parks.length && map.land.length ? clipping.intersection(clipping.union(map.parks), map.land) as Polygon[] : [];
  return map;
}
