import * as T from 'three';
import { Batch, City, type Building, type Citizen, type Hit } from './world';
import { blastImpulse } from './model.js';
import { Sound } from './audio';

export const DISASTERS = [
  { id: 'meteor', name: 'Метеорит', sub: 'Привет из космоса', icon: 'meteor', color: '#ffa46d', radius: 105, category: 'space' },
  { id: 'bomb', name: 'Авиабомба', sub: 'Точный удар', icon: 'bomb', color: '#f8b96f', radius: 65, category: 'weapons' },
  { id: 'cluster', name: 'Ковровый удар', sub: 'Целый квартал', icon: 'crosshair', color: '#f89e6c', radius: 135, category: 'weapons' },
  { id: 'nuke', name: 'Мегавзрыв', sub: 'Новая точка отсчёта', icon: 'radiation', color: '#ffc270', radius: 220, category: 'weapons' },
  { id: 'tornado', name: 'Торнадо', sub: 'Город на взлёт', icon: 'tornado', color: '#b8cfe0', radius: 78, category: 'nature' },
  { id: 'tsunami', name: 'Цунами', sub: 'Первая береговая', icon: 'waves', color: '#75d6e7', radius: 160, category: 'nature' },
  { id: 'quake', name: 'Землетрясение', sub: 'Всё нестабильно', icon: 'activity', color: '#e8b183', radius: 210, category: 'nature' },
  { id: 'storm', name: 'Гроза', sub: 'Высокое напряжение', icon: 'zap', color: '#acb9ff', radius: 150, category: 'nature' },
  { id: 'flood', name: 'Потоп', sub: 'Вид на океан', icon: 'droplets', color: '#76cadd', radius: 260, category: 'nature' },
  { id: 'volcano', name: 'Вулкан', sub: 'Горячий сосед', icon: 'mountain', color: '#ff8962', radius: 140, category: 'nature' },
  { id: 'ufo', name: 'НЛО', sub: 'Мы пришли с миром', icon: 'ufo', color: '#aaf3bd', radius: 100, category: 'space' },
  { id: 'blackhole', name: 'Чёрная дыра', sub: 'Последний аргумент', icon: 'orbit', color: '#c3a3fa', radius: 170, category: 'space' },
] as const;
export type DisasterId = typeof DISASTERS[number]['id'];
type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; color: T.Color; };
class Particles {
  mesh: T.Points; items: Particle[] = []; cursor = 0; positions: Float32Array; colors: Float32Array; sizes: Float32Array; alphas: Float32Array; material: T.ShaderMaterial;
  constructor(scene: T.Scene, public capacity: number, public smoke: boolean, public gravity = smoke ? 0 : 9) {
    const geo = new T.BufferGeometry(); this.positions = new Float32Array(capacity * 3); this.colors = new Float32Array(capacity * 3); this.sizes = new Float32Array(capacity); this.alphas = new Float32Array(capacity);
    geo.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aColor', new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aSize', new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage)); geo.setAttribute('aAlpha', new T.BufferAttribute(this.alphas, 1).setUsage(T.DynamicDrawUsage));
    this.material = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: smoke ? T.NormalBlending : T.AdditiveBlending, uniforms: { uScale: { value: 700 }, uSmoke: { value: smoke ? 1 : 0 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uScale; void main(){vColor=aColor;vAlpha=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(aSize*uScale/-mv.z,0.,200.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha; uniform float uSmoke; void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;float a=pow(1.-r,uSmoke>.5?1.5:2.);gl_FragColor=vec4(vColor,a*vAlpha);}` });
    this.mesh = new T.Points(geo, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = smoke ? 3 : 4; scene.add(this.mesh);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: T.ColorRepresentation) {
    const i = this.cursor++ % this.capacity; this.items[i] = { x, y, z, vx, vy, vz, size, life, max: life, color: new T.Color(color) };
  }
  update(dt: number) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i]; if (!p || p.life <= 0) { this.alphas[i] = 0; this.sizes[i] = 0; continue; }
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= Math.exp(-dt * .35); p.vz *= Math.exp(-dt * .35); p.vy -= dt * this.gravity;
      const f = Math.max(0, p.life / p.max); this.positions.set([p.x, p.y, p.z], i * 3); this.colors.set([p.color.r, p.color.g, p.color.b], i * 3); this.sizes[i] = p.size * (this.smoke ? 2 - f : .4 + f); this.alphas[i] = f * (this.smoke ? .8 : 1);
    }
    for (const key of ['position', 'aColor', 'aSize', 'aAlpha']) this.mesh.geometry.attributes[key].needsUpdate = true;
  }
  clear() { this.items = []; this.alphas.fill(0); this.sizes.fill(0); this.cursor = 0; this.update(0); }
}
type Debris = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; rz: number; spin: number; sx: number; sy: number; sz: number; life: number; waveId?: number; };
type ThrownActor = { source: Citizen; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; spin: number; age: number; landed: boolean; limbs?: number[]; waveId?: number; };
type Event = { type: DisasterId | 'bolt' | 'ring'; x: number; z: number; age: number; duration: number; power: number; group: T.Group; tick: number; data: Record<string, any>; };
export class Effects {
  fire: Particles; smoke: Particles; debrisBatch: Batch; debris: Debris[] = []; debrisCursor = 0; events: Event[] = [];
  blood: Particles; splats: Batch; limbs: Batch; splatCursor = 0; bloodEnabled = true;
  wrecks: ThrownActor[] = []; bodies: ThrownActor[] = []; secondaryBlasts: { x: number; z: number; delay: number }[] = [];
  carExplosions = 0; deaths = 0; waveCounter = 0; carSoundCooldown = 0;
  shake = 0; flash = 0; flood = 0; executed = 0; power = 1; destroyedAtStart = 0;
  onEvent: (name: string, message: string) => void = () => {};
  constructor(public scene: T.Scene, public city: City, public sound: Sound) {
    this.fire = new Particles(scene, 5500, false); this.smoke = new Particles(scene, 2800, true);
    this.blood = new Particles(scene, 2400, true, 28);
    const stain = new T.CircleGeometry(1, 12); stain.rotateX(-Math.PI / 2);
    const vertices = stain.attributes.position;
    for (let i = 1; i < vertices.count; i++) { const factor = .78 + Math.sin(i * 12.3) * .2; vertices.setX(i, vertices.getX(i) * factor); vertices.setZ(i, vertices.getZ(i) * factor); }
    this.splats = new Batch(scene, stain, new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 2600, false);
    this.limbs = new Batch(scene, new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ roughness: .9 }), 2800, false);
    this.debrisBatch = new Batch(scene, new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ roughness: .85 }), 2200); this.attachCity(city);
  }
  attachCity(city: City) {
    this.city = city; city.onCollapse = b => this.collapse(b); city.onFire = b => this.burn(b);
    city.onCarExplosion = (car, hit) => this.explodeCar(car, hit); city.onDeath = (person, hit) => this.killPerson(person, hit);
    city.onWreck = (x, y, z, color, hit) => {
      const kick = this.kick(x, z, hit);
      for (let i = 0; i < 7; i++) this.chunk(x, y, z, 1 + Math.random() * 3, 1, 2 + Math.random() * 3, kick.vx + (Math.random() - .5) * 12, kick.vy + 5 + Math.random() * 12, kick.vz + (Math.random() - .5) * 12, color, hit?.waveId);
      this.smoke.emit(x, y, z, kick.vx * .3, 10, kick.vz * .3, 17, 4, '#65706d');
    };
  }
  kick(x: number, z: number, hit?: Hit, mass = 1) { return hit?.impulse ? blastImpulse(x, z, hit.x, hit.z, hit.radius, hit.strength, mass) : { vx: 0, vy: 5, vz: 0 }; }
  actor(source: Citizen, hit: Hit, mass: number): ThrownActor { return { source, x: source.x, y: 1.4, z: source.z, ...this.kick(source.x, source.z, hit, mass), rx: 0, ry: source.axis ? Math.PI / 2 : 0, rz: 0, spin: (Math.random() - .5) * 7, age: 0, landed: false, waveId: hit.waveId }; }
  explodeCar(car: Citizen, hit: Hit) {
    this.carExplosions++; const wreck = this.actor(car, hit, 1.45); wreck.vy += 9; this.wrecks.push(wreck);
    this.secondaryBlasts.push({ x: car.x, z: car.z, delay: .12 + Math.random() * .22 });
    for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; this.fire.emit(car.x, 2.5, car.z, Math.cos(a) * 18, 12 + Math.random() * 20, Math.sin(a) * 18, 9 + Math.random() * 10, .7 + Math.random() * 1.1, i % 3 ? '#ff8228' : '#ffdb79'); }
    for (let i = 0; i < 7; i++) this.chunk(car.x, 2, car.z, .5 + Math.random(), .25, .7 + Math.random(), wreck.vx + (Math.random() - .5) * 22, wreck.vy + Math.random() * 14, wreck.vz + (Math.random() - .5) * 22, i % 2 ? '#444b4b' : '#a89369', hit.waveId);
  }
  splatter(x: number, z: number, size: number) {
    if (!this.bloodEnabled) return; const id = this.splatCursor++ % 2600, color = this.splatCursor % 3 ? '#87121d' : '#b71b29';
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
    const y = b.collapsed ? 3 : b.height * .4;
    this.smoke.emit(b.x + (Math.random() - .5) * 12, y + 8, b.z, 4, 15, 1, 25, 6, '#465158');
    for (let i = 0; i < 3; i++) this.fire.emit(b.x + (Math.random() - .5) * b.width, y, b.z + (Math.random() - .5) * b.depth, 0, 12 + Math.random() * 8, 0, 12, 1.4, i % 2 ? '#ffb142' : '#ff5022');
  }
  chunk(x: number, y: number, z: number, sx: number, sy: number, sz: number, vx: number, vy: number, vz: number, color: T.ColorRepresentation, waveId?: number) {
    const id = this.debrisCursor++ % 2200;
    if (id >= this.debrisBatch.used) this.debrisBatch.add(x, y, z, sx, sy, sz, color); else this.debrisBatch.color(id, color);
    this.debris[id] = { id, x, y, z, sx, sy, sz, vx, vy, vz, rx: 0, rz: 0, spin: (Math.random() - .5) * 4, life: 22, waveId };
  }
  collapse(b: Building) {
    const n = Math.min(40, 9 + Math.floor(b.height / 4));
    const kick = b.blast ? blastImpulse(b.x, b.z, b.blast.x, b.blast.z, b.blast.radius + b.width, b.blast.strength) : { vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, force = b.blast ? 5 : 7 + Math.random() * 30;
      this.chunk(b.x + (Math.random() - .5) * b.width, Math.random() * b.height + 4, b.z + (Math.random() - .5) * b.depth, 2 + Math.random() * 5, 1 + Math.random() * 3, 2 + Math.random() * 5, kick.vx + Math.cos(a) * force, kick.vy + 6 + Math.random() * 16, kick.vz + Math.sin(a) * force, b.color.clone().multiplyScalar(.7), b.blast?.waveId);
    }
    for (let i = 0; i < 8; i++) this.smoke.emit(b.x + (Math.random() - .5) * b.width, 8 + Math.random() * b.height * .5, b.z + (Math.random() - .5) * b.depth, (Math.random() - .5) * 22, 9, (Math.random() - .5) * 22, 30, 4 + Math.random() * 3, '#818078');
    this.shake = Math.max(this.shake, .4); this.city.miniMapDirty = true;
  }
  explosion(x: number, z: number, radius: number, power: number, fire = true, secondary = false) {
    if (!secondary || this.carSoundCooldown <= 0) { this.sound.impact(radius / 75); this.carSoundCooldown = .12; }
    this.shake = Math.max(this.shake, radius / 80); this.flash = Math.max(this.flash, Math.min(.7, radius / 400));
    for (let i = 0; i < Math.min(160, radius); i++) {
      const a = Math.random() * Math.PI * 2, speed = Math.random() * radius * 1.3, y = Math.random() * radius * .3;
      this.fire.emit(x, y + 3, z, Math.cos(a) * speed, Math.random() * radius * 1.2, Math.sin(a) * speed, 10 + Math.random() * 22, .7 + Math.random() * 2.3, i % 3 ? '#ff9e36' : '#fff0b6');
      if (i % 3 === 0) this.smoke.emit(x + (Math.random() - .5) * 25, y + 8, z + (Math.random() - .5) * 25, Math.cos(a) * speed * .4, 12 + Math.random() * 25, Math.sin(a) * speed * .4, 25 + Math.random() * 35, 4 + Math.random() * 5, '#5e5e56');
    }
    const ring = this.event('ring', x, z, .45 + radius / 170, power); ring.data = { radius, previous: -1, fire, waveId: ++this.waveCounter, pushed: new Set<object>() };
    const mesh = new T.Mesh(new T.RingGeometry(.945, 1, 100), new T.MeshBasicMaterial({ color: '#ffe8c6', transparent: true, opacity: .85, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 1.1; ring.group.add(mesh);
    const dome = new T.Mesh(new T.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, uniforms: { opacity: { value: .3 } }, vertexShader: 'varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}', fragmentShader: 'varying vec3 vNormal;varying vec3 vView;uniform float opacity;void main(){float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),3.);gl_FragColor=vec4(1.,.85,.62,rim*opacity);}' })); ring.group.add(dome);
  }
  event(type: Event['type'], x: number, z: number, duration: number, power: number) {
    const group = new T.Group(); group.position.set(x, 0, z); this.scene.add(group);
    const e: Event = { type, x, z, duration, power, group, age: 0, tick: 0, data: {} }; this.events.push(e); return e;
  }
  trigger(type: DisasterId, x: number, z: number, multiplier = this.power, announce = true) {
    if (this.events.filter(e => e.type !== 'ring' && e.type !== 'bolt').length >= 28) { this.onEvent('Слишком много событий', 'Дождитесь завершения части катастроф'); return false; }
    const d = DISASTERS.find(d => d.id === type)!; if (announce) { this.executed++; this.onEvent(d.name, d.sub); }
    const p = multiplier;
    if (type === 'bomb' || type === 'meteor' || type === 'nuke') {
      const e = this.event(type, x, z, type === 'meteor' ? 2 : 1.5, p);
      const mesh = new T.Mesh(type === 'meteor' ? new T.IcosahedronGeometry(8 * Math.sqrt(p), 1) : new T.CapsuleGeometry(type === 'nuke' ? 4 : 2, 8, 3, 8), new T.MeshStandardMaterial({ color: type === 'meteor' ? '#623421' : '#4d5653', emissive: type === 'meteor' ? '#e6430c' : '#000000', emissiveIntensity: 1.8, roughness: .9 })); e.group.add(mesh);
      if (type !== 'meteor') { const fin = new T.Mesh(new T.BoxGeometry(9, 3, .6), new T.MeshStandardMaterial({ color: '#ab7754' })); fin.position.y = 7; mesh.add(fin); }
    } else if (type === 'cluster') {
      const e = this.event(type, x, z, 4.2, p); e.data.next = 0;
    } else if (type === 'tornado') {
      const e = this.event(type, x, z, 22, p);
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
      const e = this.event(type, 0, this.city.extent + 170, 19, p); e.data.previous = e.z;
      const geo = new T.PlaneGeometry(this.city.extent * 2.35, 185, 90, 32); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const z0 = pos.getZ(i), xx = pos.getX(i); pos.setY(i, Math.exp(-Math.pow((z0 + 6) / 40, 2)) * (35 + 12 * p + Math.sin(xx * .027) * 3)); }
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: '#419bb1', roughness: .19, metalness: .35, transparent: true, opacity: .87, side: T.DoubleSide })); e.group.add(m);
      const foam = new T.Mesh(new T.PlaneGeometry(this.city.extent * 2.35, 8, 40, 1), new T.MeshBasicMaterial({ color: '#d4f7ee', transparent: true, opacity: .62, side: T.DoubleSide })); foam.rotation.x = -Math.PI / 2; foam.position.set(0, 36 + 12 * p, -6); e.group.add(foam);
    } else if (type === 'quake') {
      const e = this.event(type, x, z, 9, p);
      for (let i = 0; i < 7; i++) {
        const points: T.Vector3[] = []; const a = i / 7 * Math.PI * 2;
        for (let k = 0; k < 12; k++) points.push(new T.Vector3(Math.cos(a) * k * 22 + (Math.random() - .5) * 20, .95, Math.sin(a) * k * 22 + (Math.random() - .5) * 20));
        const crack = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, 1.4, 3, false), new T.MeshBasicMaterial({ color: '#eb783b' })); e.group.add(crack);
      }
    } else if (type === 'storm' || type === 'flood') {
      this.event(type, x, z, type === 'flood' ? 26 : 15, p);
    } else if (type === 'volcano') {
      const e = this.event(type, x, z, 26, p);
      const cone = new T.Mesh(new T.CylinderGeometry(16, 67, 64, 36, 6, true), new T.MeshStandardMaterial({ color: '#574f43', flatShading: true, roughness: 1 })); cone.position.y = 26; e.group.add(cone);
      const lava = new T.Mesh(new T.CircleGeometry(16, 32), new T.MeshBasicMaterial({ color: '#ff762e' })); lava.rotation.x = -Math.PI / 2; lava.position.y = 58.2; e.group.add(lava);
      this.explosion(x, z, 84 * p, 170, true);
    } else if (type === 'blackhole') {
      const e = this.event(type, x, z, 19, p);
      const hole = new T.Mesh(new T.SphereGeometry(22, 40, 24), new T.MeshBasicMaterial({ color: '#020307' })); hole.position.y = 65; e.group.add(hole);
      for (let i = 0; i < 3; i++) { const ring = new T.Mesh(new T.TorusGeometry(31 + i * 9, 2 - i * .5, 8, 100), new T.MeshBasicMaterial({ color: ['#ffdc9e', '#dba8fd', '#ad80eb'][i], transparent: true, opacity: .9 - i * .2 })); ring.position.y = 65; ring.rotation.x = 1.25; ring.rotation.y = .4; e.group.add(ring); }
    }
    return true;
  }
  bolt(x: number, z: number, power: number) {
    const e = this.event('bolt', x, z, .3, power), points: T.Vector3[] = [];
    for (let i = 0; i <= 12; i++) points.push(new T.Vector3(i === 12 ? 0 : (Math.random() - .5) * 32, 260 - i / 12 * 260, (Math.random() - .5) * 14));
    e.group.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, 1.5, 4, false), new T.MeshBasicMaterial({ color: '#d6dfff' })));
    this.explosion(x, z, 35 * Math.sqrt(power), 100 * power); this.flash = .25;
  }
  shockwave(e: Event) {
    const fraction = Math.min(1, e.age / e.duration), radius = e.data.radius * fraction;
    const hit: Hit = { x: e.x, z: e.z, radius: e.data.radius, strength: e.power, fire: e.data.fire, impulse: true, waveId: e.data.waveId, front: { previous: e.data.previous, current: radius } };
    this.city.hit(hit);
    for (const object of [...this.debris, ...this.wrecks, ...this.bodies]) {
      if (!object || object.waveId === e.data.waveId || e.data.pushed.has(object)) continue;
      if (Math.hypot(object.x - e.x, object.z - e.z) > radius || object.y > e.data.radius * 1.3) continue;
      const kick = this.kick(object.x, object.z, hit); object.vx += kick.vx; object.vy += kick.vy; object.vz += kick.vz;
      if ('life' in object) object.life = 12; else { object.landed = false; object.age = Math.min(object.age, 20); }
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
      if (actor.age < 45) {
        actor.vy -= 28 * dt; actor.x += actor.vx * dt; actor.y += actor.vy * dt; actor.z += actor.vz * dt;
        actor.rx += actor.spin * dt; actor.rz += actor.spin * dt * .4;
        const floor = body ? 1 : 1.15;
        if (actor.y < floor) {
          actor.y = floor; actor.vy = Math.abs(actor.vy) * (body ? .12 : .24); actor.vx *= .64; actor.vz *= .64; actor.spin *= .55;
          if (!actor.landed && body) { this.spray(actor.x, 1, actor.z, actor.vx, actor.vz, 12); this.splatter(actor.x, actor.z, 1.8); for (let i = 0; i < 4; i++) this.splatter(actor.x + (Math.random() - .5) * 5, actor.z + (Math.random() - .5) * 5, .35 + Math.random() * .5); }
          actor.landed = true;
          if (body) { actor.rx = T.MathUtils.lerp(actor.rx, Math.PI / 2, Math.min(1, dt * 10)); actor.rz *= .8; }
          if (Math.abs(actor.vx) + Math.abs(actor.vz) < .15) { actor.vx = actor.vz = actor.vy = actor.spin = 0; }
        }
      }
      const id = actor.source.id;
      if (body) {
        rotation.set(actor.rx, actor.ry, actor.rz);
        this.city.people.set(id, actor.x, actor.y, actor.z, .6, 1.05, .5, actor.ry, actor.rx, actor.rz);
        offset.set(0, .77, 0).applyEuler(rotation); this.city.heads.set(actor.source.extra, actor.x + offset.x, actor.y + offset.y, actor.z + offset.z, 1, 1, 1);
        for (let i = 0; i < 4; i++) {
          const arm = i < 2, sign = i % 2 ? 1 : -1; offset.set(sign * (arm ? .43 : .18), arm ? -.04 : -.82, 0).applyEuler(rotation);
          this.limbs.set(actor.limbs![i], actor.x + offset.x, actor.y + offset.y, actor.z + offset.z, .23, arm ? .7 : .8, .27, actor.ry, actor.rx, actor.rz + (arm && !actor.landed ? sign * .55 : 0));
        }
      } else {
        this.city.cars.set(id, actor.x, actor.y, actor.z, 2.25, 1.1, 4.5, actor.ry, actor.rx, actor.rz);
        if (actor.age < 9 && Math.floor(actor.age * 7) !== Math.floor((actor.age - dt) * 7)) { this.smoke.emit(actor.x, actor.y + 2, actor.z, 1, 7, 0, 8, 3, '#363e40'); this.fire.emit(actor.x, actor.y + 1, actor.z, 0, 5, 0, 5, .6, '#ff842c'); }
      }
    }
  }
  update(dt: number, time: number) {
    if (dt <= 0) return;
    this.carSoundCooldown -= dt;
    for (const queued of [...this.secondaryBlasts]) { queued.delay -= dt; if (queued.delay <= 0) { this.secondaryBlasts.splice(this.secondaryBlasts.indexOf(queued), 1); this.explosion(queued.x, queued.z, 18, 85, true, true); } }
    this.shake *= Math.exp(-dt * 3); this.flash *= Math.exp(-dt * 5); this.flood = 0;
    for (const e of [...this.events]) {
      e.age += dt; e.tick += dt; const t = e.age, p = e.power;
      if (e.type === 'meteor' || e.type === 'bomb' || e.type === 'nuke') {
        const f = Math.min(1, t / e.duration), mesh = e.group.children[0]; mesh.position.set(e.type === 'meteor' ? (1 - f) * -230 : 0, 520 * (1 - f * f), e.type === 'meteor' ? (1 - f) * -90 : 0); mesh.rotation.x += dt;
        if (e.tick > .025 && e.type === 'meteor') { e.tick = 0; this.fire.emit(e.x + mesh.position.x, mesh.position.y + 8, e.z + mesh.position.z, -20, 30, -10, 32, 1.1, '#ff9e36'); this.smoke.emit(e.x + mesh.position.x, mesh.position.y, e.z + mesh.position.z, -10, 15, -5, 28, 2.4, '#6a5d50'); }
        if (f === 1) {
          const radius = (e.type === 'meteor' ? 105 : e.type === 'nuke' ? 220 : 65) * Math.sqrt(p); this.explosion(e.x, e.z, radius, (e.type === 'nuke' ? 340 : 230) * p);
          if (e.type === 'nuke') for (let i = 0; i < 100; i++) { const a = Math.random() * Math.PI * 2, h = Math.random() * 180; this.smoke.emit(e.x + Math.cos(a) * (h > 120 ? 70 : 15), h, e.z + Math.sin(a) * (h > 120 ? 70 : 15), Math.cos(a) * 14, 20, Math.sin(a) * 14, 70, 10, '#766550'); }
        }
      } else if (e.type === 'ring') {
        this.shockwave(e);
      } else if (e.type === 'cluster' && e.tick > .32) {
        e.tick = 0; const k = e.data.next++; this.trigger('bomb', e.x + (k % 4 - 1.5) * 42, e.z + (Math.floor(k / 4) - 1) * 44, p * .7, false);
      } else if (e.type === 'tornado') {
        e.x += Math.sin(t * .3) * dt * 18; e.z -= dt * 12; e.group.position.set(e.x, 0, e.z);
        e.group.children.forEach((ring, i) => { ring.rotation.z = time * (2 + i * .025); ring.position.x = Math.sin(time * 1.8 + i * .12) * i * .28; ring.position.z = Math.cos(time * 1.5 + i * .1) * i * .25; });
        if (e.tick > .2) { e.tick = 0; this.city.hit({ x: e.x, z: e.z, radius: 78 * Math.sqrt(p), strength: 19 * p }); for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, h = Math.random() * 140; this.smoke.emit(e.x + Math.cos(a) * (12 + h * .2), h, e.z + Math.sin(a) * (12 + h * .2), -Math.sin(a) * 45, 22, Math.cos(a) * 45, 18, 1.4, '#5a6568'); } }
        for (const d of this.debris) if (d && Math.hypot(d.x - e.x, d.z - e.z) < 100) { const dx = d.x - e.x, dz = d.z - e.z; d.vx += (-dx * .8 - dz * 2) * dt; d.vz += (-dz * .8 + dx * 2) * dt; d.vy += 90 * dt; d.life = 6; }
      } else if (e.type === 'ufo') {
        e.group.rotation.y = t * .12;
        e.group.children.forEach((ship, i) => { ship.position.x = Math.cos(t * .28 + i * 2.094) * 75; ship.position.z = Math.sin(t * .28 + i * 2.094) * 75; ship.position.y = 142 + Math.sin(time + i) * 8; });
        if (e.tick > .55) { e.tick = 0; for (const ship of e.group.children) { const world = ship.getWorldPosition(new T.Vector3()); this.city.hit({ x: world.x, z: world.z, radius: 34 * Math.sqrt(p), strength: 28 * p, fire: true }); for (let k = 0; k < 4; k++) this.fire.emit(world.x, 5, world.z, (Math.random() - .5) * 8, 50, (Math.random() - .5) * 8, 7, 2.2, '#a9ffca'); } }
      } else if (e.type === 'tsunami') {
        e.z -= dt * (this.city.extent * 2 + 400) / e.duration; e.group.position.z = e.z;
        if (e.tick > .22) { e.tick = 0; for (const b of this.city.buildings) if (!b.collapsed && Math.abs(b.z - e.z) < 48) { this.city.damageBuilding(b, 23 * p); b.fire = 0; } this.city.inundate(40, e.z - 48, e.z + 48); for (let i = 0; i < 25; i++) this.smoke.emit((Math.random() - .5) * this.city.extent * 2, 38 + 12 * p, e.z - 6, 0, 12, -25, 20, 1.6, '#c4e5e5'); }
      } else if (e.type === 'quake') {
        this.shake = Math.max(this.shake, 1.8 * p * (1 - t / e.duration)); e.group.scale.setScalar(Math.min(1, t));
        if (e.tick > .55) { e.tick = 0; this.city.hit({ x: e.x + Math.sin(t) * 55, z: e.z + Math.cos(t) * 55, radius: 220 * Math.sqrt(p), strength: 15 * p }); if (Math.random() > .65) this.sound.impact(.5); }
      } else if (e.type === 'storm') {
        if (e.tick > .7) { e.tick = 0; this.bolt(e.x + (Math.random() - .5) * 250, e.z + (Math.random() - .5) * 250, p); }
        for (let i = 0; i < 12; i++) this.fire.emit(e.x + (Math.random() - .5) * 350, 190, e.z + (Math.random() - .5) * 350, -12, -150, 0, 1.8, 1.5, '#6c9ca9');
      } else if (e.type === 'flood') {
        const level = Math.sin(Math.PI * t / e.duration) * (13 + p * 9); this.flood = Math.max(this.flood, level);
        if (e.tick > 1) { e.tick = 0; for (const b of this.city.buildings) if (!b.collapsed && b.height < level * 1.6) { this.city.damageBuilding(b, 9 * p); b.fire = 0; } this.city.inundate(level); }
      } else if (e.type === 'volcano') {
        e.group.scale.setScalar(Math.min(1, t * .6));
        if (e.tick > .5) { e.tick = 0; const a = Math.random() * Math.PI * 2, radius = 55 + Math.random() * 180; this.trigger('meteor', e.x + Math.cos(a) * radius, e.z + Math.sin(a) * radius, .28 * p, false); this.fire.emit(e.x, 60, e.z, (Math.random() - .5) * 30, 60, (Math.random() - .5) * 30, 25, 3, '#ff853b'); this.smoke.emit(e.x, 70, e.z, 9, 35, 2, 70, 8, '#4e4b47'); }
      } else if (e.type === 'blackhole') {
        const scale = Math.min(1, t / 2, (e.duration - t) / 2); e.group.scale.setScalar(scale);
        e.group.children.forEach((c, i) => { if (i) c.rotation.z = t * (.3 + i * .25); });
        if (e.tick > .35) { e.tick = 0; this.city.hit({ x: e.x, z: e.z, radius: 175 * Math.sqrt(p) * scale, strength: 19 * p }); }
        for (const d of this.debris) if (d && Math.hypot(d.x - e.x, d.z - e.z) < 240) { d.vx += (e.x - d.x) * dt * 1.7; d.vy += (65 - d.y) * dt * 2 + 30 * dt; d.vz += (e.z - d.z) * dt * 1.7; d.life = 4; if (Math.hypot(d.x - e.x, d.y - 65, d.z - e.z) < 25) { d.y = -80; d.life = 0; this.debrisBatch.hide(d.id); } }
      }
      if (e.age >= e.duration) this.removeEvent(e);
    }
    for (const d of this.debris) {
      if (!d || d.life <= 0) continue; d.life -= dt;
      d.vy -= 28 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.rx += d.spin * dt; d.rz += d.spin * dt * .7;
      if (d.y < d.sy * .5 + .35) { d.y = d.sy * .5 + .35; d.vy = Math.abs(d.vy) * .22; d.vx *= .68; d.vz *= .68; d.spin *= .5; if (Math.hypot(d.vx, d.vz) < .2) { d.vy = 0; d.spin = 0; } }
      this.debrisBatch.set(d.id, d.x, d.y, d.z, d.sx, d.sy, d.sz, 0, d.rx, d.rz);
    }
    this.updateActors(dt); this.fire.update(dt); this.smoke.update(dt); this.blood.update(dt);
  }
  removeEvent(e: Event) { this.scene.remove(e.group); e.group.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } }); const i = this.events.indexOf(e); if (i >= 0) this.events.splice(i, 1); }
  setBloodEnabled(enabled: boolean) { this.bloodEnabled = enabled; this.blood.mesh.visible = enabled; this.splats.mesh.visible = enabled; }
  reset() { for (const e of [...this.events]) this.removeEvent(e); this.fire.clear(); this.smoke.clear(); this.blood.clear(); this.debris = []; this.debrisCursor = 0; this.debrisBatch.used = 0; this.debrisBatch.mesh.count = 0; this.wrecks = []; this.bodies = []; this.secondaryBlasts = []; this.splats.used = this.splats.mesh.count = this.splatCursor = 0; this.limbs.used = this.limbs.mesh.count = 0; this.carExplosions = this.deaths = this.waveCounter = 0; this.carSoundCooldown = 0; this.executed = 0; this.flood = 0; this.flash = 0; this.shake = 0; }
}
