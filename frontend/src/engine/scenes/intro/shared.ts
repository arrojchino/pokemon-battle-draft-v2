import * as THREE from 'three';

/**
 * Shared helpers for the intro environment: seeded random numbers, value noise for build-time geometry,
 * the uniform block every lit material of the intro shares (time, wind, the shrine lanterns as fake lights,
 * the reveal burst wave) and the `onBeforeCompile` patch that injects them into MeshStandardMaterial.
 */

export const NLAMP = 24;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** C1 soft ramp: 0 below -w, x above w, a parabola between. */
export const ramp = (x: number, w: number) => (x > w ? x : x < -w ? 0 : ((x + w) * (x + w)) / (4 * w));
/** Smooth maximum (polynomial), k is the blend width. */
export const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
};

function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm(x: number, y: number, oct = 4): number {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f + i * 17.3, y * f - i * 9.1);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

/** Uniforms shared by every lit material in the intro (same objects, so one write updates all). */
export type Shared = {
  uTime: { value: number };
  uWind: { value: THREE.Vector2 };
  uLamp: { value: THREE.Vector4[] };
  uLampColor: { value: THREE.Color };
  uLampGain: { value: number };
  /** xyz centre, w = seconds since the burst started (negative: no burst). */
  uBurst: { value: THREE.Vector4 };
  uBurstColor: { value: THREE.Color };
  uGlowMap: { value: THREE.Texture | null };
  /** x0, z0, 1/width, 1/depth of the town glow map in world units. */
  uGlowRect: { value: THREE.Vector4 };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  /** Pixels per world unit at distance 1 (drawing buffer height / (2 tan(fov / 2))), for sized point sprites. */
  uPx: { value: number };
};

export function createShared(): Shared {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.45, 0.9) },
    uLamp: { value: Array.from({ length: NLAMP }, () => new THREE.Vector4(0, -999, 0, 0)) },
    uLampColor: { value: new THREE.Color('#ff9a4a') },
    uLampGain: { value: 1 },
    uBurst: { value: new THREE.Vector4(0, 0.205, 0, -1) },
    uBurstColor: { value: new THREE.Color('#8fe6ff') },
    uGlowMap: { value: null },
    uGlowRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFogColor: { value: new THREE.Color('#0c1631') },
    uFogDensity: { value: 0.0062 },
    uPx: { value: 1385 },
  };
}

/** Burst wave radius and profile, shared by GLSL users (keep in sync with burstRadius below). */
export const GLSL_BURST = /* glsl */`
  float burstR(float t) { return 9.5 * (1.0 - exp(-t * 1.9)); }
  float burstBand(float r, float t) {
    float R = burstR(t);
    float w = 0.28 + t * 0.35;
    return exp(-((r - R) * (r - R)) / (w * w)) * exp(-t * 0.9) * smoothstep(0.0, 0.05, t);
  }
`;

export const GLSL_NOISE = /* glsl */`
  float iHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float iNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(iHash(i), iHash(i + vec2(1.0, 0.0)), f.x), mix(iHash(i + vec2(0.0, 1.0)), iHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const V_COMMON = /* glsl */`
  uniform float uTime; uniform vec2 uWind; uniform vec4 uBurst;
  ${GLSL_NOISE}
  ${GLSL_BURST}
  vec2 windAt(vec2 xz, float t) {
    float g = iNoise(xz * 0.13 + vec2(-t * 0.42, -t * 0.2));
    float s = sin(t * 1.6 + xz.x * 0.55 + xz.y * 0.35) * 0.5 + 0.5;
    return uWind * (0.25 + 0.95 * g) * (0.55 + 0.45 * s);
  }
  varying vec3 vLampW; varying vec3 vLampN;
`;

const F_COMMON = /* glsl */`
  #define NLAMP ${NLAMP}
  uniform float uTime; uniform vec4 uLamp[NLAMP]; uniform vec3 uLampColor; uniform float uLampGain;
  uniform vec4 uBurst; uniform vec3 uBurstColor;
  ${GLSL_NOISE}
  ${GLSL_BURST}
  varying vec3 vLampW; varying vec3 vLampN;
  vec3 lampLight(vec3 p, vec3 n) {
    float acc = 0.0;
    for (int i = 0; i < NLAMP; i++) {
      vec4 L = uLamp[i];
      vec3 d = L.xyz - p;
      float d2 = dot(d, d);
      if (d2 > 36.0 || L.w <= 0.0) continue;
      float fl = 0.92 + 0.08 * sin(uTime * (7.0 + float(i) * 0.37) + float(i) * 2.1) * sin(uTime * 2.3 + float(i));
      float w = L.w * fl / (1.0 + max(d2, 0.7) * 1.35) * (1.0 - d2 / 36.0);
      float lam = max(dot(n, d * inversesqrt(d2)), 0.0) * 0.7 + 0.3;
      acc += w * lam;
    }
    return acc * uLampColor * uLampGain;
  }
  vec3 burstLight(vec3 p) {
    if (uBurst.w < 0.0) return vec3(0.0);
    float t = uBurst.w;
    float r = length(p.xz - uBurst.xz);
    float h = exp(-max(p.y - uBurst.y, 0.0) * 0.9);
    float core = exp(-r * r * 0.18) * exp(-t * 2.6) * smoothstep(0.0, 0.04, t);
    return uBurstColor * (burstBand(r, t) * 2.0 + core * 0.9) * h;
  }
`;

export type PatchOpts = {
  lamps?: boolean;
  burst?: boolean;
  wind?: 'grass' | 'tree' | 'canopy';
  /** Sample the town glow map (warm street light on the valley floor). */
  townGlow?: boolean;
  /** Procedural lit windows on instanced houses (unit box body, roof above y = 1). */
  windows?: boolean;
  /** Constant self light (multiplies albedo), e.g. blossoms glowing faintly at night. */
  selfGlow?: number;
};

/** Inject the shared intro lighting (fake lantern lights, burst wave, wind, town glow, windows) into a standard material. */
export function patchLit<T extends THREE.MeshStandardMaterial>(mat: T, S: Shared, o: PatchOpts): T {
  const lamps = o.lamps !== false, burst = o.burst !== false;
  const key = `intro:${lamps ? 1 : 0}${burst ? 1 : 0}:${o.wind ?? '-'}:${o.townGlow ? 1 : 0}:${o.windows ? 1 : 0}:${o.selfGlow ?? 0}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: S.uTime, uWind: S.uWind, uLamp: S.uLamp, uLampColor: S.uLampColor, uLampGain: S.uLampGain,
      uBurst: S.uBurst, uBurstColor: S.uBurstColor, uGlowMap: S.uGlowMap, uGlowRect: S.uGlowRect,
    });
    let disp = '';
    if (o.wind === 'grass') {
      disp = /* glsl */`
        vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        float hb = clamp(position.y / 0.7, 0.0, 1.2); hb *= hb;
        lw.xz += windAt(ip.xz, uTime) * hb * 0.32;
        if (uBurst.w >= 0.0) {
          vec2 bd = ip.xz - uBurst.xz; float br = length(bd) + 1e-3;
          float bw = burstBand(br, uBurst.w) + exp(-br * br * 0.3) * exp(-uBurst.w * 2.0) * smoothstep(0.0, 0.05, uBurst.w);
          lw.xz += bd / br * bw * hb * 0.42; lw.y -= bw * hb * 0.14;
        }`;
    } else if (o.wind === 'tree') {
      disp = /* glsl */`
        vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        float hb = clamp(position.y, 0.0, 1.0); hb *= hb;
        float sc = length(instanceMatrix[1].xyz);
        lw.xz += windAt(ip.xz, uTime * 0.8) * hb * 0.05 * sc;`;
    } else if (o.wind === 'canopy') {
      disp = /* glsl */`
        float hb = clamp((lw.y - 1.2) / 5.0, 0.0, 1.0);
        lw.xz += windAt(lw.xz * 0.3, uTime * 0.7) * hb * 0.16 + vec2(sin(uTime * 2.6 + lw.x * 3.0), cos(uTime * 2.1 + lw.z * 3.0)) * 0.012 * hb;`;
    }
    const winV = o.windows ? /* glsl */`
      vec3 iSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vObjP = position * iSc; vObjN = normal; vGeomY = position.y; vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);` : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${V_COMMON}\n${o.windows ? 'varying vec3 vObjP; varying vec3 vObjN; varying float vGeomY; varying float vSeed;' : ''}`)
      .replace('#include <project_vertex>', /* glsl */`
        vec4 lw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lw = instanceMatrix * lw;
        #endif
        lw = modelMatrix * lw;
        ${disp}
        vLampW = lw.xyz;
        vec3 lnrm = objectNormal;
        #ifdef USE_INSTANCING
          lnrm = mat3(instanceMatrix) * lnrm;
        #endif
        vLampN = normalize(mat3(modelMatrix) * lnrm);
        ${winV}
        vec4 mvPosition = viewMatrix * lw;
        gl_Position = projectionMatrix * mvPosition;`);
    const glowF = o.townGlow ? /* glsl */`
      vec2 guv = (vLampW.xz - uGlowRect.xy) * uGlowRect.zw;
      if (guv.x > 0.0 && guv.x < 1.0 && guv.y > 0.0 && guv.y < 1.0) {
        vec3 g = texture2D(uGlowMap, guv).rgb;
        totalEmissiveRadiance += g * (diffuseColor.rgb * 2.6 + 0.10);
      }` : '';
    const winF = o.windows ? /* glsl */`
      if (abs(vObjN.y) < 0.5 && vGeomY < 0.999) {
        float face = abs(vObjN.x) > 0.5 ? sign(vObjN.x) * 2.0 : sign(vObjN.z) * 3.0;
        vec2 q = abs(vObjN.x) > 0.5 ? vec2(vObjP.z, vObjP.y) : vec2(vObjP.x, vObjP.y);
        vec2 cs = vec2(1.1, 1.3);
        vec2 cell = floor(q / cs); vec2 f = fract(q / cs);
        float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.72) * step(0.5, cell.y + 0.5);
        float hs = iHash(cell + vec2(vSeed * 91.0 + face * 7.0, face));
        float on = step(0.5, hs);
        vec3 wc = mix(vec3(1.0, 0.6, 0.26), vec3(0.75, 0.88, 1.0), step(0.9, fract(hs * 13.7)));
        totalEmissiveRadiance += wc * win * on * (1.6 + 1.6 * fract(hs * 7.1));
      }` : '';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${F_COMMON}\nuniform sampler2D uGlowMap; uniform vec4 uGlowRect;\n${o.windows ? 'varying vec3 vObjP; varying vec3 vObjN; varying float vGeomY; varying float vSeed;' : ''}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          vec3 nW = normalize(vLampN) * faceDirection;
          ${lamps ? 'totalEmissiveRadiance += diffuseColor.rgb * lampLight(vLampW, nW);' : ''}
          ${burst ? 'totalEmissiveRadiance += burstLight(vLampW) * (diffuseColor.rgb * 1.6 + 0.05);' : ''}
          ${o.selfGlow ? `totalEmissiveRadiance += diffuseColor.rgb * ${o.selfGlow.toFixed(3)};` : ''}
          ${glowF}
          ${winF}
        }`);
  };
  return mat;
}

/** Free everything under `root`: geometries, materials and any texture they (or their uniforms) reference. */
export function disposeTree(root: THREE.Object3D) {
  const tex = new Set<THREE.Texture>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((x) => mats.add(x));
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture);
    const u = (m as THREE.ShaderMaterial).uniforms;
    if (u) for (const k of Object.keys(u)) { const v = u[k]?.value; if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture); }
    m.dispose();
  }
  for (const t of tex) t.dispose();
}

/** Small canvas texture helper (sRGB colour by default). */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fog for custom shader materials: the scene's exponential-squared fog, scaled per material (`k`). */
export const GLSL_FOG = /* glsl */`
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 c, float depth, float k) {
    float d = uFogDensity * k * depth;
    return mix(c, uFogColor, 1.0 - exp(-d * d));
  }
  float fogKeep(float depth, float k) { float d = uFogDensity * k * depth; return exp(-d * d); }
`;
