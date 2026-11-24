import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityTier } from '../../quality.js';
import { heightAt, LAKE, lakeE, moonDir, STADIUM, TOWN_CENTRE, WATER_Y } from './layout.js';
import { fbm, GLSL_FOG, GLSL_NOISE, mulberry32, patchLit, smooth, type Shared } from './shared.js';

/**
 * The valley: a town as a carpet of warm lights (instanced houses with procedural lit windows, street lamps as one
 * point cloud, a glow map painted on the valley floor), a glowing stadium with slow searchlights, and the lake with
 * the moon's glitter path. All animation is in shaders.
 */

export const GLOW_RECT = new THREE.Vector4(-190, -340, 1 / 380, 1 / 320); // x0, z0, 1/w, 1/d

type House = { x: number; z: number; w: number; d: number; h: number; rot: number; roof: THREE.Color };
type Lamp = { x: number; y: number; z: number; c: THREE.Color; s: number };

const DEG = Math.PI / 180;
const ROOFS = ['#34508f', '#8f3b3b', '#2f6e6e', '#6e5a3a', '#4a3f7a', '#8a5a2a'].map((c) => new THREE.Color(c));

function inTown(x: number, z: number): number {
  // polar wedge ahead of the crest, inside the valley, not in the lake or the stadium
  const az = Math.atan2(x, -z), d = Math.hypot(x, z);
  if (az < -27 * DEG || az > 38 * DEG || d < 50 || d > 250) return 0;
  if (lakeE(x, z) < 1.1) return 0;
  if (Math.hypot(x - STADIUM.x, z - STADIUM.z) < STADIUM.r + 7) return 0;
  const y = heightAt(x, z);
  if (y > -28.3) return 0;
  const centre = 1 - smooth(20, 120, Math.hypot(x - TOWN_CENTRE.x, z - TOWN_CENTRE.z));
  const edge = smooth(50, 62, d) * (1 - smooth(215, 250, d));
  return edge * (0.35 + 0.65 * centre) * (0.55 + 0.9 * fbm(x * 0.03 + 4, z * 0.03 - 2));
}

export function townLayout(tier: QualityTier) {
  const rnd = mulberry32(404);
  const houses: House[] = [];
  const lamps: Lamp[] = [];
  const roads: Array<[number, number, number, number, number]> = [];
  const rot = 0.16, cs = Math.cos(rot), sn = Math.sin(rot);
  const toW = (u: number, v: number): [number, number] => [TOWN_CENTRE.x + u * cs - v * sn, TOWN_CENTRE.z + u * sn + v * cs];
  const B = 13;
  const warm = new THREE.Color('#ffb060'), gold = new THREE.Color('#ffd27a'), cool = new THREE.Color('#bfe0ff'), cyan = new THREE.Color('#5fe8ff');
  const houseCap = tier === 'low' ? 520 : 900;
  // Blocks with houses
  for (let i = -14; i <= 14; i++) for (let j = -12; j <= 12; j++) {
    const [cx, cz] = toW(i * B, j * B);
    const dens = inTown(cx, cz);
    if (dens < 0.25) continue;
    const n = dens > 0.75 ? 4 : dens > 0.5 ? 3 : 2;
    for (let k = 0; k < n && houses.length < houseCap; k++) {
      const u = i * B + ((k % 2) - 0.5) * 5.2 + (rnd() - 0.5) * 1.2, v = j * B + (Math.floor(k / 2) - 0.5) * 5.2 + (rnd() - 0.5) * 1.2;
      const [x, z] = toW(u, v);
      if (inTown(x, z) < 0.15) continue;
      const tall = rnd() < 0.06 + dens * 0.08;
      houses.push({ x, z, w: 3.2 + rnd() * 1.6, d: 3.2 + rnd() * 1.6, h: tall ? 6 + rnd() * 6 : 2.6 + rnd() * 1.8, rot: rot + (rnd() < 0.15 ? Math.PI / 2 : 0), roof: ROOFS[Math.floor(rnd() * ROOFS.length)] });
    }
  }
  // Street lamps along the grid lines next to lived-in blocks
  const step = tier === 'low' ? 8 : 5.5;
  for (let line = -14; line <= 14; line++) for (const dir of [0, 1]) {
    let prev: [number, number] | null = null;
    for (let s = -190; s <= 190; s += step) {
      const u = dir ? s : line * B + B / 2, v = dir ? line * B + B / 2 : s;
      const [x, z] = toW(u, v);
      if (inTown(x, z) < 0.3) { prev = null; continue; }
      const y = heightAt(x, z);
      lamps.push({ x, y: y + 1.4, z, c: rnd() < 0.08 ? cool : warm, s: 0.9 + rnd() * 0.4 });
      if (prev) roads.push([prev[0], prev[1], x, z, 1]);
      prev = [x, z];
    }
  }
  // The main avenue from the foot of the cliff to the stadium: brighter, gold, both sides.
  {
    const a = new THREE.Vector2(...(() => { const d = 52, az = 2 * DEG; return [Math.sin(az) * d, -Math.cos(az) * d] as [number, number]; })());
    const b = new THREE.Vector2(STADIUM.x - 10, STADIUM.z + 14);
    const len = a.distanceTo(b); const dir = b.clone().sub(a).normalize(); const nrm = new THREE.Vector2(-dir.y, dir.x);
    for (let s = 0; s <= len; s += 3.6) for (const side of [-1, 1]) {
      const p = a.clone().addScaledVector(dir, s).addScaledVector(nrm, side * 2.4);
      if (lakeE(p.x, p.y) < 1.05) continue;
      lamps.push({ x: p.x, y: heightAt(p.x, p.y) + 1.6, z: p.y, c: gold, s: 1.25 });
    }
    roads.push([a.x, a.y, b.x, b.y, 2.4]);
  }
  // Lakeside promenade: a ring of cool and warm lamps along the near shore.
  for (let k = 0; k < 64; k++) {
    const t = (k / 64) * Math.PI * 2;
    const u = Math.cos(t) * LAKE.a * 1.07, v = Math.sin(t) * LAKE.b * 1.1;
    const x = LAKE.x + u * LAKE.ux - v * LAKE.uz, z = LAKE.z + u * LAKE.uz + v * LAKE.ux;
    const y = heightAt(x, z);
    if (y > -27) continue;
    lamps.push({ x, y: y + 1.3, z, c: k % 3 === 0 ? cyan : warm, s: 1.1 });
  }
  return { houses, lamps, roads };
}

/** Warm street glow painted into a texture the valley floor samples (blurred lamp blobs and roads). */
export function glowTexture(layout: ReturnType<typeof townLayout>): THREE.CanvasTexture {
  const W = 512, H = 432;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const px = (x: number) => (x - GLOW_RECT.x) * GLOW_RECT.z * W;
  const pz = (z: number) => (z - GLOW_RECT.y) * GLOW_RECT.w * H;
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(2px)';
  for (const [x1, z1, x2, z2, w] of layout.roads) {
    g.strokeStyle = w > 1.5 ? 'rgba(255,190,110,0.55)' : 'rgba(255,150,70,0.28)';
    g.lineWidth = w > 1.5 ? 3.2 : 1.6;
    g.beginPath(); g.moveTo(px(x1), pz(z1)); g.lineTo(px(x2), pz(z2)); g.stroke();
  }
  g.filter = 'blur(3px)';
  for (const l of layout.lamps) {
    g.fillStyle = `rgba(${Math.round(l.c.r * 255)},${Math.round(l.c.g * 200)},${Math.round(l.c.b * 140)},0.35)`;
    g.beginPath(); g.arc(px(l.x), pz(l.z), 2.6, 0, Math.PI * 2); g.fill();
  }
  // stadium spill
  g.filter = 'blur(10px)';
  const sg = g.createRadialGradient(px(STADIUM.x), pz(STADIUM.z), 2, px(STADIUM.x), pz(STADIUM.z), 34);
  sg.addColorStop(0, 'rgba(170,230,255,0.9)'); sg.addColorStop(1, 'rgba(60,120,255,0)');
  g.fillStyle = sg; g.beginPath(); g.arc(px(STADIUM.x), pz(STADIUM.z), 40, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glowing point sprites with a world-space size (with a minimum pixel size so far lights never vanish). */
export function glowPoints(S: Shared, pts: Array<{ pos: THREE.Vector3; color: THREE.Color; size: number; flicker: number }>, opts: { minPx: number; fogK: number; reflect?: boolean }): THREE.Points {
  const n = pts.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n), fl = new Float32Array(n);
  pts.forEach((p, i) => { pos.set([p.pos.x, p.pos.y, p.pos.z], i * 3); col.set([p.color.r, p.color.g, p.color.b], i * 3); siz[i] = p.size; fl[i] = p.flicker; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  g.setAttribute('aFlicker', new THREE.BufferAttribute(fl, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: S.uTime, uPx: S.uPx, uMinPx: { value: opts.minPx }, uFogK: { value: opts.fogK }, uFogColor: S.uFogColor, uFogDensity: S.uFogDensity },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aFlicker;
      uniform float uTime, uPx, uMinPx, uFogK; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vC; varying float vCore;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mv.z, 0.1);
        float px = aSize * uPx / dist;
        float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float fl = 1.0 - aFlicker * (0.5 + 0.5 * sin(uTime * (6.0 + seed * 5.0) + seed * 40.0)) * (0.6 + 0.4 * sin(uTime * 1.7 + seed * 9.0));
        float d = uFogDensity * uFogK * dist; float keep = exp(-d * d);
        // keep tiny far lights at a minimum size but dim them by their lost area
        float shown = max(px, uMinPx);
        vC = aColor * fl * keep * min(1.0, (px * px) / (shown * shown) * 3.0 + 0.35);
        vCore = clamp(px / 6.0, 0.0, 1.0);
        gl_PointSize = shown;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vCore;
      void main() {
        vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
        float halo = exp(-r * r * 5.0);
        float core = exp(-r * r * 40.0) * 2.2;
        float a = mix(exp(-r * r * 3.5) * 1.4, halo * 0.55 + core, vCore);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false; p.renderOrder = 6;
  return p;
}

function houseGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 1, 1); body.translate(0, 0.5, 0);
  // gable roof prism with a small overhang, y from 1 to 1.45 (in body-height units after scaling the instance)
  const roof = new THREE.BufferGeometry();
  const o = 0.58, h = 0.42;
  const v = [
    -o, 1, -o, o, 1, -o, 0, 1 + h, -o, // front gable
    o, 1, o, -o, 1, o, 0, 1 + h, o, // back gable
    -o, 1, -o, 0, 1 + h, -o, 0, 1 + h, o, -o, 1, -o, 0, 1 + h, o, -o, 1, o, // left slope
    o, 1, -o, o, 1, o, 0, 1 + h, o, o, 1, -o, 0, 1 + h, o, 0, 1 + h, -o, // right slope
  ];
  // listed clockwise; flip every triangle so the faces point outward
  for (let t = 0; t < v.length; t += 9) for (let k = 0; k < 3; k++) { const a = v[t + 3 + k]; v[t + 3 + k] = v[t + 6 + k]; v[t + 6 + k] = a; }
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  const bodyNI = body.toNonIndexed(); body.dispose();
  bodyNI.deleteAttribute('uv');
  const mark = (g: THREE.BufferGeometry, r: number) => g.setAttribute('aRoof', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(r), 1));
  mark(bodyNI, 0); mark(roof, 1);
  const g = mergeGeometries([bodyNI, roof])!;
  bodyNI.dispose(); roof.dispose();
  return g;
}

export type Town = { group: THREE.Group; lights: THREE.Points; setQuality(t: QualityTier): void };

export function buildTown(S: Shared, _tier: QualityTier, layout: ReturnType<typeof townLayout>): Town {
  const group = new THREE.Group(); group.name = 'intro-town';
  // Houses: walls pale, roofs coloured (vertex colour chooses by aRoof via instance colour mixing in the shader).
  {
    const geo = houseGeometry();
    const mat = patchLit(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 }), S, { lamps: false, burst: false, windows: true });
    // roofs take the instance colour, walls stay a warm pale plaster
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRoof; varying float vRoof;').replace('#include <color_vertex>', '#include <color_vertex>\nvRoof = aRoof;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRoof;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.42, 0.40, 0.44), diffuseColor.rgb, vRoof);');
    };
    const prevKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => prevKey() + ':house';
    const n = layout.houses.length;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    layout.houses.forEach((h, i) => {
      const y = Math.min(heightAt(h.x - h.w / 2, h.z), heightAt(h.x + h.w / 2, h.z), heightAt(h.x, h.z - h.d / 2), heightAt(h.x, h.z + h.d / 2)) - 0.2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.rot);
      im.setMatrixAt(i, m.compose(p.set(h.x, y, h.z), q, s.set(h.w, h.h, h.d)));
      im.setColorAt(i, h.roof);
    });
    im.name = 'houses';
    group.add(im);
  }

  // Street lamps and the stadium's rim lights as one point cloud.
  const pts: Array<{ pos: THREE.Vector3; color: THREE.Color; size: number; flicker: number }> = layout.lamps.map((l) => ({
    pos: new THREE.Vector3(l.x, l.y, l.z), color: l.c.clone().multiplyScalar(3.2 * l.s), size: 1.5 * l.s, flicker: 0.05,
  }));
  // Stadium
  {
    const { x, z, r } = STADIUM; const y0 = heightAt(x, z) - 0.5;
    const prof = [
      new THREE.Vector2(r + 1.5, 0), new THREE.Vector2(r + 1.5, 5.5), new THREE.Vector2(r + 2.4, 6.4), new THREE.Vector2(r + 2.5, 8.2),
      new THREE.Vector2(r + 1.2, 8.4), new THREE.Vector2(r - 3, 3.6), new THREE.Vector2(r - 3.2, 1.6),
    ];
    const bowl = new THREE.LatheGeometry(prof, 48);
    const bowlMat = new THREE.MeshStandardMaterial({ color: '#8a96b8', roughness: 0.6, emissive: '#1a2440', emissiveIntensity: 1 });
    // emissive band of light under the roof lip, done with a tiny shader patch (stripe by height)
    bowlMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vObjN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y; vObjN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vObjN;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float ribs = step(0.5, fract(atan(vObjN.z, vObjN.x) * 7.64));
        totalEmissiveRadiance += vec3(0.95, 0.8, 0.6) * ribs * (smoothstep(0.5, 0.7, vH) - smoothstep(4.8, 5.0, vH)) * 0.45;
        totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * (smoothstep(5.35, 5.55, vH) - smoothstep(6.3, 6.45, vH)) * 3.0;
        totalEmissiveRadiance += vec3(1.0, 0.35, 0.4) * (smoothstep(1.2, 1.35, vH) - smoothstep(1.6, 1.75, vH)) * 1.6;
        totalEmissiveRadiance *= 0.75;
        diffuseColor.rgb *= 0.35;`);
    };
    bowlMat.customProgramCacheKey = () => 'intro-stadium-bowl';
    bowlMat.fog = false;
    const bowlMesh = new THREE.Mesh(bowl, bowlMat);
    bowlMesh.position.set(x, y0, z);
    group.add(bowlMesh);
    // the field glowing inside
    const field = new THREE.Mesh(new THREE.CircleGeometry(r - 3.1, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5cf2c4').multiplyScalar(1.4) }));
    field.rotation.x = -Math.PI / 2; field.position.set(x, y0 + 1.7, z);
    group.add(field);
    // rim lights and floodlight crowns
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      pts.push({ pos: new THREE.Vector3(x + Math.cos(a) * (r + 2.45), y0 + 8.35, z + Math.sin(a) * (r + 2.45)), color: new THREE.Color('#bfeaff').multiplyScalar(2.2), size: 0.9, flicker: 0 });
    }
    // a soft dome of light hanging over the bowl
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: { uColor: { value: new THREE.Color('#6fc8ff') } },
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying float vY; void main() { vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vY;
        void main() { float f = pow(max(dot(vN, vV), 0.0), 1.5); float a = f * (1.0 - vY) * 0.16; gl_FragColor = vec4(uColor * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    dome.position.set(x, y0 + 4, z); dome.scale.set(r + 9, 22, r + 9); dome.renderOrder = 5;
    group.add(dome);
    // searchlights: thin additive beams swaying slowly (vertex shader)
    const beamGeo = new THREE.CylinderGeometry(0.4, 4.0, 120, 12, 1, true); beamGeo.translate(0, 60, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: S.uTime, uFogColor: S.uFogColor, uFogDensity: S.uFogDensity },
      vertexShader: /* glsl */`uniform float uTime; varying float vT; varying vec3 vN; varying vec3 vV; varying float vDepth;
        attribute float aPhase;
        void main() {
          vT = position.y / 120.0;
          float sw = sin(uTime * 0.23 + aPhase * 2.4) * 0.09;
          float c = cos(sw), s = sin(sw);
          vec3 p = position; p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`varying float vT; varying vec3 vN; varying vec3 vV; varying float vDepth;
        void main() {
          float edge = pow(abs(dot(vN, vV)), 2.0);
          float a = edge * (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.03, vT) * 0.05;
          gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const beams = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      const g = beamGeo.clone();
      g.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(k), 1));
      const b = new THREE.Mesh(g, beamMat);
      // both on the far side of the bowl, leaning away from the title area (to the right)
      const a = -Math.PI / 2 + (k - 0.5) * 0.9;
      b.position.set(x + Math.cos(a) * (r + 2), y0 + 8, z + Math.sin(a) * (r + 2));
      b.rotation.set(0.05, 0, -0.32 - k * 0.12);
      b.renderOrder = 5;
      beams.add(b);
    }
    beamGeo.dispose();
    group.add(beams);
  }
  // A few soft red aircraft lights on the tallest buildings, blinking.
  layout.houses.filter((h) => h.h > 9).slice(0, 8).forEach((h) => {
    pts.push({ pos: new THREE.Vector3(h.x, heightAt(h.x, h.z) + h.h * 1.45 + 0.4, h.z), color: new THREE.Color('#ff3b4a').multiplyScalar(3), size: 0.9, flicker: 0.9 });
  });
  const lights = glowPoints(S, pts, { minPx: 2.2, fogK: 0.5 });
  lights.name = 'town-lights';
  group.add(lights);
  const full = pts.length;

  // The lake
  {
    const geo = new THREE.PlaneGeometry(LAKE.a * 2.4, LAKE.b * 2.6, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.atan2(LAKE.uz, LAKE.ux));
    const mat = new THREE.ShaderMaterial({
      transparent: false, depthWrite: true,
      uniforms: { uTime: S.uTime, uMoon: { value: moonDir() }, uFogColor: S.uFogColor, uFogDensity: S.uFogDensity,
        uDeep: { value: new THREE.Color('#050b1c') }, uSky: { value: new THREE.Color('#1c2d5e') } },
      vertexShader: /* glsl */`varying vec3 vW; varying float vDepth;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uMoon, uDeep, uSky; varying vec3 vW; varying float vDepth;
        ${GLSL_NOISE}
        ${GLSL_FOG}
        void main() {
          vec2 p = vW.xz;
          float n1 = iNoise(p * 0.35 + vec2(uTime * 0.25, uTime * 0.1));
          float n2 = iNoise(p * 1.1 - vec2(uTime * 0.4, -uTime * 0.3));
          float n3 = iNoise(p * 3.2 + vec2(uTime * 0.9, uTime * 0.6));
          vec3 nrm = normalize(vec3((n1 - 0.5) * 0.06 + (n2 - 0.5) * 0.05 + (n3 - 0.5) * 0.05, 1.0, (n2 - 0.5) * 0.08 + (n3 - 0.5) * 0.06));
          vec3 V = normalize(cameraPosition - vW);
          vec3 R = reflect(-V, nrm);
          float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
          vec3 col = mix(uDeep, uSky, fres);
          float m = max(dot(R, uMoon), 0.0);
          // the glitter path: narrow across, long toward the viewer, broken up by ripples
          vec3 mT = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
          vec3 mB = cross(mT, uMoon);
          float ex = dot(R, mT), ey = dot(R, mB);
          float path = exp(-(ex * ex) / (0.0009) - (ey * ey) / (0.03)) * step(0.0, dot(R, uMoon));
          float spark = smoothstep(0.62, 0.9, iNoise(p * 2.4 + vec2(uTime * 1.3, -uTime * 0.9)) * iNoise(p * 0.9 - uTime * 0.4) * 1.6);
          float glit = path * (0.9 + spark * 4.0) + pow(m, 30.0) * 0.05;
          col += vec3(0.85, 0.9, 1.0) * glit;
          col = applyFog(col, vDepth, 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(LAKE.x, WATER_Y, LAKE.z);
    water.name = 'lake';
    group.add(water);
  }

  return {
    group, lights,
    setQuality(t: QualityTier) { lights.geometry.setDrawRange(0, t === 'low' ? Math.ceil(full * 0.6) : full); },
  };
}
