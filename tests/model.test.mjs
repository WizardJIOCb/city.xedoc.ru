import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout, seededRandom, blastDamage, isLand, damageState, CELL } from '../src/model.js';

test('a saved seed regenerates exactly the same city', () => { assert.deepEqual(generateLayout('NEW-HAVEN'), generateLayout('NEW-HAVEN')); });
test('different seeds change the skyline and parks', () => { assert.notDeepEqual(generateLayout('ONE').buildings, generateLayout('TWO').buildings); });
test('all three supported map sizes stay within budgets and have valid lots', () => {
  for (const size of [14, 18, 24]) for (const style of ['bay', 'islands']) {
    const map = generateLayout('QA-SEED', size, style);
    assert.ok(map.buildings.length > 300 && map.buildings.length <= 2304);
    for (const b of map.buildings) { assert.ok(Number.isFinite(b.height) && b.height > 0); assert.ok(b.width < CELL / 2 && b.depth < CELL / 2); assert.ok(Math.abs(b.x) < size * CELL / 2); assert.ok(Math.abs(b.z) < size * CELL / 2); }
    for (const block of map.blocks) assert.ok(isLand(block.x, block.z, size, style));
  }
});
test('islands contain a navigable water channel separating districts', () => { const map = generateLayout('ISLAND', 18, 'islands'); assert.ok(map.blocks.some(b => b.x < -100)); assert.ok(map.blocks.some(b => b.x > 100)); assert.ok(!map.blocks.some(b => Math.abs(b.x + Math.sin(b.z / 140) * 45) <= 64)); });
test('explosions respect radius, attenuate with distance, and stronger buildings resist', () => { assert.equal(blastDamage(100, 100, 200), 0); assert.equal(blastDamage(150, 100, 200), 0); assert.equal(blastDamage(0, 0, 200), 0); assert.ok(blastDamage(10, 100, 200) > blastDamage(80, 100, 200)); assert.ok(blastDamage(20, 100, 200, 2) < blastDamage(20, 100, 200, 1)); });
test('damage thresholds distinguish intact, damaged and collapsed structures', () => { assert.equal(damageState(100), 'intact'); assert.equal(damageState(64), 'damaged'); assert.equal(damageState(0), 'destroyed'); assert.equal(damageState(-1), 'destroyed'); });
test('random seeds always produce finite random values in [0,1)', () => { const rng = seededRandom('🌍 Город'); for (let i = 0; i < 10000; i++) { const n = rng(); assert.ok(n >= 0 && n < 1); } });
