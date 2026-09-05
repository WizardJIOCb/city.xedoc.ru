import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { Squads } from '../src/squads.ts';
import { SelfDestruct, SELF_DESTRUCT_DURATIONS } from '../src/self-destruct.ts';

function setup(size = 14, style = 'bay', seed = 173) {
  const scene = new T.Scene(), city = new City(scene, 'SELF-DESTRUCT', size, style), fx = new Effects(scene, city, new Sound());
  const squads = new Squads(scene, city, fx);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const mode = new SelfDestruct(city, fx, () => squads.fighters.filter(unit => unit.alive), random);
  let time = 0;
  const step = (dt = .1) => { time += dt; city.update(dt, time); squads.update(dt, time); fx.update(dt, time); mode.update(dt); };
  return { scene, city, fx, squads, mode, step, dispose: () => { fx.reset(); city.dispose(); } };
}

for (const duration of SELF_DESTRUCT_DURATIONS) test(`${duration}s: random disasters destroy the whole city, islands, airport, transport and vegetation`, () => {
  const { city, fx, squads, mode, step, dispose } = setup(duration === 10 ? 24 : 14, duration === 60 ? 'islands' : 'bay');
  const tools = [], trigger = fx.trigger.bind(fx); fx.trigger = (id, ...args) => { tools.push(id); return trigger(id, ...args); };
  let completed = 0; mode.onComplete = () => completed++;
  const location = city.buildings[0]; squads.deploy('heavy', location.x, location.z);
  fx.power = .5; assert.equal(mode.start(duration), true);
  for (let i = 0; i < (duration + 10) * 10 && mode.active; i++) step();
  assert.equal(mode.state, 'complete', `still alive at ${mode.elapsed.toFixed(1)}s: ${mode.remainingTargets}`);
  assert.equal(completed, 1); assert.equal(mode.remainingTargets, 0);
  assert.ok(city.buildings.every(b => b.health === 0)); assert.equal(city.destroyed, city.buildings.length);
  assert.ok(Math.abs(city.percent - 100) < .0001);
  for (const objects of [city.docks, city.airportSections, city.trees, city.props, city.traffic, city.pedestrians, squads.fighters]) assert.ok(objects.every(o => !o.alive));
  for (const object of [...city.planes, ...city.ships]) assert.equal(object.userData.alive, false);
  assert.ok(new Set(tools).size >= 3); assert.ok(tools.every(id => !id.startsWith('squad_')));
  assert.equal(fx.power, .5, 'automatic power must not change the player slider');
  assert.ok(fx.debris.length > 0 && fx.waveCounter > 0, 'destruction must use real effects');
  const strikes = mode.strikes; for (let i = 0; i < 10; i++) mode.update(.1);
  assert.equal(mode.strikes, strikes); assert.equal(completed, 1);
  console.log(`${duration}s scenario completed at ${mode.elapsed.toFixed(1)}s; ${strikes} strikes; ${city.buildings.length} buildings`);
  dispose();
});

test('pause freezes the schedule, cancel stops new strikes, and regeneration clears all scheduling state', () => {
  const { scene, city, fx, mode, step, dispose } = setup();
  assert.equal(mode.start(15), false); assert.equal(mode.start(30), true); step();
  assert.equal(mode.start(10), false, 'running mode must not restart from another click');
  const before = { elapsed: mode.elapsed, strikes: mode.strikes, count: fx.events.length };
  for (let i = 0; i < 100; i++) step(0);
  assert.equal(mode.elapsed, before.elapsed); assert.equal(mode.strikes, before.strikes); assert.equal(fx.events.length, before.count);
  mode.cancel(); for (let i = 0; i < 100; i++) mode.update(.1);
  assert.equal(mode.state, 'idle'); assert.equal(mode.strikes, before.strikes); assert.equal(fx.events.length, before.count);
  dispose(); const next = new City(scene, 'REBUILT', 14); fx.attachCity(next); mode.reset(next);
  assert.equal(mode.elapsed, 0); assert.equal(mode.strikes, 0); assert.equal(mode.active, false);
  mode.update(20); assert.ok(next.buildings.every(b => b.health === 100));
  assert.equal(mode.start(10), true); mode.update(.1); assert.equal(mode.strikes, 1);
  fx.reset(); next.dispose();
});

test('finale completes even when slow disasters occupy all event slots and cannot accept new tools', () => {
  const { city, fx, mode, step, dispose } = setup();
  // Occupy the actual trigger limit without expensive hazard geometry.
  for (let i = 0; i < 28; i++) fx.event('storm', 10000 + i * 1000, 10000, 15, 1);
  const alerts = []; fx.onEvent = (...args) => alerts.push(args);
  assert.equal(mode.start(10), true);
  for (let i = 0; i < 220 && mode.active; i++) step();
  assert.equal(mode.state, 'complete'); assert.equal(city.destroyed, city.buildings.length);
  assert.equal(alerts.length, 0, 'automatic scheduling must not flood the toast with event-limit warnings');
  assert.equal(mode.start(30), false, 'an already empty city must not schedule endless events');
  dispose();
});
