export class Sound {
  ctx: AudioContext | null = null; enabled = true;
  unlock() { if (!this.ctx) this.ctx = new AudioContext(); if (this.ctx.state === 'suspended') void this.ctx.resume(); }
  impact(power = 1) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, length = Math.min(3, .8 + power * .7), buffer = c.createBuffer(1, c.sampleRate * length, c.sampleRate), data = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < data.length; i++) { smooth = (smooth + (Math.random() * 2 - 1) * .2) / 1.2; data[i] = smooth * Math.exp(-i / (c.sampleRate * length * .22)); }
    const src = c.createBufferSource(), low = c.createBiquadFilter(), gain = c.createGain();
    src.buffer = buffer; low.type = 'lowpass'; low.frequency.setValueAtTime(1400, c.currentTime); low.frequency.exponentialRampToValueAtTime(70, c.currentTime + length); gain.gain.value = Math.min(.65, power * .23);
    src.connect(low).connect(gain).connect(c.destination); src.start();
    const osc = c.createOscillator(), g = c.createGain(); osc.frequency.setValueAtTime(85, c.currentTime); osc.frequency.exponentialRampToValueAtTime(22, c.currentTime + .65); g.gain.setValueAtTime(.13 * Math.min(power, 2), c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + 1); osc.connect(g).connect(c.destination); osc.start(); osc.stop(c.currentTime + 1);
  }
  select() { if (!this.enabled || !this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(520, c.currentTime); o.frequency.exponentialRampToValueAtTime(820, c.currentTime + .055); g.gain.setValueAtTime(.025, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .08); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + .09); }
}
