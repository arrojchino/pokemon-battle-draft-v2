export type QualityTier = 'low' | 'medium' | 'high';
export type QualityPref = QualityTier | 'auto';
/** Share of the tier's full resolution the stage renders at; 'auto' lets the adaptive controller pick (0.7..1). */
export type RenderScale = 'auto' | 0.5 | 0.75 | 1;
export type EffectsLevel = 'full' | 'reduced' | 'minimal';

export type QualitySettings = {
  tier: QualityTier;
  maxDpr: number;
  msaa: number;
  bloom: boolean;
  reflections: boolean;
  shadows: boolean;
  shadowMap: number;
  /** Rain streaks (instanced quads, GPU-animated). */
  /** Floodlight shafts over the field. */
  shafts: boolean;
};

export const TIERS: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', maxDpr: 2, msaa: 4, bloom: true, reflections: true, shadows: true, shadowMap: 2048, shafts: true },
  medium: { tier: 'medium', maxDpr: 1.5, msaa: 2, bloom: true, reflections: false, shadows: true, shadowMap: 1024, shafts: true },
  low: { tier: 'low', maxDpr: 1, msaa: 0, bloom: false, reflections: false, shadows: false, shadowMap: 512, shafts: false },
};

/**
 * Effects intensity, independent of the quality tier: particle density, point-light flash strength,
 * bloom strength and post-processing (grain, colour fringe, impact blur), as 0..1.
 * Minimal keeps the attack shapes (orbs, beams, rings, slashes, debris) so every move still reads.
 */
export const EFFECTS: Record<EffectsLevel, { particles: number; lights: number; bloom: number; post: number }> = {
  full: { particles: 1, lights: 1, bloom: 1, post: 1 },
  reduced: { particles: 0.5, lights: 0.5, bloom: 0.55, post: 0.4 },
  minimal: { particles: 0, lights: 0, bloom: 0, post: 0 },
};

const ORDER: QualityTier[] = ['low', 'medium', 'high'];

/** Best-guess starting tier before any frames are measured. The adaptive controller corrects it. */
export function initialTier(gl: WebGL2RenderingContext | WebGLRenderingContext | null): QualityTier {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let renderer = '';
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    renderer = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { /* ignore */ }
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 'low';
  if (coarse || mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

/**
 * Adaptive resolution and tier controller. Watches real frame times (not guesses) and trades
 * resolution first, then features, to hold the frame budget. Hysteresis prevents oscillation.
 * `tiers` follows the Auto quality preset and `resolution` the Auto render scale; either can be off.
 */
export class AdaptiveQuality {
  scale = 1;                  // multiplies the DPR, 0.7..1 (stays 1 while the render scale is fixed)
  private acc = 0; private frames = 0; private cool = 0;
  readonly samples = new Float32Array(240); private si = 0; private filled = 0;
  constructor(private onTierDown: () => boolean, private onTierUp: () => boolean, public tiers = true, public resolution = true) {}

  /** Returns true when the render scale or the tier changed. */
  push(frameMs: number, dt: number): boolean {
    this.samples[this.si] = frameMs; this.si = (this.si + 1) % this.samples.length; this.filled = Math.min(this.filled + 1, this.samples.length);
    if (!this.tiers && !this.resolution) return false;
    this.acc += frameMs; this.frames++; this.cool -= dt;
    if (this.frames < 90 || this.cool > 0) return false;
    const avg = this.acc / this.frames; this.acc = 0; this.frames = 0;
    // Budget is ~16.7 ms; displays faster than 60 Hz simply get headroom.
    if (avg > 19.5) {
      this.cool = 2.5;
      if (this.resolution && this.scale > 0.75) { this.scale = Math.max(0.7, this.scale - 0.1); return true; }
      if (this.tiers && this.onTierDown()) { if (this.resolution) this.scale = 0.9; return true; }
    } else if (avg < 10.5 && this.resolution && this.scale < 1) {
      this.cool = 4; this.scale = Math.min(1, this.scale + 0.05); return true;
    } else if (avg < 9 && this.scale >= 1 && this.tiers) {
      this.cool = 8; if (this.onTierUp()) return true;
    }
    return false;
  }

  stats() {
    const n = this.filled; if (!n) return { fps: 0, p50: 0, p95: 0 };
    const arr = Array.from(this.samples.subarray(0, n)).sort((a, b) => a - b);
    const p50 = arr[Math.floor(n * 0.5)], p95 = arr[Math.min(n - 1, Math.floor(n * 0.95))];
    return { fps: 1000 / Math.max(1e-3, arr.reduce((a, b) => a + b, 0) / n), p50, p95 };
  }
}

export const stepTier = (t: QualityTier, dir: -1 | 1): QualityTier | null => {
  const i = ORDER.indexOf(t) + dir;
  return i >= 0 && i < ORDER.length ? ORDER[i] : null;
};
