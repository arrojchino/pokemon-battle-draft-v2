import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityTier } from '../../quality.js';
import { BASIN_Y, DAIS_R, EDGE_Z, heightAt, lakeE, pathX, pathY, slopeAt, STADIUM } from './layout.js';
import { canvasTex, fbm, mulberry32, patchLit, smooth, type Shared } from './shared.js';

/**
 * Ground: a fine terrain patch around the path and crest and a coarse one for the valley and the mountains
 * (vertex coloured, lit by the shared lantern/burst patch; the valley floor also samples the town glow map),
 * the flagstone path, and wind-blown grass clumps (one instanced mesh, swayed and flattened by the burst on the GPU).
 */

const NEAR = { x0: -32, x1: 32, z0: -20, z1: 44 };
const FAR = { x0: -360, x1: 360, z0: -500, z1: 124, step: 8 };

const C = {
  grassA: new THREE.Color('#1f3a2b'), grassB: new THREE.Color('#38552f'), grassC: new THREE.Color('#2a4a40'),
  dirt: new THREE.Color('#3d3127'), moss: new THREE.Color('#3b4a34'), rock: new THREE.Color('#3e4250'),
  cliff: new THREE.Color('#2f323d'), field: new THREE.Color('#1c2b26'), town: new THREE.Color('#2b2c31'),
  mount: new THREE.Color('#18222c'), mountHi: new THREE.Color('#243243'), shore: new THREE.Color('#2e2c2a'),
};

function groundColour(x: number, z: number, y: number, out: THREE.Color): THREE.Color {
  const n = slopeAt(x, z);
  const a = Math.abs(x - pathX(z));
  const g = fbm(x * 0.18, z * 0.18);
  out.copy(C.grassA).lerp(C.grassB, smooth(0.35, 0.7, g)).lerp(C.grassC, smooth(0.55, 0.8, fbm(x * 0.05 + 9, z * 0.05)) * 0.6);
  // valley floor and mountains
  const valley = smooth(-18, -27, y);
  if (valley > 0) {
    const tmp = new THREE.Color().copy(C.field).lerp(C.town, smooth(0.45, 0.6, fbm(x * 0.04, z * 0.04)) * 0.7);
    out.lerp(tmp, valley);
  }
  const high = smooth(-24, 10, y) * smooth(150, 230, Math.hypot(x, z + 150));
  if (high > 0) out.lerp(C.mount, high).lerp(C.mountHi, smooth(10, 50, y) * 0.6);
  const e = lakeE(x, z);
  out.lerp(C.shore, smooth(1.12, 1.0, e) * 0.8);
  // rock on steep ground, cliff face
  out.lerp(z < EDGE_Z + 1 ? C.cliff : C.rock, smooth(0.8, 0.55, n.y));
  // the path's worn earth and the mossy stone apron round the dais
  if (z > 1.5 && z < 46) out.lerp(C.dirt, smooth(2.1, 1.15, a));
  out.lerp(C.moss, smooth(3.2, 2.2, Math.hypot(x, z)) * 0.8);
  // subtle darkening in the hollows for depth
  out.multiplyScalar(0.85 + 0.3 * fbm(x * 0.6, z * 0.6, 2));
  return out;
}

function gridGeometry(x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, lower?: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    const y = heightAt(x, z);
    const k = (j * (nx + 1) + i) * 3;
    pos[k] = x; pos[k + 1] = y - (lower ? lower(x, z) : 0); pos[k + 2] = z;
    groundColour(x, z, y, c);
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    // winding so normals face +y
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fine-grain ground detail (grain, specks), tiled in world space through the UV-less vertex colour path. */
function detailTexture(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(7);
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 120 + Math.floor(r() * 120);
      g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
      const s = 1 + r() * 3;
      g.fillRect(r() * w, r() * h, s, s);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function addWorldUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * scale; uv[i * 2 + 1] = p.getZ(i) * scale; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export type Terrain = {
  group: THREE.Group;
  grass: THREE.InstancedMesh;
  grassFull: number;
  setQuality(tier: QualityTier): void;
};

export function buildTerrain(S: Shared, tier: QualityTier, glowTex: THREE.Texture, glowRect: THREE.Vector4): Terrain {
  const group = new THREE.Group(); group.name = 'intro-terrain';
  const detail = detailTexture();

  // Near patch
  const nStep = tier === 'low' ? 0.9 : 0.62;
  const nx = Math.round((NEAR.x1 - NEAR.x0) / nStep), nz = Math.round((NEAR.z1 - NEAR.z0) / nStep);
  const nearGeo = gridGeometry(NEAR.x0, NEAR.x1, NEAR.z0, NEAR.z1, nx, nz);
  addWorldUV(nearGeo, 0.5);
  const nearMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: detail }), S, {});
  const near = new THREE.Mesh(nearGeo, nearMat);
  near.receiveShadow = true; near.name = 'terrain-near';
  group.add(near);

  // Far patch: same function, coarse; vertices strictly inside the near patch are tucked under it.
  const fx = (FAR.x1 - FAR.x0) / FAR.step, fz = (FAR.z1 - FAR.z0) / FAR.step;
  const farGeo = gridGeometry(FAR.x0, FAR.x1, FAR.z0, FAR.z1, fx, fz, (x, z) => (x > NEAR.x0 + 0.1 && x < NEAR.x1 - 0.1 && z > NEAR.z0 + 0.1 && z < NEAR.z1 - 0.1 ? 6 : 0));
  addWorldUV(farGeo, 0.12);
  S.uGlowMap.value = glowTex; S.uGlowRect.value.copy(glowRect);
  const farMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: detail }), S, { lamps: false, burst: false, townGlow: true });
  const far = new THREE.Mesh(farGeo, farMat);
  far.receiveShadow = false; far.name = 'terrain-far';
  group.add(far);

  // Flagstone path: irregular slabs, two or three per row, sitting on the ground.
  {
    const slab = new THREE.CylinderGeometry(0.5, 0.53, 0.14, 7, 1);
    const pos = slab.getAttribute('position') as THREE.BufferAttribute;
    const r0 = mulberry32(11);
    for (let i = 0; i < pos.count; i++) { if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + (r0() - 0.5) * 0.02); }
    slab.computeVertexNormals();
    const rnd = mulberry32(21);
    const mats: THREE.Matrix4[] = []; const cols: THREE.Color[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const base = new THREE.Color('#6d6a72');
    for (let z = 45; z > 1.9; z -= 0.62) {
      const row = rnd() < 0.5 ? 2 : 3;
      for (let k = 0; k < row; k++) {
        const across = (row === 2 ? (k - 0.5) * 1.05 : (k - 1) * 0.74) + (rnd() - 0.5) * 0.12;
        const zz = z + (rnd() - 0.5) * 0.14;
        const x = pathX(zz) + across;
        const w = (row === 2 ? 0.5 : 0.36) + rnd() * 0.08, d = 0.27 + rnd() * 0.05;
        p.set(x, Math.max(heightAt(x, zz), pathY(zz)) + 0.02, zz);
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.04));
        s.set(w / 0.5, 1, d / 0.5);
        mats.push(m.compose(p, q, s).clone());
        cols.push(base.clone().multiplyScalar(0.7 + rnd() * 0.45).lerp(new THREE.Color('#5a6b55'), rnd() * 0.35));
      }
    }
    const mat = patchLit(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, map: detail }), S, {});
    const im = new THREE.InstancedMesh(slab, mat, mats.length);
    mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
    im.receiveShadow = true; im.name = 'path-slabs';
    group.add(im);
  }

  // Grass clumps: five tapered blades each, base dark, tips lighter.
  const grassGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const r = mulberry32(5);
    const cBase = new THREE.Color('#0f2018'), cTip = new THREE.Color('#5f8c4a');
    for (let b = 0; b < 5; b++) {
      const h = 0.34 + r() * 0.3, w = 0.022 + r() * 0.014;
      const ang = r() * Math.PI * 2, lean = 0.08 + r() * 0.16;
      const ox = (r() - 0.5) * 0.22, oz = (r() - 0.5) * 0.22;
      const v = [-w, 0, w, 0, -w * 0.6, h * 0.55, w * 0.6, h * 0.55, 0, h];
      const pos: number[] = []; const col: number[] = []; const nrm: number[] = [];
      for (let k = 0; k < 5; k++) {
        const lx = v[k * 2], ly = v[k * 2 + 1];
        const t = ly / h;
        const bend = lean * t * t;
        const x = lx * Math.cos(ang) + Math.cos(ang + 1.57) * bend + ox;
        const z = lx * Math.sin(ang) + Math.sin(ang + 1.57) * bend + oz;
        pos.push(x, ly, z);
        const c = cBase.clone().lerp(cTip, Math.pow(t, 0.8));
        col.push(c.r, c.g, c.b);
        nrm.push(Math.cos(ang + 1.57) * 0.4, 0.9, Math.sin(ang + 1.57) * 0.4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
      parts.push(g);
    }
    const g = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return g;
  })();
  const grassFull = tier === 'low' ? 1300 : tier === 'medium' ? 2000 : 2400;
  const grassMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), S, { wind: 'grass' });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassFull);
  {
    const rnd = mulberry32(33);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const tint = new THREE.Color();
    let n = 0, guard = 0;
    while (n < grassFull && guard++ < grassFull * 40) {
      // denser near the path banks and round the dais, thinning out to the sides
      const z = -2.4 + rnd() * 46;
      const side = rnd() < 0.5 ? -1 : 1;
      const a = 1.25 + Math.pow(rnd(), 1.7) * 11;
      const x = pathX(z) + side * a;
      const r0 = Math.hypot(x, z);
      if (r0 < DAIS_R + 0.45) continue;
      if (z > 1.4 && a < 1.3) continue;
      const y = heightAt(x, z);
      if (y < -5 || slopeAt(x, z).y < 0.8) continue;
      const sc = 0.55 + rnd() * 0.35 + (a > 4 ? 0.2 : 0);
      p.set(x, y - 0.02, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      s.set(sc, sc * (0.8 + rnd() * 0.5), sc);
      grass.setMatrixAt(n, m.compose(p, q, s));
      tint.setHSL(0.27 + (rnd() - 0.5) * 0.12, 0.35 + rnd() * 0.25, 0.42 + rnd() * 0.2);
      grass.setColorAt(n, tint.multiplyScalar(1.6));
      n++;
    }
    grass.count = n;
  }
  grass.name = 'grass'; grass.frustumCulled = false;
  group.add(grass);
  const grassMax = grass.count;

  return {
    group, grass, grassFull: grassMax,
    setQuality(t: QualityTier) { grass.count = t === 'low' ? Math.floor(grassMax / 2) : grassMax; },
  };
}

/** Distance helpers used by other builders. */
export const isOnPath = (x: number, z: number) => z > 1.4 && Math.abs(x - pathX(z)) < 1.35;
export const valleyFloor = (x: number, z: number) => heightAt(x, z) < BASIN_Y + 1.5 && Math.hypot(x - STADIUM.x, z - STADIUM.z) > STADIUM.r + 5;
