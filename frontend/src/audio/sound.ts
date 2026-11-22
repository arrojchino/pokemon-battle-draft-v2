/**
 * AudioManager: every sound in the game goes through here.
 *
 * - Categories: each cue answers to one volume (music, environment, Pokémon cries, interface, battle). Each
 *   category has its own fader, ducking stage and profile level into a master bus with a limiter and a soft
 *   clipper, so nothing clips however many sounds pile up (see graph.ts, mix.ts).
 * - Profiles ('menu' | 'plaza' | 'battle' | 'watch') crossfade the music piece and ambience beds and set the
 *   cry policy: quiet and rare in menus, occasional in the plaza, normal in battle.
 * - Synthesized: every effect, the plaza ambience and both music pieces are generated live with Web Audio
 *   (synth.ts, ambience.ts, music.ts); nothing to download or license. Pokémon cries are the one recording,
 *   fetched from the PokéAPI cries repository on first use, then treated once per species (analysis.ts:
 *   loudness-normalized, harsh highs cut, length capped, soft-clipped) and throttled per species and globally.
 * - Throttling: repeats of a cue inside its minimum gap are dropped, quick repeats get softer, and each
 *   category has a voice limit. Big hits and cries duck the music briefly.
 *
 * The context starts on the first user gesture (autoplay rules) and fades out and suspends while the tab is
 * hidden. `?audiotest` exposes the manager (`__sound`) and the analysis helpers (`__audioLab`) for QA renders.
 */
import { pokemonCry } from '../assets.js';
import { CRY, measure, mono, processCry, type CryStats, type Level } from './analysis.js';
import { Ambience } from './ambience.js';
import { Graph } from './graph.js';
import {
  ALL_CUES, AUDIO_DEFAULTS, CRY_DUCK, CRY_POLICY, CUE_CATEGORY, CUE_GAP, DEFAULT_GAP, DUCK, MAX_VOICES, PRIORITY, PROFILES,
  REPEAT_FALLOFF, REPEAT_WINDOW, categoryGain, type AudioMix, type Category, type Cue, type Profile,
} from './mix.js';
import { MusicPlayer } from './music.js';
import { Synth, playCue, type PlayOpts } from './synth.js';

export type { AudioMix, Category, Cue, Profile } from './mix.js';
export type { PlayOpts } from './synth.js';
export type CryOpts = { pan?: number; gain?: number; rate?: number };
type CryEntry = { buf: AudioBuffer; stats: CryStats };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Seeded PRNG so offline renders are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** The profile a category is heard in most, for QA renders. */
const homeProfile = (c: Category): Profile => (c === 'battle' || c === 'cries' ? 'battle' : c === 'ui' ? 'menu' : 'plaza');

class AudioManager {
  private live: AudioContext | null = null;
  private g: Graph | null = null;
  private synth: Synth | null = null;
  private music: MusicPlayer | null = null;
  private amb: Ambience | null = null;
  private mix: AudioMix = { ...AUDIO_DEFAULTS };
  private profile: Profile = 'menu';
  private last = new Map<Cue, number>();
  private rep = new Map<Cue, number>();
  private busy: Record<Category, number[]> = { music: [], ambience: [], cries: [], ui: [], battle: [] };
  private cries = new Map<number, Promise<CryEntry>>();
  private cryAt = -Infinity;
  private cryBy = new Map<number, number>();
  private cryEnds: number[] = [];
  private lastUi = -Infinity;
  private lastPreview = -Infinity;

  /** Create (or resume) the context. Safe to call on every gesture. */
  unlock() {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    if (!this.live) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.live = ctx;
      this.g = new Graph(ctx, this.mix, this.profile);
      this.synth = new Synth(this.g);
      this.music = new MusicPlayer(this.g);
      this.amb = new Ambience(this.g);
      document.addEventListener('visibilitychange', () => this.onVisibility());
      window.setInterval(() => this.pump(), 100);
      this.beds(3);
    }
    if (this.live.state === 'suspended' && !document.hidden) void this.live.resume().then(() => this.pump());
  }

  /** Player volumes (0..1 each) and mute; music and ambience stop entirely while silent. */
  setMix(m: Partial<AudioMix>) {
    const before = this.mix;
    this.mix = { ...this.mix, ...m };
    this.g?.setMix(this.mix);
    const on = (x: AudioMix, c: Category) => categoryGain(x, c, this.profile) > 0;
    if (on(before, 'music') !== on(this.mix, 'music') || on(before, 'ambience') !== on(this.mix, 'ambience')) this.beds(1.5);
  }
  /** Master volume and mute (kept for older callers; setMix covers every category). */
  setVolume(volume: number, muted: boolean) { this.setMix({ master: volume, muted }); }
  getMix(): AudioMix { return { ...this.mix }; }

  /** Switch the soundscape: crossfades music and ambience, sets category levels and the cry policy. */
  setProfile(p: Profile) {
    if (!PROFILES.includes(p) || p === this.profile) return;
    this.profile = p;
    const fight = p === 'battle' || p === 'watch';
    this.g?.setProfile(p, fight ? 1.2 : 2);
    this.beds(fight ? 1.6 : 2.5);
  }
  get currentProfile(): Profile { return this.profile; }

  private beds(fade: number) {
    if (!this.music || !this.amb) return;
    if (categoryGain(this.mix, 'music', this.profile) > 0) this.music.play(this.profile, fade); else this.music.stop(fade);
    if (categoryGain(this.mix, 'ambience', this.profile) > 0) this.amb.start(this.profile, fade); else this.amb.stop(fade);
    this.pump();
  }
  private pump() {
    const ctx = this.live;
    if (!ctx || ctx.state !== 'running') return;
    const until = ctx.currentTime + 0.4;
    this.music?.schedule(until); this.amb?.schedule(until);
  }
  private onVisibility() {
    const ctx = this.live, g = this.g;
    if (!ctx || !g) return;
    if (document.hidden) { g.fadeOut(true, this.mix); window.setTimeout(() => { if (document.hidden) void ctx.suspend(); }, 160); }
    else void ctx.resume().then(() => { g.fadeOut(false, this.mix); this.pump(); });
  }

  /* ------------------------------------------------------------ effects */
  /** Play a cue now. opts.gain scales it (0..1.5), pan places it (-1..1), pitch shifts it (step: <1 big, >1 small). */
  play(cue: Cue, o: PlayOpts = {}) {
    const g = this.g, s = this.synth, cat = CUE_CATEGORY[cue];
    if (!g || !s || !cat || this.live?.state !== 'running' || categoryGain(this.mix, cat, this.profile) <= 0) return;
    const ctx = g.ctx, now = ctx.currentTime, prev = this.last.get(cue) ?? -Infinity;
    if (now - prev < (CUE_GAP[cue] ?? DEFAULT_GAP)) return;
    const busy = (this.busy[cat] = this.busy[cat].filter(e => e > now));
    if (busy.length >= MAX_VOICES[cat] && !PRIORITY.has(cue)) return;
    const rep = now - prev < REPEAT_WINDOW ? Math.min(3, (this.rep.get(cue) ?? 0) + 1) : 0;
    this.rep.set(cue, rep); this.last.set(cue, now);
    // Schedule just past the next audio callback; anything earlier is already in the past when the render
    // thread picks it up and a short envelope would collapse to silence.
    const t = now + Math.max(0.015, (this.live?.baseLatency || 0) + 0.008);
    s.bus = g.input[cat];
    const ring = playCue(s, cue, t, {
      gain: clamp(o.gain ?? 1, 0, 1.5) * Math.pow(REPEAT_FALLOFF, rep),
      pan: o.pan === undefined ? undefined : clamp(o.pan, -1, 1),
      pitch: o.pitch === undefined ? undefined : clamp(o.pitch, 0.5, 2),
    });
    busy.push(t + ring);
    const d = DUCK[cue];
    if (d) g.duck('music', d, ring);
    if (cat === 'ui') this.lastUi = performance.now();
  }
  /** True when an interface cue played in the last `ms` milliseconds (lets generic click sounds step aside). */
  uiPlayedWithin(ms: number) { return performance.now() - this.lastUi < ms; }

  /* ------------------------------------------------------------ cries */
  /**
   * A Pokémon's cry. Skipped (not queued) when the profile's policy says it would be too soon: another cry
   * within `gap`, the same species within `cooldown`, or too many cries ringing. Rate below 1 lowers it.
   */
  cry(dex: number, o: CryOpts = {}) {
    const ctx = this.live;
    if (!ctx || !this.g || ctx.state !== 'running' || !Number.isInteger(dex) || dex < 1) return;
    if (categoryGain(this.mix, 'cries', this.profile) <= 0) return;
    const now = ctx.currentTime, pol = CRY_POLICY[this.profile];
    this.cryEnds = this.cryEnds.filter(e => e > now);
    if (now - this.cryAt < pol.gap || now - (this.cryBy.get(dex) ?? -Infinity) < pol.cooldown || this.cryEnds.length >= pol.voices) return;
    this.cryAt = now; this.cryBy.set(dex, now);
    void this.loadCry(ctx, dex).then(e => {
      // Decoding the first time can take a moment; a cry that would land late is dropped, not played out of sync.
      if (this.live === ctx && ctx.currentTime - now < 0.8) this.startCry(e.buf, o);
    }).catch(() => { /* no cry this time */ });
  }
  private startCry(buf: AudioBuffer, o: CryOpts) {
    const g = this.g;
    if (!g) return;
    const ctx = g.ctx, t = ctx.currentTime + 0.012, rate = clamp(o.rate ?? 1, 0.7, 1.3);
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const v = ctx.createGain(); v.gain.value = clamp(o.gain ?? 1, 0, 1);
    const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan ?? 0, -1, 1) * 0.8;
    src.connect(v).connect(p).connect(g.input.cries);
    src.start(t);
    const dur = buf.duration / rate;
    this.cryEnds.push(t + dur);
    g.duck('music', CRY_DUCK.music, dur); g.duck('ambience', CRY_DUCK.ambience, dur);
  }
  /** Fetch, decode and treat a cry once per species (cached; a failed fetch is retried next time). */
  private loadCry(ctx: BaseAudioContext, dex: number): Promise<CryEntry> {
    let p = this.cries.get(dex);
    if (!p) {
      p = fetch(pokemonCry(dex))
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(b => ctx.decodeAudioData(b))
        .then(raw => {
          const chs: Float32Array[] = [];
          for (let c = 0; c < raw.numberOfChannels; c++) chs.push(raw.getChannelData(c));
          const { out, stats } = processCry(mono(chs), raw.sampleRate);
          const buf = ctx.createBuffer(1, out.length, raw.sampleRate);
          buf.getChannelData(0).set(out);
          return { buf, stats };
        });
      this.cries.set(dex, p);
      p.catch(() => this.cries.delete(dex));
    }
    return p;
  }

  /** Settings preview: a representative sound of a category at its new level (throttled). */
  preview(cat: Category, dex?: number) {
    const now = performance.now();
    if (now - this.lastPreview < 300 || this.live?.state !== 'running') return;
    this.lastPreview = now;
    if (cat === 'cries') {
      const ctx = this.live;
      if (dex) void this.loadCry(ctx, dex).then(e => { if (this.live === ctx) this.startCry(e.buf, {}); }).catch(() => { /* offline */ });
      return;
    }
    const cue = ({ ui: 'confirm', battle: 'hit', ambience: 'step' } as Partial<Record<Category, Cue>>)[cat];
    if (cue) this.play(cue);
  }

  /* ------------------------------------------------------------ diagnostics */
  private meterTap: ScriptProcessorNode | null = null;
  private peak = 0;
  /** Peak output level right now (0..1). */
  level() {
    if (!this.g) return 0;
    const d = new Float32Array(this.g.meter.fftSize); this.g.meter.getFloatTimeDomainData(d);
    let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); return m;
  }
  get state() { return this.live?.state ?? 'none'; }
  /** Test helper: the loudest output sample since the last call (catches very short cues). */
  takePeak() {
    const g = this.g;
    if (!g) return 0;
    if (!this.meterTap) {
      const tap = g.ctx.createScriptProcessor(256, 1, 1);
      tap.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > this.peak) this.peak = v; } };
      const sink = g.ctx.createGain(); sink.gain.value = 0;
      g.meter.connect(tap).connect(sink).connect(g.ctx.destination);
      this.meterTap = tap;
    }
    const p = this.peak; this.peak = 0; return p;
  }

  /**
   * QA: render one cue offline through the full mix (default volumes unless `mix` overrides them, in the
   * profile it is usually heard in) and measure it. Deterministic (seeded randomness, no device clock).
   */
  async renderCue(cue: Cue, opt: { profile?: Profile; mix?: Partial<AudioMix>; seconds?: number; gain?: number; pitch?: number } = {}) {
    const cat = CUE_CATEGORY[cue], profile = opt.profile ?? homeProfile(cat), sr = 48000;
    const off = new OfflineAudioContext(2, Math.round(sr * (opt.seconds ?? (cue === 'introSwell' ? 7 : 3))), sr);
    const g = new Graph(off, { ...AUDIO_DEFAULTS, ...opt.mix }, profile);
    const s = new Synth(g); s.rnd = seeded(7); s.bus = g.input[cat];
    const ring = playCue(s, cue, 0.02, { gain: opt.gain, pitch: opt.pitch });
    const b = await off.startRendering();
    const lv = measure([b.getChannelData(0), b.getChannelData(1)], sr);
    return { cue, category: cat, profile, ring, ...lv, rms: Math.pow(10, lv.rmsDb / 20) };
  }
  /** QA: decode, treat and render one cry offline; returns the treatment stats and the output level. */
  async renderCry(dex: number, opt: { profile?: Profile; mix?: Partial<AudioMix>; gain?: number } = {}) {
    const sr = 48000;
    const e = await this.loadCry(this.live ?? new OfflineAudioContext(1, sr, sr), dex);
    const off = new OfflineAudioContext(2, Math.round(sr * (e.buf.duration + 0.9)), sr);
    const g = new Graph(off, { ...AUDIO_DEFAULTS, ...opt.mix }, opt.profile ?? 'battle');
    const src = off.createBufferSource(); src.buffer = e.buf;
    const v = off.createGain(); v.gain.value = opt.gain ?? 1;
    src.connect(v).connect(g.input.cries); src.start(0.02);
    const b = await off.startRendering();
    return { dex, ...e.stats, out: measure([b.getChannelData(0), b.getChannelData(1)], sr) as Level };
  }
  /** QA: render a profile's music and/or ambience for `seconds` (seeded) and measure it. */
  async renderBeds(profile: Profile, seconds = 16, opt: { mix?: Partial<AudioMix>; only?: 'music' | 'ambience' } = {}) {
    const sr = 48000, off = new OfflineAudioContext(2, Math.round(sr * seconds), sr);
    const g = new Graph(off, { ...AUDIO_DEFAULTS, ...opt.mix }, profile), rnd = seeded(11);
    if (opt.only !== 'ambience') { const m = new MusicPlayer(g, rnd); m.play(profile, 0.01); m.schedule(seconds); }
    if (opt.only !== 'music') { const a = new Ambience(g, rnd); a.start(profile, 0.01); a.schedule(seconds); }
    const b = await off.startRendering();
    return { profile, only: opt.only ?? 'both', ...measure([b.getChannelData(0), b.getChannelData(1)], sr) };
  }
}

export type SoundEngine = AudioManager;
export const sound = new AudioManager();
// Diagnostics hooks for the automated audio check (?audiotest); inert otherwise.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('audiotest')) {
  Object.assign(window as object, { __sound: sound, __audioLab: { measure, processCry, CRY, categoryGain, AUDIO_DEFAULTS, ALL_CUES, CUE_CATEGORY } });
}
