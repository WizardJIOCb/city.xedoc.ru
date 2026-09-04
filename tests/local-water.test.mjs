import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { Ocean } from '../src/ocean.ts';
import { advanceBody } from '../src/physics.ts';
import { SEA_LEVEL, planWave, waveHeight, WAVE_DURATION } from '../src/local-water.ts';

function setup(empty = false) {
  const scene = new T.Scene(), city = new City(scene, 'LOCAL-WATER', 14), fx = new Effects(scene, city, new Sound());
  if (empty) { city.buildings = []; city.traffic = []; city.pedestrians = []; city.trees = []; city.props = []; }
  return { scene, city, fx };
}
function advance(city, fx, seconds, start = 0) {
  for (let t = .05; t <= seconds + .0001; t += .05) { city.update(.05, start + t); fx.update(.05, start + t); }
}
function house(city, x, z) {
  city.addBuilding({ x, z, width: 12, depth: 12, height: 14, hue: .4, centrality: 0, roof: .2 }); return city.buildings.at(-1);
}

test('black hole takes aircraft and ferries off their routes, shreds them once and pulls their debris', () => {
  const { city, fx } = setup(true), plane = city.planes[0], ship = city.ships[1], far = city.ships[4];
  city.update(.01, 0);
  plane.position.set(75, 110, 0); ship.position.set(-75, -1, 0);
  fx.trigger('blackhole', 0, 0); fx.events[0].age = 2; fx.update(.05, 2.05);
  assert.ok(plane.userData.gravityWell); assert.ok(ship.userData.gravityWell);
  const airPosition = plane.position.clone(), seaPosition = ship.position.clone();
  city.update(.05, 2.1); assert.ok(plane.position.equals(airPosition)); assert.ok(ship.position.equals(seaPosition));
  advance(city, fx, 6, 2.1);
  assert.equal(plane.userData.alive, false); assert.equal(ship.userData.alive, false);
  assert.equal(plane.visible, false); assert.equal(ship.visible, false); assert.equal(far.userData.alive, true);
  assert.equal(fx.aircraftDestroyed, 1); assert.equal(fx.shipsDestroyed, 1);
  assert.ok(fx.debris.length > 20); assert.ok(fx.debris.some(d => d.removed));
  assert.ok(fx.debris.every(d => Number.isFinite(d.y))); fx.reset(); city.dispose();
});

test('destroyed harbor sections lose their deck and collision support, while distant docks survive', () => {
  const { city, fx } = setup(true), dock = city.docks[4], far = city.docks.at(-1);
  const oldHeight = city.terrainHeight(dock.x, dock.z); assert.ok(oldHeight > 0);
  city.hit({ x: dock.x, z: dock.z, radius: 25, strength: 500, impulse: true });
  assert.equal(dock.alive, false); assert.equal(city.terrainHeight(dock.x, dock.z), null);
  const matrix = new T.Matrix4(); city.solid.mesh.getMatrixAt(dock.ids[0], matrix); assert.equal(matrix.elements[0], 0);
  assert.equal(far.alive, true); assert.ok(fx.docksDestroyed > 0); assert.ok(fx.debris.length > 0);
  const body = { x: dock.x, y: oldHeight + 1, z: dock.z, vx: 0, vy: 0, vz: 0, spin: 0, resting: true }; let splashes = 0;
  for (let i = 0; i < 100; i++) advanceBody(body, .05, 1, city.collision, fx.waterAt, hit => { if (hit.water) splashes++; });
  assert.equal(splashes, 1); assert.ok(body.y < SEA_LEVEL); fx.reset(); city.dispose();
});

test('black hole also tears apart an island pier through accumulated damage', () => {
  const { city, fx } = setup(true), dock = city.docks.at(-4), far = city.docks[4];
  fx.trigger('blackhole', dock.x, dock.z); advance(city, fx, 12);
  assert.equal(dock.alive, false); assert.equal(far.alive, true); assert.ok(fx.docksDestroyed >= 1); fx.reset(); city.dispose();
});

test('flood lowers only its selected neighborhood and leaves the ocean, distant houses and islands unchanged', () => {
  const { scene, city, fx } = setup(true), near = house(city, 32, 32), far = house(city, -320, -320);
  const island = city.islands[0], ocean = new Ocean(scene, new T.PerspectiveCamera()), matrix = new T.Matrix4();
  city.facade.mesh.getMatrixAt(near.parts[0].id, matrix); const initialY = matrix.elements[13];
  fx.trigger('flood', 32, 32); advance(city, fx, 7);
  assert.ok(city.terrainHeight(32, 32) < -10); assert.equal(city.terrainHeight(-320, -320), .7);
  assert.equal(city.terrainHeight(island.x, island.z), .7); assert.equal(far.health, 100);
  city.facade.mesh.getMatrixAt(near.parts[0].id, matrix); assert.ok(matrix.elements[13] < initialY - 5);
  ocean.update(7, 0, city); assert.equal(ocean.mesh.position.y, SEA_LEVEL); assert.equal(fx.waterAt(-320, -320), SEA_LEVEL);
  advance(city, fx, 25, 7); assert.equal(fx.events.length, 0); assert.ok(city.terrainHeight(32, 32) < -15); assert.equal(far.health, 100);
  fx.reset(); assert.equal(city.basins.length, 0); assert.equal(city.terrainHeight(32, 32), .7); city.dispose();
});

test('overlapping flood basins remain bounded and collision follows the lowered buildings', () => {
  const { city, fx } = setup(true), building = house(city, 32, 32);
  city.basins.push({ x: 32, z: 32, radius: 190, depth: 12 }, { x: 50, z: 32, radius: 190, depth: 9 }); city.refreshGround();
  assert.equal(city.groundOffset(32, 32), -12);
  const hit = city.collision.sweep({ x: -20, y: -4, z: 32 }, { x: 70, y: -4, z: 32 }, .5);
  assert.equal(hit?.building, building);
  assert.equal(city.collision.sweep({ x: -20, y: 12, z: 32 }, { x: 70, y: 12, z: 32 }, .5), null);
  fx.reset(); city.dispose();
});

test('resting rubble wakes and splashes when its local ground subsides', () => {
  const { city, fx } = setup(true), body = { x: 32, y: 1.7, z: 32, vx: 0, vy: 0, vz: 0, spin: 0, resting: true }; let splashes = 0;
  city.basins.push({ x: 32, z: 32, radius: 150, depth: 12 }); city.refreshGround();
  for (let i = 0; i < 80; i++) advanceBody(body, .05, 1, city.collision, fx.waterAt, hit => { if (hit.water) splashes++; });
  assert.ok(body.y < SEA_LEVEL); assert.equal(splashes, 1); fx.reset(); city.dispose();
});

test('tsunami is centered on the click and has zero height outside its preview circle at every stage', () => {
  const { city, fx } = setup(true), plan = planWave(city, 123, -86, 2);
  assert.equal(plan.x, 123); assert.equal(plan.z, -86); assert.ok(Math.abs(Math.hypot(plan.dx, plan.dz) - 1) < 1e-9);
  for (let age = 0; age <= WAVE_DURATION; age += .25) for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    assert.equal(waveHeight(plan, age, plan.x + Math.cos(angle) * plan.radius * 1.001, plan.z + Math.sin(angle) * plan.radius * 1.001), 0);
  }
  assert.equal(waveHeight(plan, 0, plan.x, plan.z), 0); assert.equal(waveHeight(plan, WAVE_DURATION, plan.x, plan.z), 0);
  assert.ok(waveHeight(plan, WAVE_DURATION / 2, plan.x, plan.z) > 50); fx.reset(); city.dispose();
});

test('tsunami damages a house only when its front arrives and leaves neighboring districts intact', () => {
  const { city, fx } = setup(true), near = house(city, 0, 0), far = house(city, 350, 0);
  fx.trigger('tsunami', 0, 0); advance(city, fx, 3); assert.equal(near.health, 100); assert.equal(far.health, 100);
  advance(city, fx, 15, 3); assert.equal(near.health, 0); assert.equal(far.health, 100); assert.equal(fx.events.length, 0);
  assert.ok(fx.sprayWater.items.length > 0); assert.equal(fx.waterAt(0, 0), SEA_LEVEL); fx.reset(); city.dispose();
});

test('the tsunami front sinks local ships and breaks dock sections without hitting distant ferries', () => {
  const { city, fx } = setup(true); city.update(.01, 0);
  const ship = city.ships[0], far = city.ships[4], dock = city.addDock(40, 0, 0, 20, 4, 15, '#999999');
  ship.position.set(0, -1, 0); fx.trigger('tsunami', 0, 0);
  advance(city, fx, 3); assert.equal(ship.userData.alive, true); assert.equal(dock.alive, true);
  advance(city, fx, 15, 3);
  assert.equal(ship.userData.alive, false); assert.equal(dock.alive, false); assert.equal(far.userData.alive, true);
  assert.equal(city.planes.filter(p => p.userData.alive).length, 4); assert.ok(fx.shipsDestroyed >= 1); assert.ok(fx.docksDestroyed >= 1);
  fx.reset(); city.dispose();
});

test('a tall passing wave does not erase street-level debris as if it had sunk to the sea floor', () => {
  const { city, fx } = setup(true), body = { x: 32, y: 5, z: 32, vx: 2, vy: 0, vz: 0, spin: 0 };
  advanceBody(body, .1, 1, city.collision, () => 70, () => {});
  assert.equal(body.submerged, true); assert.notEqual(body.removed, true); assert.ok(body.y > 4);
  fx.reset(); city.dispose();
});

test('a local tsunami does not amplify flooding in a distant pre-existing basin', () => {
  const { city, fx } = setup(true), near = house(city, 0, 0), far = house(city, 350, 0);
  city.basins.push({ x: 350, z: 0, radius: 100, depth: 18 }); city.refreshGround();
  const plan = planWave(city, 0, 0, 1);
  city.inundate((x, z) => SEA_LEVEL + waveHeight(plan, 7.5, x, z), 1, 75, { x: plan.dx, z: plan.dz });
  assert.ok(near.health < 100); assert.equal(far.health, 100);
  fx.reset(); city.dispose();
});
