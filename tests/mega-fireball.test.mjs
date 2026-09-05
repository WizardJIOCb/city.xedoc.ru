import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, MeshNormalMaterial } from 'three';
import { MegaFireball } from '../src/mega-fireball.ts';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';

test('quadruple-power mega blast expands the damaging front and fireball to 440, with bounded debris and a completed lifecycle', () => {
  for (const power of [2, 4]) {
    const scene = new Scene(), city = new City(scene, 'NUKE-POWER', 14), fx = new Effects(scene, city, new Sound());
    city.buildings = []; city.traffic = []; city.pedestrians = []; city.trees = []; city.props = []; city.planes = []; city.ships = [];
    city.addBuilding({ x: 370, z: 0, width: 16, depth: 16, height: 12, hue: .4, roof: 0, centrality: 0 });
    const target = city.buildings.at(-1);
    fx.power = power; fx.trigger('nuke', 0, 0); fx.update(1.5, 1.5);
    const radius = 220 * Math.sqrt(power);
    assert.equal(fx.events.find(e => e.type === 'ring').data.radius, radius);
    assert.equal(fx.events.find(e => e.type === 'fireball').group.children[0].blastRadius, radius);
    for (let t = 1.55; t <= 18; t += .05) { city.update(.05, t); fx.update(.05, t); }
    assert.equal(target.health, power === 4 ? 0 : 100); assert.equal(fx.events.length, 0);
    assert.ok(fx.debris.length <= 2200); assert.ok(fx.debris.every(d => Number.isFinite(d.y)));
    fx.reset(); city.dispose();
  }
});

test('fireball proxy contributes no solid box to the SSAO override pass', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(43, 1, 1, 8500), mesh = new MegaFireball(220);
  scene.add(mesh); mesh.update(2); camera.position.set(800, 650, 1000); camera.lookAt(mesh.position); camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
  const opacity = mesh.material.uniforms.uOpacity.value;
  assert.equal(mesh.material.allowOverride, false, 'normal material must not replace the volume shader');
  scene.overrideMaterial = new MeshNormalMaterial();
  mesh.onBeforeRender(null, scene, camera);
  assert.equal(mesh.material.uniforms.uRenderVolume.value, 0, 'proxy must discard the normals/depth pass');
  scene.overrideMaterial.dispose(); scene.overrideMaterial = null;
  mesh.onBeforeRender(null, scene, camera);
  assert.equal(mesh.material.uniforms.uRenderVolume.value, 1, 'fire must still render in the color pass');
  assert.equal(mesh.material.uniforms.uOpacity.value, opacity, 'render passes must not advance or fade the simulation');
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('mega blast keeps an expanding fire volume after sparks expire, pauses and disposes it', () => {
  const scene = new Scene(), city = new City(scene, 'FIREBALL', 14), fx = new Effects(scene, city, new Sound());
  fx.trigger('nuke', 0, 0);
  fx.update(1.5, 1.5);
  const event = fx.events.find(e => e.type === 'fireball');
  assert.ok(event, 'impact needs a dedicated fire volume, not just small sparks');
  const mesh = event.group.children[0], initialSize = mesh.scale.x;
  fx.update(.5, 2);
  assert.ok(mesh.scale.x > initialSize * 5);
  assert.ok(mesh.material.uniforms.uOpacity.value > .9);
  const age = mesh.material.uniforms.uAge.value, height = mesh.position.y;
  fx.update(0, 2);
  assert.equal(mesh.material.uniforms.uAge.value, age);
  assert.equal(mesh.position.y, height);
  fx.update(3, 5);
  assert.ok(fx.events.includes(event), 'the volume must last beyond the initial spark burst');
  assert.ok(mesh.material.uniforms.uOpacity.value > .9);
  fx.update(3, 8);
  assert.ok(mesh.material.uniforms.uOpacity.value < .9, 'smoke must fade before removal');
  let geometryDisposed = false, materialDisposed = false;
  mesh.geometry.addEventListener('dispose', () => geometryDisposed = true);
  mesh.material.addEventListener('dispose', () => materialDisposed = true);
  fx.update(2, 10);
  assert.ok(!fx.events.includes(event));
  assert.ok(!scene.children.includes(event.group));
  assert.ok(geometryDisposed && materialDisposed);
  fx.reset(); city.dispose();
});
