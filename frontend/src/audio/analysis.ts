/**
 * Level and loudness analysis in plain TypeScript (no Web Audio needed), shared by the cry normalizer
 * (runs once per species when its cry is decoded) and the offline QA renders.
 *
 * Loudness follows ITU-R BS.1770: K-weighting (a +4 dB shelf above ~1.5 kHz and a 38 Hz high-pass), mean
 * square over 400 ms windows (100 ms hop), channels summed, -0.691 dB offset. `lufs` is the loudest
 * 400 ms window (momentary max), the right yardstick for short sounds like cries and hits; `lufsInt` is the
 * gated integrated loudness used for the music beds.
 */
export type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };
export type FilterType = 'lowpass' | 'highpass' | 'highshelf' | 'peaking';

/** Biquad coefficients (RBJ audio EQ cookbook), normalized so a0 = 1. */
export function biquad(type: FilterType, f: number, sr: number, q = Math.SQRT1_2, gainDb = 0): Coeffs {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'peaking') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run a signal through one biquad (transposed direct form II). Returns a new array. */
export function filter(x: Float32Array, c: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * o + z2; z2 = c.b2 * v - c.a2 * o; y[i] = o;
  }
  return y;
}

/** BS.1770 K-weighting (the pyloudnorm parameterisation of the two stages). */
export const kWeight = (x: Float32Array, sr: number) =>
  filter(filter(x, biquad('highshelf', 1500, sr, Math.SQRT1_2, 4)), biquad('highpass', 38, sr, 0.5));

export const toDb = (v: number) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
const round = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

export const mono = (chs: Float32Array[]): Float32Array => {
  if (chs.length === 1) return chs[0];
  const out = new Float32Array(chs[0].length);
  for (const d of chs) for (let i = 0; i < out.length; i++) out[i] += d[i] / chs.length;
  return out;
};

/** Share of a signal's energy above `hz` (24 dB/oct split), 0..1: a simple brightness/harshness gauge. */
export function hfShare(x: Float32Array, sr: number, hz = 4000): number {
  const c = biquad('highpass', hz, sr);
  const hp = filter(filter(x, c), c);
  let a = 0, b = 0;
  for (let i = 0; i < x.length; i++) { a += hp[i] * hp[i]; b += x[i] * x[i]; }
  return b > 0 ? Math.min(1, a / b) : 0;
}

/** Mean square per 400 ms block (100 ms hop) of the K-weighted channels, summed over channels. */
function blocks(chs: Float32Array[], sr: number): number[] {
  const kw = chs.map(d => kWeight(d, sr));
  const n = kw[0].length, win = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const cum = kw.map(d => { const c = new Float64Array(d.length + 1); for (let i = 0; i < d.length; i++) c[i + 1] = c[i] + d[i] * d[i]; return c; });
  const out: number[] = [];
  for (let s = 0; s === 0 || s + win <= n; s += hop) {
    const e = Math.min(n, s + win);
    let ms = 0; for (const c of cum) ms += (c[e] - c[s]) / win;
    out.push(ms);
  }
  return out;
}
const lufsOf = (ms: number) => (ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120);

export type Level = {
  /** Sample peak (linear) and in dBFS. */
  peak: number; peakDb: number;
  /** RMS over the active part only (10 ms blocks within 50 dB of the loudest block), dBFS. */
  rmsDb: number;
  /** Loudest 400 ms window (momentary max) and gated integrated loudness, LUFS. */
  lufs: number; lufsInt: number;
  /** Seconds from the start until the sound finally falls 40 dB below its peak. */
  dur: number;
  /** Share of energy above 4 kHz (harshness gauge). */
  hf: number;
};

/** Peak, active RMS, loudness, audible length and brightness of a (multi-channel) signal. */
export function measure(chs: Float32Array[], sr: number): Level {
  const n = chs[0]?.length ?? 0;
  let peak = 0;
  for (const d of chs) for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  if (!n || peak <= 1e-7) return { peak: 0, peakDb: -120, rmsDb: -120, lufs: -120, lufsInt: -120, dur: 0, hf: 0 };
  let last = 0;
  const floor = peak * 0.01;
  for (const d of chs) for (let i = n - 1; i > last; i--) if (Math.abs(d[i]) > floor) { last = i; break; }
  // Active RMS.
  const bl = Math.max(1, Math.round(0.01 * sr)), bms: number[] = [];
  for (let s = 0; s < n; s += bl) {
    let a = 0; const e = Math.min(n, s + bl);
    for (const d of chs) for (let i = s; i < e; i++) a += d[i] * d[i];
    bms.push(a / ((e - s) * chs.length));
  }
  const top = Math.max(...bms), act = bms.filter(v => v >= top * 1e-5);
  const rms = Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length);
  // Loudness.
  const ms = blocks(chs, sr);
  const lufs = lufsOf(Math.max(...ms));
  const gated = ms.filter(v => lufsOf(v) > -70);
  let lufsInt = -120;
  if (gated.length) {
    const rel = lufsOf(gated.reduce((a, b) => a + b, 0) / gated.length) - 10;
    const g2 = gated.filter(v => lufsOf(v) > rel);
    if (g2.length) lufsInt = lufsOf(g2.reduce((a, b) => a + b, 0) / g2.length);
  }
  return {
    peak: round(peak, 4), peakDb: round(toDb(peak)), rmsDb: round(toDb(rms)), lufs: round(lufs), lufsInt: round(lufsInt),
    dur: round(last / sr, 2), hf: round(hfShare(mono(chs), sr), 3),
  };
}

/**
 * Saturation guard: linear below `knee` x ceiling, then bent with tanh so the output never reaches the
 * ceiling. Continuous with slope 1 at the knee, so moderate peaks pass untouched.
 */
export function softClip(v: number, ceil: number, knee = 0.7): number {
  const k = ceil * knee, a = Math.abs(v);
  if (a <= k) return v;
  const r = ceil - k;
  return Math.sign(v) * (k + r * Math.tanh((a - k) / r));
}

/** Cry treatment constants (internal level, before the cries volume and the master). */
export const CRY = {
  /** Loudest 400 ms window after processing, LUFS. */
  target: -16,
  /** No sample above this after processing (-3.1 dBFS). */
  ceiling: 0.7,
  /** Longer cries are cut here with a fade-out of `fadeSec`. */
  maxSec: 2.0, fadeSec: 0.35,
  highpass: 90, lowpass: 7000,
  /** Bright cries get a high shelf at shelfHz, cut until at most `hfTarget` of the energy sits above 3.5 kHz. */
  shelfHz: 3000, hfTarget: 0.12, maxCutDb: 9,
  /** Quiet cries are raised at most this much (linear). */
  maxBoost: 6,
} as const;

export type CryStats = {
  gain: number; shelfDb: number; hfBefore: number; trimmed: number; capped: boolean;
  before: Level; after: Level;
};

/**
 * Treat one decoded cry (mono samples): trim leading silence so it lands on the animation beat, cap the
 * length with a fade-out, remove rumble, cut harsh highs (a shelf sized from the measured brightness plus a
 * 7 kHz low-pass), normalize the loudest 400 ms to CRY.target, and soft-clip below CRY.ceiling.
 */
export function processCry(input: Float32Array, sr: number): { out: Float32Array; stats: CryStats } {
  const before = measure([input], sr);
  const thr = Math.max(1e-4, before.peak * 0.02);
  let start = 0;
  while (start < input.length - 1 && Math.abs(input[start]) < thr) start++;
  start = Math.max(0, start - Math.round(0.008 * sr));
  const maxN = Math.round(CRY.maxSec * sr);
  let n = input.length - start;
  const capped = n > maxN;
  if (capped) n = maxN;
  let x = filter(input.slice(start, start + n), biquad('highpass', CRY.highpass, sr));
  const hfBefore = hfShare(x, sr, 3500);
  let shelfDb = 0;
  if (hfBefore > CRY.hfTarget) {
    const need = 10 * Math.log10((CRY.hfTarget * (1 - hfBefore)) / (hfBefore * (1 - CRY.hfTarget)));
    shelfDb = Math.max(-CRY.maxCutDb, need);
  }
  if (shelfDb < -0.5) x = filter(x, biquad('highshelf', CRY.shelfHz, sr, 0.7, shelfDb));
  x = filter(x, biquad('lowpass', CRY.lowpass, sr, 0.6));
  const fi = Math.min(n, Math.round(0.004 * sr));
  for (let i = 0; i < fi; i++) x[i] *= i / fi;
  const fo = Math.min(n, Math.round((capped ? CRY.fadeSec : 0.006) * sr));
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  const lvl = measure([x], sr);
  let gain = Math.pow(10, (CRY.target - lvl.lufs) / 20);
  gain = Math.min(gain, CRY.maxBoost, (CRY.ceiling * 1.26) / Math.max(1e-6, lvl.peak));
  for (let i = 0; i < n; i++) x[i] = softClip(x[i] * gain, CRY.ceiling);
  return { out: x, stats: { gain: round(gain, 3), shelfDb: round(shelfDb), hfBefore: round(hfBefore, 3), trimmed: round(start / sr, 3), capped, before, after: measure([x], sr) } };
}
