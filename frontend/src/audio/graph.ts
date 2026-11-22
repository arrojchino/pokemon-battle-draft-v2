/**
 * The mixing graph for one audio context (the live one, or an OfflineAudioContext for measurements):
 *
 *   voices -> category input -> fader (volume x trim) -> duck -> profile level -> master -> limiter -> soft clip -> out
 *                                                                         \-> reverb send (post fader) -/
 *
 * Battle effects get a gentle saturation before their fader (it glues the synth voices, independent of the
 * volume), and cries a limiter before theirs, so even two overlapping cries stay under the category ceiling.
 */
import { CATEGORIES, CATEGORY_TRIM, PROFILE_MIX, REVERB_SEND, clamp01, type AudioMix, type Category, type Profile } from './mix.js';
import { softClip } from './analysis.js';

/**
 * The limiter's automatic makeup gain (Web Audio applies 0.6 x the full-range reduction) is cancelled after
 * it, so signals below the threshold pass at unity: threshold -4 dB, ratio 12 -> 0.6 x 3.67 dB = 2.2 dB.
 */
const LIMIT = { threshold: -4, knee: 2, ratio: 12, attack: 0.002, release: 0.15 };
const MAKEUP_DB = 0.6 * (-LIMIT.threshold + LIMIT.threshold / LIMIT.ratio);

export class Graph {
  readonly master: GainNode;
  readonly meter: AnalyserNode;
  /** Where the voices of each category connect. */
  readonly input = {} as Record<Category, AudioNode>;
  private fader = {} as Record<Category, GainNode>;
  private duckG = {} as Record<Category, GainNode>;
  private prof = {} as Record<Category, GainNode>;
  private duckEnd = {} as Record<Category, number>;
  private duckDepth = {} as Record<Category, number>;
  private buffers = new Map<string, AudioBuffer>();

  constructor(readonly ctx: BaseAudioContext, mix: AudioMix, profile: Profile) {
    this.master = ctx.createGain();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = LIMIT.threshold; lim.knee.value = LIMIT.knee; lim.ratio.value = LIMIT.ratio;
    lim.attack.value = LIMIT.attack; lim.release.value = LIMIT.release;
    const unmakeup = ctx.createGain(); unmakeup.gain.value = Math.pow(10, -MAKEUP_DB / 20);
    const clip = ctx.createWaveShaper(); clip.curve = curve(x => softClip(x, 0.985, 0.85));
    this.master.connect(lim).connect(unmakeup).connect(clip).connect(ctx.destination);
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512; clip.connect(this.meter);

    const verb = ctx.createConvolver(); verb.buffer = this.impulse(1.8);
    const verbIn = ctx.createGain(); verbIn.connect(verb).connect(this.master);

    for (const c of CATEGORIES) {
      const f = ctx.createGain(), d = ctx.createGain(), p = ctx.createGain();
      f.connect(d).connect(p).connect(this.master);
      if (REVERB_SEND[c] > 0) { const s = ctx.createGain(); s.gain.value = REVERB_SEND[c]; p.connect(s).connect(verbIn); }
      this.fader[c] = f; this.duckG[c] = d; this.prof[c] = p; this.duckEnd[c] = 0; this.duckDepth[c] = 1;
      this.input[c] = f;
    }
    // Battle: soft saturation at content level.
    const pre = ctx.createGain(); pre.gain.value = 0.9;
    const sat = ctx.createWaveShaper(); sat.curve = curve(x => Math.tanh(x * 1.6) / Math.tanh(1.6)); sat.oversample = '2x';
    pre.connect(sat).connect(this.fader.battle); this.input.battle = pre;
    // Cries: category ceiling (pre fader).
    const cl = ctx.createDynamicsCompressor();
    cl.threshold.value = -5; cl.knee.value = 2; cl.ratio.value = 12; cl.attack.value = 0.002; cl.release.value = 0.12;
    const cu = ctx.createGain(); cu.gain.value = Math.pow(10, -(0.6 * (5 - 5 / 12)) / 20);
    cl.connect(cu).connect(this.fader.cries); this.input.cries = cl;

    this.setMix(mix, 0); this.setProfile(profile, 0);
  }

  /** Apply the player's volumes (tau: smoothing time constant in seconds; 0 sets them at once). */
  setMix(mix: AudioMix, tau = 0.05) {
    this.set(this.master.gain, mix.muted ? 0 : clamp01(mix.master, 0), tau);
    for (const c of CATEGORIES) this.set(this.fader[c].gain, clamp01(mix[c], 0) * CATEGORY_TRIM[c], tau);
  }
  /** Crossfade every category to a profile's levels over `fade` seconds. */
  setProfile(p: Profile, fade = 1.2) {
    for (const c of CATEGORIES) this.set(this.prof[c].gain, PROFILE_MIX[p][c], fade / 3);
  }
  /** Fade the whole output (tab hidden/shown) without touching the saved volumes. */
  fadeOut(on: boolean, mix: AudioMix) { this.set(this.master.gain, on || mix.muted ? 0 : clamp01(mix.master, 0), 0.04); }

  /**
   * Lower a category by `db` for `hold` seconds, then recover. Overlapping requests keep the deepest level
   * and the latest end, so stacked hits never pump the music up and down.
   */
  duck(c: Category, db: number, hold: number, attack = 0.05, release = 0.45) {
    const g = this.duckG[c].gain, now = this.ctx.currentTime;
    const active = now < this.duckEnd[c];
    const depth = Math.min(Math.pow(10, db / 20), active ? this.duckDepth[c] : 1);
    const end = Math.max(now + hold, active ? this.duckEnd[c] : 0);
    g.cancelScheduledValues(now);
    g.setTargetAtTime(depth, now, attack / 3);
    g.setTargetAtTime(1, end, release / 3);
    this.duckEnd[c] = end; this.duckDepth[c] = depth;
  }

  private set(p: AudioParam, v: number, tau: number) {
    if (tau <= 0) { p.cancelScheduledValues(0); p.value = v; return; }
    p.setTargetAtTime(v, this.ctx.currentTime, tau);
  }

  /* ------------------------------------------------------------ shared buffers */
  /** White, pink or brown noise (cached per context). */
  noise(kind: 'white' | 'pink' | 'brown' = 'white', seconds = 2, channels = 1): AudioBuffer {
    const key = `${kind}${seconds}${channels}`;
    let b = this.buffers.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate, n = Math.round(sr * seconds), xf = Math.min(n >> 3, Math.round(sr * 0.05));
      b = this.ctx.createBuffer(channels, n, sr);
      for (let c = 0; c < channels; c++) {
        const tmp = new Float32Array(n + xf);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
        for (let i = 0; i < n + xf; i++) {
          const w = Math.random() * 2 - 1;
          if (kind === 'white') tmp[i] = w;
          else if (kind === 'pink') {
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            tmp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
          } else { br = (br + 0.02 * w) / 1.02; tmp[i] = br * 3.5; }
        }
        // Blend the overshoot into the start so a looping source runs on without a click.
        const d = b.getChannelData(c);
        d.set(tmp.subarray(0, n));
        for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = tmp[i] * a + tmp[n + i] * (1 - a); }
      }
      this.buffers.set(key, b);
    }
    return b;
  }
  /** A smooth random control signal in -1..1 (new target `rate` times a second), for organic modulation. */
  wander(rate: number, seconds = 12): AudioBuffer {
    const key = `wander${rate}${seconds}`;
    let b = this.buffers.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate, n = Math.round(sr * seconds), seg = Math.max(1, Math.round(sr / rate));
      b = this.ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0), pts = Math.ceil(n / seg) + 1, v: number[] = [];
      for (let i = 0; i < pts; i++) v.push(Math.random() * 2 - 1);
      v[pts - 1] = v[0];
      for (let i = 0; i < n; i++) { const k = Math.floor(i / seg), f = (i % seg) / seg, s = f * f * (3 - 2 * f); d[i] = v[k] + (v[Math.min(k + 1, pts - 1)] - v[k]) * s; }
      this.buffers.set(key, b);
    }
    return b;
  }

  /** A darkening stereo room tail: noise with a decaying envelope through a lowpass that closes over time. */
  private impulse(seconds: number) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let y = 0;
      for (let i = 0; i < len; i++) {
        const f = i / len, a = 0.75 - 0.6 * f;
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - f, 2.6) * (i < 400 ? i / 400 : 1) * 1.4;
      }
    }
    return b;
  }
}

/** WaveShaper curve sampled from f over -1..1. */
function curve(f: (x: number) => number): Float32Array<ArrayBuffer> {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = f((i / (n - 1)) * 2 - 1);
  return c;
}
