import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityTier } from '../../quality.js';
import {
  DAIS_LANTERNS, DAIS_R, EDGE_Z, FLOOR_Y, GATE_Z, heightAt, LANTERN_SIDE, PAIR_Z, pathX, pathY, pathYaw, slopeAt, TREE_POS,
} from './layout.js';
import { canvasTex, mulberry32, patchLit, type Shared } from './shared.js';

/**
 * Shrine props: vermilion gate arches over the path (original design: upswept black top beam, round gold medallion,
 * paper lantern hanging from the tie beam), stone lanterns with lattice paper panes, the partner's stone dais with an
 * engraved ring motif that glows, rocks along the outcrop, a cedar forest and one old blossom tree on the crest.
 * Everything is instanced or merged; colours are vertex colours on shared materials.
 */

export type Glow = { pos: THREE.Vector3; color: THREE.Color; size: number; flicker: number };
export type Props = {
  group: THREE.Group;
  /** Lantern light sources (xyz, strength) for the shared fake-light uniform. */
  lamps: THREE.Vector4[];
  /** Additive glow sprites for lantern flames and hanging lanterns. */
  glows: Glow[];
  /** The dais engraving material (its emissive flares with the burst). */
  daisGlow: THREE.MeshStandardMaterial;
  /** Where the blossom tree's canopy is (petal source). */
  canopy: THREE.Vector3;
  setQuality(t: QualityTier): void;
};

function paint(g: THREE.BufferGeometry, c: THREE.Color | string): THREE.BufferGeometry {
  const col = new THREE.Color(c);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
}
/** Merge parts that may or may not be indexed (all converted to non-indexed, uv kept). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') q.deleteAttribute(k);
    if (!q.getAttribute('uv')) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.getAttribute('position').count * 2), 2));
    return q;
  });
  const g = mergeGeometries(ni)!;
  parts.forEach((p) => p.dispose()); ni.forEach((p) => p.dispose());
  return g;
}

const VERMILION = '#d23a26', LACQUER = '#141318', GOLD = '#d8a640', STONE = '#8a8790', STONE_D = '#5d5b63';

function gateGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const X = 1.72;
  for (const s of [-1, 1]) {
    parts.push(paint(place(new THREE.CylinderGeometry(0.16, 0.19, 4.2, 14), s * X, 1.8, 0), VERMILION));
    parts.push(paint(place(new THREE.CylinderGeometry(0.235, 0.25, 0.42, 14), s * X, 0.06, 0), LACQUER));
    parts.push(paint(place(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14), s * X, 0.3, 0), GOLD));
  }
  // tie beam (passes through the pillars) and the medallion strut
  parts.push(paint(place(new THREE.BoxGeometry(4.25, 0.22, 0.16), 0, 3.02, 0), VERMILION));
  parts.push(paint(place(new THREE.BoxGeometry(0.16, 0.62, 0.13), 0, 3.42, 0), VERMILION));
  parts.push(paint(place(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20), 0, 3.42, 0, Math.PI / 2), LACQUER));
  parts.push(paint(place(new THREE.TorusGeometry(0.2, 0.032, 6, 24), 0, 3.42, 0.045), GOLD));
  parts.push(paint(place(new THREE.TorusGeometry(0.2, 0.032, 6, 24), 0, 3.42, -0.045), GOLD));
  // lower top beam and the upswept black top beam
  parts.push(paint(place(new THREE.BoxGeometry(4.9, 0.26, 0.3), 0, 3.86, 0), VERMILION));
  const top = new THREE.BoxGeometry(5.7, 0.22, 0.44, 18, 1, 1);
  const p = top.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setY(i, p.getY(i) + 0.03 * x * x + (Math.abs(x) > 2.5 ? (Math.abs(x) - 2.5) * 0.1 : 0));
  }
  top.computeVertexNormals();
  parts.push(paint(place(top, 0, 4.1, 0), LACQUER));
  // the hanging paper lantern's cord and caps (its glowing body is drawn by the pane mesh)
  parts.push(paint(place(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), 0, 2.84, 0), LACQUER));
  parts.push(paint(place(new THREE.CylinderGeometry(0.09, 0.11, 0.05, 12), 0, 2.74, 0), LACQUER));
  parts.push(paint(place(new THREE.CylinderGeometry(0.11, 0.09, 0.05, 12), 0, 2.33, 0), LACQUER));
  return merge(parts);
}

function lanternGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(place(new THREE.CylinderGeometry(0.27, 0.31, 0.16, 6), 0, 0.02, 0), STONE_D));
  parts.push(paint(place(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 6), 0, 0.15, 0), STONE));
  parts.push(paint(place(new THREE.CylinderGeometry(0.085, 0.1, 0.64, 8), 0, 0.52, 0), STONE));
  parts.push(paint(place(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), 0, 0.78, 0), STONE_D));
  parts.push(paint(place(new THREE.CylinderGeometry(0.26, 0.2, 0.12, 6), 0, 0.88, 0), STONE));
  // fire box posts
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    parts.push(paint(place(new THREE.BoxGeometry(0.045, 0.3, 0.045), Math.cos(a) * 0.17, 1.09, Math.sin(a) * 0.17, 0, -a), STONE_D));
  }
  // roof: a wide hexagonal cap with an upturned edge, then a small knob and finial
  const roof = new THREE.CylinderGeometry(0.08, 0.38, 0.2, 6, 2);
  const rp = roof.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) { const r = Math.hypot(rp.getX(i), rp.getZ(i)); if (r > 0.34) rp.setY(i, rp.getY(i) + 0.05); }
  roof.computeVertexNormals();
  parts.push(paint(place(roof, 0, 1.34, 0), STONE));
  parts.push(paint(place(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 8), 0, 1.47, 0), STONE_D));
  parts.push(paint(place(new THREE.SphereGeometry(0.06, 10, 6), 0, 1.53, 0), GOLD));
  return merge(parts);
}

function shojiTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h / 2, w * 0.7);
    grd.addColorStop(0, '#fff2d0'); grd.addColorStop(1, '#ffb050');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,30,10,0.85)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.lineWidth = 2;
    for (const t of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(w * t, 0); g.lineTo(w * t, h); g.stroke(); g.beginPath(); g.moveTo(0, h * t); g.lineTo(w, h * t); g.stroke(); }
  });
}

/** The dais top: radial flagstones with an engraved ring-and-star motif; returns colour and glow maps. */
function daisTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const S = 512;
  const motif = (g: CanvasRenderingContext2D, stroke: string, lw: number) => {
    g.strokeStyle = stroke; g.lineWidth = lw; g.lineCap = 'round';
    const c = S / 2;
    for (const r of [0.9, 0.62]) { g.beginPath(); g.arc(c, c, (r * S) / 2, 0, Math.PI * 2); g.stroke(); }
    // eight-pointed star between the two rings
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const a = (k * Math.PI) / 8 - Math.PI / 2, r = (k % 2 === 0 ? 0.6 : 0.42) * (S / 2);
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    // eight small notches on the outer ring
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      g.beginPath(); g.arc(c + Math.cos(a) * 0.76 * (S / 2), c + Math.sin(a) * 0.76 * (S / 2), S * 0.018, 0, Math.PI * 2); g.stroke();
    }
    g.beginPath(); g.arc(c, c, S * 0.06, 0, Math.PI * 2); g.stroke();
  };
  const map = canvasTex(S, S, (g) => {
    const r = mulberry32(3);
    g.fillStyle = '#7d7a82'; g.fillRect(0, 0, S, S);
    // radial flagstones
    const c = S / 2;
    for (let ring = 0; ring < 5; ring++) {
      const r0 = ring * 0.2 * c, r1 = (ring + 1) * 0.2 * c, n = 6 + ring * 6;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2 + ring * 0.3, a1 = ((k + 1) / n) * Math.PI * 2 + ring * 0.3;
        const v = 104 + Math.floor(r() * 40);
        g.fillStyle = `rgb(${v},${v - 2},${v + 6})`;
        g.beginPath(); g.arc(c, c, r1 - 1.5, a0 + 0.01, a1 - 0.01); g.arc(c, c, r0 + 1.5, a1 - 0.01, a0 + 0.01, true); g.closePath(); g.fill();
      }
    }
    for (let i = 0; i < 4000; i++) { const v = Math.floor(80 + r() * 90); g.fillStyle = `rgba(${v},${v},${v + 8},0.25)`; g.fillRect(r() * S, r() * S, 2, 2); }
    motif(g, '#3a3440', 9);
  });
  const glow = canvasTex(S, S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.shadowColor = '#7fe8ff'; g.shadowBlur = 10;
    motif(g, '#9ff0ff', 4);
  });
  return { map, glow };
}

/** A lumpy rock: a displaced icosahedron. */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const r = mulberry32(seed);
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let s = cache.get(k); if (s === undefined) { s = 0.78 + r() * 0.36; cache.set(k, s); }
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.72, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function coniferGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(place(new THREE.CylinderGeometry(0.025, 0.045, 0.3, 6), 0, 0.12, 0), '#2a1f1c'));
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 0.27 * (1 - t * 0.78), h = 0.32 - t * 0.1;
    const cone = new THREE.ConeGeometry(r, h, 9, 1, true);
    const cp = cone.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < cp.count; k++) if (cp.getY(k) < 0) { const a = Math.atan2(cp.getZ(k), cp.getX(k)); cp.setY(k, cp.getY(k) - 0.025 * (1 + Math.sin(a * 5))); }
    cone.computeVertexNormals();
    const c = new THREE.Color('#1d3a30').lerp(new THREE.Color('#2f5a3e'), t * 0.7);
    parts.push(paint(place(cone, 0, 0.26 + t * 0.62, 0), c));
  }
  return merge(parts);
}

/** The old blossom tree: a twisting trunk and branches (tubes); canopy clusters returned as instance positions. */
function blossomTree(rnd: () => number): { wood: THREE.BufferGeometry; tips: THREE.Vector3[] } {
  const parts: THREE.BufferGeometry[] = [];
  const tips: THREE.Vector3[] = [];
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0.12, 1.0, 0.05), new THREE.Vector3(-0.1, 2.0, 0.15), new THREE.Vector3(0.15, 2.9, 0.0),
  ]);
  const tube = (curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg: number) => {
    const g = new THREE.TubeGeometry(curve, seg, 1, 7, false);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // taper: rebuild the radius along the tube from the curve frames
    for (let i = 0; i <= seg; i++) {
      const c = curve.getPointAt(i / seg); const r = r0 + (r1 - r0) * (i / seg);
      for (let j = 0; j <= 7; j++) {
        const k = i * 8 + j;
        const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(c).normalize().multiplyScalar(r).add(c);
        p.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return paint(g, '#2b1f22');
  };
  parts.push(tube(trunk, 0.36, 0.17, 10));
  const top = trunk.getPointAt(1);
  const branches = 7;
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rnd() * 0.6;
    const start = trunk.getPointAt(0.55 + rnd() * 0.45);
    const len = 1.6 + rnd() * 1.4;
    const mid = start.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.5, 0.7 + rnd() * 0.5, Math.sin(a) * len * 0.5));
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, 1.0 + rnd() * 1.0, Math.sin(a) * len));
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    parts.push(tube(curve, 0.13, 0.04, 6));
    for (let k = 0; k < 3; k++) tips.push(curve.getPointAt(0.55 + k * 0.22));
  }
  tips.push(top.clone().add(new THREE.Vector3(0, 0.6, 0)));
  return { wood: merge(parts), tips };
}

export function buildProps(S: Shared, tier: QualityTier): Props {
  const group = new THREE.Group(); group.name = 'intro-props';
  const lamps: THREE.Vector4[] = [];
  const glows: Glow[] = [];
  /** Instanced meshes thinned on the low tier (instances are in random order, so a prefix is an even subset). */
  const scalable: Array<[THREE.InstancedMesh, number]> = [];
  const stoneTex = canvasTex(128, 128, (g, w, h) => {
    const r = mulberry32(9); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = 130 + Math.floor(r() * 110); g.fillStyle = `rgba(${v},${v},${v},0.45)`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
  });
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;

  const lit = (o: THREE.MeshStandardMaterialParameters, p: Parameters<typeof patchLit>[2] = {}) => patchLit(new THREE.MeshStandardMaterial(o), S, p);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Gates
  {
    const geo = gateGeometry();
    const mat = lit({ vertexColors: true, roughness: 0.5, metalness: 0.05 });
    const im = new THREE.InstancedMesh(geo, mat, GATE_Z.length);
    GATE_Z.forEach((z, i) => {
      const x = pathX(z), yaw = pathYaw(z);
      const y = Math.min(heightAt(x - 1.72, z), heightAt(x + 1.72, z), pathY(z)) - 0.08;
      im.setMatrixAt(i, m4.compose(pv.set(x, y, z), q.setFromAxisAngle(up, yaw), sc.set(1, 1, 1)));
      // the hanging lantern under the tie beam
      const hy = y + 2.535;
      lamps.push(new THREE.Vector4(x, hy, z, 0.8));
      glows.push({ pos: new THREE.Vector3(x, hy, z), color: new THREE.Color('#ff9a45'), size: 0.62, flicker: 0.1 });
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'gates';
    group.add(im);
  }

  // Stone lanterns (path pairs and the two by the dais)
  const lanternSpots: Array<[number, number, number]> = [];
  for (const z of PAIR_Z) for (const s of [-1, 1]) { const x = pathX(z) + s * LANTERN_SIDE; lanternSpots.push([x, z, pathYaw(z)]); }
  for (const [x, z] of DAIS_LANTERNS) lanternSpots.push([x, z, 0]);
  {
    const geo = lanternGeometry();
    const mat = lit({ vertexColors: true, roughness: 0.9, map: stoneTex });
    const im = new THREE.InstancedMesh(geo, mat, lanternSpots.length);
    const paneGeo = merge([
      place(new THREE.BoxGeometry(0.27, 0.25, 0.27), 0, 1.09, 0),
    ]);
    const shoji = shojiTexture();
    const paneMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: shoji, emissiveIntensity: 2.4, roughness: 1 });
    // gate lanterns: a paper globe (lathe) hanging under each tie beam
    const globe = new THREE.LatheGeometry(Array.from({ length: 9 }, (_, i) => { const t = i / 8; return new THREE.Vector2(0.06 + Math.sin(t * Math.PI) * 0.13, t * 0.38); }), 14);
    const ribs = canvasTex(64, 64, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#ffb35a'); grd.addColorStop(0.5, '#fff0c8'); grd.addColorStop(1, '#ff9440');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(120,40,10,0.55)'; for (let i = 0; i < 8; i++) g.fillRect(0, (i / 8) * h, w, 1.5);
      g.fillStyle = 'rgba(200,40,30,0.85)'; g.fillRect(0, h * 0.44, w, h * 0.12);
    });
    const globeMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: ribs, emissiveIntensity: 2.6, roughness: 1 });
    const panes = new THREE.InstancedMesh(paneGeo, paneMat, lanternSpots.length);
    lanternSpots.forEach(([x, z, yaw], i) => {
      const y = heightAt(x, z) - 0.04;
      const n = slopeAt(x, z);
      const tilt = new THREE.Quaternion().setFromUnitVectors(up, n.clone().lerp(up, 0.75).normalize());
      q.setFromAxisAngle(up, yaw).premultiply(tilt);
      m4.compose(pv.set(x, y, z), q, sc.set(1, 1, 1));
      im.setMatrixAt(i, m4); panes.setMatrixAt(i, m4);
      const dais = i >= lanternSpots.length - 2;
      lamps.push(new THREE.Vector4(x, y + 1.09, z, dais ? 1.5 : 1.45));
      glows.push({ pos: new THREE.Vector3(x, y + 1.09, z), color: new THREE.Color('#ffa24d'), size: dais ? 0.85 : 0.72, flicker: 0.12 });
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'lanterns';
    panes.name = 'lantern-panes';
    const globes = new THREE.InstancedMesh(globe, globeMat, GATE_Z.length);
    GATE_Z.forEach((z, i) => {
      const x = pathX(z);
      const y = Math.min(heightAt(x - 1.72, z), heightAt(x + 1.72, z), pathY(z)) - 0.08 + 2.33;
      globes.setMatrixAt(i, m4.compose(pv.set(x, y, z), q.identity(), sc.set(1, 1, 1)));
    });
    globes.name = 'gate-lanterns';
    group.add(im, panes, globes);
  }

  // The dais: a wide step and the engraved top, its surface exactly at FLOOR_Y.
  const { map: daisMap, glow: daisGlowTex } = daisTextures();
  const daisSide = lit({ color: '#77747c', roughness: 0.88, map: stoneTex });
  const daisTop = lit({ color: '#ffffff', map: daisMap, roughness: 0.75, emissive: '#5fe2ff', emissiveMap: daisGlowTex, emissiveIntensity: 0.13 });
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(DAIS_R + 0.38, DAIS_R + 0.5, 0.5, 56), [daisSide, daisSide, daisSide]);
    base.position.y = FLOOR_Y - 0.11 - 0.25; // top at 0.095
    const top = new THREE.Mesh(new THREE.CylinderGeometry(DAIS_R, DAIS_R + 0.05, 0.11, 56), [daisSide, daisTop, daisSide]);
    top.position.y = FLOOR_Y - 0.055;
    top.rotation.y = Math.PI / 16;
    // a thin gold inlay band round the top edge
    const band = new THREE.Mesh(new THREE.TorusGeometry(DAIS_R + 0.005, 0.018, 6, 72), lit({ color: GOLD, metalness: 0.7, roughness: 0.35 }));
    band.rotation.x = Math.PI / 2; band.position.y = FLOOR_Y - 0.012;
    for (const m of [base, top]) { m.castShadow = true; m.receiveShadow = true; }
    group.add(base, top, band);
  }

  // Rocks: the outcrop under the dais edge, along the cliff lip and scattered by the path.
  {
    const rnd = mulberry32(77);
    const geo = rockGeometry(1);
    const mat = lit({ color: '#ffffff', roughness: 0.92, map: stoneTex, flatShading: false });
    const spots: Array<[number, number, number, number]> = [];
    // cliff lip, curling along the edge
    for (let i = 0; i < 26; i++) {
      const x = -11 + i * 0.85 + (rnd() - 0.5) * 0.6;
      const z = EDGE_Z - 0.15 + x * x * 0.016 + (rnd() - 0.5) * 0.5;
      if (Math.hypot(x, z) < DAIS_R + 0.65) continue;
      spots.push([x, z, 0.3 + rnd() * 0.55, rnd()]);
    }
    // a heavier outcrop just below the dais
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.32; spots.push([Math.cos(a) * 2.5, Math.sin(a) * 2.5 - 0.35, 0.55 + rnd() * 0.4, rnd()]); }
    // along the path banks
    for (let i = 0; i < 26; i++) {
      const z = 3 + rnd() * 40, s = rnd() < 0.5 ? -1 : 1, x = pathX(z) + s * (2.3 + rnd() * 5);
      spots.push([x, z, 0.16 + rnd() * 0.4, rnd()]);
    }
    const n = spots.length;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const col = new THREE.Color();
    spots.forEach(([x, z, s, r], i) => {
      const y = heightAt(x, z);
      q.setFromEuler(new THREE.Euler(r * 0.5, r * 6.28, (r - 0.5) * 0.4));
      im.setMatrixAt(i, m4.compose(pv.set(x, y - s * 0.25, z), q, sc.set(s * (1 + r * 0.6), s, s * (1.2 - r * 0.3))));
      im.setColorAt(i, col.set('#6e6c76').multiplyScalar(0.75 + r * 0.4).lerp(new THREE.Color('#4f6a4c'), r * 0.3));
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'rocks';
    group.add(im);
  }

  // Cedars: either side of the path behind the lanterns, and dotted down the flanks.
  {
    const rnd = mulberry32(55);
    const spots: Array<[number, number, number]> = [];
    let guard = 0;
    const want = tier === 'low' ? 70 : 120;
    while (spots.length < want && guard++ < 4000) {
      const z = -6 + rnd() * 54;
      const s = rnd() < 0.5 ? -1 : 1;
      const a = 4.6 + Math.pow(rnd(), 0.8) * 20;
      const x = pathX(z) + s * a;
      if (Math.hypot(x - TREE_POS[0], z - TREE_POS[1]) < 5) continue;
      if (Math.hypot(x, z) < 6.5) continue;
      if (z < EDGE_Z + 1.5 && Math.abs(x) < 12) continue;
      if (spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.7)) continue;
      const y = heightAt(x, z);
      if (y < -18) continue;
      spots.push([x, z, 5 + rnd() * 5 + (a > 9 ? 2 : 0)]);
    }
    const geo = coniferGeometry();
    const mat = lit({ vertexColors: true, roughness: 0.9 }, { wind: 'tree' });
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const col = new THREE.Color();
    spots.forEach(([x, z, h], i) => {
      const y = heightAt(x, z) - 0.2;
      q.setFromAxisAngle(up, rnd() * 6.28);
      const w = h * (0.75 + rnd() * 0.3);
      im.setMatrixAt(i, m4.compose(pv.set(x, y, z), q, sc.set(w, h, w)));
      im.setColorAt(i, col.setHSL(0.4 + (rnd() - 0.5) * 0.08, 0.3, 0.45 + rnd() * 0.2).multiplyScalar(1.6));
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'cedars';
    scalable.push([im, im.count]);
    group.add(im);
  }

  // The blossom tree on the crest.
  const canopyCentre = new THREE.Vector3();
  {
    const rnd = mulberry32(101);
    const { wood, tips } = blossomTree(rnd);
    const [tx, tz] = TREE_POS; const ty = heightAt(tx, tz);
    const woodMesh = new THREE.Mesh(wood, lit({ vertexColors: true, roughness: 0.85 }));
    woodMesh.position.set(tx, ty, tz); woodMesh.scale.setScalar(1.15); woodMesh.rotation.y = 0.6;
    woodMesh.castShadow = true; woodMesh.receiveShadow = true; woodMesh.name = 'tree-wood';
    group.add(woodMesh);
    woodMesh.updateMatrixWorld(true);
    // Canopy: a few soft inner masses for volume, and many alpha-tested blossom cards for a fluffy silhouette.
    const ico = new THREE.IcosahedronGeometry(0.5, 2);
    ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
    const blob = mergeVertices(ico); ico.dispose();
    { // ruffle the masses so they never read as balls
      const p = blob.getAttribute('position') as THREE.BufferAttribute; const r = mulberry32(4);
      const cache = new Map<string, number>();
      for (let i = 0; i < p.count; i++) {
        const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        let s = cache.get(k); if (s === undefined) { s = 0.75 + r() * 0.45; cache.set(k, s); }
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.8, p.getZ(i) * s);
      }
      blob.computeVertexNormals();
    }
    const tipsW = tips.map((t) => t.clone().applyMatrix4(woodMesh.matrixWorld));
    const col = new THREE.Color();
    const nb = 22;
    const blobs = new THREE.InstancedMesh(blob, lit({ color: '#ffffff', roughness: 0.85 }, { wind: 'canopy', selfGlow: 0.05, lamps: false }), nb);
    for (let i = 0; i < nb; i++) {
      const p = tipsW[i % tipsW.length].clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, (rnd() - 0.4) * 0.8, (rnd() - 0.5) * 1.2));
      const s = 0.75 + rnd() * 0.5;
      q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      blobs.setMatrixAt(i, m4.compose(p, q, sc.set(s, s * 0.75, s)));
      blobs.setColorAt(i, col.set('#b45c86').lerp(new THREE.Color('#d98aae'), rnd() * 0.6));
    }
    blobs.castShadow = true; blobs.receiveShadow = true; blobs.name = 'tree-canopy-core';
    group.add(blobs);
    const bloomTex = canvasTex(128, 128, (g, w) => {
      const r = mulberry32(12);
      g.clearRect(0, 0, w, w);
      for (let i = 0; i < 120; i++) {
        const a0 = r() * 6.28, rr = Math.sqrt(r()) * w * 0.4;
        const cx = w / 2 + Math.cos(a0) * rr, cy = w / 2 + Math.sin(a0) * rr;
        const rad = 6 + r() * 6, rot = r() * 6.28;
        const v = Math.floor(r() * 40);
        g.fillStyle = `rgb(255,${190 + v},${215 + Math.floor(v / 2)})`;
        for (let k = 0; k < 5; k++) {
          const a = rot + (k * Math.PI * 2) / 5;
          g.beginPath(); g.ellipse(cx + Math.cos(a) * rad * 0.55, cy + Math.sin(a) * rad * 0.55, rad * 0.52, rad * 0.36, a, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = 'rgb(214,90,140)'; g.beginPath(); g.arc(cx, cy, rad * 0.22, 0, Math.PI * 2); g.fill();
      }
    });
    const n = tier === 'low' ? 360 : 640;
    const cardMat = lit({ color: '#ffffff', map: bloomTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }, { wind: 'canopy', selfGlow: 0.09, lamps: false });
    const cardGeo = new THREE.PlaneGeometry(1.05, 1.05);
    { // normals lean outward-up so the cards shade like a rounded crown rather than flat confetti
      const nn = cardGeo.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 0.6, 0.8);
    }
    const im = new THREE.InstancedMesh(cardGeo, cardMat, n);
    const crown = tipsW.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / tipsW.length).add(new THREE.Vector3(0, -0.4, 0));
    for (let i = 0; i < n; i++) {
      const tip = tipsW[Math.floor(rnd() * tipsW.length)].clone();
      const spread = 1.0 + rnd() * 0.9;
      const p = tip.add(new THREE.Vector3((rnd() - 0.5) * 2 * spread, (rnd() - 0.3) * spread, (rnd() - 0.5) * 2 * spread));
      canopyCentre.add(p);
      const s = 0.7 + rnd() * 0.6;
      // face outward from the crown (plus a little jitter) so the cards build a fluffy rounded silhouette
      const out = p.clone().sub(crown).normalize().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.7)).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rnd() * 6.28));
      im.setMatrixAt(i, m4.compose(p, q, sc.set(s, s, s)));
      col.set('#ffffff').lerp(new THREE.Color('#ffb8d4'), rnd() * 0.6).multiplyScalar(0.85 + rnd() * 0.2);
      im.setColorAt(i, col);
    }
    canopyCentre.multiplyScalar(1 / n);
    im.castShadow = true; im.receiveShadow = true; im.name = 'tree-canopy';
    scalable.push([im, im.count]);
    group.add(im);
  }

  return {
    group, lamps, glows, daisGlow: daisTop, canopy: canopyCentre,
    setQuality(t: QualityTier) { for (const [m, n] of scalable) m.count = t === 'low' ? Math.ceil(n * 0.6) : n; },
  };
}
