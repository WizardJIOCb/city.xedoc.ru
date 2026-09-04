export function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const CELL = 62;
export function islandRadius(angle, radius, phase = 0) { return radius * (.92 + Math.sin(angle * 3 + phase) * .055 + Math.cos(angle * 5 - phase) * .025); }
export function isLand(x, z, size, style = 'bay') {
  const e = size * CELL / 2;
  if (Math.abs(x) > e || Math.abs(z) > e) return false;
  if (style === 'islands') return Math.abs(x + Math.sin(z / 140) * 45) > 64 && Math.abs(x / e) ** 5 + Math.abs(z / e) ** 5 < 1.25;
  return Math.abs(x / e) ** 6 + Math.abs(z / e) ** 6 < 1.08 && z < e - 35 + 45 * Math.sin(x / 160);
}
export function generateLayout(seed, size = 18, style = 'bay') {
  const rng = seededRandom(seed), buildings = [], parks = [], blocks = [];
  for (let ix = 0; ix < size; ix++) for (let iz = 0; iz < size; iz++) {
    const x = (ix - size / 2 + 0.5) * CELL, z = (iz - size / 2 + 0.5) * CELL;
    if (!isLand(x, z, size, style)) continue;
    const centrality = Math.max(0, 1 - Math.hypot(x * 0.95, z * 1.15) / (size * CELL * 0.5));
    const park = rng() < .13 || (ix === Math.floor(size / 2) - 2 && iz > size / 2 - 3 && iz < size / 2 + 2);
    blocks.push({ x, z, park });
    if (park) { parks.push({ x, z }); continue; }
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) {
      const width = 16 + rng() * 7, depth = 16 + rng() * 7;
      let height = 9 + rng() * 19 + Math.pow(centrality, 3) * (35 + rng() * 140);
      if (rng() < .08 && centrality > .45) height *= 1.5;
      height = Math.round(height / 3.6) * 3.6;
      buildings.push({ x: x + a * 13.5, z: z + b * 13.5, width, depth, height, hue: rng(), centrality, roof: rng() });
    }
  }
  return { seed, size, style, buildings, parks, blocks };
}
export function blastDamage(distance, radius, strength, resistance = 1) {
  if (distance >= radius || radius <= 0) return 0;
  return Math.max(0, strength * Math.pow(1 - distance / radius, .7) / Math.max(.2, resistance));
}
export function damageState(health) { return health <= 0 ? 'destroyed' : health < 65 ? 'damaged' : 'intact'; }

// Game-scale impulse, not a real-world blast model. The direction always points outward.
export function blastImpulse(x, z, originX, originZ, radius, strength, mass = 1) {
  const dx = x - originX, dz = z - originZ, distance = Math.hypot(dx, dz);
  if (radius <= 0 || distance >= radius || strength <= 0) return { vx: 0, vy: 0, vz: 0 };
  const falloff = Math.pow(1 - distance / radius, .55);
  const speed = Math.min(165, (24 + strength * .28) * falloff / Math.max(.4, mass));
  return { vx: (distance > .001 ? dx / distance : 1) * speed, vy: (10 + speed * .48) * falloff, vz: (distance > .001 ? dz / distance : 0) * speed };
}
