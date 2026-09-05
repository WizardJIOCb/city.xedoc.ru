import type osmtogeojson from 'osmtogeojson';
import { seededRandom } from './model.js';

export type Point = [number, number];
export type Polygon = Point[][];
export type RealBuilding = { id: string; rings: Polygon; x: number; z: number; width: number; depth: number; height: number; knownHeight: boolean };
export type RealRoad = { points: Point[]; width: number; drive: boolean; bridge: boolean };
export type RealMap = { lat: number; lon: number; size: number; name: string; buildings: RealBuilding[]; roads: RealRoad[]; land: Polygon[]; water: Polygon[]; parks: Polygon[]; trees: Point[]; rivers: Point[][]; estimatedHeights: number; fetchedAt: string };
export type MapResponse = { lat: number; lon: number; size: number; osm: Parameters<typeof osmtogeojson>[0]; fetchedAt: string };
export function project(lon: number, lat: number, centerLon: number, centerLat: number): Point {
  return [(lon - centerLon) * 111320 * Math.cos(centerLat * Math.PI / 180), (centerLat - lat) * 111320];
}
export function inRing(x: number, z: number, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function inPolygon(x: number, z: number, rings: Polygon) { return inRing(x, z, rings[0]) && !rings.slice(1).some(r => inRing(x, z, r)); }
export function ringArea(ring: Point[]) { return Math.abs(ring.reduce((sum, p, i) => { const n = ring[(i + 1) % ring.length]; return sum + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2; }
export function buildingHeight(tags: Record<string, string>, id: string) {
  const explicit = Number.parseFloat(tags.height?.replace(',', '.') ?? '');
  if (explicit > 0) return { height: Math.min(350, Math.max(3, /ft|feet|'/.test(tags.height) ? explicit * .3048 : explicit)), knownHeight: true };
  const floors = Number.parseFloat(tags['building:levels']);
  if (floors > 0) return { height: Math.min(350, Math.max(3, floors * 3.2 + 1.2)), knownHeight: true };
  const random = seededRandom(id)();
  const type = tags.building;
  return { height: ['house', 'detached', 'garage', 'garages', 'shed'].includes(type) ? 4 + random * 5 : ['industrial', 'warehouse', 'retail'].includes(type) ? 7 + random * 7 : 10 + Math.floor(random * 7) * 3.2, knownHeight: false };
}
export function clipLine(points: Point[], extent: number): Point[][] {
  const parts: Point[][] = []; let part: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1]; let enter = 0, leave = 1;
    for (const [p, q] of [[-dx, a[0] + extent], [dx, extent - a[0]], [-dz, a[1] + extent], [dz, extent - a[1]]]) {
      if (!p) { if (q < 0) leave = -1; } else if (p < 0) enter = Math.max(enter, q / p); else leave = Math.min(leave, q / p);
    }
    if (enter > leave) { if (part.length > 1) parts.push(part); part = []; continue; }
    const first: Point = [a[0] + enter * dx, a[1] + enter * dz], last: Point = [a[0] + leave * dx, a[1] + leave * dz];
    if (part.length && Math.hypot(part.at(-1)![0] - first[0], part.at(-1)![1] - first[1]) > .01) { parts.push(part); part = []; }
    if (!part.length) part.push(first); part.push(last);
    if (leave < 1) { parts.push(part); part = []; }
  }
  if (part.length > 1) parts.push(part); return parts;
}
export function segmentStrip(a: Point, b: Point, width: number): Polygon {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, x = -(b[1] - a[1]) / length * width / 2, z = (b[0] - a[0]) / length * width / 2;
  return [[[a[0] + x, a[1] + z], [b[0] + x, b[1] + z], [b[0] - x, b[1] - z], [a[0] - x, a[1] - z], [a[0] + x, a[1] + z]]];
}

// OSM coastlines have water to their right. Close each clipped coast along
// the clockwise boundary of the selected square to retain the ocean side.
export function coastWater(line: Point[], e: number): Polygon[] {
  const perimeter = (p: Point) => Math.abs(p[1] + e) < .1 ? p[0] + e : Math.abs(p[0] - e) < .1 ? 2 * e + p[1] + e : Math.abs(p[1] - e) < .1 ? 4 * e + e - p[0] : Math.abs(p[0] + e) < .1 ? 6 * e + e - p[1] : -1;
  const output: Polygon[] = [];
  for (const part of clipLine(line, e)) {
    const first = perimeter(part[0]), last = perimeter(part.at(-1)!); if (first < 0 || last < 0) continue;
    const ring = [...part], end = first <= last ? first + 8 * e : first;
    for (let corner = (Math.floor(last / (2 * e)) + 1) * 2 * e; corner < end; corner += 2 * e) ring.push([[ -e, -e ], [e, -e], [e, e], [-e, e]][Math.round(corner / (2 * e)) % 4] as Point);
    ring.push(part[0]); output.push([ring]);
  }
  return output;
}

