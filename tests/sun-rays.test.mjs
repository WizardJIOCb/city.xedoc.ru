import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { SunRaysPass, SUN_DIRECTION } from '../src/sun-rays.ts';
import { Sky } from '../src/sky.ts';

test('sun stays at the same sky direction while panning and its visibility switch preserves daylight state', () => {
  const sky = new Sky(), position = new T.Vector3(800, 300, 1000);
  sky.update(position, .38, true); const direction = sky.sunDirection.clone();
  sky.update(position.addScalar(200), .38, false);
  assert.ok(sky.position.equals(position)); assert.ok(sky.sunDirection.equals(direction));
  assert.equal(sky.material.uniforms.uSunVisible.value, 0); assert.equal(sky.material.uniforms.uNight.value, .38);
  sky.update(position, 0, true); assert.equal(sky.material.uniforms.uSunVisible.value, 1);
  sky.geometry.dispose(); sky.material.dispose();
});

test('ray buffers stay bounded at phone, desktop and large display resolutions', () => {
  const pass = new SunRaysPass(new T.Scene(), new T.PerspectiveCamera());
  for (const [quality, limit] of [['high', 768], ['medium', 512], ['low', 320]]) {
    pass.setQuality(quality);
    for (const [w, h] of [[390, 844], [1920, 1080], [7680, 4320]]) {
      pass.setSize(w, h);
      assert.ok(pass.mask.width <= limit && pass.mask.height <= limit);
      assert.ok(Math.abs(pass.mask.width / pass.mask.height - w / h) < .02);
      assert.equal(pass.mask.width, pass.shafts.width);
    }
  }
  pass.dispose();
});

test('silhouette rendering restores scene visibility, materials and renderer state even on failure', () => {
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(43, 1.7, 1, 8500);
  camera.lookAt(SUN_DIRECTION); camera.updateMatrixWorld();
  const sky = new Sky(), solid = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  const effect = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial({ transparent: true }));
  const alreadyHidden = new T.Group(); alreadyHidden.visible = false;
  scene.add(sky, solid, effect, alreadyHidden); scene.background = new T.Color('#abcdee'); const background = scene.background;
  const pass = new SunRaysPass(scene, camera), originalColor = new T.Color('#123456');
  const renderer = { autoClear: false, shadowMap: { autoUpdate: true }, clearColor: originalColor.clone(), alpha: .7,
    getClearColor(c) { return c.copy(this.clearColor); }, getClearAlpha() { return this.alpha; },
    setClearColor(c, a) { this.clearColor.set(c); this.alpha = a; }, setRenderTarget() {}, clear() {},
    render(current) { if (current === scene) { assert.equal(sky.visible, false); assert.equal(effect.visible, false); assert.equal(solid.visible, true); throw new Error('synthetic render failure'); } }
  };
  assert.throws(() => pass.render(renderer, {}, { texture: {} }), /synthetic render failure/);
  assert.equal(scene.background, background); assert.equal(scene.overrideMaterial, null);
  assert.equal(sky.visible, true); assert.equal(effect.visible, true); assert.equal(alreadyHidden.visible, false);
  assert.equal(renderer.autoClear, false); assert.equal(renderer.shadowMap.autoUpdate, true); assert.ok(renderer.clearColor.equals(originalColor)); assert.equal(renderer.alpha, .7);
  pass.dispose(); sky.geometry.dispose(); sky.material.dispose(); solid.geometry.dispose(); solid.material.dispose(); effect.geometry.dispose(); effect.material.dispose();
});
