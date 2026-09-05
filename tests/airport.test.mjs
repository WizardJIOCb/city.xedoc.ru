import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { advanceBody } from '../src/physics.ts';

function setup() {
  const scene = new T.Scene(), city = new City(scene, 'AIRPORT', 14), fx = new Effects(scene, city, new Sound());
  city.buildings = [...city.airportBuildings]; city.traffic = []; city.pedestrians = []; city.trees = []; city.props = []; city.planes = []; city.ships = [];
  return { scene, city, fx };
}
function advance(city, fx, seconds) { for (let t = .05; t <= seconds + .0001; t += .05) { city.update(.05, t); fx.update(.05, t); } }
function hidden(batch, id) { const matrix = new T.Matrix4(); batch.mesh.getMatrixAt(id, matrix); return new T.Vector3().setFromMatrixScale(matrix).length() === 0; }

test('even a half-power bomb tears a local hole in the runway, removes its markings and leaves the far end intact', () => {
  const { city, fx } = setup(), x = city.extent + 76, z = -205;
  const tile = city.airportSections.find(s => city.onDock(s, x, z)), far = city.airportSections.find(s => city.onDock(s, x, 125));
  assert.ok(tile.ids.length > 2, 'the targeted tile owns pavement and a stripe'); assert.equal(city.terrainHeight(x, z), 1.5);
  fx.trigger('bomb', x, z, .5); advance(city, fx, 6);
  assert.equal(tile.alive, false); assert.ok(tile.ids.every(id => hidden(city.solid, id)));
  assert.equal(city.terrainHeight(x, z), null); assert.ok(far.alive); assert.equal(far.health, 100);
  assert.ok(fx.airportSectionsDestroyed > 0 && fx.airportSectionsDestroyed < city.airportSections.length);
  assert.ok(fx.debris.length > 0); assert.ok(fx.waterImpacts > 0);
  const body = { x, y: 2.5, z, vx: 0, vy: 0, vz: 0, spin: 0, resting: true }; let splashes = 0;
  for (let i = 0; i < 120; i++) advanceBody(body, .05, 1, city.collision, fx.waterAt, hit => { if (hit.water) splashes++; });
  assert.equal(splashes, 1); assert.ok(body.y < -3, 'there must be no invisible airport slab holding rubble above water');
  fx.reset(); city.dispose();
});

for (const index of [0, 1]) test(`airport ${index ? 'control tower' : 'terminal'} blocks debris and collapses under a bomb`, () => {
  const { city, fx } = setup(), building = city.airportBuildings[index];
  assert.ok(city.buildings.includes(building));
  const from = { x: building.x - 70, y: 7, z: building.z }, to = { x: building.x + 70, y: 7, z: building.z };
  assert.equal(city.collision.sweep(from, to, .5)?.building, building);
  fx.trigger('bomb', building.x, building.z); advance(city, fx, 6);
  assert.equal(building.health, 0); assert.ok(building.collapsed); assert.ok(city.destroyed >= 1);
  assert.equal(city.collision.sweep(from, to, .5), null, 'the upper building collision must disappear');
  const supported = city.terrainHeight(building.x, building.z) !== null;
  assert.ok(building.parts.slice(supported ? 1 : 0).every(part => hidden(part.batch, part.id)));
  assert.ok(fx.debris.length > 10); fx.reset(); city.dispose();
});

test('airport access bridge breaks into sections and loses collision over the channel', () => {
  const { city, fx } = setup(), bridge = city.airportSections.find(s => s.z === 70 && s.x > city.extent && s.width === 13);
  assert.equal(city.terrainHeight(bridge.x, bridge.z), 3.2);
  city.hit({ x: bridge.x, z: bridge.z, radius: 6, strength: 230, impulse: true });
  assert.equal(bridge.alive, false); assert.equal(city.terrainHeight(bridge.x, bridge.z), null);
  assert.ok(bridge.ids.every(id => hidden(city.solid, id))); fx.reset(); city.dispose();
});

for (const hazard of ['tornado', 'blackhole', 'ufo', 'flood', 'tsunami']) test(`${hazard}: airport structures and pavement receive damage too`, () => {
  const { city, fx } = setup(), terminal = city.airportBuildings[0];
  fx.trigger(hazard, terminal.x, terminal.z); advance(city, fx, 32);
  assert.equal(terminal.health, 0); assert.ok(fx.airportSectionsDestroyed > 0);
  assert.ok(fx.airportSectionsDestroyed < city.airportSections.length, 'a localized hazard must leave distant sections');
  assert.equal(fx.events.length, 0); fx.reset(); city.dispose();
});

test('removing all airport support leaves neither floating ruins nor collision, and regeneration rebuilds it', () => {
  const { scene, city, fx } = setup();
  for (const section of city.airportSections) city.damageDock(section, 200, { x: section.x, z: section.z, radius: 30, strength: 150 });
  advance(city, fx, 4);
  for (const building of city.airportBuildings) {
    assert.ok(building.collapsed); assert.equal(city.terrainHeight(building.x, building.z), null);
    assert.ok(building.parts.every(part => hidden(part.batch, part.id)));
    assert.equal(city.collision.sweep({ x: building.x, y: 8, z: building.z }, { x: building.x, y: -5, z: building.z }, .5), null);
  }
  assert.equal(fx.airportSectionsDestroyed, city.airportSections.length);
  fx.reset(); city.dispose(); const next = new City(scene, 'AIRPORT', 14); fx.attachCity(next);
  assert.equal(fx.airportSectionsDestroyed, 0); assert.ok(next.airportSections.every(s => s.alive && s.health === 100));
  assert.ok(next.airportBuildings.every(b => b.health === 100 && !b.collapsed)); assert.equal(next.terrainHeight(next.extent + 76, -205), 1.5);
  next.dispose();
});
