import * as THREE from 'three';
import { GLSL_NOISE, GLSL_NOISE_TEX } from './materials.js';

/**
 * The night over the town: navy gradient, moon with a halo, two layers of twinkling stars, a faint galactic band,
 * slow moonlit clouds, a warm glow of the town on the horizon and the stadium's light dome to the north-east.
 * One draw call. Its horizon colour is the fog colour so the ground melts into the sky.
 */
export const SKY = {
  top: new THREE.Color('#03050d'),
  mid: new THREE.Color('#0a1530'),
  horizon: new THREE.Color('#1a2a52'),
  moonDir: new THREE.Vector3(-0.42, 0.42, -0.8).normalize(),
  stadiumDir: new THREE.Vector3(1, 0, -1).normalize(),
};

export function createTownSky(noise: THREE.Texture): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uNoise: { value: noise },
      uMoonDir: { value: SKY.moonDir.clone() },
      uTop: { value: SKY.top }, uMid: { value: SKY.mid }, uHorizon: { value: SKY.horizon },
      uGlowDir: { value: SKY.stadiumDir.clone() },
      uGlowCol: { value: new THREE.Color('#4f8cff') },
      uTownCol: { value: new THREE.Color('#6a4a52') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoonDir, uTop, uMid, uHorizon, uGlowDir, uGlowCol, uTownCol;
      varying vec3 vDir;
      ${GLSL_NOISE_TEX}
      float star(vec3 d, float scale, float density, float size) {
        vec3 c = floor(d * scale);
        float s = tHash(c.xy + c.z * 17.13);
        float on = step(1.0 - density, s);
        vec3 f = fract(d * scale) - 0.5;
        vec3 o = (vec3(tHash(c.yz), tHash(c.zx), tHash(c.xy + 3.0)) - 0.5) * 0.5;
        float tw = 0.6 + 0.4 * sin(uTime * (0.7 + s * 3.0) + s * 60.0);
        return on * smoothstep(size, 0.0, length(f - o)) * tw * (0.4 + 0.6 * fract(s * 91.0));
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
        col = mix(col, uTop, smoothstep(0.2, 0.85, h));
        // galactic band
        vec3 nb = normalize(vec3(0.42, 0.3, 0.86));
        float band = exp(-pow(dot(d, nb) / 0.2, 2.0));
        float bn = tFbm(vec2(atan(d.z, d.x) * 4.0, d.y * 7.0)) * tFbm(vec2(atan(d.z, d.x) * 9.0 + 3.0, d.y * 15.0));
        col += vec3(0.05, 0.06, 0.12) * band * bn * 2.2 * smoothstep(0.05, 0.4, h);
        // stars
        float st = star(d, 150.0, 0.028, 0.32) * 1.2 + star(d, 330.0, 0.05, 0.38) * 0.45 + band * star(d, 520.0, 0.12, 0.4) * 0.5;
        st *= smoothstep(0.03, 0.35, h);
        // clouds: a moving fbm sheet over a dome, lit from the moon side
        vec2 cuv = d.xz / (h + 0.18) * 1.1 + vec2(uTime * 0.0045, uTime * 0.0015);
        float cl = tFbm(cuv * 1.3) * 0.75 + tFbm(cuv * 3.7 + 7.0) * 0.25;
        float cov = smoothstep(0.5, 0.74, cl) * smoothstep(0.02, 0.22, h) * (1.0 - smoothstep(0.75, 0.98, h));
        float m = dot(d, uMoonDir);
        float near = pow(max(m, 0.0), 8.0);
        vec3 cloudCol = mix(uMid * 1.25, vec3(0.2, 0.24, 0.38), 0.2 + 0.8 * near);
        float lining = (1.0 - smoothstep(0.62, 0.8, cl)) * cov * near;
        col = mix(col, cloudCol, cov * 0.88) + vec3(0.35, 0.42, 0.7) * lining * 0.6;
        col += vec3(0.82, 0.88, 1.0) * st * (1.0 - cov);
        // moon: disc with soft maria, a tight bright halo and a wide faint one
        vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec3 mb = cross(mt, uMoonDir);
        vec2 mp = vec2(dot(d, mt), dot(d, mb)) / 0.034;
        float disc = 1.0 - smoothstep(0.92, 1.0, length(mp));
        float maria = tNoise(mp * 2.4 + 3.0) * 0.6 + tNoise(mp * 6.0) * 0.4;
        vec3 moon = vec3(1.55, 1.6, 1.7) * (0.78 + 0.3 * smoothstep(0.35, 0.7, maria)) * (1.0 - 0.25 * dot(mp, mp));
        col = mix(col, moon, disc * (1.0 - cov * 0.7));
        col += vec3(0.45, 0.55, 0.95) * pow(max(m, 0.0), 900.0) * 0.6;
        col += vec3(0.25, 0.33, 0.7) * pow(max(m, 0.0), 40.0) * 0.16;
        // horizon glows: the town all around, the stadium to the north-east
        vec3 flatD = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
        float az = max(dot(flatD, uGlowDir), 0.0);
        col += uGlowCol * pow(az, 12.0) * exp(-max(h, 0.0) * 6.0) * 0.55;
        col += uTownCol * exp(-max(h, 0.0) * 16.0) * 0.28;
        col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.12, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}

/** Shared material for far silhouettes (hills, the stadium): own soft fog so distant lights still read. */
export function createFarMaterial(fogColor: THREE.Color, time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uFog: { value: fogColor }, uTime: time, uCentre: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute float aKind;
      varying vec3 vCol; varying float vKind; varying vec3 vW; varying float vDist;
      void main() {
        vCol = color; vKind = aKind;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mv = viewMatrix * w; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFog; uniform float uTime;
      varying vec3 vCol; varying float vKind; varying vec3 vW; varying float vDist;
      ${GLSL_NOISE}
      void main() {
        vec3 col = vCol;
        float fogK = 0.0105;
        if (vKind < 0.5) {
          // hills: darker toward the crest, sparse house lights low on the slopes
          vec2 c = vec2(atan(vW.z, vW.x) * 260.0, vW.y * 1.6);
          vec2 ci = floor(c); vec2 f = fract(c) - 0.5;
          float on = step(0.93, tHash(ci)) * smoothstep(14.0, 2.0, vW.y);
          col *= 0.75 + 0.25 * tNoise(vW.xz * 0.05);
          col += vec3(2.2, 1.3, 0.55) * on * smoothstep(0.22, 0.05, length(f * vec2(1.0, 1.4)));
        } else if (vKind < 1.5) {
          // stadium bowl: rows of concourse lights
          vec2 sp = vW.xz - vec2(92.0, -92.0);
          float a = atan(sp.y, sp.x) * 40.0;
          float row = smoothstep(0.08, 0.0, abs(fract(vW.y / 4.0) - 0.5) - 0.32);
          float win = step(0.35, fract(a)) * row * step(1.5, vW.y) * step(vW.y, 15.0);
          col += vec3(1.6, 1.4, 1.1) * win * (0.6 + 0.4 * tHash(floor(vec2(a, vW.y / 4.0))));
          fogK = 0.008;
        } else {
          col *= 1.0 + 0.08 * sin(uTime * 2.0 + vW.x);
          fogK = 0.005;
        }
        float fogA = 1.0 - exp(-vDist * fogK);
        col = mix(col, uFog, clamp(fogA, 0.0, 0.92));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Light beams rising from the stadium floodlights (additive, fading with height). */
export function createBeamMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: time },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), vV)), 1.5);
        float fade = pow(1.0 - vUv.y, 2.2);
        float pulse = 0.85 + 0.15 * sin(uTime * 0.7 + vUv.x * 6.2831);
        gl_FragColor = vec4(vec3(0.45, 0.65, 1.0) * edge * fade * pulse * 0.22, 1.0);
      }`,
  });
}
