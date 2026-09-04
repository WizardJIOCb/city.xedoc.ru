import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { City } from '../src/world.ts';
import { Effects, DISASTERS } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { seededRandom } from '../src/model.js';

function setup() {
  const scene = new T.Scene(), city = new City(scene, 'TRANSPORT-HAZARDS', 14), fx = new Effects(scene, city, new Sound());
  city.update(.01, 0); city.buildings = []; city.props = [];
  city.traffic = city.traffic.slice(0, 2); city.pedestrians = []; city.trees = city.trees.slice(0, 2);
  Object.assign(city.traffic[0], { x: 0, z: 0, speed: 0, start: -20000, end: 20000 });
  Object.assign(city.traffic[1], { x: 9999, z: 9999, speed: 0, start: -20000, end: 20000 });
  Object.assign(city.trees[0], { x: 6, z: 0 }); Object.assign(city.trees[1], { x: 9999, z: 9999 });
  return { scene, city, fx };
}
function advance(city, fx, seconds, start = 0) { for (let t = .05; t <= seconds + .0001; t += .05) { city.update(.05, start + t); fx.update(.05, start + t); } }

for (const hazard of DISASTERS.filter(d => d.category !== 'troops')) test(`${hazard.id}: affects cars and trees inside the hazard while leaving distant objects intact`, () => {
  const { city, fx } = setup(); city.planes = []; city.ships = [];
  const random = Math.random; Math.random = seededRandom(`hazard-check:${hazard.id}`);
  try {
    fx.trigger(hazard.id, 0, 0); advance(city, fx, 38);
    assert.equal(city.traffic[0].alive, false, `${hazard.id}: nearby car survived`);
    assert.equal(city.trees[0].alive, false, `${hazard.id}: nearby tree survived`);
    assert.equal(city.traffic[1].alive, true); assert.equal(city.trees[1].alive, true);
    assert.ok(fx.debris.every(d => Number.isFinite(d.y))); assert.equal(fx.events.length, 0);
  } finally { Math.random = random; fx.reset(); city.dispose(); }
});

test('small repeated hits accumulate on cars, trees, aircraft and ships instead of falling below an immunity threshold', () => {
  const { city, fx } = setup(), plane = city.planes[0], ship = city.ships[0];
  plane.position.set(0, 140, 0); ship.position.set(0, -1, 0);
  const hit = { x: 0, z: 0, radius: 50, strength: 12, column: { bottom: -20, top: 220 } };
  city.hit(hit); assert.ok(city.traffic[0].alive); assert.ok(plane.userData.alive); assert.ok(ship.userData.alive);
  assert.ok(city.traffic[0].health < 100); assert.ok(plane.userData.health < 100);
  for (let i = 0; i < 12; i++) city.hit(hit);
  assert.equal(city.traffic[0].alive, false); assert.equal(city.trees[0].alive, false); assert.equal(plane.userData.alive, false); assert.equal(ship.userData.alive, false);
  assert.equal(fx.carExplosions, 1); assert.equal(fx.aircraftDestroyed, 1); assert.equal(fx.shipsDestroyed, 1); fx.reset(); city.dispose();
});

test('a black hole lifts a live car with its cabin, stops its route and absorbs it once', () => {
  const { city, fx } = setup(), car = city.traffic[0]; city.planes = []; city.ships = []; city.trees = [];
  car.x = 30; fx.trigger('blackhole', 0, 0); advance(city, fx, 1);
  assert.equal(fx.carsLifted, 1); assert.equal(fx.carExplosions, 0); assert.equal(fx.wrecks.length, 1);
  const actor = fx.wrecks[0]; assert.ok(actor.y > 12); assert.ok(actor.lifted); assert.notEqual(actor.x, car.x);
  const matrix = new T.Matrix4(); city.cabins.mesh.getMatrixAt(car.extra, matrix); assert.ok(new T.Vector3().setFromMatrixScale(matrix).length() > 1);
  advance(city, fx, 19, 1); assert.ok(actor.removed); assert.equal(fx.carsLifted, 1);
  city.cars.mesh.getMatrixAt(car.id, matrix); assert.equal(matrix.elements[0], 0); city.cabins.mesh.getMatrixAt(car.extra, matrix); assert.equal(matrix.elements[0], 0);
  fx.reset(); assert.equal(fx.carsLifted, 0); city.dispose();
});

test('a moving tornado captures an aircraft on its actual flight path and a ship, then leaves falling wreckage', () => {
  const { city, fx } = setup(), plane = city.planes[0], ship = city.ships[0], x = plane.position.x, z = plane.position.z;
  city.traffic = []; city.trees = []; ship.position.set(x - 35, -1, z);
  fx.trigger('tornado', x, z); fx.update(.05, .05);
  assert.ok(plane.userData.gravityWell); assert.ok(ship.userData.gravityWell);
  const position = plane.position.clone(); city.update(.05, .1); assert.ok(plane.position.equals(position));
  advance(city, fx, 1.5, .1); assert.ok(ship.position.y > 20); assert.notEqual(plane.rotation.z, -.1);
  advance(city, fx, 32, 1.6); assert.equal(plane.userData.alive, false); assert.equal(ship.userData.alive, false);
  assert.ok(fx.aircraftCaptured >= 1); assert.ok(fx.shipsCaptured >= 1); assert.ok(fx.aircraftDestroyed >= 1);
  assert.equal(plane.userData.gravityWell, undefined); assert.equal(ship.userData.gravityWell, undefined);
  assert.ok(fx.debris.every(d => d.removed || d.resting || Number.isFinite(d.vy))); fx.reset(); city.dispose();
});

test('a fully powered black hole captures a car at its center before applying destructive damage', () => {
  const { city, fx } = setup(); city.planes = []; city.ships = []; fx.power = 2;
  fx.trigger('blackhole', 0, 0); const event = fx.events[0]; event.age = 2; event.tick = .4;
  fx.update(.05, 2.05);
  assert.equal(fx.carsLifted, 1); assert.equal(fx.carExplosions, 0); assert.ok(fx.wrecks[0].lifted);
  fx.reset(); city.dispose();
});

test('UFO beams acquire and destroy aircraft, ships, cars and trees within their selected area', () => {
  const { city, fx } = setup(), plane = city.planes[0], ship = city.ships[0];
  plane.position.set(0, 145, 0); ship.position.set(15, -1, 0);
  fx.trigger('ufo', 0, 0);
  // Keep targets stationary to isolate beam targeting and accumulated damage.
  for (let t = .05; t <= 8; t += .05) fx.update(.05, t);
  assert.equal(plane.userData.alive, false); assert.equal(ship.userData.alive, false); assert.equal(city.traffic[0].alive, false); assert.equal(city.trees[0].alive, false);
  assert.equal(city.traffic[1].alive, true); assert.equal(city.trees[1].alive, true);
  const targets = fx.events.find(e => e.type === 'ufo').data.beamTargets; assert.equal(targets.length, 3); assert.ok(targets.every(p => Number.isFinite(p.y)));
  fx.reset(); city.dispose();
});

test('lightning can hit a passing plane along its vertical column', () => {
  const { city, fx } = setup(), plane = city.planes[0]; plane.position.set(0, 180, 0);
  fx.bolt(0, 0, 1); assert.equal(plane.userData.alive, false); assert.equal(fx.aircraftDestroyed, 1); fx.reset(); city.dispose();
});

for (const hazard of ['meteor', 'bomb', 'nuke']) test(`${hazard}: swept projectile contact detects aircraft between frames`, () => {
  const { city, fx } = setup(), plane = city.planes[0]; city.traffic = []; city.trees = [];
  fx.trigger(hazard, 0, 0); const event = fx.events[0], fraction = .8;
  plane.position.set(hazard === 'meteor' ? -230 * (1 - fraction) : 0, 520 * (1 - fraction * fraction), hazard === 'meteor' ? -90 * (1 - fraction) : 0);
  fx.update(event.duration * .9, event.duration * .9); assert.equal(plane.userData.alive, false); assert.equal(fx.aircraftDestroyed, 1); fx.reset(); city.dispose();
});

for (const hazard of ['meteor', 'bomb', 'cluster', 'nuke', 'quake', 'storm', 'volcano']) test(`${hazard}: damages ships in its area without destroying a distant ferry`, () => {
  const { city, fx } = setup(), ship = city.ships[0], far = city.ships[1]; city.traffic = []; city.trees = []; city.planes = [];
  ship.position.set(0, -1, 0); far.position.set(9999, -1, 9999);
  const random = Math.random; Math.random = seededRandom(`ship-check:${hazard}`);
  try {
    fx.trigger(hazard, 0, 0);
    // Fix routes here so that only the hazard's coverage and damage are under test.
    for (let t = .05; t <= 38; t += .05) fx.update(.05, t);
    assert.equal(ship.userData.alive, false); assert.equal(far.userData.alive, true); assert.equal(fx.shipsDestroyed, 1);
  } finally { Math.random = random; fx.reset(); city.dispose(); }
});

test('ground tremors and shallow flooding leave high aircraft intact; a wave reaching a low plane destroys it', () => {
  const { city, fx } = setup(), high = city.planes[0], low = city.planes[1];
  high.position.set(0, 180, 0); low.position.set(0, 25, 0);
  city.hit({ x: 0, z: 0, radius: 300, strength: 500, groundOnly: true });
  assert.ok(high.userData.alive); assert.ok(low.userData.alive);
  city.inundate(() => -2, 1, 80); assert.ok(high.userData.alive); assert.ok(low.userData.alive);
  city.inundate(() => 40, 1, 80, { x: 1, z: 0 });
  assert.ok(high.userData.alive); assert.equal(low.userData.alive, false); assert.equal(fx.aircraftDestroyed, 1);
  fx.reset(); city.dispose();
});
