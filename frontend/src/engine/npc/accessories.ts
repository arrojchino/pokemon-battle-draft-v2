// Small props modelled in code for the presenter: a Pokémon Center nurse cap (with a Poké Ball emblem) that is
// shaped to sit on the model's own hair, and a slim presenter headset microphone. Both use three-vrm's
// MToonMaterial so they shade like the rest of the toon model. Coordinates are head-local in body space
// (VRM 1.0 frame: face +Z, left +X, model metres, origin at the head bone).
import * as THREE from 'three';
import { MToonMaterial, type MToonMaterialParameters } from '@pixiv/three-vrm';
import { lerp } from './rig.js';

export interface HeightField { at(x: number, z: number): number }

/** Top surface of the hair (max height per 1 cm cell, head-local), from the hair meshes' bind pose. */
export function hairHeightField(meshes: THREE.Mesh[], headRest: THREE.Vector3, flip: boolean): HeightField {
  const N = 48, R = 0.24, cell = (2 * R) / N;
  const grid = new Float32Array(N * N).fill(-Infinity);
  const seen = new Set<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    if (!pos || seen.has(pos)) continue;
    seen.add(pos);
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), z = pos.getZ(i);
      if (flip) { x = -x; z = -z; }
      x -= headRest.x; z -= headRest.z;
      const y = pos.getY(i) - headRest.y;
      const gx = Math.floor((x + R) / cell), gz = Math.floor((z + R) / cell);
      if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
      const k = gz * N + gx;
      if (y > grid[k]) grid[k] = y;
    }
  }
  return {
    at(x: number, z: number) {
      const gx = Math.floor((x + R) / cell), gz = Math.floor((z + R) / cell);
      let best = -Infinity;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const ix = gx + dx, iz = gz + dz;
        if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
        best = Math.max(best, grid[iz * N + ix]);
      }
      return best;
    },
  };
}

function toon(color: THREE.ColorRepresentation, shade: THREE.ColorRepresentation, extra: MToonMaterialParameters = {}) {
  return new MToonMaterial({
    color: new THREE.Color(color),
    shadeColorFactor: new THREE.Color(shade),
    shadingToonyFactor: 0.88,
    shadingShiftFactor: -0.05,
    ...extra,
  });
}

/** Band texture: white cloth, a rose trim along the lower edge, a thin one on top, and the Poké Ball emblem. */
function capTexture(arcLen: number, height: number): THREE.CanvasTexture {
  const W = 512, H = Math.max(32, Math.round((W * height) / arcLen));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#f6eef2');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f07a9a'; g.fillRect(0, H * 0.82, W, H * 0.18);       // rose trim (bottom)
  g.fillStyle = '#f7b3c6'; g.fillRect(0, H * 0.04, W, H * 0.05);       // fine trim (top)
  // Poké Ball emblem, centred on the front
  const cx = W / 2, cy = H * 0.45, r = H * 0.3;
  g.lineWidth = r * 0.16; g.strokeStyle = '#2d2230';
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fillStyle = '#e8384f'; g.fill();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2d2230'; g.fillRect(cx - r, cy - r * 0.09, r * 2, r * 0.18);
  g.beginPath(); g.arc(cx, cy, r * 0.34, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx, cy, r * 0.21, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  // a soft highlight on the red half
  g.beginPath(); g.arc(cx - r * 0.38, cy - r * 0.5, r * 0.16, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export interface CapOptions { centerZ?: number; rx?: number; rz?: number; span?: number; height?: number; lean?: number; sink?: number }

/** The nurse cap: a leaning band wrapped over the crown, closed by a folded top panel. */
export function buildNurseCap(hair: HeightField, o: CapOptions = {}): THREE.Group {
  const cz = o.centerZ ?? -0.02, rx = o.rx ?? 0.088, rz = o.rz ?? 0.088, span = o.span ?? THREE.MathUtils.degToRad(68);
  const H0 = o.height ?? 0.052, lean = o.lean ?? THREE.MathUtils.degToRad(24), sink = o.sink ?? 0.012;
  const N = 36;
  // bottom edge follows the hair (smoothed so single strands don't make it wobble)
  const raw: number[] = [];
  for (let i = 0; i <= N; i++) {
    const th = lerp(-span, span, i / N);
    const x = rx * Math.sin(th), z = cz + rz * Math.cos(th);
    const h = hair.at(x, z);
    raw.push(Number.isFinite(h) ? h : 0.2);
  }
  const ys = raw.map((_, i) => { let s = 0, n = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j <= N) { s += raw[j]; n++; } } return s / n - sink; });
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const top: THREE.Vector3[] = [];
  let arc = 0;
  for (let i = 0; i <= N; i++) {
    const th = lerp(-span, span, i / N);
    const x = rx * Math.sin(th), z = cz + rz * Math.cos(th);
    const inward = new THREE.Vector3(-Math.sin(th) * rx, 0, -Math.cos(th) * rz).normalize();
    const h = H0 * (0.78 + 0.22 * Math.cos(th));                     // a touch taller at the front
    const b = new THREE.Vector3(x, ys[i], z);
    const t = b.clone().add(new THREE.Vector3(0, h * Math.cos(lean), 0)).addScaledVector(inward, h * Math.sin(lean));
    top.push(t);
    pos.push(b.x, b.y, b.z, t.x, t.y, t.z);
    if (i > 0) arc += rx * (span * 2 / N);
    uv.push(i / N, 0, i / N, 1);
    if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  band.setIndex(idx); band.computeVertexNormals();
  const tex = capTexture(arc, H0);
  const bandMat = toon('#ffffff', '#e3c9d6', { map: tex, side: THREE.DoubleSide });
  // folded top panel: from the band's top edge back toward the crown
  const tp: number[] = [], ti: number[] = [];
  const back = new THREE.Vector3(0, 0, cz - rz * 0.35);
  const avgY = top.reduce((s, v) => s + v.y, 0) / top.length;
  for (let i = 0; i <= N; i++) {
    const a = top[i];
    const b2 = a.clone().lerp(new THREE.Vector3(a.x * 0.92, avgY + 0.004, back.z), 0.78);
    tp.push(a.x, a.y, a.z, b2.x, b2.y, b2.z);
    if (i < N) { const k = i * 2; ti.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const lid = new THREE.BufferGeometry();
  lid.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  lid.setIndex(ti); lid.computeVertexNormals();
  const lidMat = toon('#fbf7f9', '#dcc3cf', { side: THREE.DoubleSide });
  const g = new THREE.Group(); g.name = 'NurseCap';
  const bandMesh = new THREE.Mesh(band, bandMat); bandMesh.name = 'NurseCapBand';
  const lidMesh = new THREE.Mesh(lid, lidMat); lidMesh.name = 'NurseCapTop';
  g.add(bandMesh, lidMesh);
  return g;
}

export interface HeadsetOptions { side?: 1 | -1 }

/** A slim boom microphone from under the hair at the ear to just beside the mouth. */
export function buildHeadset(o: HeadsetOptions = {}): THREE.Group {
  const s = o.side ?? 1;
  const pts = [
    new THREE.Vector3(0.079 * s, 0.032, -0.004),
    new THREE.Vector3(0.083 * s, 0.014, 0.036),
    new THREE.Vector3(0.071 * s, 0.002, 0.072),
    new THREE.Vector3(0.046 * s, -0.004, 0.097),
    new THREE.Vector3(0.026 * s, -0.006, 0.106),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const dark = toon('#2f2a35', '#1b1720');
  const pink = toon('#ff7da1', '#d65a80');
  const boom = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0021, 8, false), dark); boom.name = 'HeadsetBoom';
  const tip = curve.getPoint(1);
  const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.009, 4, 10), dark); mic.name = 'HeadsetMic';
  mic.position.copy(tip);
  mic.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0064, 0.0013, 6, 16), pink); ring.name = 'HeadsetRing';
  ring.position.copy(curve.getPoint(0.94));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangent(0.94).normalize());
  const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 20), dark); ear.name = 'HeadsetEar';
  ear.position.set(0.082 * s, 0.035, -0.008); ear.rotation.z = Math.PI / 2;
  const earCap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 20), pink);
  earCap.position.set(0.089 * s, 0.035, -0.008); earCap.rotation.z = Math.PI / 2;
  const g = new THREE.Group(); g.name = 'Headset';
  g.add(boom, mic, ring, ear, earCap);
  return g;
}
