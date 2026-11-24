import * as THREE from 'three';
import { GLSL_NOISE, type TownUniforms } from './materials.js';
import { SKY } from './sky.js';

const FOG_PARS_V = /* glsl */`
uniform float uFogDensity;
varying float vFogA;
`;

/**
 * Lit windows and glass doors: a fake interior drawn in the fragment shader (no textures).
 * aWin = (cols, rows, style, seed); style 0 shop or hall interior, 1 paper lattice, 2 sliding glass doors.
 */
export function createWindowMaterial(u: TownUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: u.uTime },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute vec4 aWin;
      varying vec2 vUv; varying vec3 vCol; varying vec4 vWin;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vCol = color; vWin = aWin;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv; varying vec3 vCol; varying vec4 vWin;
      ${GLSL_NOISE}
      #include <fog_pars_fragment>
      vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.66, 0.33)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        vec2 uv = vUv;
        float cols = vWin.x, rows = vWin.y, style = vWin.z, seed = vWin.w;
        vec3 col;
        vec2 g = fract(uv * vec2(cols, rows));
        vec2 gw = fwidth(uv * vec2(cols, rows));
        float bw = style > 0.5 && style < 1.5 ? 0.09 : 0.05;
        float bar = 1.0 - smoothstep(bw, bw + gw.x * 1.5, min(g.x, 1.0 - g.x));
        bar = max(bar, 1.0 - smoothstep(bw, bw + gw.y * 1.5, min(g.y, 1.0 - g.y)));
        if (style < 0.5) {
          vec3 wall = mix(vec3(0.75, 0.5, 0.3), vec3(1.25, 1.0, 0.75), uv.y) * vCol;
          float sy = uv.y * 3.0;
          float shelf = fract(sy);
          vec2 cell = vec2(floor(uv.x * 6.0 + seed * 7.0), floor(sy));
          float item = step(0.3, tHash(cell + seed)) * step(0.18, shelf) * step(shelf, 0.72) * step(uv.y, 0.7);
          vec3 ic = mix(vec3(0.8), hue(tHash(cell + seed + 1.0)), 0.55) * 0.9;
          col = mix(wall, ic, item * 0.9);
          col *= mix(0.35, 1.0, smoothstep(0.0, 0.1, shelf)) * mix(1.0, 0.75, step(uv.y, 0.7));
          col += vec3(1.8, 1.7, 1.5) * smoothstep(0.86, 0.96, uv.y);
          col = mix(col, vec3(0.04, 0.05, 0.07), bar);
          col += vec3(0.25, 0.32, 0.5) * smoothstep(0.05, 0.0, abs(uv.x - uv.y * 0.6 - 0.25)) * 0.5;
        } else if (style < 1.5) {
          float pn = tNoise(uv * vec2(cols, rows) * 3.0 + seed * 13.0);
          col = vCol * (1.55 + 0.5 * pn) * (0.7 + 0.3 * smoothstep(0.0, 0.6, uv.y));
          col *= 0.92 + 0.08 * sin(uTime * 3.0 + seed * 20.0) * sin(uTime * 7.3 + seed);
          col = mix(col, vec3(0.06, 0.035, 0.02), bar);
        } else {
          // two sliding glass panels opening onto a bright hall with a red counter at the back
          vec3 hall = mix(vec3(0.9, 0.72, 0.52), vec3(1.5, 1.35, 1.15), smoothstep(0.1, 0.9, uv.y)) * vCol;
          float counter = step(0.22, uv.y) * step(uv.y, 0.38) * step(0.22, uv.x) * step(uv.x, 0.78);
          hall = mix(hall, vec3(1.2, 0.08, 0.1), counter);
          hall = mix(hall, vec3(1.6, 1.5, 1.35), step(0.38, uv.y) * step(uv.y, 0.41) * step(0.22, uv.x) * step(uv.x, 0.78));
          hall *= mix(0.55, 1.0, smoothstep(0.0, 0.22, uv.y));
          float split = 1.0 - smoothstep(0.012, 0.02, abs(uv.x - 0.5));
          float frame = max(split, max(1.0 - smoothstep(0.02, 0.03, min(uv.x, 1.0 - uv.x)), 1.0 - smoothstep(0.02, 0.03, 1.0 - uv.y)));
          col = mix(hall, vec3(0.6, 0.62, 0.66), frame);
          col += vec3(0.35, 0.45, 0.7) * smoothstep(0.04, 0.0, abs(fract(uv.x * 2.0) - uv.y * 0.5 - 0.3)) * 0.35;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** Water: basin surfaces (kind 0), falling sheets (1), garden pond with koi (2). Fresnel sky, moon glint, caustic glow. */
export function createWaterMaterial(u: TownUniforms, pondCentre: THREE.Vector2): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMoonDir: { value: SKY.moonDir.clone() },
      uSkyLo: { value: SKY.horizon.clone() }, uSkyHi: { value: SKY.mid.clone() },
      uPond: { value: pondCentre },
    }]),
    vertexShader: /* glsl */`
      attribute float aW;
      varying vec3 vW; varying vec2 vUv; varying float vK;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vK = aW;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoonDir, uSkyLo, uSkyHi; uniform vec2 uPond;
      uniform sampler2D uLM; uniform vec4 uLMRect;
      varying vec3 vW; varying vec2 vUv; varying float vK;
      ${GLSL_NOISE}
      #include <fog_pars_fragment>
      float caustic(vec2 p, float t) {
        vec2 q = p * 3.0; float c = 0.0;
        for (int i = 0; i < 3; i++) { float fi = float(i); q += vec2(sin(q.y * 1.7 + t * 0.9 + fi), cos(q.x * 1.5 - t * 0.7 + fi * 2.0)) * 0.55; c += abs(sin(q.x + q.y)); }
        return pow(1.0 - c / 3.0, 4.0);
      }
      float hgt(vec2 p, float t) {
        float h = tNoise(p * 3.0 + vec2(t * 0.35, t * 0.2)) * 0.6 + tNoise(p * 7.0 - vec2(t * 0.5, -t * 0.3)) * 0.4;
        if (vK < 0.5) { float r = length(p - vec2(0.0)); h += sin(r * 26.0 - t * 4.5) * 0.25 * smoothstep(1.6, 0.4, r); }
        return h;
      }
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 col; float alpha;
        if (vK > 0.5 && vK < 1.5) {
          float s = tNoise(vec2(vUv.x * 70.0, vUv.y * 3.0 + uTime * 3.2)) * 0.6 + tNoise(vec2(vUv.x * 160.0, vUv.y * 7.0 + uTime * 4.6)) * 0.4;
          col = vec3(0.35, 0.75, 1.0) * (0.35 + 1.5 * s * s);
          col += vec3(1.2, 1.5, 1.6) * (1.0 - smoothstep(0.0, 0.18, vUv.y)) * s;
          alpha = 0.18 + 0.5 * s;
        } else {
          vec2 p = vW.xz; float t = uTime;
          float e = 0.02;
          float h0 = hgt(p, t);
          vec2 grad = vec2(hgt(p + vec2(e, 0.0), t) - h0, hgt(p + vec2(0.0, e), t) - h0) / e;
          vec3 N = normalize(vec3(-grad.x * 0.03, 1.0, -grad.y * 0.03));
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 skyRef = mix(uSkyLo, uSkyHi, smoothstep(0.0, 0.5, R.y)) * 1.4;
          float spec = pow(max(dot(R, uMoonDir), 0.0), 400.0) * 8.0;
          vec3 deep;
          if (vK < 0.5) {
            deep = vec3(0.01, 0.07, 0.1) + vec3(0.12, 0.6, 0.85) * caustic(p + grad * 0.02, t) * 0.9;
            deep += vec3(0.05, 0.35, 0.55) * smoothstep(0.6, 1.5, length(p)) * 0.6;
          } else {
            deep = vec3(0.008, 0.03, 0.035);
            for (int i = 0; i < 5; i++) {
              float fi = float(i);
              float w = 0.22 + fi * 0.04;
              vec2 c0 = uPond + vec2(cos(t * w + fi * 1.9) * (0.95 - fi * 0.08), sin(t * w * 1.37 + fi * 2.3) * 0.5);
              vec2 c1 = uPond + vec2(cos((t - 0.3) * w + fi * 1.9) * (0.95 - fi * 0.08), sin((t - 0.3) * w * 1.37 + fi * 2.3) * 0.5);
              vec2 dir = normalize(c0 - c1 + 1e-4);
              vec2 q = p - c0; vec2 lq = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
              lq.y += sin(lq.x * 18.0 - t * 6.0) * 0.015;
              float body = 1.0 - smoothstep(0.8, 1.0, length(lq / vec2(0.16, 0.05)));
              float tail = (1.0 - smoothstep(0.8, 1.0, length((lq + vec2(0.17, 0.0)) / vec2(0.05, 0.045))));
              vec3 kc = mod(fi, 2.0) < 0.5 ? vec3(0.9, 0.25, 0.05) : vec3(0.85, 0.82, 0.78);
              kc = mix(kc, vec3(0.9, 0.2, 0.05), step(0.5, tNoise(lq * 30.0 + fi * 9.0)) * step(0.5, mod(fi, 2.0)));
              deep = mix(deep, kc * 0.32, max(body, tail) * 0.9);
            }
          }
          vec2 luv = (vW.xz - uLMRect.xy) / uLMRect.z;
          vec3 lm = texture2D(uLM, clamp(luv, 0.0, 1.0)).rgb;
          vec3 glints = lm * lm * uLMRect.w * (0.25 + 0.75 * smoothstep(0.55, 0.9, tNoise(p * 9.0 + t * 0.8)));
          col = mix(deep, skyRef, fres) + spec + glints * 0.35;
          alpha = mix(0.86, 0.97, fres);
        }
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = u.uTime; m.uniforms.uLM = u.uLM as THREE.IUniform; m.uniforms.uLMRect = u.uLMRect;
  return m;
}

/** Stadium gate portal: swirling light inside an arch (shape space: x in [-w, w], y in [0, h], arch radius w). */
export function createPortalMaterial(time: { value: number }, w: number, h: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: time, uW: { value: w }, uH: { value: h } },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uW, uH; varying vec2 vP;
      ${GLSL_NOISE}
      void main() {
        float rect = uH - uW;
        vec2 p = vP;
        float d = p.y < rect ? uW - abs(p.x) : uW - length(p - vec2(0.0, rect));
        d = min(d, p.y);
        vec2 c = p - vec2(0.0, rect * 0.75);
        float r = length(c), a = atan(c.y, c.x);
        float sw = tNoise(vec2(a * 2.0 + r * 2.2 - uTime * 0.9, r * 3.0 - uTime * 0.6)) * 0.6 + tNoise(vec2(a * 5.0 - uTime * 1.3, r * 6.0)) * 0.4;
        float edge = exp(-d * 7.0) * 1.6;
        float body = (0.1 + 0.35 * sw * sw) * smoothstep(0.0, 0.5, d);
        float floorGlow = exp(-p.y * 4.0) * 0.4;
        vec3 col = vec3(0.25, 0.75, 1.0) * (edge + body + floorGlow) + vec3(1.0) * pow(sw, 6.0) * 0.6 * smoothstep(0.1, 0.8, d);
        col += vec3(1.0, 0.25, 0.3) * pow(tNoise(vec2(a * 8.0 + uTime, r * 10.0 - uTime * 2.0)), 8.0) * 0.8;
        gl_FragColor = vec4(col * 0.9, 1.0);
      }`,
  });
}

export type FxMode = 'halo' | 'firefly' | 'petal' | 'spray';
const MODE_ID: Record<FxMode, number> = { halo: 0, firefly: 1, petal: 2, spray: 3 };

/**
 * Camera-facing instanced quads for glows and particles, animated entirely in the vertex shader.
 * Per instance: iPos (anchor), iCol (HDR colour), iData (size, phase, a, b):
 * halo a = flicker, b = core strength; firefly a = wander radius; petal b = fall height; spray a = radial speed, b = up speed.
 */
export function createFx(mode: FxMode, u: TownUniforms, fogDensity: { value: number }, items: Array<{ pos: THREE.Vector3; col: THREE.Color; data: [number, number, number, number] }>): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const n = items.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), dat = new Float32Array(n * 4);
  items.forEach((it, i) => {
    pos.set([it.pos.x, it.pos.y, it.pos.z], i * 3);
    col.set([it.col.r, it.col.g, it.col.b], i * 3);
    dat.set(it.data, i * 4);
  });
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 3));
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(dat, 4));
  g.instanceCount = n;
  const petal = mode === 'petal';
  const m = new THREE.ShaderMaterial({
    transparent: !petal, depthWrite: petal, blending: petal ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false,
    side: THREE.DoubleSide,
    defines: { MODE: MODE_ID[mode] },
    uniforms: { uTime: u.uTime, uLM: u.uLM as THREE.IUniform, uLMRect: u.uLMRect, uFogDensity: fogDensity },
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec3 iCol; attribute vec4 iData;
      uniform float uTime; uniform sampler2D uLM; uniform vec4 uLMRect;
      varying vec2 vQ; varying vec3 vC; varying float vA; varying float vB;
      ${FOG_PARS_V}
      void main() {
        vec3 p = iPos; float size = iData.x, ph = iData.y; vA = 1.0; vC = iCol; vB = iData.w;
        #if MODE == 0
          vA = 1.0 + iData.z * (sin(uTime * (5.0 + ph * 3.0) + ph * 40.0) * 0.5 + sin(uTime * 11.0 + ph * 17.0) * 0.3) * 0.3;
        #elif MODE == 1
          float wr = iData.z;
          p += vec3(sin(uTime * 0.23 * (1.0 + ph) + ph * 6.0) * wr, sin(uTime * 0.41 + ph * 4.0) * 0.25, cos(uTime * 0.19 * (1.0 + ph) + ph * 3.0) * wr);
          vA = smoothstep(0.1, 1.0, sin(uTime * (0.7 + ph) + ph * 20.0));
        #elif MODE == 2
          float life = fract(uTime * 0.055 * (0.7 + ph * 0.6) + ph * 13.0);
          float fall = min(life / 0.8, 1.0);
          p.y = max(iPos.y - fall * iData.w, 0.215);
          p.x += fall * 2.4 + sin(fall * 14.0 + ph * 30.0) * 0.28;
          p.z += fall * 0.9 + cos(fall * 11.0 + ph * 20.0) * 0.22;
          vA = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.88, 1.0, life));
          vec2 luv = (p.xz - uLMRect.xy) / uLMRect.z;
          vec3 lm = texture2D(uLM, clamp(luv, 0.0, 1.0)).rgb;
          vC = iCol * (0.16 + lm * lm * uLMRect.w * 0.6);
        #else
          float T = 0.96;
          float life = fract(uTime / T * (0.92 + fract(ph * 7.0) * 0.16) + ph * 31.0);
          float jet = floor(ph * 8.0);
          float a = jet / 8.0 * 6.2831 + (fract(ph * 53.0) - 0.5) * 0.08 + 0.3927;
          float tt = life * T;
          vec3 v0 = vec3(cos(a) * iData.z, iData.w, sin(a) * iData.z);
          p = iPos + vec3(cos(a), 0.0, sin(a)) * 0.22 + v0 * tt + vec3(0.0, -2.88 * tt * tt, 0.0);
          vA = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vA *= smoothstep(0.35, 1.6, dist); // a glow right at the lens would flood the frame
        float s = max(size, dist * 0.0022);
        vec2 q = position.xy;
        #if MODE == 2
          float ang = uTime * (1.2 + ph * 2.0) + ph * 40.0;
          q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
          q.x *= 0.35 + 0.65 * abs(sin(uTime * 1.7 + ph * 9.0));
        #endif
        mv.xy += q * s;
        vQ = position.xy * 2.0;
        vFogA = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ; varying vec3 vC; varying float vA; varying float vB; varying float vFogA;
      void main() {
        float d2 = dot(vQ, vQ);
        #if MODE == 2
          vec2 q = vQ * vec2(1.0, 1.5);
          float m = 1.0 - smoothstep(0.85, 1.0, length(q)) ;
          m *= smoothstep(0.0, 0.25, length(vQ - vec2(0.0, 1.05)));
          if (m * vA < 0.5) discard;
          gl_FragColor = vec4(mix(vC, vec3(0.03, 0.05, 0.1), vFogA), 1.0);
        #else
          if (d2 > 1.0) discard;
          #if MODE == 0
            float core = exp(-d2 * 30.0);
            float halo = exp(-d2 * 4.0) * (1.0 - d2);
            vec3 c = vC * (halo * 0.32 + core * vB);
          #else
            float core = exp(-d2 * 14.0);
            float halo = exp(-d2 * 3.0) * (1.0 - d2) * 0.25;
            vec3 c = vC * (core + halo);
          #endif
          gl_FragColor = vec4(c * vA * (1.0 - vFogA), 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
