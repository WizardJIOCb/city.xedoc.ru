import C from 'clipper-lib';
import type { Point, Polygon } from './real-geometry';

type Geometry = Polygon | Polygon[];
const SCALE = 100;
function paths(geometry: Geometry): C.Paths {
  const polygons: Polygon[] = typeof geometry[0]?.[0]?.[0] === 'number' ? [geometry as Polygon] : geometry as Polygon[];
  return polygons.flatMap(polygon => polygon.map((ring, i) => {
    const path = ring.map(([x, z]) => ({ X: Math.round(x * SCALE), Y: Math.round(z * SCALE) }));
    if (C.Clipper.Orientation(path) !== (i === 0)) path.reverse();
    return path;
  }));
}
function operate(type: C.ClipType, subject: Geometry, clip: Geometry = []): Polygon[] {
  const engine = new C.Clipper(), tree = new C.PolyTree();
  engine.StrictlySimple = true;
  if (!engine.AddPaths(paths(subject), C.PolyType.ptSubject, true)) return [];
  engine.AddPaths(paths(clip), C.PolyType.ptClip, true);
  if (!engine.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)) throw new Error('Не удалось собрать контуры карты.');
  const result: Polygon[] = [];
  const ring = (node: C.PolyNode): Point[] => { const points = node.Contour().map(p => [p.X / SCALE, p.Y / SCALE] as Point); return [...points, [...points[0]] as Point]; };
  const visit = (node: C.PolyNode) => {
    if (!node.IsHole() && node.Contour().length) result.push([ring(node), ...node.Childs().filter(child => child.IsHole()).map(ring)]);
    node.Childs().forEach(visit);
  };
  tree.Childs().forEach(visit); return result;
}
export const union = (geometry: Geometry) => operate(C.ClipType.ctUnion, geometry);
export const intersection = (a: Geometry, b: Geometry) => operate(C.ClipType.ctIntersection, a, b);
export const difference = (a: Geometry, b: Geometry) => operate(C.ClipType.ctDifference, a, b);
