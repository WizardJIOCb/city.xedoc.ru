import { DISASTERS, type DisasterId, type Effects } from './effects';
import type { City } from './world';

export const SELF_DESTRUCT_DURATIONS = [10, 30, 60, 120] as const;
type Target = { x: number; z: number; air?: boolean; captured?: boolean; key?: string };
type Site = { key: string; x: number; z: number; aimX: number; aimZ: number; air: boolean; captured: boolean };

/** Directs existing disasters; all damage still goes through their normal physics. */
export class SelfDestruct {
  state: 'idle' | 'running' | 'finishing' | 'complete' = 'idle';
  duration = 30;
  elapsed = 0;
  strikes = 0;
  remainingTargets = 0;
  lastTool = '';
  onComplete = () => {};
  private scanClock = 0;
  private randomClock = 0;
  private finaleClock = 0;
  private bag: DisasterId[] = [];
  private reservations = new Map<string, number>();
  private recent = new Map<string, number>();

  constructor(private city: City, private effects: Effects, private extraTargets: () => Target[] = () => [], private random = Math.random) {}

  get active() { return this.state === 'running' || this.state === 'finishing'; }
  get remaining() { return Math.max(0, this.duration - this.elapsed); }
  get finale() { return this.elapsed >= this.duration * (this.duration === 10 ? .35 : .55); }

  start(duration: number) {
    if (this.active || !SELF_DESTRUCT_DURATIONS.some(value => value === duration)) return false;
    this.reset(this.city); this.duration = duration;
    this.sites();
    if (!this.remainingTargets) { this.state = 'complete'; return false; }
    this.state = 'running'; return true;
  }

  cancel() { if (this.active) this.state = 'idle'; }

  reset(city: City) {
    this.city = city; this.state = 'idle'; this.elapsed = this.strikes = this.remainingTargets = 0;
    this.scanClock = this.randomClock = this.finaleClock = 0; this.lastTool = '';
    this.bag = []; this.reservations.clear(); this.recent.clear();
  }

  private sites() {
    const city = this.city;
    const targets: Target[] = [
      ...city.buildings.filter(b => b.health > 0), ...city.trees.filter(t => t.alive),
      ...city.traffic.filter(c => c.alive), ...city.pedestrians.filter(p => p.alive),
      ...city.props.filter(p => p.alive), ...city.docks.filter(d => d.alive),
      ...city.airportSections.filter(d => d.alive), ...this.extraTargets(),
    ];
    for (const object of [...city.planes, ...city.ships]) if (object.userData.alive) {
      targets.push({ x: object.position.x, z: object.position.z, air: city.planes.includes(object), captured: !!object.userData.gravityWell, key: object.uuid });
    }
    this.remainingTargets = targets.length;
    const sites = new Map<string, Site>();
    targets.forEach((target, index) => {
      // Ground sectors fit inside one blast, including their corners. Aircraft
      // get lightning at their current position instead of chasing old coordinates.
      const col = Math.floor(target.x / 320), row = Math.floor(target.z / 320);
      const key = target.air ? `air:${target.key ?? index}` : `${col}:${row}`;
      if (!sites.has(key)) sites.set(key, { key, x: target.air ? target.x : (col + .5) * 320, z: target.air ? target.z : (row + .5) * 320, aimX: target.x, aimZ: target.z, air: !!target.air, captured: !!target.air && !!target.captured });
    });
    return [...sites.values()];
  }

  private randomStrike(sites: Site[]) {
    const active = this.effects.events.filter(e => !['ring', 'bolt', 'plume', 'fireball'].includes(e.type));
    // Leave room for player input and secondary projectiles from volcanoes/air raids.
    if (active.length >= 8) return;
    const available = DISASTERS.filter(d => !d.id.startsWith('squad_')
      && (d.id !== 'flood' || this.city.basins.length < 32)
      && active.filter(e => e.type === d.id).length < (['volcano', 'cluster', 'tsunami'].includes(d.id) ? 1 : 2));
    if (!this.bag.length) {
      this.bag = DISASTERS.filter(d => !d.id.startsWith('squad_')).map(d => d.id);
      for (let i = this.bag.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
    }
    const index = this.bag.findIndex(id => available.some(d => d.id === id));
    if (index < 0) { this.bag = []; return; }
    const id = this.bag.splice(index, 1)[0];
    const fresh = sites.filter(s => !s.air && (this.recent.get(s.key) ?? 0) <= this.elapsed);
    const choices = fresh.length ? fresh : sites;
    const site = choices[Math.floor(this.random() * choices.length)];
    const power = id === 'nuke' ? 1.5 + this.random() * 2.5 : 1 + this.random();
    if (this.effects.trigger(id, site.aimX, site.aimZ, power, false)) {
      this.strikes++; this.effects.executed++; this.lastTool = DISASTERS.find(d => d.id === id)!.name;
      this.recent.set(site.key, this.elapsed + 6);
    }
  }

  update(dt: number) {
    if (!this.active || dt <= 0) return;
    this.elapsed += dt; this.scanClock -= dt; this.randomClock -= dt; this.finaleClock -= dt;
    if (this.elapsed >= this.duration) this.state = 'finishing';
    if (this.scanClock > 0) return;
    this.scanClock = .1;
    const sites = this.sites();
    if (!sites.length) { this.state = 'complete'; this.onComplete(); return; }
    if (this.randomClock <= 0 && this.elapsed < this.duration * .65) {
      this.randomClock = Math.min(3, Math.max(.65, this.duration / 22)); this.randomStrike(sites);
    }
    if (!this.finale || this.finaleClock > 0) return;
    const pending = sites.filter(s => !s.captured && (this.reservations.get(s.key) ?? 0) <= this.elapsed);
    if (!pending.length) return;
    const site = pending[Math.floor(this.random() * pending.length)];
    // Spread the finale over the remaining time and allow waves time to reach
    // sector edges. Revisit genuine survivors instead of setting the HUD to 100%.
    this.finaleClock = Math.max(.1, Math.min(3, (this.remaining - 2.4) / pending.length));
    this.reservations.set(site.key, this.elapsed + 2.8);
    if (site.air) { this.effects.bolt(site.x, site.z, 2); this.lastTool = 'Гроза'; }
    else { this.effects.explosion(site.x, site.z, 330, 950); this.lastTool = 'Цепная детонация'; }
    this.strikes++; this.effects.executed++;
  }
}
