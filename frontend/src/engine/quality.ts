export type QualityTier = 'low' | 'medium' | 'high';
export type QualityPref = QualityTier | 'auto';

export type QualitySettings = {
  tier: QualityTier;
  maxDpr: number;
  msaa: number;
  bloom: boolean;
  reflections: boolean;
  shadows: boolean;
  shadowMap: number;
  /** Rain streaks (instanced quads, GPU-animated). */
  rain: number;
  buildings: number;
  shafts: boolean;
};

export const TIERS: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', maxDpr: 2, msaa: 4, bloom: true, reflections: true, shadows: true, shadowMap: 2048, rain: 2600, buildings: 340, shafts: true },
  medium: { tier: 'medium', maxDpr: 1.5, msaa: 2, bloom: true, reflections: false, shadows: true, shadowMap: 1024, rain: 1600, buildings: 220, shafts: true },
  low: { tier: 'low', maxDpr: 1, msaa: 0, bloom: false, reflections: false, shadows: false, shadowMap: 512, rain: 600, buildings: 120, shafts: false },
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
 */
export class AdaptiveQuality {
  scale = 1;                  // multiplies the DPR, 0.6..1
  private acc = 0; private frames = 0; private cool = 0;
  readonly samples = new Float32Array(240); private si = 0; private filled = 0;
  constructor(private onTierDown: () => boolean, private onTierUp: () => boolean, public enabled = true) {}

  /** Returns true when the render scale changed. */
  push(frameMs: number, dt: number): boolean {
    this.samples[this.si] = frameMs; this.si = (this.si + 1) % this.samples.length; this.filled = Math.min(this.filled + 1, this.samples.length);
    if (!this.enabled) return false;
    this.acc += frameMs; this.frames++; this.cool -= dt;
    if (this.frames < 90 || this.cool > 0) return false;
    const avg = this.acc / this.frames; this.acc = 0; this.frames = 0;
    // Budget is ~16.7 ms; displays faster than 60 Hz simply get headroom.
    if (avg > 19.5) {
      this.cool = 2.5;
      if (this.scale > 0.75) { this.scale = Math.max(0.7, this.scale - 0.1); return true; }
      if (this.onTierDown()) { this.scale = 0.9; return true; }
    } else if (avg < 10.5 && this.scale < 1) {
      this.cool = 4; this.scale = Math.min(1, this.scale + 0.05); return true;
    } else if (avg < 9 && this.scale >= 1) {
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
