import * as T from 'three';
import { Batch, City, type Building, type Citizen, type Hit, type DockSection } from './world';
import { blastImpulse } from './model.js';
import { Sound } from './audio';
import { MegaFireball, MEGA_FIREBALL_DURATION } from './mega-fireball';
import { advanceBody, type Motion, type Impact } from './physics';
import { SEA_LEVEL, planWave, waveHeight, waveFront, TsunamiWave, WAVE_DURATION, type WavePlan, type Basin } from './local-water';

export const DISASTERS = [
  { id: 'meteor', name: 'Метеорит', sub: 'Привет из космоса', icon: 'meteor', color: '#ffa46d', radius: 105, category: 'space' },
  { id: 'bomb', name: 'Авиабомба', sub: 'Точный удар', icon: 'bomb', color: '#f8b96f', radius: 65, category: 'weapons' },
  { id: 'cluster', name: 'Ковровый удар', sub: 'Целый квартал', icon: 'crosshair', color: '#f89e6c', radius: 135, category: 'weapons' },
  { id: 'nuke', name: 'Мегавзрыв', sub: 'Новая точка отсчёта', icon: 'radiation', color: '#ffc270', radius: 220, category: 'weapons' },
  { id: 'tornado', name: 'Торнадо', sub: 'Город на взлёт', icon: 'tornado', color: '#b8cfe0', radius: 110, category: 'nature' },
  { id: 'tsunami', name: 'Цунами', sub: 'Волна в выбранной зоне', icon: 'waves', color: '#75d6e7', radius: 160, category: 'nature' },
  { id: 'quake', name: 'Землетрясение', sub: 'Всё нестабильно', icon: 'activity', color: '#e8b183', radius: 210, category: 'nature' },
  { id: 'storm', name: 'Гроза', sub: 'Высокое напряжение', icon: 'zap', color: '#acb9ff', radius: 150, category: 'nature' },
  { id: 'flood', name: 'Потоп', sub: 'Локальное затопление', icon: 'droplets', color: '#76cadd', radius: 190, category: 'nature' },
  { id: 'volcano', name: 'Вулкан', sub: 'Горячий сосед', icon: 'mountain', color: '#ff8962', radius: 140, category: 'nature' },
  { id: 'ufo', name: 'НЛО', sub: 'Мы пришли с миром', icon: 'ufo', color: '#aaf3bd', radius: 100, category: 'space' },
  { id: 'blackhole', name: 'Чёрная дыра', sub: 'Последний аргумент', icon: 'orbit', color: '#c3a3fa', radius: 170, category: 'space' },
  { id: 'squad_assault', name: 'Штурмовики', sub: '6 бойцов · универсалы', icon: 'people', color: '#83c4df', radius: 18, category: 'troops' },
  { id: 'squad_heavy', name: 'Тяжёлый отряд', sub: '4 бойца · броня и огонь', icon: 'crosshair', color: '#e6c265', radius: 18, category: 'troops' },
  { id: 'squad_scout', name: 'Разведчики', sub: '5 бойцов · скорость и дальность', icon: 'pointer', color: '#9bc695', radius: 18, category: 'troops' },
] as const;
export type DisasterId = typeof DISASTERS[number]['id'];
type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; delay: number; size: number; color: T.Color; };
class Particles {
  mesh: T.Points; items: Particle[] = []; cursor = 0; positions: Float32Array; colors: Float32Array; sizes: Float32Array; alphas: Float32Array; material: T.ShaderMaterial;
  constructor(scene: T.Scene, public capacity: number, public smoke: boolean, public gravity = smoke ? 0 : 9) {
    const geo = new T.BufferGeometry(); this.positions = new Float32Array(capacity * 3); this.colors = new Float32Array(capacity * 3); this.sizes = new Float32Array(capacity); this.alphas = new Float32Array(capacity);
    geo.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aColor', new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aSize', new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aAlpha', new T.BufferAttribute(this.alphas, 1).setUsage(T.DynamicDrawUsage));
    this.material = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: smoke ? T.NormalBlending : T.AdditiveBlending, uniforms: { uScale: { value: 700 }, uSmoke: { value: smoke ? 1 : 0 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uScale; void main(){vColor=aColor;vAlpha=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(aSize*uScale/-mv.z,0.,128.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha; uniform float uSmoke; void main(){vec2 uv=(gl_PointCoord-.5)*2.;float edge=sin(uv.x*11.+uv.y*9.)*sin(uv.y*13.-uv.x*8.)*.075;float r=length(uv)+edge;if(r>1.)discard;float a=pow(max(0.,1.-r),uSmoke>.5?1.25:1.8);gl_FragColor=vec4(vColor,a*vAlpha);}` });
    this.mesh = new T.Points(geo, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = smoke ? 3 : 4; scene.add(this.mesh);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: T.ColorRepresentation, delay = 0) {
    const i = this.cursor++ % this.capacity; this.items[i] = { x, y, z, vx, vy, vz, size, life, max: life, delay, color: new T.Color(color) };
  }
  update(dt: number) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i]; if (!p || p.life <= 0) { this.alphas[i] = 0; this.sizes[i] = 0; continue; }
      if (p.delay > 0) { p.delay -= dt; this.alphas[i] = this.sizes[i] = 0; continue; }
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= Math.exp(-dt * .35); p.vz *= Math.exp(-dt * .35); p.vy -= dt * this.gravity;
      const f = Math.max(0, p.life / p.max), age = p.max - p.life, fadeIn = T.MathUtils.smoothstep(age, 0, Math.min(.16, p.max * .16)); this.positions.set([p.x, p.y, p.z], i * 3); const cooling = this.smoke ? 1 : .45 + .55 * f; this.colors.set([p.color.r, p.color.g * cooling, p.color.b * cooling * cooling], i * 3); this.sizes[i] = p.size * (this.smoke ? 1.2 + (1 - f) * 1.8 : .4 + Math.sin(Math.PI * (1 - f)) * .85) * (.35 + fadeIn * .65); this.alphas[i] = fadeIn * Math.pow(f, this.smoke ? .7 : 1.2) * (this.smoke ? .65 : .95);
    }
    for (const key of ['position', 'aColor', 'aSize', 'aAlpha']) this.mesh.geometry.attributes[key].needsUpdate = true;
  }
  clear() { this.items = []; this.alphas.fill(0); this.sizes.fill(0); this.cursor = 0; this.update(0); }
}
type Debris = Motion & { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; rz: number; spin: number; sx: number; sy: number; sz: number; life: number; waveId?: number; };
type ThrownActor = Motion & { source: Citizen; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; spin: number; age: number; landed: boolean; lifted?: boolean; limbs?: number[]; waveId?: number; };
type Event = { type: DisasterId | 'bolt' | 'ring' | 'plume' | 'fireball'; x: number; z: number; age: number; duration: number; power: number; group: T.Group; tick: number; data: Record<string, any>; };
export class Effects {
  fire: Particles; smoke: Particles; debrisBatch: Batch; debris: Debris[] = []; debrisCursor = 0; events: Event[] = [];
  blood: Particles; splats: Batch; limbs: Batch; splatCursor = 0; bloodEnabled = true;
  wrecks: ThrownActor[] = []; bodies: ThrownActor[] = []; secondaryBlasts: { x: number; z: number; delay: number }[] = [];
  sprayWater: Particles; rippleBatch: Batch; ripples: { id: number; x: number; y: number; z: number; age: number; size: number }[] = []; rippleCursor = 0; rippleOpacity = new Float32Array(180);
  waterImpacts = 0; solidImpacts = 0; buildingImpacts = 0; aircraftDestroyed = 0; impactSoundCooldown = 0;
  shipsDestroyed = 0; docksDestroyed = 0; airportSectionsDestroyed = 0; floodClock = 0;
  carsLifted = 0; aircraftCaptured = 0; shipsCaptured = 0;
  private waterWaves = new Set<Event>();
  onDeploy: (kind: string, x: number, z: number) => boolean = () => false;
  carExplosions = 0; deaths = 0; waveCounter = 0; carSoundCooldown = 0;
  shake = 0; flash = 0; flood = 0; executed = 0; power = 1; destroyedAtStart = 0;
  onEvent: (name: string, message: string) => void = () => {};
  constructor(public scene: T.Scene, public city: City, public sound: Sound) {
    this.fire = new Particles(scene, 5500, false); this.smoke = new Particles(scene, 2800, true);
    this.blood = new Particles(scene, 2400, true, 28);
    this.sprayWater = new Particles(scene, 3000, true, 24);
    const ringGeometry = new T.RingGeometry(.84, 1, 40); ringGeometry.rotateX(-Math.PI / 2);
    ringGeometry.setAttribute('aOpacity', new T.InstancedBufferAttribute(this.rippleOpacity, 1).setUsage(T.DynamicDrawUsage));
    const rippleMaterial = new T.MeshBasicMaterial({ color: '#b7e2df', transparent: true, opacity: .4, depthWrite: false });
    rippleMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOpacity; varying float vRippleAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRippleAlpha=aOpacity;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRippleAlpha;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a*=vRippleAlpha;');
    };
    this.rippleBatch = new Batch(scene, ringGeometry, rippleMaterial, 180, false);
    const stain = new T.CircleGeometry(1, 12); stain.rotateX(-Math.PI / 2);
    const vertices = stain.attributes.position;
    for (let i = 1; i < vertices.count; i++) { const factor = .78 + Math.sin(i * 12.3) * .2; vertices.setX(i, vertices.getX(i) * factor); vertices.setZ(i, vertices.getZ(i) * factor); }
    this.splats = new Batch(scene, stain, new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 2600, false);
    this.limbs = new Batch(scene, new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ roughness: .9 }), 2800, false);
    this.debrisBatch = new Batch(scene, new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ roughness: .85 }), 2200); this.attachCity(city);
  }
  attachCity(city: City) {
    this.city = city; city.onPlaneDestroyed = (plane, hit) => this.breakAircraft(plane, hit); city.onCollapse = b => this.collapse(b); city.onFire = b => this.burn(b);
    city.onCarExplosion = (car, hit) => this.explodeCar(car, hit); city.onDeath = (person, hit) => this.killPerson(person, hit);
    city.onCarLifted = (car, hit) => {
      const actor = this.actor(car, hit, 1.4); actor.lifted = true; actor.vy = 14; actor.spin = 3;
      this.wrecks.push(actor); this.carsLifted++;
    };
    city.onShipDestroyed = (ship, hit) => this.breakShip(ship, hit); city.onDockDestroyed = (dock, hit) => this.breakDock(dock, hit);
    city.onCarFlooded = (car, flow) => { const actor = this.actor(car, { x: car.x, z: car.z, radius: 30, strength: 80, flow, impulse: !!flow }, 1.5); actor.vy = 1; this.wrecks.push(actor); this.impact({ x: car.x, y: this.waterAt(car.x, car.z), z: car.z, speed: flow ? 25 : 7, size: 1.2, water: true }); };
    city.waterLevelAt = this.waterAt;
    this.splats.groundOffset = (x, z) => city.groundOffset(x, z);
    city.onWreck = (x, y, z, color, hit) => {
      y += city.groundOffset(x, z); const kick = this.kick(x, z, hit);
      for (let i = 0; i < 7; i++) this.chunk(x, y, z, 1 + Math.random() * 3, 1, 2 + Math.random() * 3, kick.vx + (Math.random() - .5) * 12, kick.vy + 5 + Math.random() * 12, kick.vz + (Math.random() - .5) * 12, color, hit?.waveId);
      this.smoke.emit(x, y, z, kick.vx * .3, 10, kick.vz * .3, 17, 4, '#65706d');
    };
  }
  waterAt = (x: number, z: number) => {
    let level = SEA_LEVEL;
    for (const event of this.waterWaves) level = Math.max(level, SEA_LEVEL + waveHeight(event.data.plan, event.age, x, z));
    return level;
  };
  breakDock(dock: DockSection, hit: Hit) {
    if (dock.kind === 'airport') this.airportSectionsDestroyed++; else this.docksDestroyed++;
    const matrix = new T.Matrix4(), position = new T.Vector3(), scale = new T.Vector3(), rotation = new T.Quaternion(), color = new T.Color();
    for (const id of dock.ids) {
      this.city.solid.mesh.getMatrixAt(id, matrix); matrix.decompose(position, rotation, scale); this.city.solid.mesh.getColorAt(id, color);
      const count = Math.min(18, Math.max(3, Math.ceil(scale.x * scale.z / 55))), kick = this.kick(position.x, position.z, hit);
      for (let i = 0; i < count; i++) {
        const offset = new T.Vector3((Math.random() - .5) * scale.x, (Math.random() - .5) * scale.y, (Math.random() - .5) * scale.z).applyQuaternion(rotation);
        this.chunk(position.x + offset.x, position.y + offset.y, position.z + offset.z, Math.min(6, scale.x / Math.sqrt(count)), Math.min(3, scale.y), Math.min(7, scale.z / Math.sqrt(count)), kick.vx + (Math.random() - .5) * 18, kick.vy + 5 + Math.random() * 12, kick.vz + (Math.random() - .5) * 18, color, hit.waveId);
      }
    }
    const ground = this.city.terrainHeight(dock.x, dock.z), water = this.waterAt(dock.x, dock.z), wet = ground === null || water > ground;
    this.impact({ x: dock.x, y: wet ? water : ground, z: dock.z, speed: 25, size: 6, water: wet });
  }
  breakShip(ship: T.Group, hit: Hit) {
    this.shipsDestroyed++; ship.updateWorldMatrix(true, true);
    for (const child of ship.children) if (child instanceof T.Mesh) {
      const position = child.getWorldPosition(new T.Vector3()), kick = this.kick(position.x, position.z, hit);
      const color = (child.material as T.MeshStandardMaterial).color;
      for (let i = 0; i < 5; i++) this.chunk(position.x + (Math.random() - .5) * 9, position.y + 1, position.z + (Math.random() - .5) * 14, 2 + Math.random() * 3, 1 + Math.random() * 2, 3 + Math.random() * 4, kick.vx + (Math.random() - .5) * 24, 6 + Math.random() * 18, kick.vz + (Math.random() - .5) * 24, color, hit.waveId);
    }
    this.impact({ x: ship.position.x, y: this.waterAt(ship.position.x, ship.position.z), z: ship.position.z, speed: 35, size: ship.userData.ferry ? 5 : 10, water: true });
  }
  breakAircraft(plane: T.Group, hit: Hit) {
    this.aircraftDestroyed++; const velocity = plane.userData.velocity as T.Vector3;
    plane.updateWorldMatrix(true, true);
    for (const child of plane.children) if (child instanceof T.Mesh) {
      child.geometry.computeBoundingBox(); const size = child.geometry.boundingBox!.getSize(new T.Vector3()); const position = child.getWorldPosition(new T.Vector3());
      const kick = this.kick(position.x, position.z, { ...hit, impulse: true }, .8);
      const pieces = child === plane.children[0] ? 7 : 3;
      for (let i = 0; i < pieces; i++) this.chunk(position.x + (Math.random() - .5) * 12, position.y + (Math.random() - .5) * 3, position.z + (Math.random() - .5) * 8, Math.min(8, Math.max(.7, size.x / pieces)), .6 + Math.random(), Math.min(6, Math.max(2, size.z / pieces)), velocity.x + kick.vx * .45 + (Math.random() - .5) * 20, 8 + Math.random() * 26, velocity.z + kick.vz * .45 + (Math.random() - .5) * 20, '#b7c1b7', hit.waveId);
    }
    for (let i = 0; i < 55; i++) { const a = Math.random() * Math.PI * 2, speed = 5 + Math.random() * 35; this.fire.emit(plane.position.x, plane.position.y, plane.position.z, Math.cos(a) * speed + velocity.x, Math.random() * 30, Math.sin(a) * speed + velocity.z, 6 + Math.random() * 12, .6 + Math.random() * 1.8, '#ffb758', Math.random() * .14); this.smoke.emit(plane.position.x, plane.position.y, plane.position.z, velocity.x * .5, 5 + Math.random() * 15, velocity.z * .5, 9 + Math.random() * 14, 2 + Math.random() * 3, '#485457', i * .015); }
    this.sound.impact(.7);
  }
  impact(hit: Impact) {
    // A collision below the water surface can damage a wall, but must not emit
    // a brown dust cloud or sparks through the crest above it.
    if (!hit.water && hit.y < this.waterAt(hit.x, hit.z) - .4) {
      if (hit.building?.health) this.city.damageBuilding(hit.building, Math.min(24, hit.speed * hit.size * .055));
      this.solidImpacts++; if (hit.building) this.buildingImpacts++;
      return;
    }
    if (hit.water) {
      this.waterImpacts++; const energy = Math.min(55, 5 + Math.sqrt(hit.speed) * hit.size * 1.7);
      for (let i = 0; i < Math.min(65, 15 + energy); i++) { const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * energy * .6; this.sprayWater.emit(hit.x + Math.cos(a) * hit.size, hit.y + .3, hit.z + Math.sin(a) * hit.size, Math.cos(a) * v, 5 + Math.random() * energy * .9, Math.sin(a) * v, 1 + Math.random() * 3.5, .7 + Math.random() * 1.5, i % 3 ? '#b5e1df' : '#70b4c3'); }
      const id = this.rippleCursor++ % 180; if (id >= this.rippleBatch.used) this.rippleBatch.add(hit.x, hit.y + .18, hit.z, 1, 1, 1, '#b7e2df');
      this.ripples[id] = { id, x: hit.x, y: hit.y + .18, z: hit.z, age: 0, size: Math.min(25, 4 + energy * .45) };
    } else {
      this.solidImpacts++; if (hit.building) { this.buildingImpacts++; if (hit.building.health > 0) this.city.damageBuilding(hit.building, Math.min(24, hit.speed * hit.size * .055)); }
      const count = Math.min(22, 4 + Math.floor(hit.speed * .25));
      for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 11; this.smoke.emit(hit.x, hit.y + .6, hit.z, Math.cos(a) * v, 2 + Math.random() * 6, Math.sin(a) * v, 2 + hit.size * 1.1 + Math.random() * 3, .4 + Math.random() * 1.2, '#a69e87'); if (i % 3 === 0) this.fire.emit(hit.x, hit.y + .4, hit.z, Math.cos(a) * v * 1.5, 4 + Math.random() * 10, Math.sin(a) * v * 1.5, .45 + Math.random(), .18 + Math.random() * .35, '#ffc778'); }
    }
    if (hit.speed > 20 && this.impactSoundCooldown <= 0) { this.sound.impact(Math.min(.5, hit.speed * hit.size / 240)); this.impactSoundCooldown = .15; }
  }
  kick(x: number, z: number, hit?: Hit, mass = 1) { return hit?.flow ? { vx: hit.flow.x * 42 / mass, vy: 10 / mass, vz: hit.flow.z * 42 / mass } : hit?.impulse ? blastImpulse(x, z, hit.x, hit.z, hit.radius, hit.strength, mass) : { vx: 0, vy: 5, vz: 0 }; }
  actor(source: Citizen, hit: Hit, mass: number): ThrownActor { return { source, x: source.x, y: 1.4 + this.city.groundOffset(source.x, source.z), z: source.z, ...this.kick(source.x, source.z, hit, mass), rx: 0, ry: source.axis ? Math.PI / 2 : 0, rz: 0, spin: (Math.random() - .5) * 7, age: 0, landed: false, waveId: hit.waveId }; }
  explodeCar(car: Citizen, hit: Hit) {
    this.carExplosions++; const wreck = this.actor(car, hit, 1.45); wreck.vy += 9; this.wrecks.push(wreck);
    this.secondaryBlasts.push({ x: car.x, z: car.z, delay: .12 + Math.random() * .22 });
    for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; this.fire.emit(car.x, 2.5, car.z, Math.cos(a) * 18, 12 + Math.random() * 20, Math.sin(a) * 18, 9 + Math.random() * 10, .7 + Math.random() * 1.1, i % 3 ? '#ff8228' : '#ffdb79'); }
    for (let i = 0; i < 7; i++) this.chunk(car.x, 2, car.z, .5 + Math.random(), .25, .7 + Math.random(), wreck.vx + (Math.random() - .5) * 22, wreck.vy + Math.random() * 14, wreck.vz + (Math.random() - .5) * 22, i % 2 ? '#444b4b' : '#a89369', hit.waveId);
  }
  splatter(x: number, z: number, size: number) {
    if (!this.bloodEnabled || this.city.terrainHeight(x, z) === null) return; const id = this.splatCursor++ % 2600, color = this.splatCursor % 3 ? '#87121d' : '#b71b29';
    if (id >= this.splats.used) this.splats.add(x, .84, z, size, 1, size * .72, color, Math.random() * 6.28); else { this.splats.set(id, x, .84, z, size, 1, size * .72, Math.random() * 6.28); this.splats.color(id, color); }
  }
  spray(x: number, y: number, z: number, vx: number, vz: number, count = 20) {
    if (!this.bloodEnabled) return;
    for (let i = 0; i < count; i++) this.blood.emit(x, y, z, vx * .3 + (Math.random() - .5) * 15, 3 + Math.random() * 13, vz * .3 + (Math.random() - .5) * 15, .7 + Math.random() * 1.8, .55 + Math.random() * .9, i % 3 ? '#b41121' : '#630b16');
  }
  killPerson(person: Citizen, hit: Hit) {
    this.deaths++; const body = this.actor(person, hit, .75); body.vy += 5;
    const clothing = new T.Color(); this.city.people.mesh.getColorAt(person.id, clothing);
    body.limbs = Array.from({ length: 4 }, () => this.limbs.add(person.x, 1, person.z, .25, .75, .28, clothing)); this.bodies.push(body);
    this.spray(person.x, 1.6, person.z, body.vx, body.vz); this.splatter(person.x, person.z, 1.3);
    for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28, r = Math.random() * 3; this.splatter(person.x + Math.cos(a) * r, person.z + Math.sin(a) * r, .2 + Math.random() * .5); }
  }
  burn(b: Building) {
    const side = Math.random() < .5 ? -1 : 1;
    const x = b.x + side * b.width * .51, z = b.z + (Math.random() - .5) * b.depth;
    const y = (b.collapsed ? 1.8 : 1.8 + Math.random() * Math.min(15, b.height * .35)) + this.city.groundOffset(b.x, b.z);
    this.smoke.emit(x, y + 3, z, 2 + Math.random() * 3, 6 + Math.random() * 7, .5, 5 + Math.random() * 6, 2 + Math.random() * 2, '#495153');
    for (let i = 0; i < 3; i++) this.fire.emit(x + (Math.random() - .5) * 3, y, z + (Math.random() - .5) * 3, side * (.5 + Math.random()), 7 + Math.random() * 12, (Math.random() - .5) * 3, 4 + Math.random() * 7, .7 + Math.random() * 1.3, i % 2 ? '#ffb142' : '#ff6122');
  }
  chunk(x: number, y: number, z: number, sx: number, sy: number, sz: number, vx: number, vy: number, vz: number, color: T.ColorRepresentation, waveId?: number) {
    const id = this.debrisCursor++ % 2200;
    if (id >= this.debrisBatch.used) this.debrisBatch.add(x, y, z, sx, sy, sz, color); else this.debrisBatch.color(id, color);
    this.debris[id] = { id, x, y, z, sx, sy, sz, vx, vy, vz, rx: Math.random() * 3, rz: Math.random() * 3, spin: (Math.random() - .5) * 9 / Math.sqrt(Math.max(1, sx * sy)), life: 22, waveId };
  }
  collapse(b: Building) {
    const n = Math.min(40, 9 + Math.floor(b.height / 4));
    const kick = b.blast ? this.kick(b.x, b.z, { ...b.blast, radius: b.blast.radius + b.width }) : { vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, force = b.blast ? 5 : 7 + Math.random() * 30;
      this.chunk(b.x + (Math.random() - .5) * b.width, Math.random() * b.height + 4 + this.city.groundOffset(b.x, b.z), b.z + (Math.random() - .5) * b.depth, 2 + Math.random() * 5, 1 + Math.random() * 3, 2 + Math.random() * 5, kick.vx * (.5 + Math.random() * 1.15) + Math.cos(a) * force, kick.vy * (.35 + Math.random()) + 6 + Math.random() * 30, kick.vz * (.5 + Math.random() * 1.15) + Math.sin(a) * force, b.color.clone().multiplyScalar(.7), b.blast?.waveId);
    }
    const water = this.waterAt(b.x, b.z), wet = water > (this.city.terrainHeight(b.x, b.z) ?? SEA_LEVEL) + 1;
    for (let i = 0; i < (wet ? 3 : 8); i++) this.smoke.emit(b.x + (Math.random() - .5) * b.width, wet ? water + 2 : 8 + Math.random() * b.height * .5, b.z + (Math.random() - .5) * b.depth, (Math.random() - .5) * 22, 9, (Math.random() - .5) * 22, wet ? 12 : 30, wet ? 1.2 : 4 + Math.random() * 3, wet ? '#b3d9d9' : '#818078');
    this.shake = Math.max(this.shake, .4); this.city.miniMapDirty = true;
  }
  explosion(x: number, z: number, radius: number, power: number, fire = true, secondary = false) {
    if (!secondary || this.carSoundCooldown <= 0) { this.sound.impact(radius / 75); this.carSoundCooldown = .12; }
    this.shake = Math.max(this.shake, radius / 80); this.flash = Math.max(this.flash, Math.min(.7, radius / 400));
    const lobes = Array.from({ length: 9 }, () => ({ angle: Math.random() * Math.PI * 2, force: .3 + Math.random() * .85, lift: .2 + Math.random() }));
    for (let i = 0; i < Math.min(180, radius * 1.4); i++) {
      const lobe = lobes[i % lobes.length], a = lobe.angle + (Math.random() - .5) * .28, velocity = (8 + Math.pow(Math.random(), 2) * radius * .85) * lobe.force;
      this.fire.emit(x + (Math.random() - .5) * 8, 2 + Math.random() * 5, z + (Math.random() - .5) * 8, Math.cos(a) * velocity, (12 + Math.random() * radius * .7) * lobe.lift, Math.sin(a) * velocity, 5 + Math.random() * 18, .5 + Math.random() * 2.3, i % 4 ? '#ff9e36' : '#ffe4a6', Math.random() * .2);
      if (i % 3 === 0) this.smoke.emit(x, 4 + Math.random() * 6, z, Math.cos(a) * velocity * .3, 8 + Math.random() * 19, Math.sin(a) * velocity * .3, 7 + Math.random() * 19, 2 + Math.random() * 5, '#605e53', .1 + Math.random() * .65);
    }
    if (radius > 30) { const plume = this.event('plume', x, z, radius > 150 ? 10 : 5, 1); plume.data.radius = radius; }
    const ring = this.event('ring', x, z, .45 + radius / 170, power); ring.data = { radius, previous: -1, fire, waveId: ++this.waveCounter, pushed: new Set<object>() };
    const mesh = new T.Mesh(new T.RingGeometry(.945, 1, 100), new T.MeshBasicMaterial({ color: '#ffe8c6', transparent: true, opacity: .85, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 1.1; ring.group.add(mesh);
    const dome = new T.Mesh(new T.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, uniforms: { opacity: { value: .3 } }, vertexShader: 'varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}', fragmentShader: 'varying vec3 vNormal;varying vec3 vView;uniform float opacity;void main(){float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),3.);gl_FragColor=vec4(1.,.85,.62,rim*opacity);}' })); ring.group.add(dome);
  }
  event(type: Event['type'], x: number, z: number, duration: number, power: number) {
    const group = new T.Group(); group.position.set(x, 0, z); this.scene.add(group);
    const e: Event = { type, x, z, duration, power, group, age: 0, tick: 0, data: {} }; this.events.push(e); return e;
  }
  trigger(type: DisasterId, x: number, z: number, multiplier = this.power, announce = true) {
    if (this.events.filter(e => !['ring', 'bolt', 'plume', 'fireball'].includes(e.type)).length >= 28) { this.onEvent('Слишком много событий', 'Дождитесь завершения части катастроф'); return false; }
    const d = DISASTERS.find(d => d.id === type)!; if (announce) { this.executed++; this.onEvent(d.name, d.sub); }
    const p = multiplier;
    if (type.startsWith('squad_')) return this.onDeploy(type.slice(6), x, z);
    if (type === 'bomb' || type === 'meteor' || type === 'nuke') {
      const e = this.event(type, x, z, type === 'meteor' ? 2 : 1.5, p);
      const mesh = new T.Mesh(type === 'meteor' ? new T.IcosahedronGeometry(8 * Math.sqrt(p), 1) : new T.CapsuleGeometry(type === 'nuke' ? 4 : 2, 8, 3, 8), new T.MeshStandardMaterial({ color: type === 'meteor' ? '#623421' : '#4d5653', emissive: type === 'meteor' ? '#e6430c' : '#000000', emissiveIntensity: 1.8, roughness: .9 })); e.group.add(mesh);
      if (type !== 'meteor') { const fin = new T.Mesh(new T.BoxGeometry(9, 3, .6), new T.MeshStandardMaterial({ color: '#ab7754' })); fin.position.y = 7; mesh.add(fin); }
    } else if (type === 'cluster') {
      const e = this.event(type, x, z, 4.2, p); e.data.next = 0;
    } else if (type === 'tornado') {
      const e = this.event(type, x, z, 22, p); e.data.captured = new Set<T.Group>(); e.group.scale.setScalar(Math.sqrt(p));
      for (let i = 0; i < 30; i++) {
        const mesh = new T.Mesh(new T.TorusGeometry(8 + i * 1.4, 3 + i * .14, 5, 28), new T.MeshStandardMaterial({ color: new T.Color().setHSL(.58, .04, .19 + i * .004), transparent: true, opacity: .5, roughness: 1 })); mesh.rotation.x = Math.PI / 2; mesh.position.y = i * 5.5; e.group.add(mesh);
      }
    } else if (type === 'ufo') {
      const e = this.event(type, x, z, 22, p);
      for (let i = 0; i < 3; i++) {
        const ship = new T.Group(); ship.position.set(Math.cos(i * 2.094) * 65, 130 + i * 15, Math.sin(i * 2.094) * 65);
        const disc = new T.Mesh(new T.SphereGeometry(1, 32, 12), new T.MeshStandardMaterial({ color: '#8bafad', metalness: .9, roughness: .22, emissive: '#31584b', emissiveIntensity: .35 })); disc.scale.set(25, 5, 25); ship.add(disc);
        const top = new T.Mesh(new T.SphereGeometry(9, 20, 12), new T.MeshStandardMaterial({ color: '#85ffd3', emissive: '#32d994', emissiveIntensity: 1.8, transparent: true, opacity: .8 })); top.position.y = 4; top.scale.y = .7; ship.add(top);
        const beam = new T.Mesh(new T.ConeGeometry(13, 135, 28, 1, true), new T.MeshBasicMaterial({ color: '#7affab', transparent: true, opacity: .11, side: T.DoubleSide, depthWrite: false })); beam.position.y = -68; ship.add(beam);
        const rim = new T.Mesh(new T.TorusGeometry(23, .7, 5, 48), new T.MeshBasicMaterial({ color: '#a0ffce' })); rim.rotation.x = Math.PI / 2; ship.add(rim); e.group.add(ship);
      }
    } else if (type === 'tsunami') {
      if (this.events.filter(event => event.type === 'tsunami').length >= 6) { this.onEvent('Море неспокойно', 'Дождитесь завершения одной из шести волн'); return false; }
      const e = this.event(type, x, z, WAVE_DURATION, p), plan = planWave(this.city, x, z, p);
      e.data.plan = plan; this.waterWaves.add(e); e.group.add(new TsunamiWave(plan));
    } else if (type === 'quake') {
      const e = this.event(type, x, z, 9, p);
      for (let i = 0; i < 7; i++) {
        const points: T.Vector3[] = []; const a = i / 7 * Math.PI * 2;
        for (let k = 0; k < 12; k++) points.push(new T.Vector3(Math.cos(a) * k * 22 + (Math.random() - .5) * 20, .95, Math.sin(a) * k * 22 + (Math.random() - .5) * 20));
        const crack = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, 1.4, 3, false), new T.MeshBasicMaterial({ color: '#eb783b' })); e.group.add(crack);
      }
    } else if (type === 'flood') {
      if (this.city.basins.length >= 32) { this.onEvent('Предел проседания', 'Восстановите город, чтобы создать новые зоны затопления'); return false; }
      const basin: Basin = { x, z, radius: 190 * Math.sqrt(p), depth: 0 };
      this.city.basins.push(basin); const e = this.event(type, x, z, 26, p); e.data.basin = basin;
    } else if (type === 'storm') {
      this.event(type, x, z, 15, p);
    } else if (type === 'volcano') {
      const e = this.event(type, x, z, 26, p);
      const cone = new T.Mesh(new T.CylinderGeometry(16, 67, 64, 36, 6, true), new T.MeshStandardMaterial({ color: '#574f43', flatShading: true, roughness: 1 })); cone.position.y = 26; e.group.add(cone);
      const lava = new T.Mesh(new T.CircleGeometry(16, 32), new T.MeshBasicMaterial({ color: '#ff762e' })); lava.rotation.x = -Math.PI / 2; lava.position.y = 58.2; e.group.add(lava);
      this.explosion(x, z, 84 * p, 170, true);
    } else if (type === 'blackhole') {
      const e = this.event(type, x, z, 19, p); e.data.captured = new Set<T.Group>();
      const hole = new T.Mesh(new T.SphereGeometry(22, 40, 24), new T.MeshBasicMaterial({ color: '#020307' })); hole.position.y = 65; e.group.add(hole);
      for (let i = 0; i < 3; i++) { const ring = new T.Mesh(new T.TorusGeometry(31 + i * 9, 2 - i * .5, 8, 100), new T.MeshBasicMaterial({ color: ['#ffdc9e', '#dba8fd', '#ad80eb'][i], transparent: true, opacity: .9 - i * .2 })); ring.position.y = 65; ring.rotation.x = 1.25; ring.rotation.y = .4; e.group.add(ring); }
    }
    return true;
  }
  bolt(x: number, z: number, power: number) {
    const e = this.event('bolt', x, z, .3, power), points: T.Vector3[] = [];
    for (let i = 0; i <= 12; i++) points.push(new T.Vector3(i === 12 ? 0 : (Math.random() - .5) * 32, 260 - i / 12 * 260, (Math.random() - .5) * 14));
    e.group.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, 1.5, 4, false), new T.MeshBasicMaterial({ color: '#d6dfff' })));
    this.city.hit({ x, z, radius: 35 * Math.sqrt(power), strength: 110 * power, fire: true, column: { bottom: -30, top: 300 } });
    this.explosion(x, z, 35 * Math.sqrt(power), 100 * power); this.flash = .25;
  }
  shockwave(e: Event) {
    const fraction = Math.min(1, e.age / e.duration), radius = e.data.radius * fraction;
    const hit: Hit = { x: e.x, z: e.z, radius: e.data.radius, strength: e.power, fire: e.data.fire, impulse: true, waveId: e.data.waveId, front: { previous: e.data.previous, current: radius } };
    this.city.hit(hit);
    for (const object of [...this.debris, ...this.wrecks, ...this.bodies]) {
      if (!object || object.removed || object.submerged || object.waveId === e.data.waveId || e.data.pushed.has(object)) continue;
      if (Math.hypot(object.x - e.x, object.z - e.z) > radius || object.y > e.data.radius * 1.3) continue;
      const kick = this.kick(object.x, object.z, hit); object.vx += kick.vx; object.vy += kick.vy; object.vz += kick.vz;
      object.resting = false; if ('life' in object) object.life = 12; else { object.landed = false; object.age = Math.min(object.age, 20); }
      e.data.pushed.add(object);
    }
    e.data.previous = radius;
    const ring = e.group.children[0] as T.Mesh, dome = e.group.children[1] as T.Mesh;
    ring.scale.setScalar(radius); (ring.material as T.MeshBasicMaterial).opacity = Math.pow(1 - fraction, .45) * .85;
    dome.scale.set(radius, radius * .36, radius); (dome.material as T.ShaderMaterial).uniforms.opacity.value = (1 - fraction) * .35;
    if (e.tick > .045 && e.data.radius > 25) {
      e.tick = 0; const count = Math.max(12, Math.floor(radius / 4));
      for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2 + Math.random() * .06, x = Math.cos(a), z = Math.sin(a); this.smoke.emit(e.x + x * radius, 1.5, e.z + z * radius, x * 26, 3 + Math.random() * 6, z * 26, 5 + radius * .035, .8 + Math.random() * .5, '#a89c86'); }
    }
  }
  updateActors(dt: number) {
    const rotation = new T.Euler(), offset = new T.Vector3();
    for (const actor of [...this.wrecks, ...this.bodies]) {
      const body = !!actor.limbs; actor.age += dt;
      advanceBody(actor, dt, body ? .4 : .9, this.city.collision, this.waterAt, hit => {
        this.impact(hit);
        if (actor.lifted && hit.speed > 12) { actor.lifted = false; this.city.cabins.hide(actor.source.extra); this.city.cars.color(actor.source.id, '#333c3b'); }
        if (body && !hit.water && !actor.landed) { this.spray(actor.x, actor.y, actor.z, actor.vx, actor.vz, 12); this.splatter(actor.x, actor.z, 1.8); }
      });
      actor.landed = !!actor.resting;
      if (!actor.resting) { actor.rx += actor.spin * dt; actor.rz += actor.spin * dt * .4; }
      else if (body) { actor.rx = T.MathUtils.lerp(actor.rx, Math.PI / 2, Math.min(1, dt * 10)); actor.rz *= Math.exp(-dt * 8); }
      if (actor.removed) { this.city[body ? 'people' : 'cars'].hide(actor.source.id); if (body) { this.city.heads.hide(actor.source.extra); for (const id of actor.limbs!) this.limbs.hide(id); } else this.city.cabins.hide(actor.source.extra); continue; }
      const id = actor.source.id;
      if (body) {
        rotation.set(actor.rx, actor.ry, actor.rz);
        this.city.people.set(id, actor.x, actor.y, actor.z, .6, 1.05, .5, actor.ry, actor.rx, actor.rz, false);
        offset.set(0, .77, 0).applyEuler(rotation); this.city.heads.set(actor.source.extra, actor.x + offset.x, actor.y + offset.y, actor.z + offset.z, 1, 1, 1, 0, 0, 0, false);
        for (let i = 0; i < 4; i++) {
          const arm = i < 2, sign = i % 2 ? 1 : -1; offset.set(sign * (arm ? .43 : .18), arm ? -.04 : -.82, 0).applyEuler(rotation);
          this.limbs.set(actor.limbs![i], actor.x + offset.x, actor.y + offset.y, actor.z + offset.z, .23, arm ? .7 : .8, .27, actor.ry, actor.rx, actor.rz + (arm && !actor.landed ? sign * .55 : 0));
        }
      } else {
        this.city.cars.set(id, actor.x, actor.y, actor.z, 2.25, 1.1, 4.5, actor.ry, actor.rx, actor.rz, false);
        if (actor.lifted) { rotation.set(actor.rx, actor.ry, actor.rz); offset.set(0, .85, 0).applyEuler(rotation); this.city.cabins.set(actor.source.extra, actor.x + offset.x, actor.y + offset.y, actor.z + offset.z, 1.8, .8, 2.2, actor.ry, actor.rx, actor.rz, false); }
        if (!actor.lifted && !actor.submerged && actor.age < 9 && Math.floor(actor.age * 7) !== Math.floor((actor.age - dt) * 7)) { this.smoke.emit(actor.x, actor.y + 2, actor.z, 1, 7, 0, 8, 3, '#363e40'); this.fire.emit(actor.x, actor.y + 1, actor.z, 0, 5, 0, 5, .6, '#ff842c'); }
      }
    }
  }
  private pullTransport(event: Event, dt: number, scale: number) {
    const tornado = event.type === 'tornado', powerScale = Math.sqrt(event.power);
    const center = new T.Vector3(event.x, tornado ? 110 * powerScale : 65, event.z), captured = event.data.captured as Set<T.Group>;
    const radius = (tornado ? 110 : 195) * powerScale * scale;
    for (const car of this.city.traffic) if (car.alive && Math.hypot(car.x - event.x, car.z - event.z) < radius) this.city.liftCar(car, { x: event.x, z: event.z, radius, strength: 0 });
    for (const object of [...this.city.planes, ...this.city.ships]) {
      if (!object.userData.alive || (object.userData.gravityWell && object.userData.gravityWell !== event)) continue;
      const distance = object.position.distanceTo(center);
      if (!captured.has(object)) {
        if (tornado ? (Math.hypot(object.position.x - event.x, object.position.z - event.z) > radius || object.position.y > 240 * powerScale) : distance > radius) continue;
        captured.add(object); object.userData.gravityWell = event;
        if (this.city.planes.includes(object)) this.aircraftCaptured++; else this.shipsCaptured++;
        object.userData.captureVelocity = object.userData.velocity?.clone() ?? new T.Vector3(); object.userData.captureAge = 0;
      }
      const velocity = object.userData.captureVelocity as T.Vector3, delta = center.clone().sub(object.position);
      const swirl = tornado ? 3.2 : .5, drag = tornado ? 2.3 : .9;
      velocity.x += (delta.x * 2.6 + delta.z * swirl - velocity.x * drag) * dt;
      velocity.z += (delta.z * 2.6 - delta.x * swirl - velocity.z * drag) * dt;
      velocity.y += (delta.y * 2.2 - velocity.y * 1.2) * dt;
      object.position.addScaledVector(velocity, dt); object.rotation.z += dt * 1.7; object.rotation.x += dt * .4; object.userData.captureAge += dt;
      if ((!tornado && distance < 35) || object.userData.captureAge > (tornado ? 3.5 : 4.5)) this.shredTransport(object, event);
    }
  }
  private shredTransport(object: T.Group, event: Event) {
    const hit: Hit = { x: event.x, z: event.z, radius: 220 * Math.sqrt(event.power), strength: 100 };
    if (object.userData.velocity && object.userData.captureVelocity) object.userData.velocity.copy(object.userData.captureVelocity);
    if (this.city.planes.includes(object)) this.city.destroyPlane(object, hit); else this.city.destroyShip(object, hit, true);
    delete object.userData.gravityWell; delete object.userData.captureVelocity; delete object.userData.captureAge;
  }
  private updateUfo(event: Event, dt: number, time: number) {
    event.group.rotation.y = event.age * .12;
    event.group.children.forEach((craft, i) => { craft.position.set(Math.cos(event.age * .28 + i * 2.094) * 75, 142 + Math.sin(time + i) * 8, Math.sin(event.age * .28 + i * 2.094) * 75); });
    const points: T.Vector3[] = event.data.beamPoints ??= event.group.children.map(craft => {
      const point = craft.getWorldPosition(new T.Vector3()); point.y = Math.max(SEA_LEVEL, this.city.terrainHeight(point.x, point.z) ?? SEA_LEVEL) + 1; return point;
    });
    const pulse = event.tick > .55;
    if (pulse) {
      event.tick = 0;
      const candidates: { source: object; position: T.Vector3; priority: number }[] = [];
      const add = (source: object, x: number, y: number, z: number, priority: number) => { if (Math.hypot(x - event.x, z - event.z) < 120 * Math.sqrt(event.power)) candidates.push({ source, position: new T.Vector3(x, y, z), priority }); };
      for (const object of [...this.city.planes, ...this.city.ships]) if (object.userData.alive && !object.userData.gravityWell) add(object, object.position.x, object.position.y, object.position.z, this.city.planes.includes(object) ? 0 : 1);
      for (const car of this.city.traffic) if (car.alive) add(car, car.x, 1 + this.city.groundOffset(car.x, car.z), car.z, 2);
      for (const tree of this.city.trees) if (tree.alive) add(tree, tree.x, 4 + this.city.groundOffset(tree.x, tree.z), tree.z, 3);
      for (const building of this.city.buildings) if (building.health > 0) add(building, building.x, 2 + this.city.groundOffset(building.x, building.z), building.z, 4);
      const used = new Set<object>(); event.data.beamTargets = [];
      for (const craft of event.group.children) {
        const world = craft.getWorldPosition(new T.Vector3());
        const target = candidates.filter(c => !used.has(c.source)).sort((a, b) => a.priority - b.priority || a.position.distanceToSquared(world) - b.position.distanceToSquared(world))[0];
        if (target) used.add(target.source);
        const point = target?.position ?? new T.Vector3(world.x, 0, world.z); event.data.beamTargets.push(point);
      }
    }
    event.group.children.forEach((craft, i) => {
      const point = points[i], destination = (event.data.beamTargets as T.Vector3[] | undefined)?.[i];
      // Keep the current endpoint across target changes. Exponential damping
      // gives the same sweep at different frame rates and a smooth approach.
      if (destination) point.lerp(destination, -Math.expm1(-6 * dt));
      const local = craft.worldToLocal(point.clone()), beam = craft.children[2] as T.Mesh;
      beam.position.copy(local).multiplyScalar(.5); beam.scale.set(1.4, local.length() / 135, 1.4);
      beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), local.clone().normalize().negate());
      (beam.material as T.MeshBasicMaterial).opacity = .15 + Math.sin(time * 18) * .04;
      if (pulse) {
        const world = craft.getWorldPosition(new T.Vector3());
        this.city.hit({ x: point.x, z: point.z, radius: 34 * Math.sqrt(event.power), strength: 28 * event.power, fire: true, column: { bottom: Math.min(-25, point.y - 12), top: Math.max(point.y, world.y) + 20 } });
        for (let k = 0; k < 5; k++) this.fire.emit(point.x, point.y + 2, point.z, (Math.random() - .5) * 10, 15, (Math.random() - .5) * 10, 5, .6, '#a9ffca');
      }
    });
  }
  update(dt: number, time: number) {
    if (dt <= 0) return;
    this.carSoundCooldown -= dt; this.impactSoundCooldown -= dt;
    for (const queued of [...this.secondaryBlasts]) { queued.delay -= dt; if (queued.delay <= 0) { this.secondaryBlasts.splice(this.secondaryBlasts.indexOf(queued), 1); this.explosion(queued.x, queued.z, 18, 85, true, true); } }
    this.shake *= Math.exp(-dt * 3); this.flash *= Math.exp(-dt * 5); let groundChanged = false;
    for (const e of [...this.events]) {
      e.age += dt; e.tick += dt; const t = e.age, p = e.power;
      if (e.type === 'meteor' || e.type === 'bomb' || e.type === 'nuke') {
        const f = Math.min(1, t / e.duration), mesh = e.group.children[0]; mesh.position.set(e.type === 'meteor' ? (1 - f) * -230 : 0, 520 * (1 - f * f), e.type === 'meteor' ? (1 - f) * -90 : 0); mesh.rotation.x += dt;
        const position = new T.Vector3(e.x + mesh.position.x, mesh.position.y, e.z + mesh.position.z);
        const previous = e.data.projectilePosition ?? new T.Vector3(e.x + (e.type === 'meteor' ? -230 : 0), 520, e.z + (e.type === 'meteor' ? -90 : 0));
        const path = new T.Line3(previous, position), closest = new T.Vector3();
        for (const plane of this.city.planes) if (plane.userData.alive && path.closestPointToPoint(plane.position, true, closest).distanceTo(plane.position) < 23 + (e.type === 'meteor' ? 8 * Math.sqrt(p) : 2)) this.city.destroyPlane(plane, { x: position.x, z: position.z, radius: 60, strength: 200, impulse: true });
        e.data.projectilePosition = position;
        if (e.tick > .025 && e.type === 'meteor') { e.tick = 0; this.fire.emit(e.x + mesh.position.x, mesh.position.y + 8, e.z + mesh.position.z, -20, 30, -10, 32, 1.1, '#ff9e36'); this.smoke.emit(e.x + mesh.position.x, mesh.position.y, e.z + mesh.position.z, -10, 15, -5, 28, 2.4, '#6a5d50'); }
        if (f === 1) {
          const radius = (e.type === 'meteor' ? 105 : e.type === 'nuke' ? 220 : 65) * Math.sqrt(p); this.explosion(e.x, e.z, radius, (e.type === 'nuke' ? 340 : 230) * p);
          if (e.type === 'nuke') {
            const volumes = this.events.filter(event => event.type === 'fireball');
            if (volumes.length >= 6) this.removeEvent(volumes[0]);
            this.event('fireball', e.x, e.z, MEGA_FIREBALL_DURATION, p).group.add(new MegaFireball(radius));
          }
        }
      } else if (e.type === 'fireball') {
        (e.group.children[0] as MegaFireball).update(t);
      } else if (e.type === 'plume') {
        if (e.tick > .065) { e.tick = 0; const radius = e.data.radius, age = e.age, top = Math.min(radius * .8, age * 34), spread = Math.min(radius * .38, age * 12);
          for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, cap = i > 2, r = cap ? Math.random() * spread : 3 + Math.random() * 8, y = cap ? top + (Math.random() - .5) * spread * .35 : Math.random() * top;
            this.smoke.emit(e.x + Math.cos(a) * r, 3 + y, e.z + Math.sin(a) * r, Math.cos(a) * (cap ? 7 : 2) + 3, cap ? 4 : 15, Math.sin(a) * (cap ? 7 : 2), (cap ? 12 : 7) + spread * .22, 1.8 + Math.random() * 2.5, age < 1 ? '#a18a65' : '#59605d');
          }
        }
      } else if (e.type === 'ring') {
        this.shockwave(e);
      } else if (e.type === 'cluster' && e.tick > .32) {
        e.tick = 0; const k = e.data.next++; this.trigger('bomb', e.x + (k % 4 - 1.5) * 42, e.z + (Math.floor(k / 4) - 1) * 44, p * .7, false);
      } else if (e.type === 'tornado') {
        e.x += Math.sin(t * .3) * dt * 18; e.z -= dt * 12; e.group.position.set(e.x, 0, e.z);
        this.pullTransport(e, dt, 1);
        e.group.children.forEach((ring, i) => { ring.rotation.z = time * (2 + i * .025); ring.position.x = Math.sin(time * 1.8 + i * .12) * i * .28; ring.position.z = Math.cos(time * 1.5 + i * .1) * i * .25; });
        if (e.tick > .2) { e.tick = 0; this.city.hit({ x: e.x, z: e.z, radius: 110 * Math.sqrt(p), strength: 19 * p, column: { bottom: -25, top: 240 * Math.sqrt(p) } }); for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, h = Math.random() * 140; this.smoke.emit(e.x + Math.cos(a) * (12 + h * .2), h, e.z + Math.sin(a) * (12 + h * .2), -Math.sin(a) * 45, 22, Math.cos(a) * 45, 18, 1.4, '#5a6568'); } }
        for (const d of [...this.debris, ...this.wrecks, ...this.bodies]) if (d && !d.removed && !d.submerged && Math.hypot(d.x - e.x, d.z - e.z) < 140 * Math.sqrt(p)) { const dx = d.x - e.x, dz = d.z - e.z; d.vx += (-dx * .7 - dz * 1.7 - d.vx * .65) * dt; d.vz += (-dz * .7 + dx * 1.7 - d.vz * .65) * dt; d.vy += (85 - d.y * .34 - d.vy * .8) * dt; d.resting = false; }
      } else if (e.type === 'ufo') {
        this.updateUfo(e, dt, time);
      } else if (e.type === 'tsunami') {
        const plan = e.data.plan as WavePlan; (e.group.children[0] as TsunamiWave).update(t, this.city.night.value);
        const surface = (x: number, z: number) => SEA_LEVEL + waveHeight(plan, t, x, z);
        if (e.tick >= .15) {
          this.city.inundate(surface, e.tick, 75 * p, { x: plan.dx, z: plan.dz }); e.tick = 0;
          const front = waveFront(plan, t);
          for (let i = 0; i < 32; i++) {
            const across = (Math.random() - .5) * plan.radius * 1.85;
            const x = plan.x + plan.dx * front + plan.dz * across, z = plan.z + plan.dz * front - plan.dx * across, height = surface(x, z);
            if (height < 2) continue;
            this.sprayWater.emit(x, height + .5, z, plan.dx * (12 + Math.random() * 22), 6 + Math.random() * 15, plan.dz * (12 + Math.random() * 22), 2 + Math.random() * 5, .65 + Math.random(), '#c7eeeb');
          }
        }
        for (const body of [...this.debris, ...this.wrecks, ...this.bodies]) if (!body.removed && surface(body.x, body.z) > Math.max(1, body.y - 2)) {
          body.resting = false; body.vx += (plan.dx * 48 - body.vx) * dt * 2; body.vz += (plan.dz * 48 - body.vz) * dt * 2; body.vy += dt * 22;
        }
      } else if (e.type === 'quake') {
        this.shake = Math.max(this.shake, 1.8 * p * (1 - t / e.duration)); e.group.scale.setScalar(Math.min(1, t));
        if (e.tick > .55) { e.tick = 0; this.city.hit({ x: e.x + Math.sin(t) * 55, z: e.z + Math.cos(t) * 55, radius: 220 * Math.sqrt(p), strength: 15 * p, groundOnly: true }); if (Math.random() > .65) this.sound.impact(.5); }
      } else if (e.type === 'storm') {
        if (e.tick > .7) { e.tick = 0; this.bolt(e.x + (Math.random() - .5) * 250, e.z + (Math.random() - .5) * 250, p); }
        for (let i = 0; i < 12; i++) this.fire.emit(e.x + (Math.random() - .5) * 350, 190, e.z + (Math.random() - .5) * 350, -12, -150, 0, 1.8, 1.5, '#6c9ca9');
      } else if (e.type === 'flood') {
        const basin = e.data.basin as Basin, depth = (10 + p * 8) * T.MathUtils.smoothstep(t, 0, 10);
        if (Math.abs(basin.depth - depth) > .001) { basin.depth = depth; groundChanged = true; }
      } else if (e.type === 'volcano') {
        e.group.scale.setScalar(Math.min(1, t * .6));
        if (e.tick > .5) { e.tick = 0; const a = Math.random() * Math.PI * 2, radius = 55 + Math.random() * 180; this.trigger('meteor', e.x + Math.cos(a) * radius, e.z + Math.sin(a) * radius, .28 * p, false); this.fire.emit(e.x, 60, e.z, (Math.random() - .5) * 30, 60, (Math.random() - .5) * 30, 25, 3, '#ff853b'); this.smoke.emit(e.x, 70, e.z, 9, 35, 2, 70, 8, '#4e4b47'); }
      } else if (e.type === 'blackhole') {
        const scale = Math.max(0, Math.min(1, t / 2, (e.duration - t) / 2)); e.group.scale.setScalar(scale);
        e.group.children.forEach((c, i) => { if (i) c.rotation.z = t * (.3 + i * .25); });
        this.pullTransport(e, dt, scale);
        if (e.tick > .35) { e.tick = 0; this.city.hit({ x: e.x, z: e.z, radius: 175 * Math.sqrt(p) * scale, strength: 19 * p }); }
        for (const d of [...this.debris, ...this.wrecks, ...this.bodies]) if (!d.removed && Math.hypot(d.x - e.x, d.z - e.z) < 240 * Math.sqrt(p) * scale) {
          const dx = e.x - d.x, dz = e.z - d.z;
          d.resting = false; d.vx += (dx * 2.3 + dz * .65 - d.vx * .7) * dt; d.vy += ((65 - d.y) * 2.6 + 30 - d.vy * .55) * dt; d.vz += (dz * 2.3 - dx * .65 - d.vz * .7) * dt;
          if (Math.hypot(dx, d.y - 65, dz) < 25) { d.removed = true; d.y = -80; if ('id' in d) this.debrisBatch.hide(d.id); }
        }
      }
      if (e.age >= e.duration) this.removeEvent(e);
    }
    if (groundChanged) { this.city.refreshGround(); this.splats.refreshGround(); }
    this.flood = Math.max(0, ...this.city.basins.map(b => b.depth));
    this.floodClock = this.city.basins.length ? this.floodClock + dt : 0;
    if (this.city.basins.length && this.floodClock >= .3) { this.city.inundate(() => SEA_LEVEL, this.floodClock, 11); this.floodClock = 0; }
    for (const d of this.debris) {
      if (!d || d.removed) continue; d.life -= dt;
      advanceBody(d, dt, Math.max(.25, Math.min(d.sx, d.sy, d.sz) * .5), this.city.collision, this.waterAt, hit => this.impact(hit));
      if (d.removed) { this.debrisBatch.hide(d.id); continue; }
      if (!d.resting) { d.rx += d.spin * dt; d.rz += d.spin * dt * .7; }
      this.debrisBatch.set(d.id, d.x, d.y, d.z, d.sx, d.sy, d.sz, 0, d.rx, d.rz);
    }
    for (const ring of this.ripples) { if (!ring) continue; ring.age += dt; const t = ring.age / 2.5; this.rippleOpacity[ring.id] = Math.max(0, 1 - t); if (t >= 1) this.rippleBatch.hide(ring.id); else this.rippleBatch.set(ring.id, ring.x, this.waterAt(ring.x, ring.z) + .15, ring.z, ring.size * (.3 + t), 1, ring.size * (.3 + t)); }
    this.rippleBatch.mesh.geometry.attributes.aOpacity.needsUpdate = true; this.sprayWater.update(dt);
    this.updateActors(dt); this.fire.update(dt); this.smoke.update(dt); this.blood.update(dt);
  }
  removeEvent(e: Event) { this.waterWaves.delete(e); if (e.type === 'blackhole' || e.type === 'tornado') for (const object of e.data.captured as Set<T.Group>) if (object.userData.gravityWell === e) this.shredTransport(object, e); this.scene.remove(e.group); e.group.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } }); const i = this.events.indexOf(e); if (i >= 0) this.events.splice(i, 1); }
  setBloodEnabled(enabled: boolean) { this.bloodEnabled = enabled; this.blood.mesh.visible = enabled; this.splats.mesh.visible = enabled; }
  reset() { for (const e of [...this.events]) this.removeEvent(e); this.city.basins = []; this.city.refreshGround(); this.shipsDestroyed = this.docksDestroyed = this.airportSectionsDestroyed = this.floodClock = this.carsLifted = this.aircraftCaptured = this.shipsCaptured = 0; this.fire.clear(); this.smoke.clear(); this.sprayWater.clear(); this.ripples = []; this.rippleCursor = this.rippleBatch.used = this.rippleBatch.mesh.count = 0; this.waterImpacts = this.solidImpacts = this.buildingImpacts = this.aircraftDestroyed = 0; this.blood.clear(); this.debris = []; this.debrisCursor = 0; this.debrisBatch.used = 0; this.debrisBatch.mesh.count = 0; this.wrecks = []; this.bodies = []; this.secondaryBlasts = []; this.splats.used = this.splats.mesh.count = this.splatCursor = 0; this.limbs.used = this.limbs.mesh.count = 0; this.carExplosions = this.deaths = this.waveCounter = 0; this.carSoundCooldown = 0; this.executed = 0; this.flood = 0; this.flash = 0; this.shake = 0; }
}
