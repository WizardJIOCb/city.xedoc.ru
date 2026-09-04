import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { advanceBody, sweepBox } from '../src/physics.ts';

function setup(empty = true, size = 14) {
  const scene = new Scene(), city = new City(scene, 'PHYSICS-COAST', size), fx = new Effects(scene, city, new Sound());
  const template = city.buildings[0];
  if (empty) { city.buildings = []; city.trees = []; city.props = []; city.traffic = []; city.pedestrians = []; }
  return { scene, city, fx, template };
}
const body = (x = 0, y = 20, z = 0) => ({ x, y, z, vx: 0, vy: 0, vz: 0, spin: 1 });
function advance(city, fx, seconds, offset = 0) { for (let t = 0; t < seconds; t += .05) { city.update(.05, t + offset); fx.update(.05, t + offset); } }

test('continuous collision catches a facade even when a fragment crosses the whole building in one frame', () => {
  const contact = sweepBox({ x: -100, y: 5, z: 0 }, { x: 100, y: 5, z: 0 }, { x: -1, y: 0, z: -10 }, { x: 1, y: 20, z: 10 });
  assert.ok(contact); assert.equal(contact.normal.x, -1); assert.ok(Math.abs(contact.t - .495) < .00001);
  assert.equal(sweepBox({ x: -100, y: 25, z: 0 }, { x: 100, y: 25, z: 0 }, { x: -1, y: 0, z: -10 }, { x: 1, y: 20, z: 10 }), null);
});
test('fast rubble bounces off a standing building and damages the facade at contact', () => {
  const { city, fx, template } = setup(); const building = { ...template, x: 0, z: 0, width: 12, depth: 24, height: 30, health: 100, roof: 0, parts: [] }; city.buildings = [building];
  fx.chunk(-80, 8, 0, 2, 2, 2, 1400, 0, 0, '#999999'); fx.update(.1, .1);
  assert.ok(fx.debris[0].x < -6); assert.ok(fx.debris[0].vx < 0); assert.ok(building.health < 100); assert.ok(fx.buildingImpacts > 0); city.dispose();
});
test('rubble drops onto the ground with an impact, settles and does not slide forever', () => {
  const { city } = setup(); const moving = { ...body(), vx: 14 }; let impacts = 0;
  for (let i = 0; i < 300; i++) advanceBody(moving, .05, .8, city.collision, -2, () => impacts++);
  assert.ok(impacts > 0); assert.ok(moving.resting); assert.equal(moving.vx, 0); assert.ok(Math.abs(moving.y - 1.5) < .01); city.dispose();
});
test('the sea has no invisible floor: falling rubble splashes once then sinks below the surface', () => {
  const { city } = setup(); const moving = body(0, 18, -city.extent - 220); let splashes = 0;
  assert.equal(city.terrainHeight(moving.x, moving.z), null);
  for (let i = 0; i < 260; i++) advanceBody(moving, .05, 1, city.collision, -2, h => { if (h.water) splashes++; });
  assert.equal(splashes, 1); assert.ok(moving.removed); assert.ok(moving.y < -36); assert.notEqual(moving.resting, true); city.dispose();
});
test('water impacts create splash particles and expanding surface rings', () => {
  const { city, fx } = setup(); fx.chunk(0, 9, -city.extent - 220, 3, 2, 3, 0, -20, 0, '#777777'); advance(city, fx, 1);
  assert.ok(fx.waterImpacts > 0); assert.ok(fx.sprayWater.items.length > 0); assert.ok(fx.rippleBatch.mesh.count > 0); city.dispose();
});
test('a fragment keeps falling after its old particle lifetime expires', () => {
  const { city, fx } = setup(); fx.chunk(0, 300, 0, 1, 1, 1, 1, 0, 0, '#888888'); fx.debris[0].life = .01;
  fx.update(.1, .1); const y = fx.debris[0].y; fx.update(.2, .3); assert.ok(fx.debris[0].y < y); assert.ok(Number.isFinite(fx.debris[0].vy)); city.dispose();
});
test('tornado fragments fall back down after the funnel finishes, without freezing aloft', () => {
  const { city, fx } = setup(); fx.chunk(20, 15, 0, 2, 2, 2, 0, 0, 0, '#888888'); fx.trigger('tornado', 0, 0);
  advance(city, fx, 65); const fragment = fx.debris[0]; assert.ok(fragment.removed || fragment.resting, `fragment remained at ${fragment.y}`); assert.ok(Number.isFinite(fragment.x)); city.dispose();
});
test('aircraft nose follows its actual velocity on the elliptical flight path', () => {
  const { city } = setup();
  for (const time of [1, 40, 90, 150]) { city.update(.01, time); for (const plane of city.planes) { const nose = new Vector3(0, 0, -1).applyEuler(plane.rotation); const velocity = plane.userData.velocity.clone().normalize(); assert.ok(nose.dot(velocity) > .99); } }
  city.dispose();
});
test('destroying an aircraft removes its intact model and throws separate wreckage', () => {
  const { city, fx } = setup(); city.update(.1, 1); const plane = city.planes[0];
  const hit = { x: plane.position.x, z: plane.position.z, radius: 100, strength: 230, impulse: true };
  city.destroyPlane(plane, hit); city.destroyPlane(plane, hit);
  assert.equal(plane.visible, false); assert.equal(plane.userData.alive, false); assert.equal(fx.aircraftDestroyed, 1); assert.ok(fx.debris.length >= 15);
  const firstY = fx.debris[0].y; advance(city, fx, 4); assert.notEqual(fx.debris[0].y, firstY); city.dispose();
});
test('fire has a soft birth, delayed ignition and a fade out instead of full-opacity popping', () => {
  const { city, fx } = setup(); fx.fire.emit(0, 1, 0, 0, 4, 0, 8, 1, '#ffb142'); fx.fire.update(.01); const first = fx.fire.alphas[0]; fx.fire.update(.12); assert.ok(fx.fire.alphas[0] > first * 3);
  fx.fire.emit(0, 1, 0, 0, 4, 0, 8, 1, '#ffb142', .3); fx.fire.update(.1); assert.equal(fx.fire.alphas[1], 0); fx.fire.update(.8); assert.ok(fx.fire.alphas[0] < .1); city.dispose();
});
test('six island villages contain destructible houses, people, land and moving ferries', () => {
  const { city } = setup(false); assert.equal(city.islands.length, 6); assert.equal(city.ships.filter(s => s.userData.ferry).length, 6);
  for (const island of city.islands) { assert.equal(city.terrainHeight(island.x, island.z), .7); assert.ok(city.buildings.filter(b => Math.hypot(b.x - island.x, b.z - island.z) < island.radius).length >= 18); assert.ok(city.pedestrians.some(p => Math.hypot(p.x - island.x, p.z - island.z) < island.radius)); }
  const ship = city.ships[1]; city.update(.1, 1); const p = ship.position.clone(); city.update(.1, 40); assert.ok(ship.position.distanceTo(p) > 20); city.dispose();
});
test('ferry routes remain over water between islands and the city on the largest map', () => {
  const { city } = setup(false, 24);
  for (const ship of city.ships.filter(s => s.userData.ferry)) { for (let i = 3; i < 197; i++) { const p = ship.userData.route.getPointAt(i / 200); assert.equal(city.terrainHeight(p.x, p.z), null, `ferry crosses land at ${p.x}, ${p.z}`); } }
  city.dispose();
});
test('sound starts disabled', () => assert.equal(new Sound().enabled, false));
