/**
 * Background music, composed in code (original, nothing downloaded): a warm, unhurried plaza theme in
 * D major (80 BPM, swung) and an energetic battle theme in A minor (138 BPM). Each theme has layers the
 * profiles turn up or down, so menu -> plaza only thickens the same piece while plaza <-> battle crossfades
 * between pieces. A look-ahead scheduler places notes on the audio clock; offline renders schedule the
 * whole span at once.
 */
import type { Graph } from './graph.js';
import type { Profile } from './mix.js';
import { Synth, midi } from './synth.js';

type Layer = 'pad' | 'keys' | 'bass' | 'bells' | 'shaker' | 'drums' | 'arp' | 'stabs';
const LAYERS: readonly Layer[] = ['pad', 'keys', 'bass', 'bells', 'shaker', 'drums', 'arp', 'stabs'];
export type ThemeId = 'plaza' | 'battle';

/** Which piece and layers each profile plays (layer levels 0..1). */
export const ARRANGEMENT: Record<Profile, { theme: ThemeId; layers: Partial<Record<Layer, number>> }> = {
  menu: { theme: 'plaza', layers: { pad: 1, keys: 0.8, bells: 0.55 } },
  plaza: { theme: 'plaza', layers: { pad: 0.85, keys: 1, bass: 1, bells: 1, shaker: 1 } },
  battle: { theme: 'battle', layers: { pad: 1, drums: 1, bass: 1, arp: 1, stabs: 1 } },
  watch: { theme: 'battle', layers: { pad: 1, drums: 0.75, bass: 0.9, arp: 0.6, stabs: 0.9 } },
};

type Bar = { bass: number; chord: number[] };
type Theme = { bpm: number; swing: number; bars: Bar[]; melody?: (rnd: () => number) => Map<number, number>; step: (song: Song, s: Synth, n: number, t: number) => void };

/* ------------------------------------------------------------------ plaza: D major, Dmaj9 Bm9 Gmaj9 A7sus4 | Dmaj9 F#m7 Em9 A7 */
const PLAZA_BARS: Bar[] = [
  { bass: 50, chord: [54, 57, 61, 64] }, { bass: 47, chord: [50, 54, 57, 61] }, { bass: 43, chord: [54, 57, 59, 62] }, { bass: 45, chord: [55, 57, 62, 64] },
  { bass: 50, chord: [54, 57, 61, 64] }, { bass: 42, chord: [54, 57, 61, 64] }, { bass: 40, chord: [55, 59, 62, 66] }, { bass: 45, chord: [55, 57, 61, 64] },
];
/** A pentatonic mallet melody: four bars, repeated with a new cadence that comes home to D. */
function plazaMelody(rnd: () => number) {
  const scale = [69, 71, 74, 76, 78, 81, 83, 86], m = new Map<number, number>();
  let i = 4;
  for (let bar = 0; bar < 4; bar++) {
    const slots = bar % 2 === 0 ? [0, 6, 8, 12] : [2, 8, 14];
    for (const k of slots) {
      if (k !== slots[0] && rnd() < 0.3) continue;
      i = Math.max(0, Math.min(scale.length - 1, i + Math.round((rnd() - 0.5) * 3)));
      m.set(bar * 16 + k, scale[i]);
    }
  }
  for (const [k, n] of [...m]) if (k < 48) m.set(k + 64, n);
  m.set(112, 78); m.set(118, 76); m.set(120, 74);
  return m;
}
function plazaStep(song: Song, s: Synth, n: number, t: number) {
  const bar = PLAZA_BARS[Math.floor(n / 16) % 8], k = n % 16;
  if (k === 0 && song.at('pad', s)) s.pad(bar.chord.map(midi), t, 0.9, 1.5, 1.4, 0.018, {}, 700, 1100);
  if (song.at('keys', s)) {
    const ch = bar.chord.map(m => midi(m + 12));
    if (k === 0) ch.forEach((f, i) => s.keys(f, t + i * 0.014, 1.4, 0.028, { pan: (i - 1.5) * 0.15 }));
    else if (k === 6) ch.slice(2).forEach(f => s.keys(f, t, 0.7, 0.02));
    else if (k === 10) ch.slice(1, 3).forEach(f => s.keys(f, t, 0.6, 0.018));
  }
  if (song.at('bass', s)) {
    if (k === 0) s.tone('triangle', midi(bar.bass), midi(bar.bass), t, 1.3, 0.1, {}, 0.01, 500);
    else if (k === 10) s.tone('triangle', midi(bar.bass + 7), midi(bar.bass + 7), t, 0.5, 0.07, {}, 0.01, 500);
  }
  if (song.at('bells', s)) { const m = song.melody.get(n % 128); if (m) s.mallet(midi(m), t, 0.7, 0.04, { pan: ((m % 7) - 3) * 0.08 }); }
  if (k % 2 === 0 && song.at('shaker', s)) s.noise(t, 0.03, k % 4 === 2 ? 0.016 : 0.009, 'bandpass', 7000, 7000, 1.2, {}, 0.004);
}

/* ------------------------------------------------------------------ battle: A minor, Am F C G | Am F G E */
const BATTLE_BARS: Bar[] = [
  { bass: 45, chord: [57, 60, 64] }, { bass: 41, chord: [57, 60, 65] }, { bass: 48, chord: [55, 60, 64] }, { bass: 43, chord: [55, 59, 62] },
  { bass: 45, chord: [57, 60, 64] }, { bass: 41, chord: [57, 60, 65] }, { bass: 43, chord: [55, 59, 62] }, { bass: 40, chord: [56, 59, 64] },
];
const kick = (s: Synth, t: number) => { s.tone('sine', 150, 48, t, 0.14, 0.45, {}, 0.002); s.noise(t, 0.006, 0.04, 'bandpass', 3000, 3000, 1, {}, 0.001); };
const snare = (s: Synth, t: number, g: number) => { s.noise(t, 0.12, 0.15 * g, 'bandpass', 1800, 1500, 0.8, {}, 0.001); s.tone('triangle', 200, 170, t, 0.07, 0.1 * g, {}, 0.001); };
function battleStep(song: Song, s: Synth, n: number, t: number) {
  const b = Math.floor(n / 16) % 8, bar = BATTLE_BARS[b], k = n % 16;
  if (song.at('drums', s)) {
    if (k === 0 || k === 8 || k === 10 || (k === 14 && b % 4 === 3)) kick(s, t);
    if (k === 4 || k === 12) snare(s, t, 1);
    else if (b === 7 && k >= 13) snare(s, t, 0.45 + (k - 13) * 0.15);
    if (k % 2 === 0) s.noise(t, 0.025, k % 4 === 2 ? 0.03 : 0.018, 'bandpass', 8000, 8000, 1.2, {}, 0.001);
  }
  if (k % 2 === 0 && song.at('bass', s)) s.pluck(midi(bar.bass - 12 + [0, 0, 12, 0, 0, 12, 0, 12][k / 2]), t, 0.16, 0.1, {}, 380);
  if (song.at('arp', s)) {
    const notes = [...bar.chord.map(m => m + 12), bar.chord[0] + 24];
    s.pluck(midi(notes[[0, 1, 2, 3, 2, 1, 2, 3][k % 8]]), t, 0.09, 0.026, { pan: k % 2 ? 0.25 : -0.25 }, 1100, 'square');
  }
  if ((k === 0 || (k === 6 && b % 2 === 1)) && song.at('stabs', s)) bar.chord.forEach(m => s.brass(midi(m), t, 0.22, 0.028, {}, 2000));
  if (k === 0 && song.at('pad', s)) s.pad(bar.chord.map(midi), t, 0.25, 1.3, 0.35, 0.012, {}, 900);
}

const THEMES: Record<ThemeId, Theme> = {
  plaza: { bpm: 80, swing: 0.18, bars: PLAZA_BARS, melody: plazaMelody, step: plazaStep },
  battle: { bpm: 138, swing: 0, bars: BATTLE_BARS, step: battleStep },
};

/** One piece: its own output (for crossfades), a gain per layer and a step clock. */
class Song {
  readonly out: GainNode;
  readonly melody: Map<number, number>;
  private layer = {} as Record<Layer, GainNode>;
  private level = {} as Record<Layer, number>;
  private n = 0;
  private next = 0;
  private on = false;
  private until = Infinity;
  constructor(private g: Graph, private theme: Theme, rnd: () => number) {
    const ctx = g.ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(g.input.music);
    for (const l of LAYERS) { const x = ctx.createGain(); x.gain.value = 0; x.connect(this.out); this.layer[l] = x; this.level[l] = 0; }
    this.melody = theme.melody ? theme.melody(rnd) : new Map();
  }
  /** Point the synth at a layer; false when that layer is silent (its notes are skipped). */
  at(l: Layer, s: Synth) { s.bus = this.layer[l]; return this.level[l] > 0.001; }
  start(t: number, fade: number) {
    if (!this.on) { this.on = true; this.n = 0; this.next = t + 0.06; }
    this.until = Infinity;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(1, t, fade / 3);
  }
  stop(t: number, fade: number) {
    if (!this.on) return;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.until = Math.min(this.until, t + fade * 1.5);
  }
  setLayers(levels: Partial<Record<Layer, number>>, t: number, fade: number) {
    for (const l of LAYERS) { this.level[l] = levels[l] ?? 0; this.layer[l].gain.setTargetAtTime(this.level[l], t, fade / 3); }
  }
  schedule(s: Synth, until: number) {
    if (!this.on) return;
    const sd = 60 / this.theme.bpm / 4, now = this.g.ctx.currentTime;
    if (this.next < now) this.next = now + 0.03;
    while (this.next < until) {
      if (this.next >= this.until) { this.on = false; return; }
      this.theme.step(this, s, this.n, this.next + (this.n % 4 === 2 ? this.theme.swing * sd * 2 : 0));
      this.next += sd; this.n++;
    }
  }
}

export class MusicPlayer {
  private songs = new Map<ThemeId, Song>();
  private s: Synth;
  constructor(private g: Graph, rnd: () => number = Math.random) { this.s = new Synth(g); this.s.rnd = rnd; }
  /** Crossfade to a profile's piece and layers over `fade` seconds. */
  play(p: Profile, fade = 2) {
    const a = ARRANGEMENT[p], t = this.g.ctx.currentTime;
    for (const [id, song] of this.songs) if (id !== a.theme) song.stop(t, fade);
    let song = this.songs.get(a.theme);
    if (!song) { song = new Song(this.g, THEMES[a.theme], this.s.rnd); this.songs.set(a.theme, song); }
    song.setLayers(a.layers, t, fade);
    song.start(t, fade);
  }
  stop(fade = 1.5) { const t = this.g.ctx.currentTime; for (const song of this.songs.values()) song.stop(t, fade); }
  schedule(until: number) { for (const song of this.songs.values()) song.schedule(this.s, until); }
}
