import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';

function setup() {
  const scene = new T.Scene(), city = new City(scene, 'UFO-SWEEP', 14), fx = new Effects(scene, city, new Sound());
  city.buildings = []; city.traffic = []; city.pedestrians = []; city.trees = []; city.props = []; city.ships = [];
  city.planes = city.planes.slice(0, 1); city.planes[0].position.set(-105, 185, 0);
  fx.trigger('ufo', 0, 0); return { city, fx, event: fx.events[0], plane: city.planes[0] };
}

test('UFO endpoint sweeps toward a new target instead of teleporting or damaging the destination before arrival', () => {
  const { city, fx, event, plane } = setup();
  for (let i = 1; i <= 10; i++) fx.update(.05, i * .05);
  const before = event.data.beamPoints[0].clone(); fx.update(.1, .6);
  const point = event.data.beamPoints[0], destination = event.data.beamTargets[0];
  assert.ok(destination.distanceTo(before) > 150);
  assert.ok(point.distanceTo(before) > 1); assert.ok(point.distanceTo(before) < destination.distanceTo(before) * .6);
  assert.ok(point.distanceTo(destination) > 40, 'aiming must retain a visible transition');
  assert.equal(plane.userData.health, undefined, 'the distant target has not been reached yet');
  for (let i = 1; i <= 12; i++) fx.update(.05, .6 + i * .05);
  assert.ok(plane.userData.health < 100, 'the beam must eventually damage its target');
  const previous = point.clone(); plane.position.set(105, 185, 0); event.tick = .55;
  fx.update(1 / 60, 1.3);
  assert.ok(point.distanceTo(previous) < 25, 'retargeting starts from the existing endpoint');
  assert.ok(point.distanceTo(plane.position) > 150);
  fx.reset(); city.dispose();
});

test('UFO damage pulses originate at the rendered beam endpoints, and pause freezes the sweep', () => {
  const { city, fx, event } = setup(), hits = []; city.onHit = hit => hits.push(hit);
  fx.update(.05, .05); event.tick = .55; fx.update(.05, .1);
  assert.equal(hits.length, 3); event.group.updateWorldMatrix(true, true);
  event.group.children.forEach((craft, i) => {
    const beam = craft.children[2], endpoint = beam.localToWorld(new T.Vector3(0, -67.5, 0));
    assert.ok(endpoint.distanceTo(event.data.beamPoints[i]) < 1e-6);
    assert.ok(Math.abs(hits[i].x - endpoint.x) < 1e-6); assert.ok(Math.abs(hits[i].z - endpoint.z) < 1e-6);
  });
  const points = event.data.beamPoints.map(p => p.clone()), matrices = event.group.children.map(craft => craft.children[2].matrix.clone());
  fx.update(0, 90); event.group.updateWorldMatrix(true, true);
  event.group.children.forEach((craft, i) => { assert.ok(event.data.beamPoints[i].equals(points[i])); assert.ok(craft.children[2].matrix.equals(matrices[i])); });
  assert.equal(hits.length, 3); fx.reset(); city.dispose();
});

test('beam sweep reaches the same position at 30 and 60 simulation frames per second', () => {
  const results = [];
  for (const frames of [30, 60]) {
    const { city, fx, event } = setup(); fx.update(.05, .05); event.tick = .55; fx.update(.05, .1);
    for (let i = 1; i <= frames * .3; i++) fx.update(1 / frames, .1 + i / frames);
    results.push(event.data.beamPoints.map(point => point.clone())); fx.reset(); city.dispose();
  }
  results[0].forEach((point, i) => assert.ok(point.distanceTo(results[1][i]) < 1e-6));
});
