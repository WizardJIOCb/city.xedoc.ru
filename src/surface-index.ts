import type { Polygon, Point } from './real-geometry';

// Polygons produced by clipping are disjoint. Even/odd crossings across all
// rings therefore include land and exclude holes, using only nearby edges.
export class SurfaceIndex {
  private rows = new Map<number, [Point, Point][]>();
  constructor(polygons: Polygon[]) {
    for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i]; if (a[1] === b[1]) continue;
      const edge: [Point, Point] = [a, b];
      for (let row = Math.floor(Math.min(a[1], b[1]) / 64); row <= Math.floor(Math.max(a[1], b[1]) / 64); row++) {
        const edges = this.rows.get(row) ?? []; edges.push(edge); this.rows.set(row, edges);
      }
    }
  }
  contains(x: number, z: number) {
    let inside = false;
    for (const [a, b] of this.rows.get(Math.floor(z / 64)) ?? []) if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    return inside;
  }
}
