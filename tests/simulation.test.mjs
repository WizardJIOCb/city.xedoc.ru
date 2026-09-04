import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { City } from '../src/world.ts';
import { Effects, DISASTERS } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';

function setup() { const scene = new Scene(), city = new City(scene, 'NEW-HAVEN', 14), fx = new Effects(scene, city, new Sound()); return { scene, city, fx }; }
function simulate(city, fx, seconds) { for (let t = .1; t <= seconds; t += .1) { city.update(.1, t); fx.update(.1, t); } }

for (const d of DISASTERS.filter(d => d.category !== 'troops')) test(`${d.id}: applies sustained damage and finishes its lifecycle`, () => {
  const { city, fx } = setup();
  fx.trigger(d.id, 0, 0); simulate(city, fx, 40);
  assert.ok(city.damage > 0, `${d.id} must damage an actual city`);
  assert.ok(city.destroyed > 0, `${d.id} must be able to collapse buildings`);
  assert.ok(city.buildings.every(b => Number.isFinite(b.health) && b.health >= 0 && b.health <= 100));
  assert.ok(city.damage <= city.buildings.length * 100 + .001);
  assert.equal(fx.events.length, 0, 'all delayed sub-events must finish');
  assert.ok(fx.debris.length <= 2200, 'debris pool stays bounded');
  if (d.id === 'flood' || d.id === 'tsunami') { assert.ok(city.traffic.some(c => !c.alive)); assert.ok(city.pedestrians.some(p => !p.alive)); }
  fx.reset(); city.dispose();
});
test('pause freezes flood height, event age, debris and structure collapse', () => {
  const { city, fx } = setup(); fx.trigger('flood', 0, 0); fx.trigger('bomb', 0, 0); simulate(city, fx, 8);
  const water = fx.flood, eventAge = fx.events[0].age, damage = city.damage, matrices = city.facade.mesh.instanceMatrix.array.slice();
  for (let i = 0; i < 20; i++) { city.update(0, 8); fx.update(0, 8); }
  assert.equal(fx.flood, water); assert.equal(fx.events[0].age, eventAge); assert.equal(city.damage, damage); assert.deepEqual(city.facade.mesh.instanceMatrix.array, matrices);
  fx.reset(); city.dispose();
});
test('regeneration clears particles, effects, flood and destroyed objects', () => {
  const { scene, city, fx } = setup(); fx.trigger('nuke', 0, 0); simulate(city, fx, 7); assert.ok(city.destroyed > 0);
  fx.reset(); city.dispose(); const next = new City(scene, 'NEW-HAVEN', 14); fx.attachCity(next);
  assert.equal(fx.events.length, 0); assert.equal(fx.debris.length, 0); assert.equal(fx.fire.items.length, 0); assert.equal(fx.smoke.items.length, 0); assert.equal(fx.flood, 0); assert.equal(next.destroyed, 0); assert.equal(next.damage, 0); assert.ok(next.traffic.every(c => c.alive)); assert.ok(!scene.children.includes(city.group)); next.dispose();
});
test('aircraft in a blast fall and ships in a blast sink', () => {
  const { city, fx } = setup(); const plane = city.planes[0], ship = city.ships[0]; plane.position.set(0, 20, 0); ship.position.set(0, 0, 0); city.hit({ x: 0, z: 0, radius: 100, strength: 200 });
  assert.equal(plane.userData.alive, false); assert.equal(ship.userData.alive, false); simulate(city, fx, 3); assert.equal(plane.visible, false); assert.ok(ship.position.y < 0); fx.reset(); city.dispose();
});
