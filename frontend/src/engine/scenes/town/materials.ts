import * as THREE from 'three';

/**
 * Town materials. A handful of shared materials cover the whole town so geometry can be merged by material:
 * procedural surface detail (stone, wood, tiles, plaster, leaves) comes from a per-vertex `aKind` id evaluated in
 * the fragment shader, warm lantern light comes from one baked light map sampled by world xz (the "light pools"),
 * and every animation (wind, cloth, flicker) is a uniform-driven vertex or fragment effect.
 */

export type TownUniforms = {
  uTime: { value: number };
  /** Light map: sqrt-encoded warm lantern light over the town, sampled by world xz. */
  uLM: { value: THREE.Texture | null };
  /** Ambient occlusion on the ground (contact darkening under buildings, trees, benches). */
  uAO: { value: THREE.Texture | null };
  /** minX, minZ, size, strength of the light map. */
  uLMRect: { value: THREE.Vector4 };
  uMoonCol: { value: THREE.Color };
  /** Tileable noise atlas (see createNoiseTexture): fragment noise is sampled, not hashed. */
  uNoise: { value: THREE.Texture | null };
};

export function createTownUniforms(): TownUniforms {
  return {
    uTime: { value: 0 },
    uLM: { value: null },
    uAO: { value: null },
    uLMRect: { value: new THREE.Vector4(-20, -20, 40, 2.2) },
    uMoonCol: { value: new THREE.Color('#8fa8ff') },
    uNoise: { value: null },
  };
}

export const GLSL_NOISE = /* glsl */`
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 tHash2(vec2 p) { float n = tHash(p); return vec2(n, tHash(p + n + 17.17)); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = tHash(i), b = tHash(i + vec2(1.0, 0.0)), c = tHash(i + vec2(0.0, 1.0)), d = tHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float tNoise3(vec3 p) {
  float iz = floor(p.z), fz = fract(p.z); fz = fz * fz * (3.0 - 2.0 * fz);
  return mix(tNoise(p.xy + iz * vec2(37.0, 17.0)), tNoise(p.xy + (iz + 1.0) * vec2(37.0, 17.0)), fz);
}
float tFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * tNoise(p); p = p * 2.07 + vec2(17.1, 9.3); a *= 0.5; } return s; }
`;

/** Same functions as GLSL_NOISE, but value noise comes from the noise atlas (one fetch instead of four hashes). */
export const GLSL_NOISE_TEX = /* glsl */`
uniform sampler2D uNoise;
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 tHash2(vec2 p) { float n = tHash(p); return vec2(n, tHash(p + n + 17.17)); }
float tNoise(vec2 p) { return texture2D(uNoise, p * 0.125).r; }
float tNoise3(vec3 p) {
  float iz = floor(p.z), fz = fract(p.z); fz = fz * fz * (3.0 - 2.0 * fz);
  return mix(tNoise(p.xy + iz * vec2(3.7, 1.7)), tNoise(p.xy + (iz + 1.0) * vec2(3.7, 1.7)), fz);
}
float tFbm(vec2 p) { vec4 n = texture2D(uNoise, p * 0.125); return n.r * 0.62 + n.g * 0.38; }
// Voronoi from the atlas: x = distance to the cell edge (cell units), y = cell id, z = a second id
vec3 tVoronoi(vec2 p) { vec4 n = texture2D(uNoise, p * 0.125); return vec3(n.b * 0.5, n.a, fract(n.a * 7.31)); }
`;

const GLSL_FRAG_UTIL = /* glsl */`
uniform sampler2D uLM;
uniform sampler2D uAO;
uniform vec4 uLMRect;
uniform vec3 uMoonCol;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// Bump from an analytic height in world units (unnormalised screen derivatives keep the slope physical).
vec3 tBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - g);
}
vec2 tLMuv(vec3 wp) { return (wp.xz - uLMRect.xy) / uLMRect.z; }
// Warm lantern light at a world point: sqrt-encoded map, fading with height above the ground.
vec3 townLight(vec3 wp, vec3 wn) {
  vec2 uv = tLMuv(wp);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  vec3 l = texture2D(uLM, uv).rgb;
  float hf = exp(-max(wp.y - 0.2, 0.0) * 0.85);
  return l * l * uLMRect.w * hf * (0.4 + 0.6 * clamp(wn.y, 0.0, 1.0));
}
`;

const V_HEAD = /* glsl */`
uniform float uTime;
varying vec3 vTW;
varying vec3 vTN;
${GLSL_NOISE}
`;
const V_WORLD = /* glsl */`
{
  vec4 tWorld = vec4(transformed, 1.0);
  vec3 tObjN = normal;
  #ifdef USE_INSTANCING
    tWorld = instanceMatrix * tWorld;
    tObjN = mat3(instanceMatrix) * tObjN;
  #endif
  tWorld = modelMatrix * tWorld;
  vTW = tWorld.xyz;
  vTN = normalize(mat3(modelMatrix) * tObjN);
}
`;
const F_HEAD = /* glsl */`
uniform float uTime;
varying vec3 vTW;
varying vec3 vTN;
${GLSL_NOISE_TEX}
${GLSL_FRAG_UTIL}
`;

type Patch = {
  key: string;
  uniforms: Partial<TownUniforms> & Record<string, THREE.IUniform>;
  vHead?: string; vBegin?: string;
  fHead?: string; fColor?: string; fRough?: string; fNormal?: string; fEmissive?: string;
};

export function patchMaterial<M extends THREE.Material>(mat: M, p: Patch): M {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, p.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${V_HEAD}\n${p.vHead ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${p.vBegin ?? ''}\n${V_WORLD}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${F_HEAD}\n${p.fHead ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${p.fColor ?? ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${p.fRough ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${p.fNormal ?? ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${p.fEmissive ?? ''}`);
  };
  mat.customProgramCacheKey = () => p.key;
  return mat;
}

/**
 * Surface kinds for the static material (`aKind`):
 * 0 painted, 1 wood planks, 2 stone blocks, 3 roof tiles (uv: u along the eave, v down the slope, world units),
 * 4 plaster, 5 clipped hedge, 6 dark metal, 7 lacquer / glossy paint, 8 bark, 9 rough stone (lanterns, rocks).
 */
export const KIND = { paint: 0, wood: 1, stone: 2, tile: 3, plaster: 4, hedge: 5, metal: 6, gloss: 7, bark: 8, rock: 9 } as const;

export function createStaticMaterial(u: TownUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  return patchMaterial(m, {
    key: 'town-static',
    uniforms: u,
    vHead: 'attribute float aKind; varying float vKind; varying vec2 vTUv;',
    vBegin: 'vKind = aKind; vTUv = uv;',
    fHead: 'varying float vKind; varying vec2 vTUv; float tH; float tRough; float tMetal;',
    fColor: /* glsl */`
      tH = 0.0; tRough = 0.8; tMetal = 0.0;
      vec3 tAN = abs(vTN);
      vec2 tP = tAN.y > 0.7 ? vTW.xz : (tAN.x > tAN.z ? vTW.zy : vTW.xy);
      float tn1 = tNoise(tP * 5.3), tn2 = tNoise(tP * 23.7);
      float k = vKind;
      if (k < 0.5) {
        diffuseColor.rgb *= 0.92 + 0.12 * tn1; tH = tn2 * 0.0012; tRough = 0.62;
      } else if (k < 1.5) {
        float pl = fract(tP.x / 0.13 + 0.5);
        float seam = smoothstep(0.0, 0.07, pl) * smoothstep(1.0, 0.93, pl);
        float grain = tNoise(vec2(tP.x * 40.0, tP.y * 2.2)) * 0.6 + tNoise(vec2(tP.x * 90.0, tP.y * 5.0)) * 0.4;
        float plankTone = 0.82 + 0.3 * tHash(vec2(floor(tP.x / 0.13 + 0.5), 3.0));
        diffuseColor.rgb *= plankTone * (0.72 + 0.4 * grain) * mix(0.55, 1.0, seam);
        tH = seam * 0.004 + grain * 0.0015; tRough = 0.72;
      } else if (k < 2.5) {
        vec2 b = tP / vec2(0.34, 0.17);
        float row = floor(b.y); b.x += mod(row, 2.0) * 0.5;
        vec2 f = fract(b), id = floor(b);
        float e = min(min(f.x, 1.0 - f.x) * 0.34, min(f.y, 1.0 - f.y) * 0.17);
        float blk = smoothstep(0.004, 0.014, e);
        diffuseColor.rgb *= (0.78 + 0.34 * tHash(id)) * mix(0.5, 1.0, blk) * (0.88 + 0.2 * tn1);
        tH = blk * (0.008 + 0.004 * smoothstep(0.0, 0.05, e)) + tn2 * 0.002; tRough = 0.86;
      } else if (k < 3.5) {
        float u = vTUv.x / 0.14, v = vTUv.y / 0.16;
        float ridge = 0.5 + 0.5 * cos(fract(u) * 6.2831);
        float course = fract(v);
        float lap = smoothstep(0.0, 0.12, course);
        float tid = tHash(vec2(floor(u), floor(v)));
        diffuseColor.rgb *= (0.62 + 0.45 * pow(ridge, 0.7)) * (0.88 + 0.22 * tid) * mix(0.55, 1.0, lap);
        tH = ridge * 0.018 + (1.0 - course) * 0.01 * lap; tRough = 0.36 + 0.2 * tid;
      } else if (k < 4.5) {
        diffuseColor.rgb *= (0.95 + 0.07 * tn1) * mix(0.82, 1.0, smoothstep(0.2, 0.9, vTW.y));
        tH = tn2 * 0.001; tRough = 0.9;
      } else if (k < 5.5) {
        float l1 = tNoise3(vTW * 9.0), l2 = tNoise3(vTW * 23.0);
        float lf = l1 * 0.55 + l2 * 0.45;
        diffuseColor.rgb *= (0.55 + 0.7 * lf) * mix(0.7, 1.08, smoothstep(0.2, 1.2, vTW.y));
        tH = lf * 0.035; tRough = 0.95;
      } else if (k < 6.5) {
        diffuseColor.rgb *= 0.92 + 0.12 * tn2; tH = 0.0; tRough = 0.38; tMetal = 0.6;
      } else if (k < 7.5) {
        diffuseColor.rgb *= 0.96 + 0.06 * tn1; tRough = 0.24;
      } else if (k < 8.5) {
        float st = tNoise(vec2(tP.x * 18.0, tP.y * 2.5)) * 0.6 + tNoise(vec2(tP.x * 45.0, tP.y * 6.0)) * 0.4;
        diffuseColor.rgb *= 0.6 + 0.6 * st; tH = st * 0.012; tRough = 0.95;
      } else {
        float r1 = tNoise3(vTW * 6.0), r2 = tNoise3(vTW * 19.0);
        float moss = smoothstep(0.55, 0.8, tNoise3(vTW * 3.0 + 4.0)) * smoothstep(0.3, 0.9, vTN.y + 0.4);
        diffuseColor.rgb *= 0.75 + 0.45 * (r1 * 0.6 + r2 * 0.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.09, 0.03), moss * 0.7);
        tH = (r1 * 0.6 + r2 * 0.4) * 0.012; tRough = 0.92;
      }
    `,
    fRough: 'roughnessFactor = tRough; metalnessFactor = tMetal;',
    fNormal: 'normal = tBump(-vViewPosition, normal, vec2(dFdx(tH), dFdy(tH)), faceDirection);',
    fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * townLight(vTW, vTN);',
  });
}

/** The town floor: plaza rings with an inlaid medallion band, flagstone avenues, tiled forecourt, grass, raked gravel. */
export function createGroundMaterial(u: TownUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  return patchMaterial(m, {
    key: 'town-ground',
    uniforms: u,
    fHead: /* glsl */`
      float gH; float gRough; vec3 gGlow;
      float caustic(vec2 p, float t) {
        vec2 q = p * 2.6;
        float c = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          q += vec2(sin(q.y * 1.7 + t * 0.9 + fi), cos(q.x * 1.5 - t * 0.7 + fi * 2.0)) * 0.55;
          c += abs(sin(q.x + q.y));
        }
        return pow(1.0 - c / 3.0, 4.0);
      }
    `,
    fColor: /* glsl */`
      vec2 gp = vTW.xz;
      float gr = length(gp);
      float gang = atan(gp.y, gp.x);
      gH = 0.0; gRough = 0.95; gGlow = vec3(0.0);
      float wob = (tNoise(gp * 1.9) - 0.5) * 0.16;
      float dPave = sdSeg(gp, vec2(0.0, -5.0), vec2(0.0, -7.4)) - 1.6;
      dPave = min(dPave, sdSeg(gp, vec2(3.7, -3.7), vec2(80.0, -80.0)) - 1.2);
      dPave = min(dPave, sdSeg(gp, vec2(5.0, 0.3), vec2(7.6, 0.6)) - 1.0);
      dPave = min(dPave, max(abs(gr - 8.25) - 0.85, max(-0.6 - gang, gang - 0.8) * gr));
      dPave = min(dPave, sdSeg(gp, vec2(0.0, 5.0), vec2(0.0, 90.0)) - 1.35);
      dPave = min(dPave, sdSeg(gp, vec2(-5.0, 0.0), vec2(-7.4, 0.0)) - 1.0);
      float dFore = sdBox(gp - vec2(0.0, -8.35), vec2(5.0, 1.0));
      float dPlaza = gr - 5.6;
      float dGarden = length(vec2(gp.x + 9.9, gp.y * 0.85)) - 4.1;

      // grass: two tones of turf, clover patches, tiny pale flowers
      float gn = tFbm(gp * 0.42);
      float gn2 = tNoise(gp * 6.5), gn3 = tNoise(gp * 29.0);
      vec3 alb = mix(vec3(0.03, 0.062, 0.026), vec3(0.06, 0.11, 0.04), gn) * (0.8 + 0.35 * gn2) * (0.85 + 0.3 * gn3);
      float outer = smoothstep(13.2, 15.5, gr);
      alb = mix(alb, alb * vec3(0.8, 0.85, 0.9), outer);
      gH = gn3 * 0.012 + gn2 * 0.01;
      vec2 fc = floor(gp * 9.0); vec2 ff = fract(gp * 9.0) - 0.5;
      float fh = tHash(fc);
      float speck = step(0.965, fh) * smoothstep(0.16, 0.05, length(ff - (tHash2(fc + 3.0) - 0.5) * 0.5));
      alb = mix(alb, fh > 0.985 ? vec3(0.7, 0.55, 0.62) : vec3(0.7, 0.7, 0.55), speck * (1.0 - outer));

      // raked gravel of the shrine garden: ripples around the stage and the pond
      float aaG = fwidth(dGarden);
      float mG = 1.0 - smoothstep(-aaG, aaG, dGarden + wob);
      if (mG > 0.0) {
        float dd = min(length(gp - vec2(-9.8, 0.0)) - 1.15, length((gp - vec2(-9.0, -3.9)) * vec2(0.8, 1.0)) - 1.45);
        float rip = 0.5 + 0.5 * sin(dd * 6.2831 / 0.075);
        float peb = tNoise(gp * 55.0) * 0.6 + tNoise(gp * 140.0) * 0.4;
        vec3 grav = vec3(0.30, 0.29, 0.27) * (0.8 + 0.25 * rip) * (0.82 + 0.3 * peb);
        alb = mix(alb, grav, mG);
        gH = mix(gH, rip * 0.008 + peb * 0.004, mG);
        gRough = mix(gRough, 0.92, mG);
      }

      // flagstone avenues with mossy joints and a soft grass edge
      float dP = min(dPave, dFore);
      float aaP = fwidth(dP);
      float mP = 1.0 - smoothstep(-aaP, aaP, dP + wob * step(0.0, dFore - 0.01));
      if (mP > 0.0) {
        vec3 pa; float ph; float pr;
        if (dFore < 0.02) {
          vec2 tq = gp / 0.5; vec2 f = fract(tq), id = floor(tq);
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.5;
          float t = smoothstep(0.004, 0.012, e);
          float runner = 1.0 - smoothstep(0.58, 0.6, abs(gp.x));
          vec3 tile = mix(vec3(0.42, 0.42, 0.44), vec3(0.5, 0.5, 0.52), tHash(id));
          tile = mix(tile, vec3(0.32, 0.03, 0.04), runner);
          pa = mix(vec3(0.07), tile * (0.9 + 0.12 * tNoise(gp * 7.0)), t);
          ph = t * 0.004; pr = mix(0.9, 0.3 + 0.12 * tHash(id), t);
        } else {
          vec3 vor = tVoronoi(gp * 3.1);
          float e = vor.x / 3.1;
          float st = smoothstep(0.006, 0.022, e);
          vec3 sc = mix(vec3(0.13, 0.14, 0.16), vec3(0.22, 0.2, 0.18), vor.y) * (0.82 + 0.28 * tNoise(gp * 11.0 + vor.z * 9.0));
          vec3 joint = mix(vec3(0.03, 0.035, 0.03), vec3(0.03, 0.06, 0.02), smoothstep(0.3, 0.7, tNoise(gp * 4.0)));
          pa = mix(joint, sc, st);
          ph = st * (0.01 + 0.008 * smoothstep(0.0, 0.08, e)) + tNoise(gp * 31.0) * 0.003;
          pr = mix(0.95, 0.62 - 0.2 * vor.z, st);
        }
        float edge = smoothstep(-0.12, 0.0, dP) * step(0.0, dFore - 0.01);
        pa *= 1.0 - edge * 0.45;
        alb = mix(alb, pa, mP); gH = mix(gH, ph, mP); gRough = mix(gRough, pr, mP);
      }

      // plaza: concentric stone courses, a medallion band around the fountain, a dark curb with light dots
      float aaPl = fwidth(dPlaza);
      float mPl = 1.0 - smoothstep(-aaPl, aaPl, dPlaza);
      if (mPl > 0.0) {
        float r0 = 1.6, rw = 0.34;
        float ri = floor((gr - r0) / rw);
        float circ = 6.2831 * (r0 + (ri + 0.5) * rw);
        float segN = floor(circ / 0.4);
        float a01 = gang / 6.2831 + 0.5 + tHash(vec2(ri, 7.0));
        float fa = fract(a01 * segN), fr = fract((gr - r0) / rw);
        float e = min(min(fr, 1.0 - fr) * rw, min(fa, 1.0 - fa) * circ / segN);
        vec2 id = vec2(ri, floor(a01 * segN));
        float st = smoothstep(0.004, 0.013, e);
        // eight dark rays of a compass rose between the paths
        float ray = abs(fract((gang + 0.3927) / 0.7854) - 0.5) * gr;
        float rose = (1.0 - smoothstep(0.08, 0.1, ray - (5.4 - gr) * 0.06)) * step(3.05, gr) * step(gr, 5.25);
        vec3 pc = mix(vec3(0.27, 0.25, 0.23), vec3(0.37, 0.35, 0.32), tHash(id)) * (0.86 + 0.22 * tNoise(gp * 8.0));
        pc = mix(pc, vec3(0.1, 0.12, 0.2), rose * 0.85);
        vec3 pl = mix(vec3(0.06), pc, st);
        float plh = st * 0.007 + tNoise(gp * 27.0) * 0.002;
        float plr = mix(0.9, 0.55 - 0.15 * tHash(id + 2.0), st);

        // medallion band 2.3 .. 2.95: deep blue inlay, gold edges, eight ball medallions with glowing buttons
        float band = step(2.3, gr) * step(gr, 2.95);
        if (band > 0.0) {
          pl = vec3(0.025, 0.04, 0.1) * (0.85 + 0.3 * tNoise(gp * 14.0)); plh = 0.004; plr = 0.22;
          float k = floor((gang - 0.3927) / 0.7854 + 0.5);
          float a = k * 0.7854 + 0.3927;
          vec2 o = vec2(cos(a), sin(a)); vec2 q = gp - o * 2.625;
          float d = length(q);
          if (d < 0.27) {
            float s = dot(q, o);
            vec3 ball = s > 0.0 ? vec3(0.45, 0.02, 0.03) : vec3(0.72, 0.7, 0.66);
            ball *= mix(1.0, 0.25, 1.0 - smoothstep(0.022, 0.03, abs(s)));
            ball = mix(ball, vec3(0.75, 0.73, 0.7), 1.0 - smoothstep(0.075, 0.085, d));
            ball = mix(ball, vec3(0.05), (1.0 - smoothstep(0.05, 0.058, d)) * smoothstep(0.04, 0.05, d));
            gGlow += vec3(0.25, 1.6, 2.2) * (1.0 - smoothstep(0.03, 0.045, d)) * (0.8 + 0.2 * sin(uTime * 2.0 + k));
            pl = mix(pl, ball, 1.0 - smoothstep(0.24, 0.255, d));
            pl = mix(pl, vec3(0.6, 0.42, 0.1), smoothstep(0.24, 0.255, d));
            plh = 0.006 * (1.0 - smoothstep(0.24, 0.27, d)); plr = 0.3;
          }
          float gold = max(1.0 - smoothstep(0.012, 0.02, abs(gr - 2.31)), 1.0 - smoothstep(0.012, 0.02, abs(gr - 2.94)));
          pl = mix(pl, vec3(0.62, 0.43, 0.1), gold); plr = mix(plr, 0.28, gold);
          gGlow += vec3(0.05, 0.25, 0.4) * gold * 0.15;
        }
        // curb ring 5.3 .. 5.6 with warm light dots
        float curb = smoothstep(5.28, 5.3, gr);
        if (curb > 0.0) {
          float seg = abs(fract(gang / 6.2831 * 48.0) - 0.5);
          vec3 cc = vec3(0.06, 0.065, 0.075) * (0.8 + 0.3 * tNoise(gp * 12.0));
          cc *= mix(0.4, 1.0, smoothstep(0.0, 0.02, seg));
          pl = mix(pl, cc, curb); plh = mix(plh, 0.012 * smoothstep(0.0, 0.03, seg), curb); plr = mix(plr, 0.5, curb);
          vec2 dq = vec2(fract(gang / 6.2831 * 24.0) - 0.5, (gr - 5.45) / (6.2831 * 5.45 / 24.0));
          float dot0 = length(dq * vec2(1.0, 1.0)) * 6.2831 * 5.45 / 24.0;
          gGlow += vec3(2.4, 1.8, 1.0) * (1.0 - smoothstep(0.02, 0.035, dot0)) * curb;
        }
        // damp, glossy stone around the basin
        float wet = (1.0 - smoothstep(1.7, 2.15, gr + tNoise(gp * 3.0) * 0.4));
        pl *= 1.0 - wet * 0.45; plr = mix(plr, 0.12, wet);
        alb = mix(alb, pl, mPl); gH = mix(gH, plh, mPl); gRough = mix(gRough, plr, mPl);
        // caustic shimmer thrown by the fountain
        float cf = smoothstep(1.55, 1.75, gr) * (1.0 - smoothstep(1.8, 2.6, gr));
        if (cf > 0.0) gGlow += vec3(0.25, 0.75, 1.0) * caustic(gp, uTime) * cf * 0.9;
      }
      vec2 auv = tLMuv(vTW);
      float ao = (auv.x > 0.0 && auv.y > 0.0 && auv.x < 1.0 && auv.y < 1.0) ? texture2D(uAO, auv).r : 1.0;
      diffuseColor.rgb = alb * ao;
    `,
    fRough: 'roughnessFactor = gRough;',
    fNormal: 'normal = tBump(-vViewPosition, normal, vec2(dFdx(gH), dFdy(gH)), faceDirection);',
    fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * townLight(vTW, vec3(0.0, 1.0, 0.0)) + gGlow;',
  });
}

/** Tree canopies and bushes: noisy leaf clumps, wind sway (aWind = weight, phase), moonlit rim. */
export function createFoliageMaterial(u: TownUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  return patchMaterial(m, {
    key: 'town-foliage',
    uniforms: u,
    vHead: 'attribute vec2 aWind;',
    vBegin: /* glsl */`
      {
        float ph = aWind.y;
        #ifdef USE_INSTANCING
          ph += instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        #endif
        float gust = 0.65 + 0.35 * sin(uTime * 0.31 + ph * 0.2);
        float w = aWind.x * gust;
        transformed.x += (sin(uTime * 1.05 + ph) * 0.045 + sin(uTime * 2.6 + ph * 1.7 + position.y * 3.0) * 0.012) * w;
        transformed.z += (cos(uTime * 0.87 + ph * 1.3) * 0.035 + cos(uTime * 3.1 + position.x * 4.0) * 0.01) * w;
        transformed.y += sin(uTime * 1.7 + ph + position.x * 2.0) * 0.008 * w;
      }
    `,
    fHead: 'float fH;',
    fColor: /* glsl */`
      float l1 = tNoise3(vTW * 5.0), l2 = tNoise3(vTW * 13.0 + 3.0);
      float lf = l1 * 0.55 + l2 * 0.45;
      diffuseColor.rgb *= 0.55 + 0.75 * lf;
      fH = lf * 0.05;
    `,
    fRough: '',
    fNormal: 'normal = tBump(-vViewPosition, normal, vec2(dFdx(fH), dFdy(fH)), faceDirection);',
    fEmissive: /* glsl */`
      float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * (townLight(vTW, vTN) * 0.8 + uMoonCol * rim * 0.45 + uMoonCol * 0.05);
    `,
  });
}

/** Flower and grass cards (instanced crossed quads, atlas map, alpha cut-out), swaying at the top. */
export function createCardMaterial(u: TownUniforms, map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  return patchMaterial(m, {
    key: 'town-cards',
    uniforms: u,
    vHead: 'attribute vec2 iCell;',
    vBegin: /* glsl */`
      vMapUv = uv * 0.5 + iCell;
      {
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.91;
        #endif
        float w = uv.y * uv.y;
        transformed.x += (sin(uTime * 1.6 + ph) * 0.03 + sin(uTime * 4.1 + ph * 2.0) * 0.008) * w;
        transformed.z += cos(uTime * 1.3 + ph * 1.2) * 0.025 * w;
      }
    `,
    fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * (townLight(vTW, vec3(0.0, 1.0, 0.0)) + uMoonCol * 0.06);',
  });
}

/** Noren curtains and banners: atlas map, gentle sway (aSway = direction xyz, weight). */
export function createClothMaterial(u: TownUniforms, map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.85 });
  return patchMaterial(m, {
    key: 'town-cloth',
    uniforms: u,
    vHead: 'attribute vec4 aSway;',
    vBegin: /* glsl */`
      {
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        float s = sin(uTime * 1.5 + wp0.x * 0.8 + wp0.z * 0.6) * 0.7 + sin(uTime * 2.7 + wp0.x * 2.0 + wp0.y) * 0.3;
        transformed += aSway.xyz * aSway.w * s * 0.045;
      }
    `,
    fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * (townLight(vTW, vTN) * 1.3 + vec3(0.02, 0.02, 0.03));',
  });
}

/** Glowing parts (paper lanterns, lamp glass, light strips): vertex colour in HDR, optional flicker (aFlick). */
export function createEmissiveMaterial(u: TownUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  return patchMaterial(m, {
    key: 'town-emissive',
    uniforms: u,
    vHead: 'attribute float aFlick; varying float vFlick;',
    vBegin: 'vFlick = aFlick;',
    fHead: 'varying float vFlick;',
    fColor: 'diffuseColor.rgb *= 1.0 + vFlick * (tNoise(vec2(uTime * 5.0, vTW.x * 3.1 + vTW.z * 1.7)) - 0.5) * 0.5;',
  });
}
