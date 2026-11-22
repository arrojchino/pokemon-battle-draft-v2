/**
 * Environmental ambience, synthesized: an outdoor square at golden hour with soft wind, a fountain, a faint
 * crowd murmur and occasional distant birds. The beds are looping noise through filters, moved by slow random
 * modulation so the loop never shows; birds and fountain droplets are scheduled at random. Each profile sets
 * the layer mix (battle keeps only wind and a distant crowd).
 */
import type { Graph } from './graph.js';
import type { Profile } from './mix.js';
import { Synth } from './synth.js';

type Bed = 'wind' | 'water' | 'crowd' | 'birds';
const BEDS: readonly Bed[] = ['wind', 'water', 'crowd', 'birds'];
export const SCENE: Record<Profile, Record<Bed, number>> = {
  menu: { wind: 0.8, water: 0.6, crowd: 0, birds: 0.5 },
  plaza: { wind: 0.7, water: 1, crowd: 0.8, birds: 1 },
  battle: { wind: 0.5, water: 0, crowd: 1, birds: 0.15 },
  watch: { wind: 0.5, water: 0, crowd: 1, birds: 0.15 },
};

export class Ambience {
  private out: GainNode;
  private bed = {} as Record<Bed, GainNode>;
  private level: Record<Bed, number> = { wind: 0, water: 0, crowd: 0, birds: 0 };
  private srcs: AudioScheduledSourceNode[] = [];
  private on = false;
  private until = Infinity;
  private nextBird = 0;
  private nextDrop = 0;
  private s: Synth;

  constructor(private g: Graph, rnd: () => number = Math.random) {
    const ctx = g.ctx;
    this.s = new Synth(g); this.s.rnd = rnd;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(g.input.ambience);
    for (const b of BEDS) { const x = ctx.createGain(); x.gain.value = 0; x.connect(this.out); this.bed[b] = x; }
  }

  /** Fade in (or re-mix) the beds for a profile. */
  start(p: Profile, fade = 2.5) {
    const t = this.g.ctx.currentTime;
    if (!this.on) { this.build(t); this.on = true; this.nextBird = t + 2 + this.s.rnd() * 3; this.nextDrop = t; }
    this.until = Infinity;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(1, t, fade / 3);
    this.level = SCENE[p];
    for (const b of BEDS) this.bed[b].gain.setTargetAtTime(SCENE[p][b], t, fade / 3);
  }
  stop(fade = 2) {
    if (!this.on) return;
    const t = this.g.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.until = Math.min(this.until, t + fade * 1.6);
  }

  /** Place birds and droplets up to `until` (audio clock); frees the beds once a fade-out has finished. */
  schedule(until: number) {
    if (!this.on) return;
    const now = this.g.ctx.currentTime, r = this.s.rnd;
    if (now >= this.until) { this.srcs.forEach(x => x.stop()); this.srcs = []; this.on = false; return; }
    if (this.nextBird < now) this.nextBird = now + 0.5;
    while (this.nextBird < until) { if (this.level.birds > 0.01) this.bird(this.nextBird); this.nextBird += 2.5 + r() * 7; }
    if (this.nextDrop < now) this.nextDrop = now;
    while (this.nextDrop < until) { if (this.level.water > 0.01) this.drop(this.nextDrop); this.nextDrop += 0.08 + r() * 0.35; }
  }

  private build(t: number) {
    const ctx = this.g.ctx, g = this.g, r = this.s.rnd;
    const loop = (buf: AudioBuffer, offset = 0) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, offset); this.srcs.push(s); return s; };
    const filt = (type: BiquadFilterType, hz: number, q: number) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    const mod = (rate: number, depth: number, target: AudioParam) => { const d = ctx.createGain(); d.gain.value = depth; loop(g.wander(rate), r() * 10).connect(d).connect(target); };
    // Wind: brown noise, low-passed, with slow gusts that also open the filter a little.
    { const lp = filt('lowpass', 420, 0.5), v = ctx.createGain(); v.gain.value = 0.32;
      loop(g.noise('brown', 6, 2)).connect(lp).connect(v).connect(this.bed.wind);
      mod(0.12, 0.2, v.gain); mod(0.05, 120, lp.frequency); }
    // Fountain: a band of pink noise with a babbling flutter, a little right of centre.
    { const hp = filt('highpass', 500, 0.5), lp = filt('lowpass', 4200, 0.5), v = ctx.createGain(), pan = ctx.createStereoPanner();
      v.gain.value = 0.16; pan.pan.value = 0.25;
      loop(g.noise('pink', 5, 2), 1.3).connect(hp).connect(lp).connect(v).connect(pan).connect(this.bed.water);
      mod(9, 0.05, v.gain); mod(0.3, 0.03, v.gain); }
    // Crowd: pink noise in the voice band with a syllable-rate flutter, far away.
    { const bp = filt('bandpass', 600, 0.8), lp = filt('lowpass', 1500, 0.5), v = ctx.createGain();
      v.gain.value = 0.22;
      loop(g.noise('pink', 7, 2), 3.1).connect(bp).connect(lp).connect(v).connect(this.bed.crowd);
      mod(5, 0.08, v.gain); mod(0.2, 0.06, v.gain); }
  }

  /** One distant bird: a short chirp series, a trill or a two-note whistle. */
  private bird(t: number) {
    const s = this.s, r = (a: number, b: number) => a + s.rnd() * (b - a);
    s.bus = this.bed.birds;
    const o = { pan: r(-0.8, 0.8), gain: r(0.5, 1) }, kind = s.rnd();
    if (kind < 0.45) { const n = 2 + Math.floor(r(0, 3)), f = r(3000, 4200); for (let i = 0; i < n; i++) s.chirp(f, f * r(1.25, 1.45), t + i * r(0.1, 0.14), 0.07, 0.03, o); }
    else if (kind < 0.75) { const n = 6 + Math.floor(r(0, 5)), f = r(3600, 4600); for (let i = 0; i < n; i++) s.chirp(f * (i % 2 ? 1.08 : 1), f * (i % 2 ? 0.98 : 0.92), t + i * 0.07, 0.035, 0.022, o); }
    else { const f = r(2200, 2900); s.chirp(f, f * 0.94, t, 0.22, 0.03, o); s.chirp(f * 0.8, f * 0.78, t + 0.27, 0.28, 0.028, o); }
  }
  /** A fountain droplet: a tiny upward plink near the fountain. */
  private drop(t: number) {
    const s = this.s, f = 1200 + s.rnd() * 2200;
    s.bus = this.bed.water;
    s.tone('sine', f, f * 1.6, t, 0.03, 0.006 + s.rnd() * 0.012, { pan: 0.25 + (s.rnd() - 0.5) * 0.3 }, 0.002);
  }
}
