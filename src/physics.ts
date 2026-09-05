import type { Building, City } from './world';
import { inPolygon, type Point } from './real-geometry';

export type Vec = { x: number; y: number; z: number };
export type Motion = Vec & { vx: number; vy: number; vz: number; spin: number; resting?: boolean; submerged?: boolean; impactCooldown?: number; removed?: boolean; supportLevel?: number | null; supportBuilding?: Building };
export type Contact = { t: number; normal: Vec; building: Building };
export type Impact = { x: number; y: number; z: number; speed: number; size: number; water: boolean; building?: Building };

// Swept sphere against an expanded building box. Continuous detection prevents
// fast fragments from tunnelling through thin facades between simulation frames.
export function sweepBox(from: Vec, to: Vec, min: Vec, max: Vec): { t: number; normal: Vec } | null {
  let enter = 0, leave = 1;
  const normal = { x: 0, y: 0, z: 0 };
  const inside = from.x > min.x && from.x < max.x && from.y > min.y && from.y < max.y && from.z > min.z && from.z < max.z;
  if (inside) return null;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) { if (from[axis] < min[axis] || from[axis] > max[axis]) return null; continue; }
    const a = (min[axis] - from[axis]) / delta, b = (max[axis] - from[axis]) / delta;
    const near = Math.min(a, b), far = Math.max(a, b);
    if (near >= enter) { enter = near; normal.x = normal.y = normal.z = 0; normal[axis] = delta > 0 ? -1 : 1; }
    leave = Math.min(leave, far);
    if (enter > leave) return null;
  }
  return enter >= 0 && enter <= 1 && leave >= 0 && Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) > 0 ? { t: enter, normal } : null;
}

export function sweepPrism(from: Vec, to: Vec, triangle: Point[], bottom: number, top: number, radius: number) {
  const [a, b, c] = triangle, sign = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (!sign) return null;
  const planes = [{ x: 0, y: 1, z: 0, distance: top }, { x: 0, y: -1, z: 0, distance: -bottom }];
  for (let i = 0; i < 3; i++) {
    const p = triangle[i], q = triangle[(i + 1) % 3], length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const x = sign * (q[1] - p[1]) / length, z = -sign * (q[0] - p[0]) / length;
    planes.push({ x, y: 0, z, distance: x * p[0] + z * p[1] });
  }
  let enter = 0, leave = 1, inside = true; let normal: Vec | null = null;
  for (const plane of planes) {
    const value = plane.x * from.x + plane.y * from.y + plane.z * from.z - plane.distance - radius;
    if (value > 0) inside = false;
    const delta = plane.x * (to.x - from.x) + plane.y * (to.y - from.y) + plane.z * (to.z - from.z);
    if (Math.abs(delta) < 1e-9) { if (value > 0) return null; continue; }
    const t = -value / delta;
    if (delta < 0 && t >= enter) { enter = t; normal = { x: plane.x, y: plane.y, z: plane.z }; }
    else if (delta > 0) leave = Math.min(leave, t);
    if (enter > leave) return null;
  }
  return !inside && normal && enter >= 0 && enter <= 1 ? { t: enter, normal } : null;
}

export class CollisionWorld {
  private cells = new Map<string, Building[]>();
  private triangleCells = new Map<string, { building: Building; triangle: Point[] }[]>();
  private source: Building[] = [];
  constructor(public city: City) { this.rebuild(); }
  rebuild() {
    this.cells.clear(); this.triangleCells.clear(); this.source = this.city.buildings;
    for (const building of this.source) for (const triangle of building.triangles ?? []) {
      for (let x = Math.floor(Math.min(...triangle.map(p => p[0])) / 64); x <= Math.floor(Math.max(...triangle.map(p => p[0])) / 64); x++) for (let z = Math.floor(Math.min(...triangle.map(p => p[1])) / 64); z <= Math.floor(Math.max(...triangle.map(p => p[1])) / 64); z++) {
        const key = `${x},${z}`, entries = this.triangleCells.get(key) ?? []; entries.push({ building, triangle }); this.triangleCells.set(key, entries);
      }
    }
    for (const b of this.source) for (let x = Math.floor((b.x - b.width / 2 - 5) / 64); x <= Math.floor((b.x + b.width / 2 + 5) / 64); x++) {
      for (let z = Math.floor((b.z - b.depth / 2 - 5) / 64); z <= Math.floor((b.z + b.depth / 2 + 5) / 64); z++) {
        const key = `${x},${z}`, list = this.cells.get(key) ?? []; list.push(b); this.cells.set(key, list);
      }
    }
  }
  sweep(from: Vec, to: Vec, radius = .5): Contact | null {
    if (this.source !== this.city.buildings) this.rebuild();
    const candidates = new Set<Building>(), triangles = new Map<Building, Set<Point[]>>(); let nearest: Contact | null = null;
    for (let x = Math.floor((Math.min(from.x, to.x) - radius) / 64); x <= Math.floor((Math.max(from.x, to.x) + radius) / 64); x++) {
      for (let z = Math.floor((Math.min(from.z, to.z) - radius) / 64); z <= Math.floor((Math.max(from.z, to.z) + radius) / 64); z++) {
        const key = `${x},${z}`; for (const b of this.cells.get(key) ?? []) candidates.add(b);
        for (const entry of this.triangleCells.get(key) ?? []) { const local = triangles.get(entry.building) ?? new Set<Point[]>(); local.add(entry.triangle); triangles.set(entry.building, local); }
      }
    }
    for (const b of candidates) {
      const height = b.health <= 0 ? (b.collapsed && this.city.terrainHeight(b.x, b.z) !== null ? 3 : 0) : b.height * (b.height > 50 && b.roof > .32 ? 1.28 : 1) + 1;
      if (!height) continue;
      const offset = this.city.groundOffset(b.x, b.z);
      let hit = sweepBox(from, to, { x: b.x - b.width / 2 - radius, y: .6 + offset - radius, z: b.z - b.depth / 2 - radius }, { x: b.x + b.width / 2 + radius, y: height + offset + radius, z: b.z + b.depth / 2 + radius });
      if (b.triangles) {
        // The bounding box is only a broad phase: courtyards must stay open.
        hit = null;
        for (const triangle of triangles.get(b) ?? []) { const contact = sweepPrism(from, to, triangle, .6 + offset, height + offset, radius); if (contact && (!hit || contact.t < hit.t)) hit = contact; }
      }
      if (hit && (!nearest || hit.t < nearest.t)) nearest = { ...hit, building: b };
    }
    return nearest;
  }
  walkable(x: number, z: number, clearance = 1) {
    const floor = this.city.terrainHeight(x, z);
    if (floor === null || this.city.waterLevelAt(x, z) > floor + .6) return false;
    if (this.source !== this.city.buildings) this.rebuild();
    for (const b of this.cells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []) {
      if (!b.collapsed && Math.abs(x - b.x) < b.width / 2 + clearance && Math.abs(z - b.z) < b.depth / 2 + clearance) {
        if (!b.footprint || inPolygon(x, z, b.footprint)) return false;
        for (const ring of b.footprint) for (let i = 1; i < ring.length; i++) { const a = ring[i - 1], c = ring[i], dx = c[0] - a[0], dz = c[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / Math.max(.001, dx * dx + dz * dz))); if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < clearance) return false; }
      }
    }
    return true;
  }
  nearestWalkable(x: number, z: number, limit = 55): { x: number; z: number } | null {
    if (this.walkable(x, z, 2)) return { x, z };
    for (let r = 4; r <= limit; r += 4) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (this.walkable(px, pz, 2)) return { x: px, z: pz }; }
    return null;
  }
}

export function advanceBody(body: Motion, dt: number, radius: number, collision: CollisionWorld, water: number | ((x: number, z: number) => number), impact: (hit: Impact) => void) {
  if (body.removed) return;
  const steps = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / steps;
  for (let step = 0; step < steps; step++) {
    body.impactCooldown = Math.max(0, (body.impactCooldown ?? 0) - h);
    if (body.resting && Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.vz) > .8) body.resting = false;
    const land = collision.city.terrainHeight(body.x, body.z);
    const waterLevel = typeof water === 'number' ? water : water(body.x, body.z);
    if (body.resting && (body.supportLevel !== land || (body.supportBuilding && body.supportBuilding.health <= 0)) && (land === null || body.y - radius > land + .3) && !collision.sweep(body, { x: body.x, y: body.y - .4, z: body.z }, radius)) body.resting = false;
    body.supportLevel = land;
    const wet = (land === null || waterLevel > land + .2) && body.y - radius < waterLevel;
    if (wet && !body.submerged) {
      impact({ x: body.x, y: waterLevel, z: body.z, speed: Math.hypot(body.vx, body.vy, body.vz), size: radius, water: true });
      body.submerged = true; body.resting = false; body.vx *= .34; body.vz *= .34; body.vy *= .3;
    } else if (!wet && body.y > waterLevel + radius + 1) body.submerged = false;
    if (body.resting && !wet) continue;
    const from = { x: body.x, y: body.y, z: body.z };
    body.vy -= (wet ? 9 : 28) * h;
    const drag = Math.exp(-(wet ? 2.1 : .11) * h); body.vx *= drag; body.vz *= drag;
    if (wet) { body.vy = Math.max(-9, body.vy); body.spin *= Math.exp(-h * 2); }
    const to = { x: body.x + body.vx * h, y: body.y + body.vy * h, z: body.z + body.vz * h };
    const contact = collision.sweep(from, to, radius);
    if (contact) {
      const n = contact.normal, dot = body.vx * n.x + body.vy * n.y + body.vz * n.z;
      body.x = from.x + (to.x - from.x) * contact.t + n.x * .04; body.y = from.y + (to.y - from.y) * contact.t + n.y * .04; body.z = from.z + (to.z - from.z) * contact.t + n.z * .04;
      if (dot < 0) { body.vx -= 1.28 * dot * n.x; body.vy -= 1.28 * dot * n.y; body.vz -= 1.28 * dot * n.z; }
      body.vx *= .68; body.vz *= .68; body.spin *= .55;
      if (Math.abs(dot) > 4 && !body.impactCooldown) { impact({ x: body.x - n.x * radius, y: body.y - n.y * radius, z: body.z - n.z * radius, speed: Math.abs(dot), size: radius, water: false, building: contact.building }); body.impactCooldown = .18; }
      if (n.y > .5 && Math.hypot(body.vx, body.vz) < 1 && Math.abs(body.vy) < 2) { body.resting = true; body.supportBuilding = contact.building; body.vx = body.vy = body.vz = body.spin = 0; }
    } else Object.assign(body, to);
    const floor = collision.city.terrainHeight(body.x, body.z);
    if (floor !== null && body.y < floor + radius && !wet) {
      const speed = Math.abs(body.vy); body.y = floor + radius; body.vy = speed * .2; body.vx *= .6; body.vz *= .6; body.spin *= .5;
      if (speed > 4 && !body.impactCooldown) { impact({ x: body.x, y: floor, z: body.z, speed, size: radius, water: false }); body.impactCooldown = .18; }
      if (Math.hypot(body.vx, body.vz) < 1 && body.vy < 2) { body.resting = true; body.supportBuilding = undefined; body.vx = body.vy = body.vz = body.spin = 0; }
    }
    // Objects keep simulating until settled or submerged, never freeze on age.
    // A tall passing crest must not cull street-level objects as deep-sea debris.
    if (body.y < Math.min(-2, waterLevel) - 34) body.removed = true;
  }
}
