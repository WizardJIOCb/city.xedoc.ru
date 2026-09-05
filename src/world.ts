import * as T from 'three';
import { CollisionWorld } from './physics';
import { createIslandTerrain } from './island-terrain';
import { basinDepth, SEA_LEVEL, type Basin } from './local-water';
import { CELL, generateLayout, seededRandom, blastDamage, blastImpulse, islandRadius } from './model.js';
import { buildRealWorld, FootprintBatch, moveOnRoute, type Route } from './real-world';
import { inPolygon, type Polygon, type Point, type RealMap } from './real-geometry';
import { SurfaceIndex } from './surface-index';

const dummy = new T.Object3D();
const white = new T.Color();
export class Batch {
  mesh: T.InstancedMesh; used = 0;
  private originalY: Float32Array; private grounded: Uint8Array;
  constructor(group: T.Group | T.Scene, geometry: T.BufferGeometry, material: T.Material, capacity: number, shadow = true, public groundOffset?: (x: number, z: number) => number) {
    this.originalY = new Float32Array(capacity); this.grounded = new Uint8Array(capacity);
    this.mesh = new T.InstancedMesh(geometry, material, capacity); this.mesh.count = 0; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); group.add(this.mesh);
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: T.ColorRepresentation, ry = 0) {
    if (this.used >= this.originalY.length) this.grow();
    const id = this.used++; this.set(id, x, y, z, sx, sy, sz, ry); this.mesh.setColorAt(id, white.set(color)); if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.mesh.count = this.used; return id;
  }
  set(id: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, grounded = true) {
    this.originalY[id] = y; this.grounded[id] = grounded ? 1 : 0;
    dummy.position.set(x, y + (grounded ? this.groundOffset?.(x, z) ?? 0 : 0), z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz); dummy.updateMatrix(); this.mesh.setMatrixAt(id, dummy.matrix); this.mesh.instanceMatrix.needsUpdate = true;
  }
  private grow() {
    const capacity = this.originalY.length * 2;
    const y = new Float32Array(capacity); y.set(this.originalY); this.originalY = y;
    const grounded = new Uint8Array(capacity); grounded.set(this.grounded); this.grounded = grounded;
    const previous = this.mesh, next = new T.InstancedMesh(previous.geometry, previous.material, capacity);
    next.instanceMatrix.array.set(previous.instanceMatrix.array); next.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (previous.instanceColor) { next.instanceColor = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3); next.instanceColor.array.set(previous.instanceColor.array); }
    next.count = previous.count; next.castShadow = previous.castShadow; next.receiveShadow = previous.receiveShadow; next.frustumCulled = false;
    previous.parent?.add(next); previous.removeFromParent(); previous.dispose(); this.mesh = next;
  }
  hide(id: number) { this.set(id, 0, -200, 0, 0, 0, 0, 0, 0, 0, false); }
  refreshGround() {
    if (!this.groundOffset) return;
    const matrix = this.mesh.instanceMatrix.array;
    for (let id = 0; id < this.used; id++) if (this.grounded[id]) matrix[id * 16 + 13] = this.originalY[id] + this.groundOffset(matrix[id * 16 + 12], matrix[id * 16 + 14]);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  color(id: number, c: T.ColorRepresentation) { this.mesh.setColorAt(id, white.set(c)); if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
}
type Part = { batch: Pick<Batch, 'set' | 'hide' | 'color'>; id: number; x: number; y: number; z: number; sx: number; sy: number; sz: number };
export type Building = { x: number; z: number; width: number; depth: number; height: number; hue: number; centrality: number; roof: number; health: number; fire: number; collapsed: boolean; collapse: number; parts: Part[]; color: T.Color; tiltX: number; tiltZ: number; blast?: Hit; footprint?: Polygon; triangles?: Point[][] };
export type Citizen = { x: number; z: number; axis: boolean; start: number; end: number; speed: number; id: number; extra: number; alive: boolean; phase: number; health?: number; route?: Route; progress?: number; heading?: number };
export type Island = { x: number; z: number; radius: number; phase: number; name: string; dock: T.Vector3 };
export type Hit = { x: number; z: number; radius: number; strength: number; fire?: boolean; impulse?: boolean; column?: { bottom: number; top: number }; groundOnly?: boolean; flow?: { x: number; z: number }; waveId?: number; front?: { previous: number; current: number }; };
export type DockSection = { x: number; y: number; z: number; width: number; depth: number; height: number; rotation: number; ids: number[]; health: number; alive: boolean; kind: 'dock' | 'airport'; supports?: Building };
export class City {
  group = new T.Group(); buildings: Building[] = []; trees: { x: number; z: number; id: number; trunk: number; alive: boolean; health?: number }[] = [];
  layout: ReturnType<typeof generateLayout>; extent: number; rng: () => number;
  solid: Batch; facade: Batch; foliage: Batch; cars: Batch; cabins: Batch; people: Batch; heads: Batch;
  paving?: Batch;
  traffic: Citizen[] = []; pedestrians: Citizen[] = []; planes: T.Group[] = []; ships: T.Group[] = [];
  night = { value: 0 }; damage = 0; destroyed = 0; population: number; affected = 0; vehiclesLost = 0;
  onCollapse: (b: Building) => void = () => {}; onFire: (b: Building) => void = () => {};
  onWreck: (x: number, y: number, z: number, color: T.ColorRepresentation, hit?: Hit) => void = () => {};
  onCarExplosion: (car: Citizen, hit: Hit) => void = () => {};
  onDeath: (person: Citizen, hit: Hit) => void = () => {};
  props: { x: number; y: number; z: number; ids: number[]; alive: boolean; health?: number }[] = [];
  islands: Island[] = []; collision: CollisionWorld; worldRadius = 0;
  landCells = new Set<string>(); terrainRects: { x: number; z: number; width: number; depth: number; y: number }[] = [];
  onPlaneDestroyed: (plane: T.Group, hit: Hit) => void = () => {};
  onShipDestroyed: (ship: T.Group, hit: Hit) => void = () => {};
  onDockDestroyed: (dock: DockSection, hit: Hit) => void = () => {};
  onCarFlooded: (car: Citizen, flow?: { x: number; z: number }) => void = () => {};
  onCarLifted: (car: Citizen, hit: Hit) => void = () => {};
  docks: DockSection[] = []; airportSections: DockSection[] = []; airportBuildings: Building[] = []; basins: Basin[] = []; private groundCache = new Map<string, number>();
  private dockCells = new Map<string, DockSection[]>();
  waterLevelAt: (x: number, z: number) => number = () => SEA_LEVEL;
  onHit: (hit: Hit) => void = () => {};
  fireClock = 0; miniMapDirty = true;
  realBatch?: FootprintBatch;
  private realSurface?: SurfaceIndex;
  constructor(public scene: T.Scene, public seed = 'NEW-HAVEN', public size = 18, public style = 'bay', public realMap?: RealMap) {
    this.rng = seededRandom(seed + ':details'); this.layout = realMap ? { seed, size, style, buildings: [], blocks: [], parks: [] } : generateLayout(seed, size, style); this.extent = realMap ? realMap.size / 2 : size * CELL / 2;
    const box = new T.BoxGeometry(1, 1, 1), standard = new T.MeshStandardMaterial({ roughness: .85, metalness: .05 });
    const facadeMat = new T.MeshStandardMaterial({ roughness: .48, metalness: .18 });
    facadeMat.onBeforeCompile = shader => {
      shader.uniforms.uNight = this.night;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBuilding; varying vec3 vFace;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBuilding = (instanceMatrix * vec4(position,1.0)).xyz; vFace=normal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBuilding; varying vec3 vFace; uniform float uNight;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float side = 1.0-step(0.5,abs(vFace.y));
        float u = abs(vFace.x) > .5 ? vBuilding.z : vBuilding.x;
        vec2 cell = vec2(u/3.05, vBuilding.y/3.6);
        vec2 f = fract(cell);
        float windowMask = step(.17,f.x)*step(f.x,.83)*step(.2,f.y)*step(f.y,.77)*side;
        windowMask *= 1.0-smoothstep(.25,1.5,max(fwidth(cell.x),fwidth(cell.y)));
        float lit = step(.48,fract(sin(dot(floor(cell),vec2(12.9898,78.233)))*43758.5453));
        vec3 glass = mix(vec3(.025,.065,.085),vec3(.12,.24,.29), .5+.5*sin(vBuilding.y*.014+u*.001));
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowMask*.82);
        diffuseColor.rgb *= 1.0-.15*side*step(.94,f.y);
        totalEmissiveRadiance += windowMask * lit * vec3(1.0,.65,.28) * (.13+uNight*1.8);
      `);
    };
    this.solid = new Batch(this.group, box, standard, 45000);
    if (realMap) this.paving = new Batch(this.group, new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), standard, Math.max(45000, realMap.roads.reduce((n, road) => n + road.points.length * 2, 0)), false);
    this.facade = new Batch(this.group, box, facadeMat, 12000);
    this.foliage = new Batch(this.group, new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ roughness: .97 }), 6000);
    this.cars = new Batch(this.group, box, new T.MeshStandardMaterial({ roughness: .4, metalness: .3 }), 400);
    this.cabins = new Batch(this.group, box, new T.MeshStandardMaterial({ color: '#7196a7', roughness: .2, metalness: .55 }), 400);
    this.people = new Batch(this.group, box, standard, 700, false); this.heads = new Batch(this.group, new T.IcosahedronGeometry(.3, 0), standard, 700, false);
    for (const batch of this.groundBatches) batch.groundOffset = (x, z) => this.groundOffset(x, z);
    if (realMap) this.realSurface = new SurfaceIndex(realMap.land);
    this.generate(); this.collision = new CollisionWorld(this); this.worldRadius = realMap ? Math.SQRT2 * this.extent + 220 : this.extent + 1350; this.population = this.buildings.length * 43 + this.traffic.length * 2;
    scene.add(this.group);
  }
  generate() {
    if (this.realMap) { buildRealWorld(this, this.realMap); return; }
    const r = this.rng, e = this.extent;
    for (const block of this.layout.blocks) {
      const { x, z, park } = block; this.landCells.add(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      this.solid.add(x, -4.5, z, CELL, 9, CELL, '#546760');
      this.solid.add(x, .06, z, CELL, .15, CELL, '#34434a');
      this.solid.add(x, .38, z, 51, .62, 51, '#a5aaa0');
      if (park) {
        this.solid.add(x, .72, z, 47, .12, 47, '#698957');
        this.solid.add(x, .81, z, 4, .08, 48, '#c3bc9b'); this.solid.add(x, .81, z, 48, .08, 4, '#c3bc9b');
        for (let i = 0; i < 10; i++) { const tx = x + (r() - .5) * 41, tz = z + (r() - .5) * 41; if (Math.abs(tx - x) > 3 && Math.abs(tz - z) > 3) this.tree(tx, tz, 3 + r() * 2); }
        if (r() > .55) { this.solid.add(x, 1, z, 10, .5, 10, '#dfd2b5'); this.solid.add(x, 1.3, z, 8, .2, 8, '#55b9c2'); this.solid.add(x, 2.1, z, 1, 2, 1, '#c8cbbd'); }
      }
      for (let i = -25; i <= 25; i += 10) { this.solid.add(x + i, .18, z - 31, 4.5, .035, .35, '#c4c3a4'); this.solid.add(x - 31, .18, z + i, .35, .035, 4.5, '#c4c3a4'); }
      for (let i = 0; i < 5; i++) { this.solid.add(x - 28 + i * 1.8, .19, z - 22, .9, .04, 4, '#d4d5c3'); this.solid.add(x - 22, .19, z - 28 + i * 1.8, 4, .04, .9, '#d4d5c3'); }
      if (r() > .15) { this.tree(x - 23, z - 10, 2.6); this.tree(x + 23, z + 12, 2.6); }
      const pole = this.solid.add(x - 25, 3.9, z + 23, .27, 7, .27, '#50616a');
      const lamp = this.solid.add(x - 24, 7.4, z + 23, 2.4, .3, .7, '#ead5a0');
      this.props.push({ x: x - 25, y: 4, z: z + 23, ids: [pole, lamp], alive: true });
    }
    for (const spec of this.layout.buildings) this.addBuilding(spec);
    this.createTraffic(); this.harbor(); this.airport();
    if (this.style === 'islands') for (const z of [-124, 124]) {
      this.solid.add(0, 2.5, z, 200, 4, 12, '#8b989b');
      for (let x = -90; x <= 90; x += 45) { this.solid.add(x, 12, z - 5, 2, 24, 2, '#d8bba1'); this.solid.add(x, 12, z + 5, 2, 24, 2, '#d8bba1'); }
    }
    // Promenade, piers and protective seawall.
    for (let x = -e * .65; x < e * .68; x += 20) { const dock = this.addDock(x, 1.3, e + 14, 20, 3.3, 9, '#b7ae93'); dock.ids.push(this.solid.add(x, 2.1, e + 18.5, 20, 1, .6, '#c5bfa8')); }
    for (let k = 0; k < 4; k++) this.createPlane(k);
    if (this.style === 'islands') for (const z of [-124, 124]) this.terrainRects.push({ x: 0, z, width: 200, depth: 12, y: 4.5 });
    this.createIslands();
  }
  addBuilding(spec: typeof this.layout.buildings[number]) {
      const r = this.rng;
      const color = new T.Color().setHSL(.51 + spec.hue * .09, .14 + spec.hue * .16, .24 + spec.hue * .24);
      if (spec.height < 25) color.setHSL(.035 + spec.hue * .095, .16 + spec.hue * .2, .33 + spec.hue * .25);
      const b: Building = { ...spec, color, health: 100, fire: 0, collapsed: false, collapse: 0, parts: [], tiltX: (r() - .5) * .2, tiltZ: (r() - .5) * .2 };
      const h = b.height;
      this.part(b, this.facade, b.x, h / 2 + .8, b.z, b.width, h, b.depth, color);
      this.part(b, this.solid, b.x, h + 1.2, b.z, b.width + .6, .9, b.depth + .6, h < 25 && b.roof < .4 ? '#a57959' : '#9baba6');
      this.part(b, this.solid, b.x, 1.8, b.z, b.width + 1.8, 2, b.depth + 1.8, '#b8b5a7');
      if (h > 50 && b.roof > .32) {
        this.part(b, this.facade, b.x, h + h * .14, b.z, b.width * .7, h * .28, b.depth * .7, color);
        this.part(b, this.solid, b.x, h * 1.28 + 1, b.z, b.width * .72, 1, b.depth * .72, '#b7c3ba');
        if (h > 85 && b.roof > .6) this.part(b, this.solid, b.x, h * 1.28 + 10, b.z, .55, 19, .55, '#d5d9cb');
      } else {
        this.part(b, this.solid, b.x + b.width * .16, h + 2.4, b.z, b.width * .24, 2.5, b.depth * .25, '#687a7c');
        if (h < 22 && b.roof > .6) this.part(b, this.solid, b.x, h + 1.8, b.z - 3, b.width * .55, .4, 5, '#345e77');
      }
      this.buildings.push(b);
    }
  get groundBatches() { return [this.solid, this.facade, this.foliage, this.cars, this.cabins, this.people, this.heads, ...(this.paving ? [this.paving] : [])]; }
  groundOffset(x: number, z: number): number {
    if (!this.basins.length) return 0;
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    // City blocks subside as rigid pieces, along with their roads and buildings.
    if (this.landCells.has(key)) {
      const cached = this.groundCache.get(key); if (cached !== undefined) return cached;
      const offset = -Math.max(0, ...this.basins.map(b => basinDepth(b, (Math.floor(x / CELL) + .5) * CELL, (Math.floor(z / CELL) + .5) * CELL)));
      this.groundCache.set(key, offset); return offset;
    }
    return -Math.max(0, ...this.basins.map(b => basinDepth(b, x, z)));
  }
  refreshGround() {
    this.groundCache.clear();
    this.realBatch?.refreshGround();
    for (const batch of this.groundBatches) batch.refreshGround();
    this.group.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      if (object.name === 'real-terrain') {
        const original = object.userData.originalTerrain, positions = object.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) positions.setY(i, original[i * 3 + 1] + this.groundOffset(positions.getX(i), positions.getZ(i)));
        positions.needsUpdate = true; object.geometry.computeVertexNormals(); object.geometry.computeBoundingSphere(); return;
      }
      if (object.name !== 'island-terrain') return;
      const affected = this.basins.some(b => Math.hypot(b.x - object.position.x, b.z - object.position.z) < b.radius + object.userData.terrainRadius);
      if (!affected && !object.userData.subsidedTerrain) return;
      object.userData.subsidedTerrain = affected;
      const positions = object.geometry.attributes.position;
      const original = object.userData.originalTerrain ??= positions.array.slice();
      for (let i = 0; i < positions.count; i++) positions.setY(i, original[i * 3 + 1] + this.groundOffset(object.position.x + positions.getX(i), object.position.z + positions.getZ(i)));
      positions.needsUpdate = true; object.geometry.computeVertexNormals(); object.geometry.computeBoundingSphere();
    });
    this.miniMapDirty = true;
  }
  terrainHeight(x: number, z: number): number | null {
    const base = this.baseTerrainHeight(x, z); return base === null ? null : base + this.groundOffset(x, z);
  }
  baseTerrainHeight(x: number, z: number): number | null {
    for (const dock of this.dockCells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) if (dock.alive && this.onDock(dock, x, z)) return dock.y + dock.height / 2;
    if (this.realSurface) return this.realSurface.contains(x, z) ? .7 : null;
    for (const r of this.terrainRects) if (Math.abs(x - r.x) <= r.width / 2 && Math.abs(z - r.z) <= r.depth / 2) return r.y;
    if (this.landCells.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)) return .7;
    for (const island of this.islands) if (Math.hypot(x - island.x, z - island.z) < islandRadius(Math.atan2(z - island.z, x - island.x), island.radius, island.phase)) return .7;
    return null;
  }
  createIslands() {
    const names = ['Пальмовая бухта', 'Маячный', 'Сан-Марина', 'Зелёный мыс', 'Солнечный', 'Тихая гавань'];
    const r = this.rng, e = this.extent;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + .28, radius = 142 + r() * 34, distance = e + 650 + (i % 2) * 100;
      const x = Math.cos(a) * distance, z = Math.sin(a) * distance;
      const edge = islandRadius(a + Math.PI, radius, i), dock = new T.Vector3(x - Math.cos(a) * (edge + 28), 0, z - Math.sin(a) * (edge + 28));
      this.islands.push({ x, z, radius, phase: i, name: names[i], dock });
      const terrain = createIslandTerrain(radius, i);
      terrain.position.set(x, 0, z); this.group.add(terrain);
      for (let k = 0; k < 4; k++) { const distance = 18.5 + k * 13; this.addDock(dock.x + Math.cos(a) * distance, .1, dock.z + Math.sin(a) * distance, 13, 2, 9, '#a58c6a', -a); }
      for (let j = 0; j < 18; j++) {
        const bx = x + (j % 6 - 2.5) * 31, bz = z + (Math.floor(j / 6) - 1) * 58 + (j % 2 ? 17 : -17);
        this.addBuilding({ x: bx, z: bz, width: 15 + r() * 8, depth: 16 + r() * 6, height: 7.2 + Math.floor(r() * 4) * 3.6, hue: .45 + r() * .5, centrality: 0, roof: r() });
      }
      this.addBuilding({ x: x + radius * .65, z: z + 35, width: 9, depth: 9, height: 43, hue: .85, centrality: 0, roof: .2 });
      for (let j = 0; j < 42; j++) { const angle = r() * Math.PI * 2, d = radius * (.72 + r() * .16); this.tree(x + Math.cos(angle) * d, z + Math.sin(angle) * d, 3 + r() * 3); }
      for (let j = 0; j < 12; j++) {
        const axis = j % 2 === 0, p = (r() - .5) * 150, px = x + (axis ? p : 6), pz = z + (axis ? 6 : p);
        const id = this.people.add(px, 1.3, pz, .6, 1.05, .5, '#c6b487'), extra = this.heads.add(px, 2.05, pz, 1, 1, 1, '#d5b595');
        this.pedestrians.push({ x: px, z: pz, axis, start: (axis ? x : z) - 85, end: (axis ? x : z) + 85, speed: (j % 3 ? 1 : -1) * 1.3, id, extra, alive: true, phase: r() * 6 });
      }
      this.createFerry(this.islands[i], i);
    }
  }
  createFerry(island: Island, index: number) {
    const ship = new T.Group(), e = this.extent;
    const hull = new T.Mesh(new T.BoxGeometry(8, 4, 25), new T.MeshStandardMaterial({ color: ['#e5d1a5', '#67a8af', '#bc7762'][index % 3] })); hull.position.y = 1; ship.add(hull);
    const cabin = new T.Mesh(new T.BoxGeometry(6, 4.5, 12), new T.MeshStandardMaterial({ color: '#dde6d9', roughness: .4 })); cabin.position.set(0, 5, -1); ship.add(cabin);
    const glass = new T.Mesh(new T.BoxGeometry(6.1, 1.5, 8), new T.MeshStandardMaterial({ color: '#38637a', metalness: .4, roughness: .2 })); glass.position.set(0, 5.7, -3); ship.add(glass);
    const a = Math.atan2(island.dock.z, island.dock.x), end = Math.PI / 2;
    let delta = end - a; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2;
    const route = [island.dock.clone()], ring = e * 1.46 + 40;
    for (let i = 0; i <= 12; i++) { const angle = a + delta * i / 12; route.push(new T.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring)); }
    route.push(new T.Vector3(-e * .3 + index * 13, 0, e + 128));
    const curve = new T.CatmullRomCurve3(route, false, 'centripetal');
    ship.userData.route = curve; ship.userData.routeLength = curve.getLength(); ship.userData.offset = index * .14; ship.userData.alive = true; ship.userData.ferry = true;
    ship.position.copy(island.dock); this.group.add(ship); this.ships.push(ship);
  }
  destroyPlane(plane: T.Group, hit: Hit) {
    if (!plane.userData.alive) return;
    plane.userData.alive = false; plane.visible = false; plane.userData.falling = false;
    this.onPlaneDestroyed(plane, hit); this.miniMapDirty = true;
  }
  destroyShip(ship: T.Group, hit: Hit, shatter = false) {
    if (!ship.userData.alive) return;
    ship.userData.alive = false; if (shatter) ship.visible = false;
    this.onShipDestroyed(ship, hit); this.miniMapDirty = true;
  }
  addDock(x: number, y: number, z: number, width: number, height: number, depth: number, color: T.ColorRepresentation, rotation = 0, kind: DockSection['kind'] = 'dock') {
    const dock: DockSection = { x, y, z, width, height, depth, rotation, kind, health: 100, alive: true, ids: [this.solid.add(x, y, z, width, height, depth, color, rotation)] };
    (kind === 'airport' ? this.airportSections : this.docks).push(dock);
    const halfX = (Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * depth) / 2;
    const halfZ = (Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * depth) / 2;
    for (let cx = Math.floor((x - halfX) / CELL); cx <= Math.floor((x + halfX) / CELL); cx++) for (let cz = Math.floor((z - halfZ) / CELL); cz <= Math.floor((z + halfZ) / CELL); cz++) {
      const key = `${cx},${cz}`, list = this.dockCells.get(key) ?? []; list.push(dock); this.dockCells.set(key, list);
    }
    return dock;
  }
  onDock(dock: DockSection, x: number, z: number) {
    const dx = x - dock.x, dz = z - dock.z, c = Math.cos(dock.rotation), s = Math.sin(dock.rotation);
    return Math.abs(c * dx - s * dz) <= dock.width / 2 && Math.abs(s * dx + c * dz) <= dock.depth / 2;
  }
  damageDock(dock: DockSection, amount: number, hit: Hit) {
    if (!dock.alive) return; dock.health = Math.max(0, dock.health - amount);
    if (dock.health > 0) return;
    dock.alive = false; this.onDockDestroyed(dock, hit);
    for (const id of dock.ids) this.solid.hide(id);
    if (dock.supports) this.damageBuilding(dock.supports, 100, hit.fire, hit);
    this.miniMapDirty = true;
  }
  part(b: Building, batch: Batch, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: T.ColorRepresentation) { const id = batch.add(x, y, z, sx, sy, sz, color); b.parts.push({ batch, id, x, y, z, sx, sy, sz }); }
  tree(x: number, z: number, size: number) {
    const trunk = this.solid.add(x, size * .7, z, .65, size * 1.4, .65, '#6e624a');
    const id = this.foliage.add(x, size * 1.65, z, size, size * 1.25, size, new T.Color().setHSL(.23 + this.rng() * .08, .25 + this.rng() * .2, .22 + this.rng() * .13)); this.trees.push({ x, z, id, trunk, alive: true });
  }
  createTraffic() {
    const r = this.rng, colors = ['#eed29b', '#b94e3d', '#508590', '#d8ded5', '#354b5c', '#e5b444', '#6e7861'];
    for (let i = 0; i < this.size * 12; i++) {
      const block = this.layout.blocks[Math.floor(r() * this.layout.blocks.length)], axis = r() > .5;
      const same = this.layout.blocks.filter(b => axis ? b.z === block.z : b.x === block.x).map(b => axis ? b.x : b.z).sort((a, b) => a - b);
      const pos = axis ? block.x : block.z; let idx = same.indexOf(pos), lo = idx, hi = idx;
      while (lo > 0 && same[lo] - same[lo - 1] < CELL * 1.1) lo--; while (hi < same.length - 1 && same[hi + 1] - same[hi] < CELL * 1.1) hi++;
      const start = same[lo] - 22, end = same[hi] + 22, speed = (r() > .5 ? 1 : -1) * (12 + r() * 12), lane = speed > 0 ? 28 : 34;
      const p = start + r() * (end - start), x = axis ? p : block.x - lane, z = axis ? block.z - lane : p;
      const id = this.cars.add(x, .95, z, 2.1, 1.05, 4.5, colors[Math.floor(r() * colors.length)], axis ? Math.PI / 2 : 0), extra = this.cabins.add(x, 1.75, z, 1.8, .8, 2.2, '#a6bbc1', axis ? Math.PI / 2 : 0);
      this.traffic.push({ x, z, axis, start, end, speed, id, extra, alive: true, phase: r() * 6 });
    }
    for (let i = 0; i < this.size * 24; i++) {
      const block = this.layout.blocks[Math.floor(r() * this.layout.blocks.length)], axis = r() > .5, p = (r() - .5) * 42;
      const x = axis ? block.x + p : block.x + 24, z = axis ? block.z + 24 : block.z + p;
      const id = this.people.add(x, 1.3, z, .6, 1.05, .5, colors[Math.floor(r() * colors.length)]), extra = this.heads.add(x, 2.05, z, 1, 1, 1, '#d5b595');
      this.pedestrians.push({ x, z, axis, start: (axis ? block.x : block.z) - 23, end: (axis ? block.x : block.z) + 23, speed: (r() > .5 ? 1 : -1) * (1 + r() * 1.3), id, extra, alive: true, phase: r() * 6 });
    }
  }
  harbor() {
    const e = this.extent;
    for (let j = 0; j < 3; j++) {
      const x = -e * .62 + j * 68;
      const sections = Array.from({ length: 5 }, (_, k) => this.addDock(x, -.8, e + 6 + k * 21, 40, 7, 21, '#8e9690'));
      for (let k = 0; k < 8; k++) { const z = e + Math.floor(k / 2) * 15; sections[Math.min(4, Math.floor((z - e + 4.5) / 21))].ids.push(this.solid.add(x + (k % 2) * 14 - 8, 4, z, 11, 5, 7, ['#698d96', '#b76745', '#b89c51'][k % 3])); }
      const a = this.solid.add(x - 12, 23, e + 55, 2, 45, 2, '#d0a14a'), b = this.solid.add(x + 4, 44, e + 55, 36, 2, 2, '#d0a14a'), c = this.solid.add(x + 21, 32, e + 55, .3, 24, .3, '#798388'); sections[2].ids.push(a, b, c);
    }
    const ship = new T.Group(), mat = new T.MeshStandardMaterial({ color: '#c6cbc0', roughness: .6 });
    const hull = new T.Mesh(new T.BoxGeometry(18, 8, 70), new T.MeshStandardMaterial({ color: '#314e5d' })); hull.position.y = 2; ship.add(hull);
    const cabin = new T.Mesh(new T.BoxGeometry(13, 12, 16), mat); cabin.position.set(0, 10, -22); ship.add(cabin);
    for (let k = 0; k < 6; k++) { const c = new T.Mesh(new T.BoxGeometry(6, 6, 12), new T.MeshStandardMaterial({ color: ['#c27e4b', '#698c92', '#ddbc6e'][k % 3] })); c.position.set(k % 2 ? -4 : 4, 8, 3 + Math.floor(k / 2) * 13); ship.add(c); }
    ship.position.set(e * .1, -2, e + 150); ship.rotation.y = Math.PI / 2; ship.userData.alive = true; this.group.add(ship); this.ships.push(ship);
  }
  airport() {
    const e = this.extent;
    // Each tile owns its ground, pavement and markings; no unbreakable slab or
    // collision rectangle remains underneath a bombed-out part of the runway.
    const tiles: DockSection[][] = [];
    for (let row = 0; row < 14; row++) {
      tiles[row] = [];
      for (let col = 0; col < 4; col++) {
        const x = e + 32.5 + col * 25, z = -265 + row * 30;
        const tile = this.addDock(x, -2, z, 25, 7, 30, '#657b68', 0, 'airport'); tiles[row][col] = tile;
        const roadLeft = Math.max(x - 12.5, e + 59.5), roadRight = Math.min(x + 12.5, e + 92.5);
        if (row > 0 && row < 13 && roadRight > roadLeft) tile.ids.push(this.solid.add((roadLeft + roadRight) / 2, 1.6, z, roadRight - roadLeft, .3, 30, '#3e4d52'));
      }
    }
    for (let z = -225; z < 90; z += 24) {
      // Split a stripe at tile boundaries so it cannot float across a crater.
      for (let row = 1; row < 13; row++) {
        const lo = Math.max(z - 5, -280 + row * 30), hi = Math.min(z + 5, -250 + row * 30);
        if (hi > lo) tiles[row][2].ids.push(this.solid.add(e + 76, 1.79, (lo + hi) / 2, 1.2, .06, hi - lo, '#e0ddc7'));
      }
    }
    const structure = (x: number, z: number, width: number, height: number, depth: number, color: string) => {
      const building: Building = { x, z, width, height, depth, hue: .4, centrality: 0, roof: 0, health: 100, fire: 0, collapsed: false, collapse: 0, parts: [], color: new T.Color(color), tiltX: .05, tiltZ: -.06 };
      this.buildings.push(building); this.airportBuildings.push(building);
      const foundation = this.addDock(x, -2, z, width, 7, depth, '#7e8b89', 0, 'airport'); foundation.supports = building;
      return building;
    };
    const terminal = structure(e + 20, -80, 38, 12, 76, '#8ca0a1');
    this.part(terminal, this.solid, terminal.x, 7.5, terminal.z, 38, 12, 76, terminal.color);
    const tower = structure(e + 22, -24, 13, 42, 13, '#608a99');
    this.part(tower, this.solid, tower.x, 21, tower.z, 7, 37, 7, '#bcbcaf'); this.part(tower, this.solid, tower.x, 38, tower.z, 13, 8, 13, tower.color);
    for (let i = 0; i < 5; i++) this.addDock(e - 31 + i * 13, 1.7, 70, 13, 3, 15, '#7e8b89', 0, 'airport');
  }
  createPlane(index: number) {
    const g = new T.Group(), m = new T.MeshStandardMaterial({ color: '#e1dfd0', metalness: .25, roughness: .4 }), accent = new T.MeshStandardMaterial({ color: '#e28b63' });
    const body = new T.Mesh(new T.CapsuleGeometry(1.25, 13, 3, 8), m); body.rotation.x = Math.PI / 2; g.add(body);
    const wing = new T.Mesh(new T.BoxGeometry(22, .35, 3), m); wing.position.z = 1; wing.rotation.y = .06; g.add(wing);
    const tail = new T.Mesh(new T.BoxGeometry(8, .3, 2), accent); tail.position.z = 6; g.add(tail);
    const fin = new T.Mesh(new T.BoxGeometry(.4, 4, 3), accent); fin.position.set(0, 2, 6); g.add(fin);
    g.userData.velocity = new T.Vector3(); g.userData.offset = index * Math.PI / 2; g.userData.alive = true; this.group.add(g); this.planes.push(g);
  }
  hit(hit: Hit) {
    let affected = 0;
    const reached = (distance: number, scale = 1) => distance < hit.radius * scale && (!hit.front || (distance > hit.front.previous && distance <= hit.front.current));
    const damageObject = (object: { health?: number }, distance: number, resistance: number) => {
      if (!reached(distance)) return false;
      object.health = Math.max(0, (object.health ?? 100) - blastDamage(distance, hit.radius, hit.strength, resistance));
      return object.health <= 0;
    };
    for (const b of this.collision.nearby(hit.x, hit.z, hit.radius)) {
      if (b.collapsed || b.health <= 0) continue;
      const d = Math.max(0, Math.hypot(b.x - hit.x, b.z - hit.z) - b.width * .45);
      if (!reached(d)) continue;
      const amount = blastDamage(d, hit.radius, hit.strength, .8 + b.height / 230);
      if (amount < .01) continue;
      this.damageBuilding(b, amount, hit.fire, hit.impulse ? hit : undefined); affected++;
    }
    for (const t of this.trees) if (t.alive && damageObject(t, Math.hypot(t.x - hit.x, t.z - hit.z), .45)) { t.alive = false; this.foliage.hide(t.id); this.solid.hide(t.trunk); this.onWreck(t.x, 4, t.z, '#617449', hit); }
    for (const car of this.traffic) if (car.alive && damageObject(car, Math.hypot(car.x - hit.x, car.z - hit.z), .35)) {
      // Mark dead before the callback: secondary explosions must not retrigger this car.
      car.alive = false; this.vehiclesLost++; this.cars.color(car.id, '#292b29'); this.cabins.hide(car.extra); this.onCarExplosion(car, hit);
    }
    for (const p of this.pedestrians) if (p.alive && reached(Math.hypot(p.x - hit.x, p.z - hit.z)) && hit.strength > 10) { p.alive = false; this.onDeath(p, hit); }
    for (const p of this.props) if (p.alive && damageObject(p, Math.hypot(p.x - hit.x, p.z - hit.z), .6)) { p.alive = false; for (const id of p.ids) this.solid.hide(id); this.onWreck(p.x, p.y, p.z, '#7c8581', hit); }
    for (const dock of [...this.docks, ...this.airportSections]) if (dock.alive) { const distance = Math.max(0, Math.hypot(dock.x - hit.x, dock.z - hit.z) - Math.min(dock.width, dock.depth) * .4); if (reached(distance)) this.damageDock(dock, blastDamage(distance, hit.radius, hit.strength, .65), hit); }
    for (const plane of this.planes) if (plane.userData.alive && !plane.userData.gravityWell && !hit.groundOnly) {
      if (hit.column && (plane.position.y < hit.column.bottom || plane.position.y > hit.column.top)) continue;
      const distance = Math.hypot(plane.position.x - hit.x, hit.column ? 0 : plane.position.y * .5, plane.position.z - hit.z);
      if (damageObject(plane.userData, distance, .8)) this.destroyPlane(plane, hit);
    }
    for (const ship of this.ships) if (ship.userData.alive && !ship.userData.gravityWell && damageObject(ship.userData, Math.hypot(ship.position.x - hit.x, ship.position.z - hit.z), 1)) this.destroyShip(ship, hit);
    this.onHit(hit); this.affected = Math.min(this.population, Math.round(this.damage / 100 * 43) + this.vehiclesLost * 2); this.miniMapDirty = true; return affected;
  }
  liftCar(car: Citizen, hit: Hit) {
    if (!car.alive) return;
    car.alive = false; car.health = 0; this.vehiclesLost++; this.onCarLifted(car, hit); this.miniMapDirty = true;
  }
  damageBuilding(b: Building, amount: number, fire = false, blast?: Hit) {
    if (b.collapsed || b.health <= 0) return;
    const before = b.health; b.health = Math.max(0, b.health - amount); this.damage += before - b.health;
    if (blast) { b.blast = blast; const kick = blast.flow ? { vx: blast.flow.x * 60, vz: blast.flow.z * 60 } : blastImpulse(b.x, b.z, blast.x, blast.z, blast.radius + b.width, blast.strength); b.tiltX = T.MathUtils.clamp(kick.vz / 350, -.3, .3); b.tiltZ = T.MathUtils.clamp(kick.vx / 350, -.3, .3); }
    if (b.health < 65) for (const part of b.parts) part.batch.color(part.id, b.color.clone().multiplyScalar(.48 + b.health / 180));
    if (fire && b.health < 80) b.fire = Math.max(b.fire, 8 + this.rng() * 20);
    if (b.health <= 0) this.startCollapse(b);
    this.miniMapDirty = true;
  }
  inundate(surface: (x: number, z: number) => number, dt: number, strength: number, flow?: { x: number; z: number }) {
    const depth = (x: number, z: number) => {
      const level = surface(x, z);
      if (flow && level <= SEA_LEVEL + .08) return 0;
      return level - (this.terrainHeight(x, z) ?? SEA_LEVEL);
    };
    for (const b of this.buildings) {
      const water = depth(b.x, b.z); if (water < .5) continue; b.fire = 0;
      this.damageBuilding(b, dt * strength * T.MathUtils.clamp(water / Math.max(8, b.height * .45), 0, 1), false,
        flow ? { x: b.x - flow.x * 30, z: b.z - flow.z * 30, radius: 100, strength: 130, impulse: true, flow } : undefined);
    }
    for (const p of this.pedestrians) if (p.alive && depth(p.x, p.z) > 1.3) { p.alive = false; this.people.hide(p.id); this.heads.hide(p.extra); }
    for (const c of this.traffic) if (c.alive && depth(c.x, c.z) > 1.1) { c.alive = false; this.vehiclesLost++; this.cars.color(c.id, '#3c5254'); this.cabins.hide(c.extra); this.onCarFlooded(c, flow); }
    for (const tree of this.trees) if (tree.alive && depth(tree.x, tree.z) > (flow ? 3 : 8)) { tree.alive = false; this.foliage.hide(tree.id); this.solid.hide(tree.trunk); this.onWreck(tree.x, 4, tree.z, '#617449'); }
    for (const dock of [...this.docks, ...this.airportSections]) if (dock.alive && depth(dock.x, dock.z) > 1) this.damageDock(dock, dt * strength, { x: dock.x, z: dock.z, radius: 70, strength: 120, flow, impulse: !!flow });
    if (flow) for (const ship of this.ships) if (ship.userData.alive && surface(ship.position.x, ship.position.z) > ship.position.y + 6) this.destroyShip(ship, { x: ship.position.x, z: ship.position.z, radius: 90, strength: 130, flow, impulse: true });
    for (const plane of this.planes) if (plane.userData.alive && surface(plane.position.x, plane.position.z) > plane.position.y + 2) this.destroyPlane(plane, { x: plane.position.x, z: plane.position.z, radius: 60, strength: 160, flow, impulse: !!flow });
    this.miniMapDirty = true;
  }
  startCollapse(b: Building) { b.collapse = .001; this.destroyed++; this.onCollapse(b); }
  update(dt: number, time: number) {
    if (dt <= 0) return;
    for (const b of this.buildings) {
      if (b.collapse > 0 && !b.collapsed) {
        b.collapse += dt * .65; const t = b.collapse;
        for (const part of b.parts) part.batch.set(part.id, part.x + b.tiltZ * part.y * t * 2, Math.max(.4, part.y - t * t * b.height * .6), part.z + b.tiltX * part.y * t * 2, part.sx, part.sy * Math.max(.05, 1 - t * .65), part.sz, 0, b.tiltX * t, b.tiltZ * t);
        if (t > 1.25) { b.collapsed = true; for (const part of b.parts) part.batch.hide(part.id); if (this.terrainHeight(b.x, b.z) !== null) { const base = b.parts[0]; base.batch.set(base.id, b.x, 1.4, b.z, b.width * 1.03, 2.8, b.depth * 1.03, 0, .025, .03); base.batch.color(base.id, '#545550'); } }
      }
    }
    for (const b of this.airportBuildings) if (b.collapsed && this.terrainHeight(b.x, b.z) === null) for (const part of b.parts) part.batch.hide(part.id);
    this.fireClock += dt;
    if (this.fireClock > .1) {
      this.fireClock = 0;
      for (const b of this.buildings) if (b.fire > 0) {
        b.fire -= .1; this.onFire(b);
        if (!b.collapsed && b.health > 0) { const before = b.health; b.health = Math.max(0, b.health - .267); this.damage += before - b.health; if (b.health === 0) this.startCollapse(b); }
        if (this.rng() < .0078) { const other = this.collision.nearby(b.x, b.z, 35).find(n => n !== b && !n.collapsed && n.fire <= 0 && Math.hypot(n.x - b.x, n.z - b.z) < 35); if (other) other.fire = 8; }
      }
      this.affected = Math.min(this.population, Math.round(this.damage / 100 * 43) + this.vehiclesLost * 2);
    }
    for (const c of this.traffic) if (c.alive) { if (c.route) moveOnRoute(c, dt); else if (c.axis) c.x += c.speed * dt; else c.z += c.speed * dt; const p = c.axis ? c.x : c.z; if (!c.route && (p > c.end || p < c.start)) { if (c.axis) c.x = c.speed > 0 ? c.start : c.end; else c.z = c.speed > 0 ? c.start : c.end; } this.cars.set(c.id, c.x, this.realMap ? (this.baseTerrainHeight(c.x, c.z) ?? .7) + .7 : .96, c.z, 2.1, 1.05, 4.5, c.heading ?? (c.axis ? Math.PI / 2 : 0)); this.cabins.set(c.extra, c.x, this.realMap ? (this.baseTerrainHeight(c.x, c.z) ?? .7) + 1.46 : 1.72, c.z, 1.8, .75, 2.2, c.heading ?? (c.axis ? Math.PI / 2 : 0)); }
    for (const p of this.pedestrians) if (p.alive) { const panic = this.destroyed > 0 ? 2.6 : 1; if (p.route) moveOnRoute(p, dt * panic); else if (p.axis) p.x += p.speed * dt * panic; else p.z += p.speed * dt * panic; const pos = p.axis ? p.x : p.z; if (!p.route && (pos > p.end || pos < p.start)) p.speed *= -1; const bob = Math.sin(time * 9 + p.phase) * .065; this.people.set(p.id, p.x, 1.3 + bob, p.z, .6, 1.05, .5); this.heads.set(p.extra, p.x, 2.05 + bob, p.z, 1, 1, 1); }
    for (const plane of this.planes) {
      if (plane.userData.gravityWell) continue;
      if (plane.userData.falling) { plane.position.y -= dt * 65; plane.position.x += dt * 25; plane.rotation.z += dt * 1.2; if (plane.position.y < 0) { plane.visible = false; plane.userData.falling = false; this.onWreck(plane.position.x, 4, plane.position.z, '#4a5458'); } }
      if (!plane.userData.alive) continue;
      const a = time * .021 + plane.userData.offset; plane.position.set(Math.cos(a) * this.extent * 1.1, 130 + plane.userData.offset * 12 + Math.sin(a * 2) * 25, Math.sin(a) * this.extent * .92); plane.userData.velocity.set(-Math.sin(a) * this.extent * 1.1 * .021, Math.cos(a * 2) * 1.05, Math.cos(a) * this.extent * .92 * .021); plane.rotation.y = Math.atan2(-plane.userData.velocity.x, -plane.userData.velocity.z); plane.rotation.z = -.1;
    }
    for (const ship of this.ships) { if (ship.userData.gravityWell) continue; if (!ship.userData.alive) { ship.position.y = Math.max(-42, ship.position.y - dt * 3.5); ship.rotation.z = Math.min(.95, ship.rotation.z + dt * .1); if (ship.position.y <= -40) ship.visible = false; continue; } if (ship.userData.ferry) {
        const progress = (time * 22 / ship.userData.routeLength + ship.userData.offset) % 2, direction = progress < 1 ? 1 : -1;
        const t = progress < 1 ? progress : 2 - progress, curve = ship.userData.route as T.CatmullRomCurve3;
        ship.position.copy(curve.getPointAt(T.MathUtils.clamp(t, 0, 1))); const tangent = curve.getTangentAt(T.MathUtils.clamp(t, .001, .999)); ship.rotation.y = Math.atan2(-tangent.x * direction, -tangent.z * direction);
      } else ship.position.x = Math.sin(time * .006) * this.extent * .65; ship.position.y = -1 + Math.sin(time * .8) * .35; ship.rotation.z = Math.sin(time * .6) * .018; }
  }
  get percent() { return Math.min(100, this.damage / Math.max(1, this.buildings.length * 100) * 100); }
  dispose() {
    this.scene.remove(this.group); const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    this.group.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); if (o instanceof T.InstancedMesh || o instanceof T.BatchedMesh) o.dispose(); } }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
}
