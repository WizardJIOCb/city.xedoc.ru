import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { Squads, UNITS, findRoute } from '../src/squads.ts';

function setup(clear = true) { const scene = new Scene(), city = new City(scene, 'COMBAT', 14), fx = new Effects(scene, city, new Sound()), squads = new Squads(scene, city, fx); const template = city.buildings[0]; if (clear) { city.buildings = []; city.trees = []; city.props = []; city.traffic = []; city.pedestrians = []; } fx.onDeploy = (kind, x, z) => squads.deploy(kind, x, z); return { city, fx, squads, template }; }
function advance(city, fx, squads, seconds) { for (let i = 0; i < seconds * 30; i++) { const dt = 1 / 30; city.update(dt, i * dt); squads.update(dt, i * dt); fx.update(dt, i * dt); } }

test('all three squad types deploy their distinct number of soldiers by parachute', () => {
  const { city, fx, squads } = setup();
  for (const [kind, spec] of Object.entries(UNITS)) { assert.equal(fx.trigger(`squad_${kind}`, 0, 0), true); assert.equal(squads.fighters.filter(u => u.kind === kind).length, spec.count); }
  assert.ok(squads.fighters.every(u => u.dropping && u.y >= 72)); advance(city, fx, squads, 8); assert.ok(squads.fighters.every(u => !u.dropping && u.alive)); assert.equal(squads.shots, 0); city.dispose();
});
test('enemy squads exchange visible projectiles and take casualties; allies never shoot one another', () => {
  const { city, fx, squads } = setup(); squads.deploy('assault', -35, 0, 0); squads.deploy('heavy', 35, 0, 1);
  advance(city, fx, squads, 20); assert.ok(squads.shots > 10); assert.ok(squads.kills > 0); assert.ok(squads.fighters.some(u => u.alive)); assert.ok(fx.splats.mesh.count > 0); city.dispose();
  const allied = setup(); allied.squads.deploy('assault', -35, 0, 0); allied.squads.deploy('scout', 35, 0, 0); advance(allied.city, allied.fx, allied.squads, 16); assert.equal(allied.squads.shots, 0); assert.equal(allied.squads.kills, 0); allied.city.dispose();
});
test('navigation routes around buildings instead of walking through them', () => {
  const { city, template } = setup(); city.buildings = [{ ...template, x: 0, z: 0, width: 28, depth: 35, height: 25, health: 100, parts: [], collapsed: false }];
  const path = findRoute(city, { x: -48, z: 0 }, { x: 48, z: 0 }); assert.ok(path.length > 8); assert.ok(path.some(p => Math.abs(p.z) > 18)); assert.ok(path.every(p => city.collision.walkable(p.x, p.z))); city.dispose();
});
test('walls intercept projectiles before the opposing soldiers', () => {
  const { city, fx, squads, template } = setup(); squads.deploy('assault', 40, 0, 1); const target = squads.fighters[0]; target.x = 40; target.z = 0; target.y = 2.6; target.dropping = false;
  city.buildings = [{ ...template, x: 0, z: 0, width: 12, depth: 100, height: 25, health: 100, parts: [], collapsed: false }];
  squads.tracers.add(0, 0, 0, 1, 1, 1, '#ffffff'); squads.bullets[0] = { id: 0, team: 0, x: -40, y: 2.6, z: 0, vx: 270, vy: 0, vz: 0, life: 1, damage: 1000 };
  for (let i = 0; i < 10; i++) squads.update(.03, i * .03);
  assert.equal(target.hp, 100); assert.equal(target.alive, true); assert.ok(fx.buildingImpacts > 0); assert.equal(squads.bullets[0].life <= 0, true); city.dispose();
});
test('combat squads find opponents around real city blocks', () => {
  const { city, fx, squads } = setup(false); squads.deploy('assault', -70, 0, 0); squads.deploy('scout', 70, 0, 1);
  advance(city, fx, squads, 35); assert.ok(squads.shots > 0, 'navigation should bring the squads into line of sight'); assert.ok(squads.fighters.filter(u => u.alive && !u.dropping).every(u => city.terrainHeight(u.x, u.z) !== null)); city.dispose();
});
test('disasters hit deployed troops and map reset clears troops, parachutes and shots', () => {
  const { city, fx, squads } = setup(); squads.deploy('heavy', 0, 0, 2); city.hit({ x: 0, z: 0, radius: 120, strength: 500, impulse: true }); assert.equal(squads.kills, 4);
  advance(city, fx, squads, 2); squads.reset(city); assert.equal(squads.fighters.length, 0); assert.equal(squads.bullets.length, 0); assert.equal(squads.canopies.mesh.count, 0); assert.equal(squads.tracers.mesh.count, 0); city.dispose();
});
test('squads reject open sea and cap unit count without overflowing instance buffers', () => {
  const { city, squads } = setup(); assert.equal(squads.deploy('assault', 0, -city.extent - 250), false);
  for (let i = 0; i < 16; i++) assert.equal(squads.deploy('assault', 0, 0), true);
  assert.equal(squads.deploy('assault', 0, 0), false); assert.equal(squads.fighters.length, 96); city.dispose();
});
test('pause freezes parachutes, navigation and gunfire', () => {
  const { city, squads } = setup(); squads.deploy('assault', 0, 0, 0); const before = squads.fighters.map(u => u.y); squads.update(0, 100); assert.deepEqual(squads.fighters.map(u => u.y), before); assert.equal(squads.shots, 0); city.dispose();
});
