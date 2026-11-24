// QA stage for the intro cinematic (dev server only, not part of the build):
// http://localhost:5182/pokemon-battle-draft-v2/qa/intro.html   (?tier=low|medium|high  ?h=1  ?t=6.5  ?paused  ?clean  ?card=0)
// Renders exactly like the game (NeutralToneMapping 0.82, HalfFloat composer, bloom, OutputPass), copies shotAt onto
// the environment's camera every frame, shows a stand-in partner from the reveal beat (with a pop-in flash) and calls
// burst() there, and outlines where the HTML title card sits. `window.__qa` exposes renderer stats and checks.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createIntro } from '../src/engine/scenes/intro/Intro.ts';
import type { EnvShot } from '../src/engine/scenes/types.ts';
import type { QualityTier } from '../src/engine/quality.ts';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const info = document.getElementById('info')!;
const card = document.getElementById('card')!;
if (q.get('card') === '0') card.style.display = 'none';

let tier = (q.get('tier') as QualityTier) || 'high';
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const tBuild = performance.now();
let env = createIntro({ tier });
const buildMs = Math.round(performance.now() - tBuild);
let composer: EffectComposer;
function buildComposer() {
  composer?.passes.forEach((p) => p.dispose());
  composer?.dispose();
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: tier === 'high' ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(env.scene, env.camera));
  if (tier !== 'low') composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.15));
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
}
buildComposer();

// Stand-in partner: a stylised capsule creature of height 1 (scaled to the chosen height).
let height = Number(q.get('h') ?? 1);
const partner = new THREE.Group();
const pmBody = new THREE.MeshStandardMaterial({ color: '#ffd34d', roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0 });
const pmDark = new THREE.MeshStandardMaterial({ color: '#2a2230', roughness: 0.4 });
const pmCheek = new THREE.MeshStandardMaterial({ color: '#ff3b4a', roughness: 0.5 });
{
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.4, 8, 20), pmBody); body.position.y = 0.5; body.scale.set(1, 1, 0.9);
  const earG = new THREE.ConeGeometry(0.075, 0.3, 12);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earG, pmBody); ear.position.set(s * 0.17, 0.92, 0); ear.rotation.z = -s * 0.35;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 10), pmDark); tip.position.y = 0.11; ear.add(tip);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), pmDark); eye.position.set(s * 0.11, 0.66, 0.26);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), pmCheek); cheek.position.set(s * 0.2, 0.55, 0.22); cheek.scale.set(1, 1, 0.4);
    partner.add(ear, eye, cheek);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.18), pmBody); tail.position.set(0.18, 0.4, -0.3); tail.rotation.set(0.5, 0, -0.6);
  partner.add(body, tail);
  partner.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
}
const partnerRoot = new THREE.Group(); partnerRoot.add(partner);
function placePartner() {
  env.scene.add(partnerRoot);
  partnerRoot.position.set(env.partnerSpot.x, 0.205, env.partnerSpot.z);
  partnerRoot.rotation.y = env.partnerSpot.face;
  env.setPartnerHeight(height);
}
placePartner();

const REVEAL = env.beats.find((b) => b.kind === 'reveal')!.t;
const TITLE = env.beats.find((b) => b.kind === 'title')!.t;
let t = Number(q.get('t') ?? 0);
let paused = q.has('paused');
let revealed = false;
const shot: EnvShot = { pos: [0, 0, 0], target: [0, 0, 0], fov: 36 };

function applyTime(dtWall: number) {
  // Deterministic: replays the reveal at its beat when scrubbing past it.
  const wasRevealed = revealed;
  revealed = t >= REVEAL;
  if (revealed && !wasRevealed) { env.update(REVEAL, 0); env.burst(); }
  env.update(t, dtWall);
  const pt = t - REVEAL;
  partnerRoot.visible = revealed;
  if (revealed) {
    // pop out of the send-out flash: overshoot then settle; white emissive fades
    const k = Math.min(1, pt / 0.35);
    const s = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + 0.18 * Math.sin(k * Math.PI)) : 1;
    partner.scale.setScalar(height * Math.max(0.001, s));
    pmBody.emissiveIntensity = 3 * Math.exp(-pt * 5);
  }
  card.style.opacity = t >= TITLE ? '1' : '0';
  env.shotAt(t, shot);
  env.camera.position.set(...shot.pos);
  env.camera.lookAt(...shot.target);
  env.camera.fov = shot.fov;
  env.camera.aspect = innerWidth / innerHeight;
  env.camera.updateProjectionMatrix();
}

// UI
const scrub = document.getElementById('scrub') as HTMLInputElement;
const tlabel = document.getElementById('tlabel')!;
const playBtn = document.getElementById('play')!;
scrub.max = String(env.duration);
scrub.addEventListener('input', () => { t = Number(scrub.value); paused = true; playBtn.textContent = 'Play (P)'; });
playBtn.addEventListener('click', () => { paused = !paused; playBtn.textContent = paused ? 'Play (P)' : 'Pause (P)'; });
document.getElementById('restart')!.addEventListener('click', () => { t = 0; });
document.querySelectorAll<HTMLButtonElement>('[data-h]').forEach((b) => b.addEventListener('click', () => {
  height = Number(b.dataset.h); env.setPartnerHeight(height);
  document.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.addEventListener('click', () => {
  setTier(b.dataset.tier as QualityTier);
  document.querySelectorAll('[data-tier]').forEach((x) => x.classList.toggle('on', x === b));
}));
const JUMPS = [1, 3, 4.5, 6.5, 8, 9.5, 12.5];
addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') t = 0;
  if (e.key === 'p' || e.key === 'P') { paused = !paused; playBtn.textContent = paused ? 'Play (P)' : 'Pause (P)'; }
  const n = Number(e.key);
  if (n >= 1 && n <= JUMPS.length) { t = JUMPS[n - 1]; }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

function setTier(next: QualityTier) {
  tier = next;
  env.setQuality(next);
  renderer.shadowMap.enabled = next !== 'low';
  buildComposer();
}

// Checks
function smoothness() {
  const dt = 1 / 60; const s: EnvShot = { pos: [0, 0, 0], target: [0, 0, 0], fov: 36 };
  const P: number[][] = [], T: number[][] = [];
  for (let k = 0; k * dt <= env.duration + 1e-9; k++) { env.shotAt(k * dt, s); P.push([...s.pos]); T.push([...s.target]); }
  const acc = (A: number[][], i: number) => A[i].map((v, j) => (A[i + 1][j] - 2 * v + A[i - 1][j]) / (dt * dt));
  const len = (v: number[]) => Math.hypot(...v);
  let maxJumpP = 0, maxJumpT = 0, maxAccP = 0, maxVel = 0, atP = 0;
  for (let i = 1; i < P.length - 2; i++) {
    const a0 = acc(P, i), a1 = acc(P, i + 1);
    const j = len(a1.map((v, k) => v - a0[k]));
    if (j > maxJumpP) { maxJumpP = j; atP = i * dt; }
    maxAccP = Math.max(maxAccP, len(a0));
    maxVel = Math.max(maxVel, len(P[i + 1].map((v, k) => (v - P[i][k]) / dt)));
    const b0 = acc(T, i), b1 = acc(T, i + 1);
    maxJumpT = Math.max(maxJumpT, len(b1.map((v, k) => v - b0[k])));
  }
  // end at rest
  const vEnd = len(P[P.length - 1].map((v, k) => (v - P[P.length - 2][k]) / dt));
  return { samples: P.length, maxAccelJumpPos: +maxJumpP.toFixed(4), at: +atP.toFixed(2), maxAccelJumpTarget: +maxJumpT.toFixed(4), maxAccel: +maxAccP.toFixed(3), maxSpeed: +maxVel.toFixed(3), endSpeed: +vEnd.toFixed(5) };
}
/** Minimum camera clearance above the ground over the whole timeline. */
function clearance() {
  const s: EnvShot = { pos: [0, 0, 0], target: [0, 0, 0], fov: 36 };
  let min = Infinity, at = 0;
  for (let k = 0; k <= env.duration * 60; k++) {
    env.shotAt(k / 60, s);
    const c = s.pos[1] - env.debug.heightAt(s.pos[0], s.pos[2]);
    if (c < min) { min = c; at = k / 60; }
  }
  return { min: +min.toFixed(3), at: +at.toFixed(2) };
}
/** Partner framing from the reveal to the end, for several heights: NDC extents of its bounding box. */
function framing(aspect = 16 / 9) {
  const cam = new THREE.PerspectiveCamera(36, aspect, 0.1, 600);
  const s: EnvShot = { pos: [0, 0, 0], target: [0, 0, 0], fov: 36 };
  const res: Record<string, { inLetterbox: boolean; minY: number; maxY: number; minX: number; maxX: number; worstAt: number }> = {};
  for (const h of [0.4, 0.5, 1.0, 1.5, 2.0, 2.2]) {
    env.setPartnerHeight(h);
    let minY = 9, maxY = -9, minX = 9, maxX = -9, worstAt = 0, worst = -9;
    for (let k = Math.ceil(REVEAL * 30); k <= env.duration * 30; k++) {
      env.shotAt(k / 30, s);
      cam.position.set(...s.pos); cam.lookAt(...s.target); cam.fov = s.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      for (const [x, y, z] of [[-0.3 * h, 0.205, 0], [0.3 * h, 0.205, 0], [-0.3 * h, 0.205 + h, 0], [0.3 * h, 0.205 + h, 0]]) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        const w = Math.max(Math.abs(v.x), Math.abs(v.y));
        if (w > worst) { worst = w; worstAt = k / 30; }
      }
    }
    res[`h${h}`] = { inLetterbox: maxY < 0.82 && minY > -0.82 && maxX < 0.97 && minX > -0.97, minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), minX: +minX.toFixed(3), maxX: +maxX.toFixed(3), worstAt };
  }
  env.setPartnerHeight(height);
  return res;
}

type QA = { fps: number; calls: number; triangles: number; points: number; programs: number; geometries: number; textures: number; t: number; tier: string; ready: boolean;
  seek(t: number): void; pause(p: boolean): void; setHeight(h: number): void; setTier(t: QualityTier): void; smooth: typeof smoothness; clearance: typeof clearance; framing: typeof framing; disposeTest(): object };
const qa = {
  fps: 0, calls: 0, triangles: 0, points: 0, programs: 0, geometries: 0, textures: 0, t: 0, tier, ready: false, buildMs,
  seek(nt: number) { t = nt; paused = true; },
  pause(p: boolean) { paused = p; },
  setHeight(h: number) { height = h; env.setPartnerHeight(h); },
  setTier,
  smooth: smoothness, clearance, framing,
  breakdown() {
    const out: Record<string, number> = {};
    env.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const g = m.geometry as THREE.BufferGeometry;
      const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : ((g as THREE.InstancedBufferGeometry).instanceCount ?? 1);
      const k = (m.name || m.parent?.name || 'unnamed') + (m.castShadow ? ' [cast]' : '');
      out[k] = (out[k] ?? 0) + Math.round(n * (Number.isFinite(inst) ? inst : 1));
    });
    return out;
  },
  disposeTest() {
    const before = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    env.scene.remove(partnerRoot);
    env.dispose();
    renderer.renderLists.dispose();
    const after = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    env = createIntro({ tier }); placePartner(); revealed = false; buildComposer();
    return { before, after };
  },
} as QA;
(window as unknown as { __qa: QA }).__qa = qa;

let last = performance.now(); let acc = 0, frames = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) { t += dt; if (t > env.duration + 1.2) t = 0; }
  applyTime(dt);
  renderer.info.reset();
  composer.render(dt);
  acc += dt; frames++;
  if (acc > 0.5) {
    qa.fps = Math.round(frames / acc); acc = 0; frames = 0;
  }
  const i = renderer.info;
  qa.calls = i.render.calls; qa.triangles = i.render.triangles; qa.points = i.render.points; qa.programs = i.programs?.length ?? 0;
  qa.geometries = i.memory.geometries; qa.textures = i.memory.textures; qa.t = +t.toFixed(2); qa.tier = tier; qa.ready = true;
  scrub.value = String(Math.min(t, env.duration)); tlabel.textContent = t.toFixed(2);
  info.textContent = `t ${t.toFixed(2)} / ${env.duration}  ${paused ? '(paused)' : ''}\nfps ${qa.fps}  tier ${tier}  h ${height}\ncalls ${qa.calls}  tris ${qa.triangles}\npoints ${qa.points}  programs ${qa.programs}\ngeo ${qa.geometries}  tex ${qa.textures}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
