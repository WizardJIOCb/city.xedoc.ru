import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, City, Citizen } from './world';
import { inPolygon, ringArea, type Polygon, type Point, type RealMap, type RealBuilding } from './real-geometry';

export function shapeOf(rings: Polygon, x = 0, z = 0, sx = 1, sz = 1) {
  const points = (ring: Point[]) => ring.map(p => new T.Vector2((p[0] - x) / sx, -(p[1] - z) / sz));
  const shape = new T.Shape(points(rings[0])); shape.holes = rings.slice(1).map(r => new T.Path(points(r))); return shape;
}

// Share roof vertices and index the walls instead of expanding each triangle.
// This keeps full OSM contours and courtyards affordable on regional maps.
export function footprintGeometry(spec: RealBuilding, triangles: Point[][]) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const roof = new Map<string, number>();
  const vertex = (p: Point, y: number, nx: number, ny: number, nz: number) => {
    const id = positions.length / 3; positions.push((p[0] - spec.x) / spec.width, y, (p[1] - spec.z) / spec.depth); normals.push(nx, ny, nz); return id;
  };
  for (const tri of triangles) {
    const ids = tri.map(p => { const key = `${p[0]},${p[1]}`; if (!roof.has(key)) roof.set(key, vertex(p, .5, 0, 1, 0)); return roof.get(key)!; });
    const [a, b, c] = tri;
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) ids.reverse();
    indices.push(...ids);
  }
  spec.rings.forEach((ring, ri) => {
    const signed = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const direction = Math.sign(signed) * (ri ? -1 : 1);
    for (let i = 1; i < ring.length; i++) {
      let a = ring[i - 1], b = ring[i]; if (direction < 0) [a, b] = [b, a];
      const dx = (b[0] - a[0]) / spec.width, dz = (b[1] - a[1]) / spec.depth, length = Math.hypot(dx, dz); if (length < 1e-8) continue;
      const nx = dz / length, nz = -dx / length, v = vertex(a, -.5, nx, 0, nz);
      vertex(a, .5, nx, 0, nz); vertex(b, .5, nx, 0, nz); vertex(b, -.5, nx, 0, nz);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  });
  return new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3)).setAttribute('normal', new T.Float32BufferAttribute(normals, 3)).setIndex(indices);
}

export class FootprintBatch {
  mesh: T.BatchedMesh;
  private matrix = new T.Matrix4(); private transform = new T.Object3D();
  private placed = new Map<number, { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; rx: number; rz: number }>();
  constructor(private city: City, buildings: RealBuilding[]) {
    const source = city.facade.mesh.material as T.MeshStandardMaterial, material = source.clone();
    material.onBeforeCompile = (shader, renderer) => { source.onBeforeCompile(shader, renderer); shader.vertexShader = shader.vertexShader.replaceAll('instanceMatrix * vec4(position,1.0)', 'batchingMatrix * vec4(position,1.0)'); };
    material.customProgramCacheKey = () => 'osm-facades-v1';
    const points = buildings.reduce((n, b) => n + b.rings.reduce((m, ring) => m + ring.length, 0), 20);
    this.mesh = new T.BatchedMesh(Math.max(1, buildings.length), points * 5, points * 12, material);
    this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.sortObjects = false; city.group.add(this.mesh);
  }
  add(spec: RealBuilding, color: T.Color, triangles: Point[][]) {
    const geometry = footprintGeometry(spec, triangles);
    const id = this.mesh.addInstance(this.mesh.addGeometry(geometry)); geometry.dispose();
    this.set(id, spec.x, spec.height / 2 + .8, spec.z, spec.width, spec.height, spec.depth); this.color(id, color); return id;
  }
  set(id: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    this.placed.set(id, { x, y, z, sx, sy, sz, ry, rx, rz });
    this.transform.position.set(x, y + this.city.groundOffset(x, z), z); this.transform.scale.set(sx, sy, sz); this.transform.rotation.set(rx, ry, rz); this.transform.updateMatrix();
    this.mesh.setMatrixAt(id, this.transform.matrix); this.mesh.setVisibleAt(id, sx > 0 && sy > 0 && sz > 0);
  }
  hide(id: number) { this.mesh.setVisibleAt(id, false); this.placed.delete(id); }
  color(id: number, value: T.ColorRepresentation) { this.mesh.setColorAt(id, new T.Color(value)); }
  refreshGround() { for (const [id, p] of this.placed) { this.mesh.getMatrixAt(id, this.matrix); this.matrix.elements[13] = p.y + this.city.groundOffset(p.x, p.z); this.mesh.setMatrixAt(id, this.matrix); } }
}

export type Route = { points: Point[]; lengths: number[]; total: number; offset: number };
export function makeRoute(points: Point[], offset = 0): Route {
  const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, lengths, total: lengths.at(-1)!, offset };
}
export function routePosition(route: Route, distance: number) {
  const progress = ((distance % (route.total * 2)) + route.total * 2) % (route.total * 2), direction = progress <= route.total ? 1 : -1;
  const d = direction > 0 ? progress : route.total * 2 - progress;
  let i = 1; while (i < route.lengths.length - 1 && route.lengths[i] < d) i++;
  const a = route.points[i - 1], b = route.points[i], length = route.lengths[i] - route.lengths[i - 1] || 1, t = (d - route.lengths[i - 1]) / length;
  const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
  return { x: a[0] + (b[0] - a[0]) * t - dz * route.offset, z: a[1] + (b[1] - a[1]) * t + dx * route.offset, heading: Math.atan2(dx * direction, dz * direction) };
}
export function moveOnRoute(person: Citizen, dt: number) {
  person.progress = (person.progress ?? 0) + Math.abs(person.speed) * dt;
  Object.assign(person, routePosition(person.route!, person.progress));
}

function surface(city: City, polygons: Polygon[], height: number, color: string, thickness = 0) {
  const geometries = polygons.filter(p => p[0].length > 3).map(p => {
    const shape = shapeOf(p), geo = thickness ? new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 }) : new T.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); geo.translate(0, height - thickness, 0); return (geo.index ? geo.toNonIndexed() : geo).deleteAttribute('uv');
  });
  if (!geometries.length) return;
  const merged = mergeGeometries(geometries), positions = merged.attributes.position, vertices: number[] = [];
  // Interior vertices let a local flood lower the middle of a large OSM polygon.
  const split = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    const lengths = [a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a)], longest = Math.max(...lengths);
    if (longest <= Math.max(32, city.extent / 64) ** 2) { vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray()); return; }
    const i = lengths.indexOf(longest), p = [a, b, c][i], q = [b, c, a][i], r = [c, a, b][i], middle = p.clone().add(q).multiplyScalar(.5);
    split(p, middle, r); split(middle, q, r);
  };
  for (let i = 0; i < positions.count; i += 3) split(new T.Vector3().fromBufferAttribute(positions, i), new T.Vector3().fromBufferAttribute(positions, i + 1), new T.Vector3().fromBufferAttribute(positions, i + 2));
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals(); merged.dispose();
  const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, roughness: .98 }));
  mesh.receiveShadow = true; mesh.name = 'real-terrain'; mesh.userData.originalTerrain = geometry.attributes.position.array.slice(); city.group.add(mesh); geometries.forEach(g => g.dispose());
}

export function buildRealWorld(city: City, map: RealMap) {
  surface(city, map.land, .7, '#94998a', 9); surface(city, map.parks, .74, '#72905f');
  city.realBatch = new FootprintBatch(city, map.buildings);
  for (const spec of map.buildings) {
    const hue = city.rng(), color = new T.Color().setHSL(.075 + hue * .08, .12 + hue * .12, .42 + hue * .18);
    const b: Building = { ...spec, color, hue, centrality: 0, roof: 0, health: 100, fire: 0, collapsed: false, collapse: 0, parts: [], tiltX: .06, tiltZ: -.04, footprint: spec.rings };
    const contour = spec.rings[0].slice(0, -1).map(p => new T.Vector2(...p)), holes = spec.rings.slice(1).map(r => r.slice(0, -1).map(p => new T.Vector2(...p)));
    const points = [...contour, ...holes.flat()]; b.triangles = T.ShapeUtils.triangulateShape(contour, holes).map(face => face.map(i => [points[i].x, points[i].y] as Point));
    const id = city.realBatch.add(spec, color, b.triangles); b.parts.push({ batch: city.realBatch, id, x: b.x, y: b.height / 2 + .8, z: b.z, sx: b.width, sy: b.height, sz: b.depth }); city.buildings.push(b);
  }
  const roadRoutes: { route: Route; drive: boolean; width: number }[] = [];
  for (const road of map.roads) {
    const route = makeRoute(road.points); if (route.total < 6) continue; roadRoutes.push({ route, drive: road.drive, width: road.width });
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < .1) continue;
      const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
      if (road.bridge) {
        const count = Math.ceil(length / 20);
        for (let k = 0; k < count; k++) {
          const t = (k + .5) / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const dock = city.addDock(x, .5, z, road.width + 2, 1, length / count + .1, '#758384', angle);
          dock.ids.push(city.solid.add(x, 1.06, z, road.width, .08, length / count + .1, road.drive ? '#435157' : '#bcb89e', angle));
          if (road.drive) dock.ids.push(city.solid.add(x, 1.115, z, .28, .02, Math.min(4.2, length / count), '#d3d0b5', angle));
        }
        continue;
      } else city.paving!.add((a[0] + b[0]) / 2, .77, (a[1] + b[1]) / 2, road.width + 2, .08, length + .3, '#b7b4a4', angle);
      city.paving!.add((a[0] + b[0]) / 2, road.bridge ? 1.06 : .83, (a[1] + b[1]) / 2, road.width, .08, length + .3, road.drive ? '#435157' : '#bcb89e', angle);
      if (road.drive && map.size <= 3000) for (let d = 6; d < length - 2 && city.paving!.used < 36000; d += 13) city.paving!.add(a[0] + (b[0] - a[0]) * d / length, road.bridge ? 1.115 : .885, a[1] + (b[1] - a[1]) * d / length, .28, .02, 4.2, '#d3d0b5', angle);
    }
  }
  for (const point of map.trees.slice(0, 1600)) if (map.land.some(p => inPolygon(...point, p))) city.tree(...point, 2.5 + city.rng() * 2);
  for (const park of map.parks) {
    const xs = park[0].map(p => p[0]), zs = park[0].map(p => p[1]), minX = Math.min(...xs), minZ = Math.min(...zs), w = Math.max(...xs) - minX, d = Math.max(...zs) - minZ;
    for (let i = 0; i < Math.min(500, ringArea(park[0]) / 180) && city.trees.length < 2000; i++) {
      const x = minX + city.rng() * w, z = minZ + city.rng() * d;
      if (inPolygon(x, z, park) && !map.buildings.some(b => inPolygon(x, z, b.rings))) city.tree(x, z, 2.8 + city.rng() * 2.5);
    }
  }
  const driving = roadRoutes.filter(r => r.drive && r.route.total > 25);
  for (let i = 0; i < Math.min(240, driving.length * 2); i++) {
    const road = driving[i % driving.length], route = { ...road.route, offset: road.width * .23 }, progress = city.rng() * route.total, p = routePosition(route, progress);
    if (city.baseTerrainHeight(p.x, p.z) === null) continue;
    const id = city.cars.add(p.x, 1.4, p.z, 2.1, 1.05, 4.5, ['#d6c4a0', '#659eab', '#c26d57', '#e2dfcf'][i % 4], p.heading), extra = city.cabins.add(p.x, 2.1, p.z, 1.8, .75, 2.2, '#718e9a', p.heading);
    city.traffic.push({ ...p, route, progress, speed: 7 + city.rng() * 9, id, extra, alive: true, axis: false, start: 0, end: 0, phase: 0 });
  }
  for (let i = 0; i < Math.min(400, roadRoutes.length * 2); i++) {
    const road = roadRoutes[i % roadRoutes.length], route = { ...road.route, offset: road.width / 2 + .6 }, progress = city.rng() * route.total, p = routePosition(route, progress);
    if (city.baseTerrainHeight(p.x, p.z) === null || map.buildings.some(b => inPolygon(p.x, p.z, b.rings))) continue;
    const id = city.people.add(p.x, 1.3, p.z, .6, 1.05, .5, '#a7a5b0'), extra = city.heads.add(p.x, 2.05, p.z, 1, 1, 1, '#d3b090');
    city.pedestrians.push({ ...p, route, progress, speed: 1 + city.rng(), id, extra, alive: true, axis: false, start: 0, end: 0, phase: city.rng() * 6 });
  }
  for (const points of map.rivers.slice(0, 3)) {
    const curve = new T.CurvePath<T.Vector3>(); for (let i = 1; i < points.length; i++) curve.add(new T.LineCurve3(new T.Vector3(points[i - 1][0], 0, points[i - 1][1]), new T.Vector3(points[i][0], 0, points[i][1])));
    if (curve.getLength() < 80) continue;
    const ship = new T.Group(), hull = new T.Mesh(new T.BoxGeometry(5, 3, 15), new T.MeshStandardMaterial({ color: '#cdbf9d' })), cabin = new T.Mesh(new T.BoxGeometry(3.5, 3, 7), new T.MeshStandardMaterial({ color: '#c3d4d2' })); cabin.position.y = 3; ship.add(hull, cabin);
    Object.assign(ship.userData, { alive: true, ferry: true, route: curve, routeLength: curve.getLength(), offset: city.rng() }); ship.position.copy(curve.getPointAt(ship.userData.offset)); city.ships.push(ship); city.group.add(ship);
  }
  for (let i = 0; i < 2; i++) city.createPlane(i);
}
