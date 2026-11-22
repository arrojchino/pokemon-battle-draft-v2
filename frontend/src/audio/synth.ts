/**
 * Synth voices and the recipe of every cue, generated live with Web Audio: no effect files to download or
 * license. Design rules: soft attacks on interface sounds, nothing bright above ~5 kHz at any real level,
 * short tails, small random variation on anything that repeats, and musical cues in D major (the plaza key).
 */
import type { Graph } from './graph.js';
import type { Cue } from './mix.js';

export type PlayOpts = { gain?: number; pan?: number; pitch?: number };
export const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const clampPan = (p: number) => Math.max(-1, Math.min(1, p));

export class Synth {
  /** Input the next voices connect to (a category bus, or a music/ambience layer). */
  bus: AudioNode;
  rnd: () => number = Math.random;
  constructor(readonly g: Graph) { this.bus = g.input.ui; }
  private get ctx() { return this.g.ctx; }

  /** Gain envelope (exponential attack and decay) -> optional pan -> current bus. */
  env(t: number, peak: number, attack: number, decay: number, o: PlayOpts = {}): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * (o.gain ?? 1)), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    this.route(g, o.pan);
    return g;
  }
  /** Linear attack, hold, exponential release: pads and swells. */
  envAHR(t: number, peak: number, attack: number, hold: number, release: number, o: PlayOpts = {}): GainNode {
    const g = this.ctx.createGain(), p = Math.max(0.0002, peak * (o.gain ?? 1));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p, t + attack);
    g.gain.setValueAtTime(p, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    this.route(g, o.pan);
    return g;
  }
  private route(n: AudioNode, pan?: number) {
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = clampPan(pan); n.connect(p).connect(this.bus); }
    else n.connect(this.bus);
  }
  private filt(type: BiquadFilterType, hz: number, q = 0.7) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; }

  /** Oscillator with a pitch glide and an optional low-pass. */
  tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, o: PlayOpts = {}, attack = 0.005, lp = 0) {
    const osc = this.ctx.createOscillator(), p = o.pitch ?? 1;
    osc.type = type;
    osc.frequency.setValueAtTime(f0 * p, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * p), t + attack + dur);
    const e = this.env(t, peak, attack, dur, o);
    if (lp) osc.connect(this.filt('lowpass', lp * p)).connect(e); else osc.connect(e);
    osc.start(t); osc.stop(t + attack + dur + 0.05);
  }
  /** Noise burst through a swept filter. */
  noise(t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 1, o: PlayOpts = {}, attack = 0.005, kind: 'white' | 'pink' = 'white') {
    const ctx = this.ctx, p = o.pitch ?? 1;
    const src = ctx.createBufferSource(); src.buffer = this.g.noise(kind); src.loop = true;
    const f = this.filt(type, f0 * p, q);
    f.frequency.setValueAtTime(f0 * p, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * p), t + attack + dur);
    src.connect(f).connect(this.env(t, peak, attack, dur, o));
    src.start(t, this.rnd() * 1.5); src.stop(t + attack + dur + 0.05);
  }
  /** Two-operator FM: a bright attack that mellows as the index decays (bells, coins, shimmer). */
  fm(f: number, ratio: number, index: number, t: number, dur: number, peak: number, o: PlayOpts = {}, attack = 0.002) {
    const ctx = this.ctx, p = o.pitch ?? 1;
    const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain();
    c.frequency.value = f * p; m.frequency.value = f * ratio * p;
    mg.gain.setValueAtTime(f * p * index, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, f * p * index * 0.05), t + attack + dur);
    m.connect(mg).connect(c.frequency);
    c.connect(this.env(t, peak, attack, dur, o));
    c.start(t); m.start(t); c.stop(t + attack + dur + 0.05); m.stop(t + attack + dur + 0.05);
  }
  /** Soft glass bell. */
  bell(f: number, t: number, dur: number, peak: number, o: PlayOpts = {}) { this.fm(f, 3.5, 0.8, t, dur, peak, o, 0.003); }
  /** Mallet (marimba-like): sine body, a quick fourth partial and a soft knock. */
  mallet(f: number, t: number, dur: number, peak: number, o: PlayOpts = {}) {
    this.tone('sine', f, f, t, dur, peak, o, 0.002);
    this.tone('sine', f * 3.98, f * 3.98, t, dur * 0.16, peak * 0.2, o, 0.001);
    this.noise(t, 0.006, peak * 0.3, 'bandpass', Math.min(f * 2, 4000), Math.min(f * 2, 4000), 1.5, o, 0.001);
  }
  /** Electric piano (FM, ratio 1): warm keys for the plaza music. */
  keys(f: number, t: number, dur: number, peak: number, o: PlayOpts = {}) { this.fm(f, 1, 1.3, t, dur, peak, o, 0.004); }
  /** Low sine drop: the body of hits, steps and landings. */
  thud(t: number, f: number, peak: number, dur = 0.25, o: PlayOpts = {}) { this.tone('sine', f * 2.2, f, t, dur, peak, o, 0.002); }

  /** Pad: per note a saw and a triangle detuned apart, through a low-pass opening from cut0 to cut1. */
  pad(freqs: number[], t: number, attack: number, hold: number, release: number, peak: number, o: PlayOpts = {}, cut0 = 900, cut1 = cut0) {
    const ctx = this.ctx, p = o.pitch ?? 1;
    const f = this.filt('lowpass', cut0, 0.5);
    f.frequency.setValueAtTime(cut0, t);
    if (cut1 !== cut0) f.frequency.exponentialRampToValueAtTime(cut1, t + attack);
    f.connect(this.envAHR(t, peak, attack, hold, release, o));
    const end = t + attack + hold + release + 0.05;
    for (const hz of freqs) for (const [type, cents] of [['sawtooth', -7], ['triangle', 7]] as const) {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = hz * p; osc.detune.value = cents;
      osc.connect(f); osc.start(t); osc.stop(end);
    }
  }
  /** Brass-like stab: detuned saws through a low-pass with a bright attack. */
  brass(f: number, t: number, dur: number, peak: number, o: PlayOpts = {}, bright = 2400) {
    const ctx = this.ctx, p = o.pitch ?? 1;
    const flt = this.filt('lowpass', 400, 0.9);
    flt.frequency.setValueAtTime(400, t); flt.frequency.exponentialRampToValueAtTime(bright, t + 0.05); flt.frequency.exponentialRampToValueAtTime(bright * 0.4, t + dur);
    flt.connect(this.envAHR(t, peak, 0.02, dur * 0.6, dur * 0.5, o));
    for (const c of [-6, 6]) { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f * p; osc.detune.value = c; osc.connect(flt); osc.start(t); osc.stop(t + dur * 1.2 + 0.1); }
  }
  /** Filtered saw with a closing filter: plucks and the driving bass. */
  pluck(f: number, t: number, dur: number, peak: number, o: PlayOpts = {}, cut = 900, type: OscillatorType = 'sawtooth') {
    const ctx = this.ctx, osc = ctx.createOscillator(), flt = this.filt('lowpass', cut * 3, 1.1);
    osc.type = type; osc.frequency.value = f * (o.pitch ?? 1);
    flt.frequency.setValueAtTime(cut * 3, t); flt.frequency.exponentialRampToValueAtTime(cut * 0.4, t + dur);
    osc.connect(flt).connect(this.env(t, peak, 0.004, dur, o));
    osc.start(t); osc.stop(t + dur + 0.06);
  }
  /** A pitch with vibrato (status wobble). */
  wobble(f0: number, f1: number, t: number, dur: number, peak: number, o: PlayOpts = {}, rate = 7, depth = 0.05) {
    const ctx = this.ctx, osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    lfo.frequency.value = rate; lg.gain.value = f0 * depth; lfo.connect(lg).connect(osc.frequency);
    osc.connect(this.env(t, peak, 0.03, dur, o));
    osc.start(t); lfo.start(t); osc.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }
  /** Bird chirp: a quick sine glide with a gentle swell. */
  chirp(f0: number, f1: number, t: number, dur: number, peak: number, o: PlayOpts = {}) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.connect(this.env(t, peak, dur * 0.3, dur * 0.7, o));
    osc.start(t); osc.stop(t + dur + 0.05);
  }
}

/**
 * Schedule one cue at time t on the synth's current bus. Returns how long it rings (seconds), used for
 * voice limits and ducking.
 */
export function playCue(s: Synth, cue: Cue, t: number, o: PlayOpts = {}): number {
  const r = (a: number, b: number) => a + s.rnd() * (b - a);
  const v = { ...o, pitch: (o.pitch ?? 1) * r(0.97, 1.03) };
  switch (cue) {
    /* ---------------------------------------------------------------- interface: soft, short, warm */
    case 'hover': s.tone('sine', 1650, 1500, t, 0.03, 0.09, o, 0.002); return 0.05;
    case 'click': s.noise(t, 0.018, 0.25, 'bandpass', 2600, 1800, 1.4, v, 0.001); s.tone('sine', 820, 640, t, 0.045, 0.16, v, 0.002); return 0.08;
    case 'toggle': s.noise(t, 0.012, 0.18, 'bandpass', 3400, 3000, 2, v, 0.001); s.tone('triangle', 1250, 1180, t, 0.03, 0.11, v, 0.001); return 0.06;
    case 'confirm': s.mallet(midi(86), t, 0.32, 0.12, o); s.mallet(midi(93), t + 0.075, 0.42, 0.1, o); s.tone('sine', midi(62), midi(62), t, 0.16, 0.07, o, 0.004); return 0.55;
    case 'back': s.mallet(midi(81), t, 0.18, 0.09, o); s.mallet(midi(74), t + 0.06, 0.26, 0.08, o); return 0.35;
    case 'error': s.tone('triangle', midi(52), midi(51.5), t, 0.12, 0.12, o, 0.004, 900); s.tone('triangle', midi(51), midi(50.5), t + 0.11, 0.16, 0.11, o, 0.004, 900); return 0.32;
    case 'join': [74, 78, 81].forEach((n, i) => s.mallet(midi(n), t + i * 0.08, 0.4, 0.08, o)); s.bell(midi(86), t + 0.24, 0.8, 0.04, o); return 1.05;
    case 'tick': s.tone('sine', 1050, 980, t, 0.025, 0.16, v, 0.001); s.noise(t, 0.008, 0.08, 'bandpass', 1800, 1800, 3, v, 0.001); return 0.04;
    case 'tickUrgent': [0, 0.09].forEach(d => { s.tone('sine', 1400, 1320, t + d, 0.028, 0.12, o, 0.001); s.noise(t + d, 0.008, 0.06, 'bandpass', 2400, 2400, 3, o, 0.001); }); return 0.13;
    case 'notify': s.mallet(midi(79), t, 0.25, 0.09, o); s.mallet(midi(86), t + 0.09, 0.4, 0.09, o); s.bell(midi(86), t + 0.09, 0.6, 0.02, o); return 0.7;
    case 'prompt': s.tone('triangle', midi(81), midi(81), t, 0.09, 0.05, o, 0.008); s.tone('triangle', midi(88), midi(88), t + 0.05, 0.12, 0.045, o, 0.008); return 0.2;
    case 'dialogOpen': s.noise(t, 0.12, 0.05, 'bandpass', 700, 2200, 0.9, o, 0.05, 'pink'); s.mallet(midi(81), t + 0.06, 0.3, 0.06, o); return 0.4;
    case 'dialogMove': s.tone('sine', 1400, 1300, t, 0.018, 0.08, v, 0.001); return 0.03;
    case 'dialogSelect': s.mallet(midi(81), t, 0.2, 0.08, o); s.mallet(midi(86), t + 0.06, 0.32, 0.08, o); return 0.4;
    case 'dialogClose': s.noise(t, 0.11, 0.045, 'bandpass', 2000, 700, 0.9, o, 0.01, 'pink'); s.mallet(midi(74), t + 0.02, 0.18, 0.05, o); return 0.22;
    case 'npcGreet': [81, 86, 90].forEach((n, i) => s.mallet(midi(n), t + i * 0.09, 0.3, i === 2 ? 0.08 : 0.07, o)); s.bell(midi(90), t + 0.18, 0.6, 0.025, o); return 0.85;
    case 'chatSend': s.tone('sine', 520, 1150, t, 0.07, 0.085, o, 0.005); s.noise(t, 0.03, 0.042, 'bandpass', 1500, 2200, 1, o, 0.004, 'pink'); return 0.1;
    case 'chatIn': s.mallet(midi(88), t, 0.22, 0.06, o); s.mallet(midi(83), t + 0.07, 0.3, 0.05, o); return 0.4;
    case 'joinLobby':
      s.pad([62, 66, 69, 74].map(midi), t, 0.25, 0.3, 0.8, 0.03, o, 1200, 2000);
      [74, 78, 81, 86].forEach((n, i) => s.mallet(midi(n), t + i * 0.065, 0.45, 0.07, o)); return 1.4;
    case 'watchStart':
      s.noise(t, 0.12, 0.05, 'bandpass', 400, 2600, 0.8, o, 0.35, 'pink');
      s.bell(midi(81), t + 0.38, 0.8, 0.05, o); s.bell(midi(88), t + 0.46, 0.9, 0.04, o); return 1.4;
    case 'plazaReturn':
      [81, 78, 86].forEach((n, i) => s.mallet(midi(n), t + [0, 0.09, 0.2][i], 0.4, 0.07, o));
      s.pad([62, 66, 69].map(midi), t + 0.1, 0.3, 0.3, 0.8, 0.028, o, 1000, 1600); return 1.5;
    case 'introSwell':
      s.pad([50, 57, 62, 64, 66, 69].map(midi), t, 2.2, 1.0, 2.2, 0.03, o, 300, 2000);
      s.tone('sine', midi(38), midi(38), t, 3.4, 0.09, o, 1.8);
      [81, 86, 88, 90, 93].forEach((n, i) => s.bell(midi(n), t + 1.7 + i * 0.3 + r(0, 0.08), 1.3, 0.028, { ...o, pan: r(-0.45, 0.45) }));
      return 5.6;

    /* ---------------------------------------------------------------- world foley */
    case 'step': {
      const p = o.pitch ?? 1, heavy = Math.min(1.5, Math.max(0.6, 1 / p)), so = { ...o, pitch: p * r(0.9, 1.1) };
      s.noise(t, 0.045 * heavy, 0.11 * heavy, 'lowpass', 1400, 450, 0.6, so, 0.003, 'pink');
      s.thud(t, 70, 0.16 * heavy, 0.07 * heavy, so);
      s.noise(t + 0.008, 0.02, 0.035, 'bandpass', 3000, 2400, 1.4, so, 0.002);
      return 0.15;
    }

    /* ---------------------------------------------------------------- match flow */
    case 'coinFlip': s.fm(2100, 2.76, 2, t, 0.45, 0.07, o); s.noise(t, 0.3, 0.04, 'bandpass', 3000, 2400, 0.8, o, 0.02); return 0.5;
    case 'coinLand': [0, 0.11, 0.19, 0.24].forEach((d, i) => s.fm(2000 - i * 90, 2.76, 1.8, t + d, 0.22 - i * 0.04, 0.1 / (i + 1), o)); s.thud(t, 150, 0.14, 0.12, o); return 0.45;
    case 'tossWin': [74, 78, 81].forEach((n, i) => s.mallet(midi(n), t + i * 0.07, 0.3, 0.08, o)); s.bell(midi(86), t + 0.21, 0.8, 0.06, o); s.mallet(midi(86), t + 0.21, 0.5, 0.09, o); return 1.0;
    case 'tossLose': s.mallet(midi(76), t, 0.3, 0.07, o); s.mallet(midi(72), t + 0.16, 0.5, 0.07, o); s.pad([57, 60, 64].map(midi), t + 0.12, 0.08, 0.2, 0.6, 0.03, o, 800); return 1.0;
    case 'deal': for (let i = 0; i < 6; i++) s.noise(t + i * 0.055, 0.06, 0.11, 'bandpass', r(2000, 2600), 1300, 1.2, o, 0.004, 'pink'); return 0.4;
    case 'pick': s.thud(t, 80, 0.32, 0.22, v); s.noise(t, 0.18, 0.1, 'lowpass', 2200, 300, 1, v, 0.004, 'pink'); return 0.3;

    /* ---------------------------------------------------------------- battle */
    case 'switchIn':
      s.noise(t, 0.035, 0.2, 'bandpass', 1400, 900, 1.2, o, 0.001);
      s.tone('sine', 520, 160, t, 0.08, 0.2, o, 0.002);
      s.noise(t + 0.02, 0.32, 0.12, 'bandpass', 400, 3000, 1.1, o, 0.12, 'pink');
      s.bell(midi(81), t + 0.3, 0.6, 0.045, o); s.bell(midi(88), t + 0.36, 0.7, 0.035, o); return 1.0;
    case 'dash': s.noise(t, 0.24, 0.22, 'bandpass', 500, 2400, 1.3, v, 0.08, 'pink'); return 0.34;
    case 'punch': s.thud(t, 62, 0.75, 0.24, v); s.noise(t, 0.09, 0.3, 'lowpass', 2600, 350, 1, v); s.noise(t, 0.015, 0.12, 'bandpass', 1500, 1500, 1, v, 0.001); return 0.3;
    case 'slash': s.noise(t, 0.14, 0.3, 'bandpass', 4200, 1700, 1.6, v, 0.012); s.fm(1900, 1.41, 0.8, t + 0.01, 0.12, 0.03, v); s.thud(t + 0.03, 105, 0.3, 0.12, v); return 0.25;
    case 'bite': [0, 0.08].forEach(d => { s.noise(t + d, 0.05, 0.28, 'bandpass', 2400, 1300, 1.8, v, 0.002); s.thud(t + d, 130, 0.35, 0.08, v); }); return 0.2;
    case 'fire':
      s.noise(t, 0.6, 0.28, 'lowpass', 700, 2400, 0.7, o, 0.08, 'pink'); s.noise(t, 0.6, 0.12, 'bandpass', 200, 420, 1.6, o, 0.05);
      for (let i = 0; i < 7; i++) s.noise(t + r(0, 0.6), 0.015, 0.06, 'bandpass', r(2200, 3200), 2000, 1.2, o, 0.001);
      return 0.75;
    case 'water':
      s.noise(t, 0.6, 0.26, 'bandpass', 1300, 800, 0.8, o, 0.06, 'pink'); s.noise(t + 0.05, 0.25, 0.1, 'lowpass', 3500, 900, 0.8, o, 0.01);
      for (let i = 0; i < 4; i++) s.tone('sine', r(400, 900), r(1100, 1700), t + r(0.05, 0.55), 0.05, 0.035, o, 0.005);
      return 0.72;
    case 'zap':
      s.noise(t, 0.02, 0.2, 'highpass', 1800, 1800, 0.7, o, 0.001);
      for (let i = 0; i < 5; i++) {
        const d = i * 0.055 + r(0, 0.025);
        s.noise(t + d, 0.035, 0.18, 'bandpass', r(2600, 3600), 1800, 0.9, o, 0.001);
        s.tone('sawtooth', r(70, 110), r(50, 70), t + d, 0.05, 0.09, o, 0.002, 900);
      }
      return 0.36;
    case 'beamCharge': s.tone('sawtooth', 110, 700, t, 0.2, 0.07, o, 0.02, 1400); s.noise(t, 0.05, 0.05, 'bandpass', 600, 2500, 2, o, 0.15, 'pink'); return 0.25;
    case 'beam':
      s.tone('sawtooth', 220, 205, t, 0.62, 0.08, o, 0.02, 1500); s.tone('sawtooth', 223, 208, t, 0.62, 0.08, o, 0.02, 1500);
      s.tone('sine', 110, 104, t, 0.62, 0.12, o, 0.02); s.noise(t, 0.62, 0.06, 'bandpass', 1400, 1400, 2.5, o, 0.02, 'pink'); return 0.7;
    case 'orb': s.tone('sine', 300, 820, t, 0.42, 0.11, o, 0.02); s.fm(300, 0.5, 3, t, 0.42, 0.04, o); return 0.46;
    case 'orbHit': s.thud(t, 78, 0.55, 0.28, v); s.noise(t, 0.22, 0.18, 'lowpass', 3400, 450, 1, v); return 0.32;
    case 'rings': for (let i = 0; i < 3; i++) s.fm(r(320, 460), 1.01, 4, t + i * 0.09, 0.32, 0.06, o); return 0.55;
    case 'wind': s.noise(t, 0.7, 0.22, 'bandpass', 380, 1500, 2.2, o, 0.25, 'pink'); return 0.95;
    case 'leaves': for (let i = 0; i < 10; i++) s.noise(t + r(0, 0.6), 0.045, 0.09, 'bandpass', r(1600, 3400), 1300, 2.5, o, 0.003); return 0.7;
    case 'quake':
      s.tone('sine', 52, 30, t, 0.95, 0.75, o, 0.03); s.noise(t, 0.9, 0.45, 'lowpass', 280, 60, 1, o, 0.03);
      for (let i = 0; i < 5; i++) s.thud(t + r(0.05, 0.55), r(45, 85), 0.3, 0.18, o);
      return 1.0;
    case 'meteor': s.noise(t, 0.4, 0.16, 'bandpass', 2400, 450, 1.4, o, 0.15, 'pink'); s.tone('sine', 140, 60, t + 0.1, 0.4, 0.15, o, 0.2); return 0.6;
    case 'meteorHit': s.thud(t, 48, 0.9, 0.48, v); s.noise(t, 0.45, 0.36, 'lowpass', 2200, 140, 1, v); s.noise(t, 0.06, 0.12, 'bandpass', 1100, 900, 1, v, 0.002); return 0.55;
    case 'coins': for (let i = 0; i < 9; i++) s.fm(r(1700, 2700), 2.76, 1.6, t + r(0, 0.7), 0.13, 0.045, o); return 0.85;
    case 'heal': [0, 4, 7, 12, 16].forEach((n, i) => s.fm(midi(72 + n), 2, 1, t + i * 0.07, 0.45, 0.05, o)); return 0.8;
    case 'shield': s.fm(220, 2, 2.5, t, 0.8, 0.1, o); s.tone('sine', 440, 445, t, 0.8, 0.05, o, 0.05); return 0.85;
    case 'buff': [0, 5, 7, 12].forEach((n, i) => s.fm(midi(67 + n), 2, 1, t + i * 0.05, 0.25, 0.05, o)); s.noise(t, 0.15, 0.04, 'bandpass', 1500, 5000, 0.8, o, 0.12, 'pink'); return 0.45;
    case 'debuff': [12, 7, 5, 0].forEach((n, i) => s.tone('triangle', midi(60 + n), midi(60 + n), t + i * 0.06, 0.14, 0.07, o, 0.004, 1400)); s.noise(t, 0.3, 0.04, 'bandpass', 2500, 600, 1, o, 0.02, 'pink'); return 0.45;
    case 'hazard':
      s.noise(t, 0.3, 0.08, 'bandpass', 800, 2000, 2, o, 0.1, 'pink');
      for (let i = 0; i < 5; i++) { s.thud(t + 0.5 + i * 0.07, r(150, 240), 0.22, 0.08, o); s.noise(t + 0.5 + i * 0.07, 0.035, 0.08, 'bandpass', 2600, 2000, 2.5, o, 0.002); }
      return 0.95;
    case 'status': s.wobble(560, 380, t, 0.38, 0.08, o); s.noise(t, 0.32, 0.04, 'lowpass', 900, 500, 0.7, o, 0.05, 'pink'); return 0.45;
    case 'hit': s.thud(t, 88, 0.55, 0.17, v); s.noise(t, 0.09, 0.22, 'lowpass', 2600, 450, 1, v); s.noise(t, 0.015, 0.08, 'bandpass', 1600, 1600, 1, v, 0.001); return 0.22;
    case 'hitBig': s.thud(t, 50, 0.9, 0.42, v); s.noise(t, 0.3, 0.4, 'lowpass', 3200, 180, 0.9, v); s.noise(t, 0.08, 0.18, 'bandpass', 1000, 600, 1, v, 0.002); return 0.48;
    case 'crit': s.noise(t, 0.045, 0.32, 'bandpass', 2400, 1600, 0.9, o, 0.001); s.fm(1320, 2.76, 1.4, t, 0.25, 0.06, o); s.thud(t, 70, 0.35, 0.15, o); return 0.3;
    case 'super': s.fm(midi(88), 2, 1, t, 0.18, 0.07, o); s.fm(midi(95), 2, 1, t + 0.08, 0.3, 0.07, o); return 0.42;
    case 'resist': s.tone('triangle', 260, 180, t, 0.16, 0.09, o, 0.004, 1200); s.noise(t, 0.06, 0.06, 'lowpass', 900, 600, 0.7, o, 0.002); return 0.2;
    case 'miss': s.noise(t, 0.2, 0.16, 'bandpass', 700, 2600, 1.3, o, 0.06, 'pink'); return 0.28;
    case 'faint':
      s.tone('triangle', 330, 110, t, 0.75, 0.08, o, 0.03, 900);
      s.thud(t + 0.42, 62, 0.4, 0.3, o); s.noise(t + 0.42, 0.4, 0.08, 'lowpass', 900, 250, 0.7, o, 0.03, 'pink'); return 0.9;
    case 'tera':
      [0, 7, 12, 16, 19, 24].forEach((n, i) => s.fm(midi(64 + n), 3.01, 1.6, t + i * 0.05, 0.7, 0.05, o));
      s.noise(t, 0.6, 0.06, 'bandpass', 2000, 5000, 0.8, o, 0.08, 'pink'); s.thud(t, 50, 0.5, 0.45, o); return 1.0;
    case 'stamp': s.thud(t + 0.01, 75, 0.55, 0.18, o); s.noise(t, 0.06, 0.12, 'bandpass', 1800, 1200, 1, o, 0.002); return 0.22;
    case 'ko': s.tone('sine', 92, 38, t, 0.7, 0.85, o, 0.004); s.noise(t, 0.6, 0.32, 'lowpass', 1400, 90, 0.9, o); s.fm(98, 1.4, 1.6, t + 0.02, 1.2, 0.07, o); return 1.25;
    case 'win':
      [67, 72, 76].forEach((n, i) => s.brass(midi(n), t + i * 0.12, 0.1, 0.06, o, 2200));
      [72, 76, 79, 84].forEach(n => s.brass(midi(n), t + 0.38, 1.0, 0.045, o, 2600));
      s.thud(t + 0.38, 65, 0.35, 0.4, o);
      [84, 88, 91].forEach((n, i) => s.bell(midi(n), t + 0.5 + i * 0.09, 0.9, 0.03, { ...o, pan: (i - 1) * 0.4 }));
      return 2.0;
    case 'lose':
      [76, 72, 69].forEach((n, i) => s.mallet(midi(n), t + i * 0.26, 0.55, 0.09, o));
      s.pad([57, 60, 64].map(midi), t + 0.55, 0.35, 0.45, 1.1, 0.035, o, 700, 1000);
      return 2.5;
  }
  return 0;
}
