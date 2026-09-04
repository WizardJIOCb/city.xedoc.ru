import * as T from 'three';
import { Batch, City, type Hit } from './world';
import { advanceBody, type Motion } from './physics';
import { blastImpulse } from './model.js';
import type { Effects } from './effects';

export const TEAMS = [
  { name: 'Синие', color: '#60baf0' }, { name: 'Красные', color: '#ed7064' }, { name: 'Золотые', color: '#e6c265' }
] as const;
export const UNITS = {
  assault: { name: 'Штурмовой отряд', count: 6, hp: 100, speed: 8, range: 160, interval: .7, damage: 22 },
  heavy: { name: 'Тяжёлый отряд', count: 4, hp: 190, speed: 5, range: 145, interval: .32, damage: 18 },
  scout: { name: 'Разведчики', count: 5, hp: 75, speed: 11, range: 235, interval: 1.4, damage: 38 }
} as const;
export type UnitKind = keyof typeof UNITS;
type Fighter = Motion & { id: number; team: number; squad: number; kind: UnitKind; hp: number; alive: boolean; dropping: boolean; heading: number; age: number; fireClock: number; pathClock: number; path: { x: number; z: number }[]; pathIndex: number; target?: Fighter; rx: number; rz: number };
type Bullet = { id: number; team: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; damage: number };

class Heap {
  items: { key: string; score: number }[] = [];
  push(item: { key: string; score: number }) { this.items.push(item); let i = this.items.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (this.items[parent].score <= item.score) break; this.items[i] = this.items[parent]; i = parent; } this.items[i] = item; }
  pop() { const result = this.items[0], last = this.items.pop(); if (this.items.length && last) { let i = 0; while (i * 2 + 1 < this.items.length) { let child = i * 2 + 1; if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++; if (last.score <= this.items[child].score) break; this.items[i] = this.items[child]; i = child; } this.items[i] = last; } return result; }
}

export function findRoute(city: City, start: { x: number; z: number }, goal: { x: number; z: number }, budget = 2200) {
  const step = 6, sx = Math.round(start.x / step), sz = Math.round(start.z / step), gx = Math.round(goal.x / step), gz = Math.round(goal.z / step);
  const key = (x: number, z: number) => `${x},${z}`, first = key(sx, sz), open = new Heap(), cost = new Map([[first, 0]]), parents = new Map<string, string>(), closed = new Set<string>();
  open.push({ key: first, score: 0 }); let end: string | null = null, best = first, bestDistance = Infinity;
  while (open.items.length && closed.size < budget) {
    const current = open.pop().key; if (closed.has(current)) continue; closed.add(current);
    const [x, z] = current.split(',').map(Number), distance = Math.abs(x - gx) + Math.abs(z - gz);
    if (distance < bestDistance) { bestDistance = distance; best = current; }
    if (distance <= 2) { end = current; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = key(nx, nz), newCost = cost.get(current)! + 1;
      if (closed.has(next) || (cost.get(next) ?? Infinity) <= newCost || !city.collision.walkable(nx * step, nz * step, 1.2)) continue;
      if (city.collision.sweep({ x: x * step, y: 2, z: z * step }, { x: nx * step, y: 2, z: nz * step }, .8)) continue;
      cost.set(next, newCost); parents.set(next, current); open.push({ key: next, score: newCost + Math.abs(nx - gx) + Math.abs(nz - gz) });
    }
  }
  // Partial routes let units advance through large districts across bounded searches.
  end ??= best; const path: { x: number; z: number }[] = [];
  while (end !== first && parents.has(end)) { const [x, z] = end.split(',').map(Number); path.push({ x: x * step, z: z * step }); end = parents.get(end)!; }
  return path.reverse();
}

export class Squads {
  group = new T.Group(); fighters: Fighter[] = []; bullets: Bullet[] = []; deployed = 0; shots = 0; kills = 0; team = 0;
  torso: Batch; head: Batch; limbs: Batch; gun: Batch; canopies: Batch; cords: Batch; markers: Batch; tracers: Batch;
  private bulletCursor = 0; private thinkCursor = 0; private soundClock = 0;
  constructor(public scene: T.Scene, public city: City, public effects: Effects) {
    const box = new T.BoxGeometry(1, 1, 1), cloth = new T.MeshStandardMaterial({ roughness: .85 });
    this.torso = new Batch(this.group, box, cloth, 96); this.head = new Batch(this.group, new T.SphereGeometry(.6, 8, 6), cloth, 96);
    this.limbs = new Batch(this.group, box, cloth, 384); this.gun = new Batch(this.group, box, new T.MeshStandardMaterial({ roughness: .5 }), 96);
    this.canopies = new Batch(this.group, new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: .9 }), 96);
    this.cords = new Batch(this.group, box, new T.MeshBasicMaterial({ color: '#d9dfd6' }), 384, false);
    const ring = new T.RingGeometry(2.7, 3.3, 20); ring.rotateX(-Math.PI / 2);
    this.markers = new Batch(this.group, ring, new T.MeshBasicMaterial({ transparent: true, opacity: .65, depthWrite: false }), 96, false);
    this.tracers = new Batch(this.group, box, new T.MeshBasicMaterial({ toneMapped: false }), 256, false);
    scene.add(this.group); this.attach(city);
  }
  attach(city: City) { this.city = city; city.onHit = hit => this.hit(hit); }
  deploy(kind: string, x: number, z: number, team = this.team) {
    if (!(kind in UNITS) || team < 0 || team >= TEAMS.length) return false;
    const spec = UNITS[kind as UnitKind];
    if (this.fighters.length + spec.count > 96) { this.effects.onEvent('Лимит десанта', 'До 96 бойцов на карту. Восстановите город для новой битвы.'); return false; }
    const center = this.city.collision.nearestWalkable(x, z);
    if (!center) { this.effects.onEvent('Нужна площадка на суше', 'Выберите улицу, парк или остров.'); return false; }
    this.deployed++;
    for (let i = 0; i < spec.count; i++) {
      const a = i * Math.PI * 2 / spec.count, point = this.city.collision.nearestWalkable(center.x + Math.cos(a) * 10, center.z + Math.sin(a) * 10) ?? center;
      const id = this.fighters.length, color = TEAMS[team].color;
      this.fighters.push({ ...point, y: 72 + i * 3, vx: 0, vy: -15, vz: 0, spin: 0, id, team, squad: this.deployed, kind: kind as UnitKind, hp: spec.hp, alive: true, dropping: true, heading: a, age: 0, fireClock: i * .12, pathClock: i * .07, path: [], pathIndex: 0, rx: 0, rz: 0 });
      this.torso.add(0, -100, 0, 1, 1, 1, color); this.head.add(0, -100, 0, 1, 1, 1, color); this.gun.add(0, -100, 0, 1, 1, 1, '#303e41'); this.canopies.add(0, -100, 0, 1, 1, 1, color); this.markers.add(point.x, .84, point.z, 1, 1, 1, color);
      for (let j = 0; j < 4; j++) { this.limbs.add(0, -100, 0, 1, 1, 1, color); this.cords.add(0, -100, 0, 1, 1, 1, '#e4e6d5'); }
    }
    this.effects.onEvent(spec.name, `${TEAMS[team].name} · ${spec.count} бойцов. Высадите другую команду рядом — начнётся бой.`); return true;
  }
  private die(unit: Fighter, impulse?: { vx: number; vy: number; vz: number }) {
    if (!unit.alive) return; unit.alive = false; unit.dropping = false; unit.hp = 0; this.kills++;
    Object.assign(unit, impulse ?? { vx: (Math.random() - .5) * 8, vy: 5, vz: (Math.random() - .5) * 8 }); unit.spin = 2 + Math.random() * 3;
    this.effects.spray(unit.x, unit.y, unit.z, unit.vx, unit.vz, 22); this.effects.splatter(unit.x, unit.z, 1.5); this.markers.hide(unit.id);
  }
  hit(hit: Hit) {
    for (const u of this.fighters) if (u.alive) {
      const d = Math.hypot(u.x - hit.x, u.z - hit.z);
      if (d >= hit.radius || (hit.front && (d <= hit.front.previous || d > hit.front.current))) continue;
      u.hp -= hit.strength * (1 - d / hit.radius) * 2;
      if (u.hp <= 0) this.die(u, blastImpulse(u.x, u.z, hit.x, hit.z, hit.radius, hit.strength, .85));
    }
  }
  private shoot(unit: Fighter, target: Fighter) {
    const spec = UNITS[unit.kind], direction = new T.Vector3(target.x - unit.x, target.y - unit.y + (Math.random() - .5) * 1.2, target.z - unit.z);
    direction.x += (Math.random() - .5) * 1.3; direction.z += (Math.random() - .5) * 1.3; direction.normalize().multiplyScalar(270);
    const id = this.bulletCursor++ % 256;
    if (id >= this.tracers.used) this.tracers.add(0, -100, 0, 1, 1, 1, TEAMS[unit.team].color); else this.tracers.color(id, TEAMS[unit.team].color);
    this.bullets[id] = { id, x: unit.x, y: unit.y + .25, z: unit.z, vx: direction.x, vy: direction.y, vz: direction.z, life: spec.range / 270 + .08, team: unit.team, damage: spec.damage };
    this.effects.fire.emit(unit.x + direction.x * .006, unit.y + .4, unit.z + direction.z * .006, 0, 1, 0, 2.5, .12, '#ffe3a0'); this.shots++;
    if (this.soundClock <= 0) { this.effects.sound.shot(); this.soundClock = .09; }
    unit.fireClock = spec.interval * (.85 + Math.random() * .3);
  }
  update(dt: number, time: number) {
    if (dt <= 0) return; this.soundClock -= dt;
    // At most two navigation searches per frame; the rest use their current path.
    const thinkers = new Set([this.thinkCursor++ % Math.max(1, this.fighters.length), this.thinkCursor++ % Math.max(1, this.fighters.length)]);
    for (const u of this.fighters) {
      u.age += dt; u.fireClock -= dt; u.pathClock -= dt;
      if (!u.alive) {
        advanceBody(u, dt, .6, this.city.collision, this.effects.waterAt, hit => this.effects.impact(hit));
        if (u.resting) { u.rx = Math.PI / 2; u.rz = 0; } else { u.rx += u.spin * dt; u.rz += u.spin * dt * .3; }
      } else if (u.dropping) {
        u.y -= dt * 15; const floor = (this.city.terrainHeight(u.x, u.z) ?? -2) + 1.9;
        if (u.y <= floor) { u.y = floor; u.dropping = false; this.effects.impact({ x: u.x, y: floor - 1.9, z: u.z, speed: 6, size: .5, water: false }); }
      } else {
        u.y = (this.city.terrainHeight(u.x, u.z) ?? -2) + 1.9;
        if (this.effects.waterAt(u.x, u.z) > u.y + .2) { this.die(u); continue; }
        let nearest: Fighter | undefined, distance = Infinity;
        for (const other of this.fighters) if (other.alive && !other.dropping && other.team !== u.team) { const d = Math.hypot(other.x - u.x, other.z - u.z); if (d < distance) { nearest = other; distance = d; } }
        u.target = nearest;
        if (nearest) {
          const spec = UNITS[u.kind]; u.heading = Math.atan2(nearest.x - u.x, nearest.z - u.z);
          const visible = distance < spec.range && !this.city.collision.sweep({ x: u.x, y: u.y + .25, z: u.z }, { x: nearest.x, y: nearest.y + .25, z: nearest.z }, .08);
          if (visible) { if (u.fireClock <= 0) this.shoot(u, nearest); }
          else {
            if (u.pathClock <= 0 && thinkers.has(u.id)) { u.path = findRoute(this.city, u, nearest); u.pathIndex = 0; u.pathClock = 1.8 + Math.random(); }
            const point = u.path[u.pathIndex];
            if (point) { const dx = point.x - u.x, dz = point.z - u.z, length = Math.hypot(dx, dz), move = Math.min(length, spec.speed * dt); if (length < .8) u.pathIndex++; else { const x = u.x + dx / length * move, z = u.z + dz / length * move; if (this.city.collision.walkable(x, z, .8) && !this.city.collision.sweep(u, { x, y: u.y, z }, .7)) { u.x = x; u.z = z; u.y = (this.city.terrainHeight(x, z) ?? .7) + 1.9; u.heading = Math.atan2(dx, dz); } else { u.path = []; u.pathClock = 0; } } }
          }
        }
      }
      this.draw(u, time);
    }
    for (const bullet of this.bullets) {
      if (!bullet || bullet.life <= 0) continue; bullet.life -= dt;
      const from = { x: bullet.x, y: bullet.y, z: bullet.z }, to = { x: bullet.x + bullet.vx * dt, y: bullet.y + bullet.vy * dt, z: bullet.z + bullet.vz * dt };
      const wall = this.city.collision.sweep(from, to, .06);
      let fraction = wall?.t ?? 1, struck: Fighter | undefined;
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length2 = dx * dx + dy * dy + dz * dz;
      for (const u of this.fighters) if (u.alive && !u.dropping && u.team !== bullet.team) { const t = T.MathUtils.clamp(((u.x - from.x) * dx + (u.y - from.y) * dy + (u.z - from.z) * dz) / Math.max(.001, length2), 0, 1); if (t < fraction && Math.hypot(u.x - from.x - dx * t, u.y - from.y - dy * t, u.z - from.z - dz * t) < 1.6) { fraction = t; struck = u; } }
      if (struck) { struck.hp -= bullet.damage; this.effects.spray(struck.x, struck.y, struck.z, bullet.vx * .03, bullet.vz * .03, 4); if (struck.hp <= 0) this.die(struck, { vx: bullet.vx * .028, vy: 4, vz: bullet.vz * .028 }); bullet.life = 0; }
      else if (wall) { this.effects.impact({ x: from.x + dx * fraction, y: from.y + dy * fraction, z: from.z + dz * fraction, speed: 10, size: .12, water: false, building: wall.building }); bullet.life = 0; }
      Object.assign(bullet, to);
      if (bullet.life <= 0) this.tracers.hide(bullet.id);
      else this.tracers.set(bullet.id, bullet.x, bullet.y, bullet.z, .16, .16, 7, Math.atan2(bullet.vx, bullet.vz), -Math.asin(bullet.vy / 270));
    }
  }
  private draw(u: Fighter, time: number) {
    const id = u.id;
    if (u.removed) { this.torso.hide(id); this.head.hide(id); this.gun.hide(id); for (let i = 0; i < 4; i++) this.limbs.hide(id * 4 + i); return; }
    const yaw = u.heading, rx = u.alive ? 0 : u.rx, rz = u.alive ? 0 : u.rz, scale = u.kind === 'heavy' ? 1.2 : 1;
    this.torso.set(id, u.x, u.y, u.z, 1.15 * scale, 1.5, .8, yaw, rx, rz);
    const rotation = new T.Euler(rx, yaw, rz), head = new T.Vector3(0, 1.15, 0).applyEuler(rotation);
    this.head.set(id, u.x + head.x, u.y + head.y, u.z + head.z, 1, 1, 1);
    this.gun.set(id, u.x + Math.sin(yaw), u.y + .1, u.z + Math.cos(yaw), .23, .26, u.kind === 'heavy' ? 2.8 : 2, yaw, rx, rz);
    for (let i = 0; i < 4; i++) { const arm = i < 2, sign = i % 2 ? 1 : -1, offset = new T.Vector3(sign * (arm ? .73 : .35), arm ? -.1 : -1.12, arm ? .25 : 0).applyEuler(rotation); const walk = u.alive && u.path[u.pathIndex] ? Math.sin(time * 11 + sign * Math.PI / 2) * .4 : 0; this.limbs.set(id * 4 + i, u.x + offset.x, u.y + offset.y, u.z + offset.z, .36, arm ? 1.2 : 1.35, .4, yaw, rx + (arm ? -.5 : walk), rz); }
    if (u.dropping) {
      this.canopies.set(id, u.x, u.y + 7, u.z, 5.5, 2.6, 5.5, yaw, Math.sin(time * 2 + id) * .06);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .7, x = Math.cos(a), z = Math.sin(a); this.cords.set(id * 4 + i, u.x + x * 1.8, u.y + 3.8, u.z + z * 1.8, .045, 7, .045, -a, .45); }
    } else { this.canopies.hide(id); for (let i = 0; i < 4; i++) this.cords.hide(id * 4 + i); }
    if (u.alive) this.markers.set(id, u.x, (this.city.terrainHeight(u.x, u.z) ?? .7) + .14, u.z, 1, 1, 1);
  }
  get summary() { return TEAMS.map((team, index) => `${team.name}: ${this.fighters.filter(u => u.alive && u.team === index).length}`).join(' · '); }
  reset(city: City) { this.fighters = []; this.bullets = []; this.deployed = this.shots = this.kills = this.bulletCursor = this.thinkCursor = 0; for (const batch of [this.torso, this.head, this.limbs, this.gun, this.canopies, this.cords, this.markers, this.tracers]) batch.used = batch.mesh.count = 0; this.attach(city); }
}
