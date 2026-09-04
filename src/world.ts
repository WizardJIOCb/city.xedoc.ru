import * as T from 'three';
import { CollisionWorld } from './physics';
import { createIslandTerrain } from './island-terrain';
import { CELL, generateLayout, seededRandom, blastDamage, blastImpulse, islandRadius } from './model.js';

const dummy = new T.Object3D();
const white = new T.Color();
export class Batch {
  mesh: T.InstancedMesh; used = 0;
  constructor(group: T.Group | T.Scene, geometry: T.BufferGeometry, material: T.Material, capacity: number, shadow = true) {
    this.mesh = new T.InstancedMesh(geometry, material, capacity); this.mesh.count = 0; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); group.add(this.mesh);
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: T.ColorRepresentation, ry = 0) {
    const id = this.used++; this.set(id, x, y, z, sx, sy, sz, ry); this.mesh.setColorAt(id, white.set(color)); if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.mesh.count = this.used; return id;
  }
  set(id: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz); dummy.updateMatrix(); this.mesh.setMatrixAt(id, dummy.matrix); this.mesh.instanceMatrix.needsUpdate = true;
  }
  hide(id: number) { this.set(id, 0, -200, 0, 0, 0, 0); }
  color(id: number, c: T.ColorRepresentation) { this.mesh.setColorAt(id, white.set(c)); if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
}
type Part = { batch: Batch; id: number; x: number; y: number; z: number; sx: number; sy: number; sz: number };
export type Building = { x: number; z: number; width: number; depth: number; height: number; hue: number; centrality: number; roof: number; health: number; fire: number; collapsed: boolean; collapse: number; parts: Part[]; color: T.Color; tiltX: number; tiltZ: number; blast?: Hit; };
export type Citizen = { x: number; z: number; axis: boolean; start: number; end: number; speed: number; id: number; extra: number; alive: boolean; phase: number; };
export type Island = { x: number; z: number; radius: number; phase: number; name: string; dock: T.Vector3 };
export type Hit = { x: number; z: number; radius: number; strength: number; fire?: boolean; impulse?: boolean; waveId?: number; front?: { previous: number; current: number }; };
export class City {
  group = new T.Group(); buildings: Building[] = []; trees: { x: number; z: number; id: number; trunk: number; alive: boolean }[] = [];
  layout: ReturnType<typeof generateLayout>; extent: number; rng: () => number;
  solid: Batch; facade: Batch; foliage: Batch; cars: Batch; cabins: Batch; people: Batch; heads: Batch;
  traffic: Citizen[] = []; pedestrians: Citizen[] = []; planes: T.Group[] = []; ships: T.Group[] = [];
  night = { value: 0 }; damage = 0; destroyed = 0; population: number; affected = 0; vehiclesLost = 0;
  onCollapse: (b: Building) => void = () => {}; onFire: (b: Building) => void = () => {};
  onWreck: (x: number, y: number, z: number, color: T.ColorRepresentation, hit?: Hit) => void = () => {};
  onCarExplosion: (car: Citizen, hit: Hit) => void = () => {};
  onDeath: (person: Citizen, hit: Hit) => void = () => {};
  props: { x: number; y: number; z: number; ids: number[]; alive: boolean; }[] = [];
  islands: Island[] = []; collision: CollisionWorld; worldRadius = 0;
  landCells = new Set<string>(); terrainRects: { x: number; z: number; width: number; depth: number; y: number }[] = [];
  onPlaneDestroyed: (plane: T.Group, hit: Hit) => void = () => {};
  onHit: (hit: Hit) => void = () => {};
  fireClock = 0; miniMapDirty = true;
  constructor(public scene: T.Scene, public seed = 'NEW-HAVEN', public size = 18, public style = 'bay') {
    this.rng = seededRandom(seed + ':details'); this.layout = generateLayout(seed, size, style); this.extent = size * CELL / 2;
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
        float lit = step(.48,fract(sin(dot(floor(cell),vec2(12.9898,78.233)))*43758.5453));
        vec3 glass = mix(vec3(.025,.065,.085),vec3(.12,.24,.29), .5+.5*sin(vBuilding.y*.014+u*.001));
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowMask*.82);
        diffuseColor.rgb *= 1.0-.15*side*step(.94,f.y);
        totalEmissiveRadiance += windowMask * lit * vec3(1.0,.65,.28) * (.13+uNight*1.8);
      `);
    };
    this.solid = new Batch(this.group, box, standard, 45000);
    this.facade = new Batch(this.group, box, facadeMat, 12000);
    this.foliage = new Batch(this.group, new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ roughness: .97 }), 6000);
    this.cars = new Batch(this.group, box, new T.MeshStandardMaterial({ roughness: .4, metalness: .3 }), 400);
    this.cabins = new Batch(this.group, box, new T.MeshStandardMaterial({ color: '#7196a7', roughness: .2, metalness: .55 }), 400);
    this.people = new Batch(this.group, box, standard, 700, false); this.heads = new Batch(this.group, new T.IcosahedronGeometry(.3, 0), standard, 700, false);
    this.generate(); this.collision = new CollisionWorld(this); this.worldRadius = this.extent + 1350; this.population = this.buildings.length * 43 + this.traffic.length * 2;
    scene.add(this.group);
  }
  generate() {
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
    for (let x = -e * .65; x < e * .68; x += 20) { this.solid.add(x, 1.3, e + 14, 20, 3.3, 9, '#b7ae93'); this.solid.add(x, 2.1, e + 18.5, 20, 1, .6, '#c5bfa8'); }
    for (let k = 0; k < 4; k++) this.createPlane(k);
    this.terrainRects.push({ x: e + 70, z: -70, width: 100, depth: 420, y: 1.5 });
    for (let j = 0; j < 3; j++) this.terrainRects.push({ x: -e * .62 + j * 68, z: e + 48, width: 40, depth: 105, y: 2.7 });
    this.terrainRects.push({ x: 0, z: e + 14, width: e * 1.34, depth: 9, y: 2.95 });
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
  terrainHeight(x: number, z: number): number | null {
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
      const pier = new T.Mesh(new T.BoxGeometry(52, 2, 9), new T.MeshStandardMaterial({ color: '#a58c6a' })); pier.position.set(dock.x + Math.cos(a) * 38, .1, dock.z + Math.sin(a) * 38); pier.rotation.y = -a; this.group.add(pier);
      this.terrainRects.push({ x: pier.position.x, z: pier.position.z, width: Math.abs(Math.cos(a)) * 52 + 9, depth: Math.abs(Math.sin(a)) * 52 + 9, y: 1.1 });
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
      this.solid.add(x, -.8, e + 48, 40, 7, 105, '#8e9690');
      for (let k = 0; k < 8; k++) this.solid.add(x + (k % 2) * 14 - 8, 4, e + Math.floor(k / 2) * 15, 11, 5, 7, ['#698d96', '#b76745', '#b89c51'][k % 3]);
      const a = this.solid.add(x - 12, 23, e + 55, 2, 45, 2, '#d0a14a'), b = this.solid.add(x + 4, 44, e + 55, 36, 2, 2, '#d0a14a'), c = this.solid.add(x + 21, 32, e + 55, .3, 24, .3, '#798388'); this.props.push({ x, y: 25, z: e + 55, ids: [a, b, c], alive: true });
    }
    const ship = new T.Group(), mat = new T.MeshStandardMaterial({ color: '#c6cbc0', roughness: .6 });
    const hull = new T.Mesh(new T.BoxGeometry(18, 8, 70), new T.MeshStandardMaterial({ color: '#314e5d' })); hull.position.y = 2; ship.add(hull);
    const cabin = new T.Mesh(new T.BoxGeometry(13, 12, 16), mat); cabin.position.set(0, 10, -22); ship.add(cabin);
    for (let k = 0; k < 6; k++) { const c = new T.Mesh(new T.BoxGeometry(6, 6, 12), new T.MeshStandardMaterial({ color: ['#c27e4b', '#698c92', '#ddbc6e'][k % 3] })); c.position.set(k % 2 ? -4 : 4, 8, 3 + Math.floor(k / 2) * 13); ship.add(c); }
    ship.position.set(e * .1, -2, e + 150); ship.rotation.y = Math.PI / 2; ship.userData.alive = true; this.group.add(ship); this.ships.push(ship);
  }
  airport() {
    const e = this.extent;
    this.solid.add(e + 70, -2, -70, 100, 7, 420, '#657b68'); this.solid.add(e + 76, 1.6, -70, 33, .3, 360, '#3e4d52');
    for (let z = -225; z < 90; z += 24) this.solid.add(e + 76, 1.79, z, 1.2, .06, 10, '#e0ddc7');
    this.solid.add(e + 20, 5, -80, 38, 12, 76, '#8ca0a1'); this.solid.add(e + 22, 21, -24, 7, 37, 7, '#bcbcaf'); this.solid.add(e + 22, 38, -24, 13, 8, 13, '#608a99');
    this.solid.add(e - 5, 1.7, 70, 65, 3, 15, '#7e8b89');
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
    for (const b of this.buildings) {
      if (b.collapsed || b.health <= 0) continue;
      const d = Math.max(0, Math.hypot(b.x - hit.x, b.z - hit.z) - b.width * .45);
      if (!reached(d)) continue;
      const amount = blastDamage(d, hit.radius, hit.strength, .8 + b.height / 230);
      if (amount < .01) continue;
      this.damageBuilding(b, amount, hit.fire, hit.impulse ? hit : undefined); affected++;
    }
    for (const t of this.trees) if (t.alive && reached(Math.hypot(t.x - hit.x, t.z - hit.z), .85) && hit.strength > 30) { t.alive = false; this.foliage.hide(t.id); this.solid.hide(t.trunk); this.onWreck(t.x, 4, t.z, '#617449', hit); }
    for (const car of this.traffic) if (car.alive && reached(Math.hypot(car.x - hit.x, car.z - hit.z), .9) && hit.strength > 25) {
      // Mark dead before the callback: secondary explosions must not retrigger this car.
      car.alive = false; this.vehiclesLost++; this.cars.color(car.id, '#292b29'); this.cabins.hide(car.extra); this.onCarExplosion(car, hit);
    }
    for (const p of this.pedestrians) if (p.alive && reached(Math.hypot(p.x - hit.x, p.z - hit.z)) && hit.strength > 10) { p.alive = false; this.onDeath(p, hit); }
    for (const p of this.props) if (p.alive && hit.strength > 50 && reached(Math.hypot(p.x - hit.x, p.z - hit.z), .85)) { p.alive = false; for (const id of p.ids) this.solid.hide(id); this.onWreck(p.x, p.y, p.z, '#7c8581', hit); }
    for (const plane of this.planes) if (plane.userData.alive && hit.strength > 80 && reached(Math.hypot(plane.position.x - hit.x, plane.position.y * .5, plane.position.z - hit.z))) this.destroyPlane(plane, hit);
    for (const ship of this.ships) if (ship.userData.alive && hit.strength > 90 && reached(Math.hypot(ship.position.x - hit.x, ship.position.z - hit.z))) { ship.userData.alive = false; this.onWreck(ship.position.x, 12, ship.position.z, '#a27c57', hit); }
    this.onHit(hit); this.affected = Math.min(this.population, Math.round(this.damage / 100 * 43) + this.vehiclesLost * 2); this.miniMapDirty = true; return affected;
  }
  damageBuilding(b: Building, amount: number, fire = false, blast?: Hit) {
    if (b.collapsed || b.health <= 0) return;
    const before = b.health; b.health = Math.max(0, b.health - amount); this.damage += before - b.health;
    if (blast) { b.blast = blast; const kick = blastImpulse(b.x, b.z, blast.x, blast.z, blast.radius + b.width, blast.strength); b.tiltX = T.MathUtils.clamp(kick.vz / 350, -.3, .3); b.tiltZ = T.MathUtils.clamp(kick.vx / 350, -.3, .3); }
    if (b.health < 65) for (const part of b.parts) part.batch.color(part.id, b.color.clone().multiplyScalar(.48 + b.health / 180));
    if (fire && b.health < 80) b.fire = Math.max(b.fire, 8 + this.rng() * 20);
    if (b.health <= 0) this.startCollapse(b);
    this.miniMapDirty = true;
  }
  inundate(level: number, minZ = -Infinity, maxZ = Infinity) {
    if (level < 3) return;
    for (const p of this.pedestrians) if (p.alive && p.z >= minZ && p.z <= maxZ) { p.alive = false; this.people.hide(p.id); this.heads.hide(p.extra); }
    if (level < 5) return;
    for (const c of this.traffic) if (c.alive && c.z >= minZ && c.z <= maxZ) { c.alive = false; this.vehiclesLost++; this.cars.color(c.id, '#3c5254'); this.cabins.hide(c.extra); }
  }
  startCollapse(b: Building) { b.collapse = .001; this.destroyed++; this.onCollapse(b); }
  update(dt: number, time: number) {
    if (dt <= 0) return;
    for (const b of this.buildings) {
      if (b.collapse > 0 && !b.collapsed) {
        b.collapse += dt * .65; const t = b.collapse;
        for (const part of b.parts) part.batch.set(part.id, part.x + b.tiltZ * part.y * t * 2, Math.max(.4, part.y - t * t * b.height * .6), part.z + b.tiltX * part.y * t * 2, part.sx, part.sy * Math.max(.05, 1 - t * .65), part.sz, 0, b.tiltX * t, b.tiltZ * t);
        if (t > 1.25) { b.collapsed = true; for (const part of b.parts) part.batch.hide(part.id); const base = b.parts[0]; base.batch.set(base.id, b.x, 1.4, b.z, b.width * 1.03, 2.8, b.depth * 1.03, 0, .025, .03); base.batch.color(base.id, '#545550'); }
      }
    }
    this.fireClock += dt;
    if (this.fireClock > .1) {
      this.fireClock = 0;
      for (const b of this.buildings) if (b.fire > 0) {
        b.fire -= .1; this.onFire(b);
        if (!b.collapsed && b.health > 0) { const before = b.health; b.health = Math.max(0, b.health - .267); this.damage += before - b.health; if (b.health === 0) this.startCollapse(b); }
        if (this.rng() < .0078) { const other = this.buildings.find(n => n !== b && !n.collapsed && n.fire <= 0 && Math.hypot(n.x - b.x, n.z - b.z) < 35); if (other) other.fire = 8; }
      }
      this.affected = Math.min(this.population, Math.round(this.damage / 100 * 43) + this.vehiclesLost * 2);
    }
    for (const c of this.traffic) if (c.alive) { if (c.axis) c.x += c.speed * dt; else c.z += c.speed * dt; const p = c.axis ? c.x : c.z; if (p > c.end || p < c.start) { if (c.axis) c.x = c.speed > 0 ? c.start : c.end; else c.z = c.speed > 0 ? c.start : c.end; } this.cars.set(c.id, c.x, .96, c.z, 2.1, 1.05, 4.5, c.axis ? Math.PI / 2 : 0); this.cabins.set(c.extra, c.x, 1.72, c.z, 1.8, .75, 2.2, c.axis ? Math.PI / 2 : 0); }
    for (const p of this.pedestrians) if (p.alive) { const panic = this.destroyed > 0 ? 2.6 : 1; if (p.axis) p.x += p.speed * dt * panic; else p.z += p.speed * dt * panic; const pos = p.axis ? p.x : p.z; if (pos > p.end || pos < p.start) p.speed *= -1; const bob = Math.sin(time * 9 + p.phase) * .065; this.people.set(p.id, p.x, 1.3 + bob, p.z, .6, 1.05, .5); this.heads.set(p.extra, p.x, 2.05 + bob, p.z, 1, 1, 1); }
    for (const plane of this.planes) {
      if (plane.userData.falling) { plane.position.y -= dt * 65; plane.position.x += dt * 25; plane.rotation.z += dt * 1.2; if (plane.position.y < 0) { plane.visible = false; plane.userData.falling = false; this.onWreck(plane.position.x, 4, plane.position.z, '#4a5458'); } }
      if (!plane.userData.alive) continue;
      const a = time * .021 + plane.userData.offset; plane.position.set(Math.cos(a) * this.extent * 1.1, 130 + plane.userData.offset * 12 + Math.sin(a * 2) * 25, Math.sin(a) * this.extent * .92); plane.userData.velocity.set(-Math.sin(a) * this.extent * 1.1 * .021, Math.cos(a * 2) * 1.05, Math.cos(a) * this.extent * .92 * .021); plane.rotation.y = Math.atan2(-plane.userData.velocity.x, -plane.userData.velocity.z); plane.rotation.z = -.1;
    }
    for (const ship of this.ships) { if (!ship.userData.alive) { ship.position.y = Math.max(-30, ship.position.y - dt * 2); ship.rotation.z = Math.min(.7, ship.rotation.z + dt * .06); continue; } if (ship.userData.ferry) {
        const progress = (time * 22 / ship.userData.routeLength + ship.userData.offset) % 2, direction = progress < 1 ? 1 : -1;
        const t = progress < 1 ? progress : 2 - progress, curve = ship.userData.route as T.CatmullRomCurve3;
        ship.position.copy(curve.getPointAt(T.MathUtils.clamp(t, 0, 1))); const tangent = curve.getTangentAt(T.MathUtils.clamp(t, .001, .999)); ship.rotation.y = Math.atan2(-tangent.x * direction, -tangent.z * direction);
      } else ship.position.x = Math.sin(time * .006) * this.extent * .65; ship.position.y = -1 + Math.sin(time * .8) * .35; ship.rotation.z = Math.sin(time * .6) * .018; }
  }
  get percent() { return Math.min(100, this.damage / (this.buildings.length * 100) * 100); }
  dispose() {
    this.scene.remove(this.group); const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    this.group.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); if (o instanceof T.InstancedMesh) o.dispose(); } }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
}
