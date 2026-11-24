import * as THREE from 'three';
import type { QualityTier } from '../../quality.js';
import { DAIS_R, FLOOR_Y, heightAt, pathX } from './layout.js';
import { GLSL_BURST, GLSL_FOG, mulberry32, type Shared } from './shared.js';

/**
 * Living particles and the reveal burst, all animated in shaders from `uTime` / `uBurst`:
 * fireflies drifting over the grass, blossom petals carried up the hill by the wind (blown outward by the burst),
 * and the burst itself: a light ring racing across the dais, rising sparks, a short column of light and a flurry
 * of petals thrown off the dais.
 */

export type Fx = {
  group: THREE.Group;
  setQuality(t: QualityTier): void;
};

const PETAL_V = /* glsl */`
  attribute vec4 aSeed; // spawn x, z, ground y, random
  uniform float uTime; uniform vec4 uBurst; uniform vec2 uWind; uniform float uMode;
  varying float vA; varying float vShade; varying float vDepth;
  ${GLSL_BURST}
  mat3 rotXYZ(vec3 a) {
    vec3 c = cos(a), s = sin(a);
    return mat3(c.y * c.z, c.y * s.z, -s.y, s.x * s.y * c.z - c.x * s.z, s.x * s.y * s.z + c.x * c.z, s.x * c.y, c.x * s.y * c.z + s.x * s.z, c.x * s.y * s.z - s.x * c.z, c.x * c.y);
  }
  void main() {
    float r = aSeed.w;
    vec3 p;
    float alpha;
    vec3 spin = vec3(uTime * (1.5 + r * 2.0), uTime * (1.1 + r * 1.3), uTime * 0.7 + r * 6.28);
    if (uMode < 0.5) {
      // ambient petals: a looping drift along the wind, falling and fluttering
      float ph = fract(uTime * (0.055 + r * 0.04) + r * 7.31);
      vec2 w = normalize(uWind);
      p = vec3(aSeed.x, aSeed.z + 3.4 - ph * 3.3, aSeed.y);
      p.xz += w * (ph - 0.5) * 14.0;
      p.x += sin(uTime * 1.3 + r * 30.0) * 0.35; p.z += cos(uTime * 1.1 + r * 17.0) * 0.25;
      p.y += sin(uTime * 2.1 + r * 11.0) * 0.08;
      alpha = smoothstep(0.0, 0.08, ph) * smoothstep(1.0, 0.85, ph);
      if (uBurst.w >= 0.0) {
        vec2 bd = p.xz - uBurst.xz; float br = length(bd) + 1e-3;
        float push = exp(-br * 0.22) * (1.0 - exp(-uBurst.w * 2.5)) * exp(-uBurst.w * 0.15);
        p.xz += bd / br * push * 5.0; p.y += push * 1.6;
        spin *= 1.0 + push * 3.0;
      }
    } else {
      // burst petals: thrown off the dais, slowing, then drifting down with the wind
      float t = max(uBurst.w, 0.0);
      float a = r * 6.2831 * 7.0;
      vec2 dir = vec2(cos(a), sin(a));
      float sp = 2.2 + fract(r * 13.7) * 3.2;
      float k = 1.4;
      float travel = sp * (1.0 - exp(-k * t)) / k;
      p = vec3(uBurst.x, uBurst.y + 0.25 + fract(r * 5.3) * 0.9, uBurst.z);
      p.xz += dir * (0.25 + travel);
      p.y += (1.0 + fract(r * 3.1) * 2.2) * (1.0 - exp(-2.2 * t)) - t * 0.32;
      p.xz += uWind * t * 0.6;
      alpha = (uBurst.w >= 0.0 ? 1.0 : 0.0) * smoothstep(0.0, 0.05, t) * smoothstep(4.2, 2.6, t);
      spin *= 1.6;
    }
    mat3 R = rotXYZ(spin + r * 10.0);
    vec3 local = R * (position * (0.8 + r * 0.5));
    vShade = 0.6 + 0.4 * abs((R * vec3(0.0, 0.0, 1.0)).y);
    vA = alpha;
    vec4 mv = viewMatrix * vec4(p + local, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const PETAL_F = /* glsl */`
  uniform vec3 uColor; uniform vec4 uBurst;
  varying float vA; varying float vShade; varying float vDepth;
  ${GLSL_FOG}
  void main() {
    if (vA < 0.01) discard;
    vec3 c = uColor * vShade;
    c = applyFog(c, vDepth, 1.0);
    gl_FragColor = vec4(c, vA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function petalGeometry(): THREE.BufferGeometry {
  // a small notched petal: 4 triangles
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0, 0.03, 0.0, 0.035, 0.0, 0, 0.07, -0.03, 0, 0.035, 0.012, 0, 0.062, -0.012, 0, 0.062];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 4, 0, 4, 2, 0, 2, 5, 0, 5, 3]);
  g.translate(0, 0, -0.035);
  return g;
}

export function buildFx(S: Shared, tier: QualityTier, canopy: THREE.Vector3): Fx {
  const group = new THREE.Group(); group.name = 'intro-fx';
  const hi = tier !== 'low';

  // Fireflies
  const FF = 260;
  const ffGeo = new THREE.BufferGeometry();
  {
    const rnd = mulberry32(88);
    const pos = new Float32Array(FF * 3), seed = new Float32Array(FF);
    for (let i = 0; i < FF; i++) {
      const z = -1.5 + rnd() * 40, s = rnd() < 0.5 ? -1 : 1;
      const x = pathX(z) + s * (0.8 + Math.pow(rnd(), 1.3) * 9);
      pos.set([x, heightAt(x, z) + 0.35 + rnd() * 1.9, z], i * 3); seed[i] = rnd();
    }
    ffGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  }
  const ffMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: S.uTime, uPx: S.uPx, uBurst: S.uBurst, uFogColor: S.uFogColor, uFogDensity: S.uFogDensity },
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uTime, uPx; uniform vec4 uBurst; varying float vA; varying float vCore;
      void main() {
        vec3 p = position;
        float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 50.0;
        p += vec3(sin(t) * 0.6 + sin(t * 2.3) * 0.15, sin(t * 1.3 + 1.0) * 0.35, cos(t * 0.9) * 0.6);
        if (uBurst.w >= 0.0) { vec2 bd = p.xz - uBurst.xz; float br = length(bd) + 1e-3; float k = exp(-br * 0.3) * (1.0 - exp(-uBurst.w * 3.0)); p.xz += bd / br * k * 2.5; p.y += k * 0.8; }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float blink = smoothstep(0.35, 1.0, sin(uTime * (0.9 + aSeed * 1.4) + aSeed * 31.0) * 0.5 + 0.5);
        vA = (0.15 + 0.85 * blink) * smoothstep(0.3, 1.2, -mv.z);
        float px = 0.16 * uPx / max(-mv.z, 0.2);
        vCore = clamp(px / 7.0, 0.0, 1.0);
        gl_PointSize = clamp(px, 2.0, 16.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vCore;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 6.0) * 0.6 + exp(-r * r * 60.0) * 2.4 * vCore + exp(-r * r * 10.0) * (1.0 - vCore);
        if (a * vA < 0.004) discard;
        gl_FragColor = vec4(vec3(0.78, 1.0, 0.42) * a * vA * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false; fireflies.renderOrder = 7; fireflies.name = 'fireflies';
  group.add(fireflies);

  // Petals (ambient drift + burst flurry share one geometry)
  const pGeo = petalGeometry();
  const AMB = 700, BURST = 160;
  const mkPetals = (n: number, mode: number, seedFn: (i: number, r: () => number) => [number, number, number]) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = pGeo.index; geo.setAttribute('position', pGeo.getAttribute('position'));
    const a = new Float32Array(n * 4); const r = mulberry32(300 + mode);
    for (let i = 0; i < n; i++) { const [x, z, y] = seedFn(i, r); a.set([x, z, y, r()], i * 4); }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: S.uTime, uBurst: S.uBurst, uWind: S.uWind, uMode: { value: mode }, uColor: { value: new THREE.Color('#ffc2dc').multiplyScalar(0.55) }, uFogColor: S.uFogColor, uFogDensity: S.uFogDensity },
      vertexShader: PETAL_V, fragmentShader: PETAL_F,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 7;
    return mesh;
  };
  const ambient = mkPetals(AMB, 0, (i, r) => {
    // half drift off the blossom tree, half over the whole path
    if (i % 2 === 0) { const x = canopy.x + (r() - 0.5) * 7, z = canopy.z + (r() - 0.5) * 7; return [x, z, heightAt(x, z) + 1.2 + r() * 3]; }
    const z = -2 + r() * 40, x = pathX(z) + (r() - 0.5) * 12;
    return [x, z, heightAt(x, z) + r() * 1.5];
  });
  ambient.name = 'petals';
  const burstPetals = mkPetals(BURST, 1, () => [0, 0, 0]);
  burstPetals.name = 'burst-petals';
  group.add(ambient, burstPetals);

  // Burst: dais ring (bright engraving-level ring and core flash)
  const ringMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uBurst: S.uBurst, uColor: S.uBurstColor },
    vertexShader: /* glsl */`varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec4 uBurst; uniform vec3 uColor; varying vec2 vP;
      ${GLSL_BURST}
      void main() {
        float t = uBurst.w; if (t < 0.0) discard;
        float r = length(vP);
        float edge = smoothstep(${(DAIS_R + 0.02).toFixed(3)}, ${(DAIS_R - 0.04).toFixed(3)}, r);
        float ring = burstBand(r, t) * 3.0;
        float inner = burstBand(r, max(t - 0.18, 0.0)) * 1.5 * step(0.18, t);
        float core = exp(-r * r * 1.6) * exp(-t * 3.6) * smoothstep(0.0, 0.03, t) * 1.8;
        vec3 c = uColor * (ring + inner) + vec3(1.0, 0.97, 0.9) * core;
        gl_FragColor = vec4(c * edge, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(DAIS_R + 0.05, 64), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, FLOOR_Y + 0.003, 0); ring.renderOrder = 8; ring.name = 'burst-ring';
  group.add(ring);

  // A ground-hugging shock ring beyond the dais (floats a hand above the grass, additive and soft)
  const shockMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uBurst: S.uBurst, uColor: S.uBurstColor },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec4 uBurst; uniform vec3 uColor; varying vec2 vUv;
      ${GLSL_BURST}
      void main() {
        float t = uBurst.w; if (t < 0.0) discard;
        float a = burstBand(burstR(t), t) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - vUv.y) * 0.9;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const shockGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true); shockGeo.translate(0, 0.5, 0);
  const shock = new THREE.Mesh(shockGeo, shockMat);
  shock.position.set(0, FLOOR_Y - 0.25, 0); shock.renderOrder = 8; shock.name = 'burst-shock';
  shock.onBeforeRender = () => {
    const t = S.uBurst.value.w;
    const R = t < 0 ? 0.001 : 9.5 * (1 - Math.exp(-t * 1.9));
    shock.scale.set(Math.max(R, 0.001), 0.6 + R * 0.05, Math.max(R, 0.001));
    shock.updateMatrixWorld();
  };
  group.add(shock);

  // Rising sparks
  const SP = 240;
  const spGeo = new THREE.BufferGeometry();
  {
    const r = mulberry32(606);
    const pos = new Float32Array(SP * 3), dir = new Float32Array(SP * 4);
    for (let i = 0; i < SP; i++) {
      const a = r() * Math.PI * 2, el = 0.35 + r() * 1.0;
      dir.set([Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el), r()], i * 4);
    }
    spGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    spGeo.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
  }
  const spMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uBurst: S.uBurst, uPx: S.uPx, uTime: S.uTime },
    vertexShader: /* glsl */`
      attribute vec4 aDir; uniform vec4 uBurst; uniform float uPx, uTime; varying float vA; varying vec3 vC; varying float vCore;
      void main() {
        float t = max(uBurst.w - aDir.w * 0.25, 0.0);
        float sp = 2.5 + fract(aDir.w * 17.0) * 4.5;
        float k = 1.6;
        vec3 p = uBurst.xyz + vec3(0.0, 0.15, 0.0);
        p += aDir.xyz * sp * (1.0 - exp(-k * t)) / k;
        p.y += t * (0.5 + fract(aDir.w * 7.0) * 0.9);
        float sw = t * 2.0 + aDir.w * 20.0;
        p.x += sin(sw) * 0.15 * t; p.z += cos(sw) * 0.15 * t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float life = 1.6 + fract(aDir.w * 3.3) * 1.8;
        vA = (uBurst.w >= 0.0 ? 1.0 : 0.0) * smoothstep(0.0, 0.05, t) * smoothstep(life, life * 0.4, t) * (0.6 + 0.4 * sin(uTime * 22.0 + aDir.w * 90.0));
        vC = mix(vec3(1.0, 0.8, 0.35), vec3(0.55, 0.92, 1.0), step(0.55, fract(aDir.w * 11.0)));
        float px = 0.06 * uPx / max(-mv.z, 0.2);
        vCore = clamp(px / 5.0, 0.0, 1.0);
        gl_PointSize = clamp(px, 2.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC; varying float vCore;
      void main() {
        if (vA < 0.01) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 8.0) * 0.5 + exp(-r * r * 50.0) * 2.5;
        gl_FragColor = vec4(vC * a * vA * 2.0, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sparks = new THREE.Points(spGeo, spMat);
  sparks.frustumCulled = false; sparks.renderOrder = 8; sparks.name = 'burst-sparks';
  group.add(sparks);

  // Column of light (the send-out pillar), brief
  const colMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uBurst: S.uBurst, uColor: S.uBurstColor },
    vertexShader: /* glsl */`uniform vec4 uBurst; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() {
        float t = max(uBurst.w, 0.0);
        float grow = 0.35 + 1.1 * (1.0 - exp(-t * 4.0));
        vec3 p = position; p.xz *= grow * mix(1.0, 0.55, position.y / 10.0);
        vY = position.y / 10.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * vec3(normal.x, 0.0, normal.z)); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`uniform vec4 uBurst; uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() {
        float t = uBurst.w; if (t < 0.0) discard;
        float rise = smoothstep(vY - 0.05, vY + 0.05, t * 3.5);
        float fade = exp(-t * 2.4) * smoothstep(0.0, 0.04, t);
        float edge = pow(abs(dot(vN, vV)), 2.5);
        float a = edge * rise * fade * (1.0 - vY) * (1.0 - vY) * 0.75;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const colGeo = new THREE.CylinderGeometry(0.55, 0.85, 10, 32, 1, true); colGeo.translate(0, 5, 0);
  const column = new THREE.Mesh(colGeo, colMat);
  column.position.set(0, FLOOR_Y, 0); column.renderOrder = 8; column.frustumCulled = false; column.name = 'burst-column';
  group.add(column);

  // Hide the burst-only meshes when idle (no draw calls outside the burst)
  const burstOnly: THREE.Object3D[] = [ring, shock, sparks, column, burstPetals];
  const sync = () => { const on = S.uBurst.value.w >= 0; for (const o of burstOnly) o.visible = on; };
  sync();
  (group.userData as { sync?: () => void }).sync = sync;

  const setQuality = (t: QualityTier) => {
    const low = t === 'low';
    ffGeo.setDrawRange(0, low ? FF / 2 : FF);
    (ambient.geometry as THREE.InstancedBufferGeometry).instanceCount = low ? AMB / 2 : AMB;
    (burstPetals.geometry as THREE.InstancedBufferGeometry).instanceCount = low ? BURST / 2 : BURST;
    spGeo.setDrawRange(0, low ? SP / 2 : SP);
  };
  setQuality(hi ? 'high' : 'low');
  return { group, setQuality };
}
