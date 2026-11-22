// Procedural talking mouth: a syllable stream (vowel, length, loudness) grouped into words and phrases, turned
// into smoothly blended VRM viseme weights. Not lip-sync to audio (the game has no voice lines); it reads as
// natural speech because syllable timing, word gaps and phrase pauses are randomised within human ranges.
import { clamp, damp, rand } from './rig.js';

export type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
export const VISEMES: readonly Viseme[] = ['aa', 'ih', 'ou', 'ee', 'oh'];
// rough vowel frequency in friendly English/Japanese-style chatter
const VOWEL_BAG: readonly Viseme[] = ['aa', 'aa', 'aa', 'ih', 'ih', 'ee', 'ee', 'oh', 'oh', 'ou'];

export class Lipsync {
  /** Current viseme weights (0..1), smoothed. */
  readonly weights: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  /** 0..1 loudness envelope of the current syllable (drives small head beats). */
  energy = 0;
  /** Set for one update when a stressed syllable starts. */
  stressed = false;
  private on = false;
  private t = 0;
  private sylStart = 0;
  private sylLen = 0;
  private sylAmp = 0;
  private vowel: Viseme = 'aa';
  private gapUntil = 0;
  private sylLeftInWord = 0;
  private sylLeftInPhrase = 0;

  constructor(private rate = 1) {}

  setRate(rate: number) { this.rate = rate; }

  start() {
    if (this.on) return;
    this.on = true;
    this.sylLeftInWord = 0;
    this.sylLeftInPhrase = Math.round(rand(6, 14));
    this.gapUntil = this.t + 0.06; // a breath before the first word
    this.sylLen = 0;
  }

  stop() { this.on = false; }

  get active() { return this.on; }

  update(dt: number) {
    this.t += dt;
    this.stressed = false;
    const target: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    let env = 0;
    if (this.on && this.t >= this.gapUntil) {
      if (this.t >= this.sylStart + this.sylLen) this.nextSyllable();
      if (this.t >= this.gapUntil) {
        const u = clamp((this.t - this.sylStart) / this.sylLen, 0, 1);
        // fast open, slower close: the mouth peaks at ~35% of the syllable
        env = u < 0.35 ? Math.sin((u / 0.35) * Math.PI * 0.5) : Math.cos(((u - 0.35) / 0.65) * Math.PI * 0.5) * 0.85 + 0.15 * (1 - u);
        env = clamp(env, 0, 1) * this.sylAmp;
        target[this.vowel] = env;
        // co-articulation: a little of the neighbouring shape keeps the mouth from looking binary
        if (this.vowel === 'aa') target.oh = env * 0.18; else if (this.vowel === 'ee') target.ih = env * 0.25; else if (this.vowel === 'ou') target.oh = env * 0.2;
      }
    }
    const k = damp(this.on ? 28 : 16, dt);
    for (const v of VISEMES) this.weights[v] += (target[v] - this.weights[v]) * k;
    this.energy += (env - this.energy) * damp(20, dt);
  }

  private nextSyllable() {
    if (this.sylLeftInWord <= 0) {
      if (this.sylLen > 0) {
        if (--this.sylLeftInPhrase <= 0) {
          this.sylLeftInPhrase = Math.round(rand(6, 15));
          this.gapUntil = this.t + rand(0.32, 0.65) / this.rate; // phrase pause (breath)
        } else {
          this.gapUntil = this.t + rand(0.05, 0.16) / this.rate; // word gap
        }
      }
      this.sylLeftInWord = Math.round(rand(1, 4));
    }
    this.sylLeftInWord--;
    this.sylStart = Math.max(this.t, this.gapUntil);
    this.sylLen = rand(0.11, 0.2) / this.rate;
    const first = this.sylLeftInWord === 0 ? 0 : 1;
    this.sylAmp = rand(0.45, 0.8) + (first ? 0 : 0.08);
    let v = VOWEL_BAG[Math.floor(Math.random() * VOWEL_BAG.length)];
    if (v === this.vowel && Math.random() < 0.5) v = VOWEL_BAG[Math.floor(Math.random() * VOWEL_BAG.length)];
    this.vowel = v;
    this.stressed = this.sylAmp > 0.74;
  }
}
