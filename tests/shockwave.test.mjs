import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { blastImpulse } from '../src/model.js';

function fixture() { const scene = new Scene(), city = new City(scene, 'BLAST-QA', 14), fx = new Effects(scene, city, new Sound()); city.trees = []; city.props = []; city.planes = []; city.ships = []; return { city, fx }; }
function advance(city, fx, seconds) { for (let t = 0; t < seconds; t += .05) { city.update(.05, t); fx.update(.05, t); } }

test('impulse points away from the epicentre in every quadrant and scales with distance and mass', () => {
  for (const [x, z] of [[20, 0], [-20, 0], [0, 20], [0, -20], [-30, 30]]) { const k = blastImpulse(x, z, 0, 0, 100, 200); assert.ok(k.vx * x + k.vz * z > 0); assert.ok(k.vy > 0); }
  assert.ok(blastImpulse(10, 0, 0, 0, 100, 200).vx > blastImpulse(90, 0, 0, 0, 100, 200).vx);
  assert.ok(blastImpulse(10, 0, 0, 0, 100, 200, 1).vx > blastImpulse(10, 0, 0, 0, 100, 200, 2).vx);
  assert.deepEqual(blastImpulse(100, 0, 0, 0, 100, 200), { vx: 0, vy: 0, vz: 0 });
  assert.ok(Object.values(blastImpulse(0, 0, 0, 0, 100, 200)).every(Number.isFinite));
});
test('damage travels with the expanding front and is applied only once per building', () => {
  const { city, fx } = fixture(); city.traffic = []; city.pedestrians = []; city.buildings = city.buildings.slice(0, 2);
  Object.assign(city.buildings[0], { x: 20, z: 0, height: 20, width: 16 }); Object.assign(city.buildings[1], { x: 110, z: 0, height: 20, width: 16 });
  fx.explosion(0, 0, 150, 40, false); assert.equal(city.damage, 0);
  fx.update(.2, .2); assert.ok(city.buildings[0].health < 100); assert.equal(city.buildings[1].health, 100);
  const nearHealth = city.buildings[0].health; advance(city, fx, 2);
  assert.equal(city.buildings[0].health, nearHealth); assert.ok(city.buildings[1].health < 100); assert.equal(fx.events.length, 0); city.dispose();
});
test('collapsing buildings on opposite sides eject fragments away from the explosion', () => {
  const { city, fx } = fixture(); city.traffic = []; city.pedestrians = []; city.buildings = city.buildings.slice(0, 2);
  Object.assign(city.buildings[0], { x: -40, z: 0, height: 30 }); Object.assign(city.buildings[1], { x: 40, z: 0, height: 30 });
  fx.explosion(0, 0, 140, 500, false); fx.update(1, 1);
  assert.equal(city.destroyed, 2); assert.ok(fx.debris.length > 10);
  assert.ok(fx.debris.filter(d => d.x < 0).every(d => d.vx < 0)); assert.ok(fx.debris.filter(d => d.x > 0).every(d => d.vx > 0)); city.dispose();
});
test('a wave relaunches existing rubble once, without accelerating it every frame', () => {
  const { city, fx } = fixture(); city.buildings = []; city.traffic = []; city.pedestrians = [];
  fx.chunk(35, 10, 0, 1, 1, 1, 0, 0, 0, '#555555'); fx.explosion(0, 0, 100, 150, false);
  fx.update(.5, .5); const vx = fx.debris[0].vx; assert.ok(vx > 0); fx.update(.02, .52); assert.equal(fx.debris[0].vx, vx); city.dispose();
});
test('cars ignite neighbouring cars through delayed secondary explosions, exactly once each', () => {
  const { city, fx } = fixture(); city.buildings = []; city.pedestrians = []; city.traffic = city.traffic.slice(0, 2);
  Object.assign(city.traffic[0], { x: 0, z: 0 }); Object.assign(city.traffic[1], { x: 12, z: 0, speed: 0 });
  city.hit({ x: 0, z: 0, radius: 4, strength: 150, impulse: true }); assert.equal(city.traffic[0].alive, false); assert.equal(city.traffic[1].alive, true);
  advance(city, fx, 4); assert.ok(city.traffic.every(c => !c.alive)); assert.equal(fx.carExplosions, 2); assert.equal(fx.wrecks.length, 2); assert.equal(fx.secondaryBlasts.length, 0); assert.equal(fx.events.length, 0); city.dispose();
});
test('pedestrians become thrown bodies with blood spray and persistent ground splatters', () => {
  const { city, fx } = fixture(); city.buildings = []; city.traffic = []; city.pedestrians = city.pedestrians.slice(0, 1); Object.assign(city.pedestrians[0], { x: 8, z: 0 });
  const hit = { x: 0, z: 0, radius: 40, strength: 200, impulse: true }; city.hit(hit); city.hit(hit);
  assert.equal(fx.deaths, 1); assert.equal(fx.bodies.length, 1); assert.ok(fx.blood.items.length > 0); assert.ok(fx.splats.mesh.count > 0);
  advance(city, fx, 5); assert.ok(fx.bodies[0].x > 8); assert.ok(fx.bodies[0].landed); assert.ok(fx.splats.mesh.count > 6);
  fx.reset(); assert.equal(fx.bodies.length, 0); assert.equal(fx.splats.mesh.count, 0); assert.equal(fx.limbs.mesh.count, 0); assert.equal(fx.blood.items.length, 0); city.dispose();
});
test('blood can be hidden without disabling deaths or blast physics', () => {
  const { city, fx } = fixture(); city.buildings = []; city.traffic = []; city.pedestrians = city.pedestrians.slice(0, 1); const p = city.pedestrians[0]; fx.setBloodEnabled(false);
  city.hit({ x: p.x - 4, z: p.z, radius: 30, strength: 200, impulse: true }); assert.equal(fx.deaths, 1); assert.equal(fx.blood.items.length, 0); assert.equal(fx.splats.mesh.count, 0); assert.equal(fx.blood.mesh.visible, false); assert.ok(fx.bodies[0].vx > 0); city.dispose();
});
test('pause freezes shockwave travel and pending vehicle chain reactions', () => {
  const { city, fx } = fixture(); fx.explosion(0, 0, 100, 250); fx.secondaryBlasts.push({ x: 20, z: 20, delay: .2 });
  const matrix = city.facade.mesh.instanceMatrix.array.slice(); for (let i = 0; i < 10; i++) { fx.update(0, 0); city.update(0, 0); }
  assert.equal(city.damage, 0); assert.equal(fx.events[0].age, 0); assert.equal(fx.secondaryBlasts[0].delay, .2); assert.deepEqual(city.facade.mesh.instanceMatrix.array, matrix); city.dispose();
});
