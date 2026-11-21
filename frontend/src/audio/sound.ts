/**
 * All game audio, synthesized live with the Web Audio API: no sound files to download or license.
 * Sound effects only: the game deliberately has no background music.
 *
 * Effects run through a little tape saturation and a short generated "back alley" reverb into a master
 * gain (volume and mute), so everything shares the same grimy room. The context starts on the first
 * user gesture (browser autoplay rules) and is suspended when the tab is hidden.
 */

export type Cue =
  // UI
  | 'hover' | 'click' | 'confirm' | 'back' | 'toggle' | 'error' | 'join' | 'tick' | 'tickUrgent'
  // Match flow
  | 'coinFlip' | 'coinLand' | 'tossWin' | 'tossLose' | 'deal' | 'pick'
  // Battle
  | 'switchIn' | 'dash' | 'punch' | 'slash' | 'bite' | 'fire' | 'water' | 'zap' | 'beamCharge' | 'beam'
  | 'orb' | 'orbHit' | 'rings' | 'wind' | 'leaves' | 'quake' | 'meteor' | 'meteorHit' | 'coins' | 'heal' | 'shield'
  | 'buff' | 'debuff' | 'hazard' | 'status' | 'hit' | 'hitBig' | 'crit' | 'super' | 'resist' | 'miss' | 'faint' | 'tera'
  | 'stamp' | 'ko' | 'win' | 'lose'
  // World
  | 'thunder'
  // Bots
  | 'chirp' | 'chirpHappy' | 'chirpSad' | 'chirpAngry';

export type PlayOpts = { gain?: number; pan?: number; pitch?: number };

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
/** Level of the effects bus into the saturator (headroom); the player's volume sets the master gain. */
const SFX_LEVEL = 0.9;

class SoundEngine {
  private ctx: BaseAudioContext | null = null;
  private live: AudioContext | null = null;
  private offline = false;
  private master!: GainNode; private sfx!: GainNode; private verb!: ConvolverNode; private verbSend!: GainNode;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private muted = false;
  private last = new Map<Cue, number>();
  private meter: AnalyserNode | null = null;

  /** Create (or resume) the context. Safe to call on every gesture. */
  unlock() {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    if (!this.live) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.live = ctx;
      this.build(ctx);
      document.addEventListener('visibilitychange', () => { if (document.hidden) void ctx.suspend(); else void ctx.resume(); });
    }
    if (this.live.state === 'suspended') void this.live.resume();
  }

  /** Effects bus, saturation, reverb and meter for a context (live or offline). */
  private build(ctx: BaseAudioContext) {
    {
      this.ctx = ctx; this.noise = null;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.master.connect(comp).connect(ctx.destination);
      this.meter = ctx.createAnalyser(); this.meter.fftSize = 512; comp.connect(this.meter);
      // Tape-ish saturation on effects for grit.
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
      shaper.curve = curve; shaper.oversample = '2x';
      this.sfx = ctx.createGain(); this.sfx.gain.value = SFX_LEVEL; this.sfx.connect(shaper).connect(this.master);
      this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(1.6);
      this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.22;
      this.verbSend.connect(this.verb).connect(this.master);
      this.applyVolume();
    }
  }

  /**
   * Render one cue offline and report its peak and RMS. Deterministic (no device clock), so the
   * automated check can prove every cue produces sound.
   */
  async renderCue(cue: Cue): Promise<{ peak: number; rms: number }> {
    const keep = { ctx: this.ctx, master: this.master, sfx: this.sfx, verb: this.verb, verbSend: this.verbSend, meter: this.meter, noise: this.noise, last: this.last };
    const off = new OfflineAudioContext(2, 44100 * 3, 44100);
    this.build(off); this.offline = true; this.last = new Map();
    this.master.gain.value = 0.8;
    try { this.play(cue); } finally { this.offline = false; }
    Object.assign(this, keep);
    const buf = await off.startRendering();
    const d = buf.getChannelData(0); let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    return { peak, rms: Math.sqrt(sum / d.length) };
  }

  /** Sound-effects volume (0..1) and mute; mute keeps the level so unmuting restores it. */
  setVolume(volume: number, muted: boolean) { this.volume = volume; this.muted = muted; this.applyVolume(); }
  private applyVolume() {
    if (!this.ctx || this.offline) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** Peak output level right now (0..1), for diagnostics and tests. */
  level() {
    if (!this.meter) return 0;
    const d = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(d);
    let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); return m;
  }
  get state() { return this.live?.state ?? 'none'; }
  /** Test helper: continuously track the loudest sample until read (catches very short cues). */
  private peak = 0; private tap: ScriptProcessorNode | null = null;
  takePeak() {
    if (!this.ctx || !this.meter) return 0;
    if (!this.tap) {
      this.tap = this.ctx.createScriptProcessor(256, 1, 1);
      this.tap.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > this.peak) this.peak = v; } };
      const sink = this.ctx.createGain(); sink.gain.value = 0;
      this.meter.connect(this.tap).connect(sink).connect(this.ctx.destination);
    }
    const p = this.peak; this.peak = 0; return p;
  }

  /* ------------------------------------------------------------ building blocks */
  private impulse(seconds: number) {
    const ctx = this.ctx!; const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    return b;
  }
  private noiseBuf() {
    if (!this.noise) {
      const ctx = this.ctx!; const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
  /** An output for one voice: gain envelope → optional pan → bus (+ reverb send). */
  private out(t: number, peak: number, attack: number, decay: number, o: PlayOpts = {}, bus: AudioNode = this.sfx, wet = true) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * (o.gain ?? 1)), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let node: AudioNode = g;
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); node = p; }
    node.connect(bus);
    if (wet) node.connect(this.verbSend);
    return g;
  }
  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, o: PlayOpts = {}, attack = 0.005, bus?: AudioNode) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type;
    const p = o.pitch ?? 1;
    osc.frequency.setValueAtTime(f0 * p, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * p), t + dur);
    osc.connect(this.out(t, peak, attack, dur, o, bus));
    osc.start(t); osc.stop(t + attack + dur + 0.05);
    return osc;
  }
  private hiss(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, o: PlayOpts = {}, attack = 0.005, bus?: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
    src.connect(f).connect(this.out(t, peak, attack, dur, o, bus));
    src.start(t, Math.random() * 1.5); src.stop(t + attack + dur + 0.05);
  }
  private fm(carrier: number, ratio: number, index: number, t: number, dur: number, peak: number, o: PlayOpts = {}) {
    const ctx = this.ctx!; const p = o.pitch ?? 1;
    const c = ctx.createOscillator(); const m = ctx.createOscillator(); const mg = ctx.createGain();
    c.frequency.value = carrier * p; m.frequency.value = carrier * ratio * p; mg.gain.setValueAtTime(carrier * index, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
    m.connect(mg).connect(c.frequency);
    c.connect(this.out(t, peak, 0.002, dur, o));
    c.start(t); m.start(t); c.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  }
  private thud(t: number, f: number, peak: number, dur = 0.25, o: PlayOpts = {}) { this.tone('sine', f * 2.2, f, t, dur, peak, o, 0.002); }

  /* ------------------------------------------------------------ cues */
  play(cue: Cue, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || (!this.offline && ctx.state !== 'running')) return;
    // Throttle identical cues (hover storms, multi-hit spam).
    const now = ctx.currentTime; const prev = this.last.get(cue) ?? -1;
    if (now - prev < (cue === 'hover' ? 0.05 : 0.025)) return;
    this.last.set(cue, now);
    // Schedule just past the next audio callback; anything earlier is already in the past when the
    // render thread picks it up and a short envelope would collapse to silence.
    const t = this.offline ? 0.02 : now + Math.max(0.015, ((ctx as AudioContext).baseLatency || 0) + 0.008);
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    switch (cue) {
      case 'hover': this.tone('square', 1900, 1700, t, 0.025, 0.035, o); break;
      case 'click': this.thud(t, 120, 0.4, 0.08, o); this.hiss(t, 0.04, 0.12, 'bandpass', 3000, 2000, 2, o); break;
      case 'toggle': this.tone('square', 600, 900, t, 0.05, 0.08, o); break;
      case 'confirm': [0, 4, 7].forEach((n, i) => this.tone('square', midi(64 + n), midi(64 + n), t + i * 0.06, 0.12, 0.09, o)); this.thud(t, 90, 0.4, 0.2, o); break;
      case 'back': this.tone('square', 500, 260, t, 0.12, 0.08, o); break;
      case 'error': this.tone('sawtooth', 150, 110, t, 0.3, 0.15, o); this.tone('sawtooth', 157, 113, t, 0.3, 0.12, o); break;
      case 'join': [0, 7, 12].forEach((n, i) => this.fm(midi(69 + n), 3.5, 2, t + i * 0.08, 0.5, 0.12, o)); break;
      case 'tick': this.tone('square', 1200, 1200, t, 0.03, 0.06, o); break;
      case 'tickUrgent': this.tone('square', 1600, 1600, t, 0.05, 0.11, o); this.tone('square', 1600, 1600, t + 0.09, 0.05, 0.09, o); break;
      case 'coinFlip': this.fm(2600, 2.76, 3, t, 0.5, 0.12, o); this.hiss(t, 0.35, 0.08, 'highpass', 4000, 6000, 1, o); break;
      case 'coinLand': [0, 0.11, 0.19, 0.24].forEach((d, i) => this.fm(3100 - i * 120, 2.76, 2.5, t + d, 0.25 - i * 0.04, 0.16 / (i + 1), o)); this.thud(t, 140, 0.2, 0.1, o); break;
      case 'tossWin': [0, 3, 7, 12].forEach((n, i) => this.tone('square', midi(67 + n), midi(67 + n), t + i * 0.07, 0.16, 0.08, o)); break;
      case 'tossLose': this.tone('sawtooth', midi(55), midi(48), t, 0.6, 0.1, o, 0.02); break;
      case 'deal': for (let i = 0; i < 6; i++) this.hiss(t + i * 0.05, 0.07, 0.1, 'bandpass', 2500, 1200, 1.5, o); break;
      case 'pick': this.thud(t, 70, 0.6, 0.35, o); this.hiss(t, 0.25, 0.15, 'lowpass', 2500, 300, 1, o); break;

      case 'switchIn': this.tone('sawtooth', 110, 880, t, 0.35, 0.07, o, 0.02); this.hiss(t, 0.4, 0.08, 'bandpass', 600, 5000, 4, o, 0.05); this.fm(880, 1.5, 1.5, t + 0.33, 0.35, 0.07, o); break;
      case 'dash': this.hiss(t, 0.32, 0.25, 'bandpass', 500, 2600, 1.4, o, 0.08); break;
      case 'punch': this.thud(t, 65, 0.9, 0.25, o); this.hiss(t, 0.09, 0.4, 'lowpass', 3000, 400, 1, o); break;
      case 'slash': this.hiss(t, 0.18, 0.35, 'bandpass', 7000, 2500, 3, o, 0.01); this.tone('sawtooth', 2400, 900, t, 0.12, 0.05, o); this.thud(t + 0.03, 90, 0.4, 0.15, o); break;
      case 'bite': [0, 0.08].forEach(d => { this.hiss(t + d, 0.06, 0.35, 'bandpass', 3000, 1500, 2, o); this.thud(t + d, 110, 0.4, 0.08, o); }); break;
      case 'fire': this.hiss(t, 0.75, 0.32, 'lowpass', 900, 3200, 0.7, o, 0.08); this.hiss(t, 0.7, 0.12, 'bandpass', 180, 400, 2, o, 0.05); for (let i = 0; i < 8; i++) this.hiss(t + r(0, 0.6), 0.02, 0.15, 'highpass', 3000, 3000, 1, o); break;
      case 'water': this.hiss(t, 0.7, 0.28, 'bandpass', 1500, 900, 0.8, o, 0.06); for (let i = 0; i < 6; i++) this.tone('sine', r(500, 1400), r(1500, 2600), t + r(0, 0.6), 0.06, 0.05, o); break;
      case 'zap': for (let i = 0; i < 5; i++) { const d = i * 0.06 + r(0, 0.03); this.hiss(t + d, 0.05, 0.35, 'highpass', 2000, 6000, 1, o); this.tone('square', r(60, 120), r(40, 80), t + d, 0.06, 0.15, o); } break;
      case 'beamCharge': this.tone('sawtooth', 120, 900, t, 0.18, 0.08, o, 0.01); break;
      case 'beam': this.tone('sawtooth', 220, 210, t, 0.7, 0.1, o, 0.02); this.tone('sawtooth', 223, 214, t, 0.7, 0.1, o, 0.02); this.hiss(t, 0.7, 0.12, 'bandpass', 2400, 2400, 6, o, 0.02); break;
      case 'orb': this.tone('sine', 300, 900, t, 0.5, 0.12, o, 0.02); this.fm(300, 0.5, 4, t, 0.5, 0.05, o); break;
      case 'orbHit': this.thud(t, 80, 0.6, 0.3, o); this.hiss(t, 0.25, 0.2, 'lowpass', 4000, 500, 1, o); break;
      case 'rings': for (let i = 0; i < 3; i++) this.fm(r(300, 500), 1.01, 6, t + i * 0.09, 0.35, 0.07, o); break;
      case 'wind': this.hiss(t, 1.0, 0.25, 'bandpass', 400, 1800, 3, o, 0.25); break;
      case 'leaves': for (let i = 0; i < 12; i++) this.hiss(t + r(0, 0.7), 0.05, 0.12, 'bandpass', r(2000, 5000), 1500, 3, o); break;
      case 'quake': this.tone('sine', 55, 30, t, 1.1, 0.9, o, 0.02); this.hiss(t, 1.0, 0.5, 'lowpass', 300, 60, 1, o, 0.03); for (let i = 0; i < 6; i++) this.thud(t + r(0.05, 0.6), r(45, 90), 0.35, 0.2, o); break;
      case 'meteor': this.tone('sine', 1800, 300, t, 0.6, 0.06, o, 0.02); this.hiss(t, 0.6, 0.12, 'bandpass', 3000, 600, 4, o, 0.2); break;
      case 'meteorHit': this.thud(t, 50, 1, 0.5, o); this.hiss(t, 0.5, 0.4, 'lowpass', 2500, 150, 1, o); break;
      case 'coins': for (let i = 0; i < 14; i++) this.fm(r(2200, 3600), 2.76, 2, t + r(0, 0.8), 0.15, 0.06, o); break;
      case 'heal': [0, 4, 7, 12, 16].forEach((n, i) => this.fm(midi(72 + n), 2, 1, t + i * 0.07, 0.4, 0.06, o)); break;
      case 'shield': this.fm(220, 2, 3, t, 0.9, 0.12, o); this.tone('sine', 440, 445, t, 0.9, 0.06, o, 0.05); break;
      case 'buff': [0, 5, 7, 12].forEach((n, i) => this.tone('square', midi(60 + n), midi(60 + n), t + i * 0.05, 0.09, 0.06, o)); break;
      case 'debuff': [12, 7, 5, 0].forEach((n, i) => this.tone('square', midi(55 + n), midi(55 + n), t + i * 0.05, 0.09, 0.05, o)); break;
      case 'hazard': for (let i = 0; i < 5; i++) { this.thud(t + i * 0.07 + 0.5, r(150, 260), 0.25, 0.08, o); this.hiss(t + i * 0.07 + 0.5, 0.04, 0.15, 'bandpass', 3500, 2000, 3, o); } this.hiss(t, 0.4, 0.1, 'bandpass', 800, 2000, 2, o, 0.1); break;
      case 'status': this.tone('triangle', 700, 300, t, 0.3, 0.08, o); this.tone('triangle', 740, 320, t + 0.05, 0.3, 0.06, o); break;
      case 'hit': this.thud(t, 90, 0.6, 0.18, o); this.hiss(t, 0.1, 0.25, 'lowpass', 3000, 500, 1, o); break;
      case 'hitBig': this.thud(t, 55, 1, 0.4, o); this.hiss(t, 0.3, 0.45, 'lowpass', 5000, 200, 1, o); this.tone('sawtooth', 300, 60, t, 0.25, 0.08, o); break;
      case 'crit': this.hiss(t, 0.15, 0.5, 'highpass', 5000, 8000, 1, o); this.tone('square', 1800, 1200, t, 0.1, 0.08, o); break;
      case 'super': this.tone('square', midi(76), midi(76), t, 0.08, 0.08, o); this.tone('square', midi(83), midi(83), t + 0.08, 0.14, 0.08, o); break;
      case 'resist': this.tone('triangle', 300, 200, t, 0.2, 0.08, o); break;
      case 'miss': this.hiss(t, 0.25, 0.2, 'bandpass', 1200, 4000, 2, o, 0.05); this.tone('sine', 800, 500, t + 0.1, 0.15, 0.05, o); break;
      case 'faint': this.tone('sawtooth', 440, 55, t, 1.1, 0.12, o, 0.01); this.tone('sawtooth', 446, 56, t, 1.1, 0.1, o, 0.01); this.hiss(t + 0.2, 0.9, 0.12, 'bandpass', 3000, 200, 2, o); break;
      case 'tera': [0, 7, 12, 16, 19, 24].forEach((n, i) => this.fm(midi(64 + n), 3.01, 2, t + i * 0.05, 0.8, 0.07, o)); this.hiss(t, 0.8, 0.15, 'highpass', 3000, 9000, 1, o, 0.05); this.thud(t, 50, 0.6, 0.5, o); break;
      case 'stamp': this.hiss(t, 0.22, 0.25, 'highpass', 2500, 5000, 0.8, o, 0.01); this.thud(t + 0.02, 75, 0.7, 0.2, o); break;
      case 'ko': this.thud(t, 40, 1, 0.6, o); this.tone('square', midi(43), midi(31), t, 0.6, 0.12, o); break;
      case 'win': [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => this.tone('square', midi(60 + n), midi(60 + n), t + i * 0.09, i === 7 ? 0.6 : 0.1, 0.09, o)); this.thud(t, 60, 0.5, 0.3, o); break;
      case 'lose': [0, -1, -2, -3].forEach((n, i) => this.wah(midi(55 + n), t + i * 0.32, i === 3 ? 0.9 : 0.28, o)); break;
      case 'thunder': {
        // A crack, then a long rolling rumble that swells and fades.
        this.hiss(t, 0.25, 0.5, 'highpass', 1500, 400, 0.7, o, 0.003);
        this.hiss(t + 0.05, 3.2, 0.7, 'lowpass', 320, 60, 0.8, o, 0.4);
        for (let i = 0; i < 4; i++) this.hiss(t + 0.3 + i * r(0.3, 0.7), r(0.6, 1.2), 0.35, 'lowpass', r(150, 260), 50, 1, o, 0.1);
        break;
      }
      case 'chirp': case 'chirpHappy': case 'chirpSad': case 'chirpAngry': this.chirp(cue, t, o); break;
    }
  }

  /** Comic trombone for losing. */
  private wah(f: number, t: number, dur: number, o: PlayOpts) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, t);
    if (dur > 0.5) { const lfo = ctx.createOscillator(); const lg = ctx.createGain(); lfo.frequency.value = 6; lg.gain.value = f * 0.02; lfo.connect(lg).connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1); }
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 6;
    flt.frequency.setValueAtTime(300, t); flt.frequency.linearRampToValueAtTime(1600, t + 0.12); flt.frequency.linearRampToValueAtTime(500, t + dur);
    osc.connect(flt).connect(this.out(t, 0.16, 0.02, dur, o));
    osc.start(t); osc.stop(t + dur + 0.1);
  }

  /** Robot gibberish: a few pitched square blips with a vowel-ish filter. */
  private chirp(kind: Cue, t: number, o: PlayOpts) {
    const n = 3 + Math.floor(Math.random() * 4);
    const base = kind === 'chirpSad' ? 300 : kind === 'chirpAngry' ? 180 : kind === 'chirpHappy' ? 620 : 440;
    for (let i = 0; i < n; i++) {
      const up = kind === 'chirpHappy' ? 1 + i * 0.12 : kind === 'chirpSad' ? 1 - i * 0.08 : 0.8 + Math.random() * 0.5;
      const f = base * up * (o.pitch ?? 1);
      const d = t + i * 0.075;
      this.tone(kind === 'chirpAngry' ? 'sawtooth' : 'square', f, f * (Math.random() < 0.5 ? 1.25 : 0.8), d, 0.06, 0.06, { ...o, pitch: 1 });
    }
  }
}

export const sound = new SoundEngine();
// Diagnostics hook for the automated audio check (?audiotest); inert otherwise.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('audiotest')) (window as unknown as { __sound: SoundEngine }).__sound = sound;
