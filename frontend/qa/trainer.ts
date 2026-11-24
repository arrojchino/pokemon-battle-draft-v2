// QA stage for plaza trainers (dev server only, not part of the build):
// http://localhost:5183/pokemon-battle-draft-v2/qa/trainer.html   (?n=5  ?clean  ?reduced)
// Night plaza lighting under the game's renderer settings (NeutralToneMapping 0.82, bloom, PCF shadows).
// One trainer is driven with WASD (Shift jogs), the rest walk circles at different speeds.
// `window.__qa` exposes fps, draw calls, triangles, programs, geometries, textures, the average Trainer.update
// cost, and helpers for scripted checks (spawn, view, drive, record).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Trainer, type TrainerLook } from '../src/engine/character/Trainer.ts';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const info = document.getElementById('info')!;
let reduced = q.has('reduced');

// ---------------------------------------------------------------- renderer + post (brief settings)
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

const scene = new THREE.Scene();
scene.background = new THREE.Color('#060c22');
scene.fog = new THREE.Fog('#0a1430', 9, 30);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 80);
camera.position.set(2.4, 1.2, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.55, 0);
controls.enableDamping = true;

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.15));
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- night plaza
scene.add(new THREE.HemisphereLight('#3a4f8f', '#1a1420', 1.1));
const moon = new THREE.DirectionalLight('#a9bcff', 2.2);
moon.position.set(-4, 7, 3);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 25 });
moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);
const lanterns: [number, number][] = [[2.6, -1.8], [-2.8, 1.6]];
for (const [x, z] of lanterns) {
  const l = new THREE.PointLight('#ffb366', 9, 7, 1.6);
  l.position.set(x, 1.9, z); scene.add(l);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffc070', emissiveIntensity: 4 }));
  glow.position.copy(l.position); scene.add(glow);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.8, 10), new THREE.MeshStandardMaterial({ color: '#2a2f44', roughness: 0.6, metalness: 0.4 }));
  post.position.set(x, 0.9, z); post.castShadow = true; scene.add(post);
}
const floorTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4f63'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = 70 + Math.floor(Math.random() * 22);
    g.fillStyle = `rgb(${v},${v + 4},${v + 20})`;
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 12); t.anisotropy = 8;
  return t;
})();
const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.34, 40), new THREE.MeshBasicMaterial({ color: '#3ee6ff', transparent: true, opacity: 0.8 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; scene.add(ring);

// ---------------------------------------------------------------- trainers
const OUTFITS = ['#2f5fd0', '#e24a5a', '#2ea36b', '#f2f2f6', '#2b2d3a', '#ffb02e', '#8b5cf6', '#1fb8c9', '#c23b8a', '#6b8e23'];
const ACCENTS = ['#ffc94a', '#3ee6ff', '#ff3b4a', '#ffffff', '#ff7a1a', '#7cf27c', '#ff5fa2', '#4a7dff'];
const HAIRS = [undefined, '#2a1d17', '#d8b46a', '#8e3b30', '#1d1c26', '#c9ccd8', '#5c3b2a', undefined];
const lookFor = (i: number): TrainerLook => ({
  outfit: OUTFITS[(i * 3) % OUTFITS.length], accent: ACCENTS[(i * 5 + 1) % ACCENTS.length], hair: HAIRS[i % HAIRS.length], cap: i % 3 !== 2,
});
type Walker = { tr: Trainer; cx: number; cz: number; r: number; w: number; a: number; speed: number; pause: number };
const walkers: Walker[] = [];
let player: Trainer | null = null;
const pv = { x: 0, z: 0, vx: 0, vz: 0, face: 0 };
const keys = new Set<string>();
let walkSpeed = +(q.get("walk") ?? 1.55);
let driveOverride: { dx: number; dz: number; jog: boolean } | null = null;

async function spawn(n: number) {
  for (const w of walkers) w.tr.dispose();
  walkers.length = 0;
  player?.dispose();
  player = await Trainer.load({ outfit: '#2f5fd0', accent: '#ffc94a', hair: '#3b2a22' }, { reducedMotion: reduced });
  scene.add(player.root);
  player.place(pv.x, pv.z, pv.face);
  const speeds = [0, 0.55, 0.9, 1.15, 1.3, 1.6, 2.3, 1.0, 0.75, 1.2];
  for (let i = 1; i < n; i++) {
    const tr = await Trainer.load(lookFor(i), { reducedMotion: reduced });
    const ang = (i / Math.max(1, n - 1)) * Math.PI * 2;
    const rad = 2.2 + (i % 4) * 1.1;
    const speed = speeds[i % speeds.length];
    const r = 0.6 + (i % 3) * 0.35;
    const w: Walker = { tr, cx: Math.cos(ang) * rad, cz: Math.sin(ang) * rad, r, w: speed / r * (i % 2 ? 1 : -1), a: Math.random() * 6, speed, pause: 0 };
    scene.add(tr.root);
    walkers.push(w);
  }
}

// ---------------------------------------------------------------- camera presets
type View = 'side' | 'front' | 'threeq' | 'face' | 'group' | 'free';
let view: View = 'threeq';
function setView(v: View) { view = v; controls.enabled = v === 'free' || v === 'group'; if (v === 'group') { camera.position.set(0, 6.5, 11); controls.target.set(0, 0.4, 0); } }
const camGoal = new THREE.Vector3(), tgtGoal = new THREE.Vector3();
function followCam(dt: number) {
  if (!player || view === 'free' || view === 'group') return;
  const x = player.root.position.x, z = player.root.position.z, f = pv.face;
  const sx = Math.sin(f), cz = Math.cos(f);
  if (view === 'side') { camGoal.set(x + 2.6, 0.55, z); tgtGoal.set(x, 0.48, z); }
  else if (view === 'front') { camGoal.set(x + sx * 2.4, 0.62, z + cz * 2.4); tgtGoal.set(x, 0.5, z); }
  else if (view === 'threeq') { camGoal.set(x + sx * 1.8 + cz * 1.3, 0.85, z + cz * 1.8 - sx * 1.3); tgtGoal.set(x, 0.5, z); }
  else if (view === 'face') { camGoal.set(x + sx * 0.62 + cz * 0.12, 0.9, z + cz * 0.62 - sx * 0.12); tgtGoal.set(x, 0.86, z); }
  const k = 1 - Math.exp(-(view === 'side' ? 30 : 8) * dt);
  camera.position.lerp(camGoal, k); controls.target.lerp(tgtGoal, k);
  camera.lookAt(controls.target);
}

// ---------------------------------------------------------------- input
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'Digit1') void spawn(1);
  if (e.code === 'Digit5') void spawn(5);
  if (e.code === 'Digit2') void spawn(20);
  if (e.code === 'KeyQ') player?.wave();
  if (e.code === 'KeyE') player?.cheer();
});
addEventListener('keyup', e => keys.delete(e.code));
document.querySelectorAll<HTMLButtonElement>('#ui button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.n) void spawn(+b.dataset.n);
  if (b.dataset.cam) setView(b.dataset.cam as View);
  const act = b.dataset.act;
  if (b.dataset.toggle !== undefined) b.classList.toggle('on');
  if (act === 'wave') player?.wave();
  if (act === 'cheer') player?.cheer();
  if (act === 'waveall') { player?.wave(); walkers.forEach((w, i) => (i % 2 ? w.tr.cheer() : w.tr.wave())); }
  if (act === 'reduced') { reduced = b.classList.contains('on'); player?.setReducedMotion(reduced); walkers.forEach(w => w.tr.setReducedMotion(reduced)); }
  if (act === 'fade') player?.setFade(b.classList.contains('on') ? 0.35 : 1);
}));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- recording (filmstrip of the side view)
let rec: { n: number; every: number; next: number; shots: HTMLCanvasElement[]; done: (url: string) => void; cw: number; ch: number } | null = null;
function grab() {
  if (!rec) return;
  const src = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = rec.cw; c.height = rec.ch;
  c.getContext('2d')!.drawImage(src, (src.width - rec.cw) / 2, (src.height - rec.ch) / 2 - src.height * 0.02, rec.cw, rec.ch, 0, 0, rec.cw, rec.ch);
  rec.shots.push(c);
  if (rec.shots.length >= rec.n) {
    const s = document.createElement('canvas');
    s.width = rec.cw * rec.n; s.height = rec.ch;
    const g = s.getContext('2d')!;
    rec.shots.forEach((x, i) => { g.drawImage(x, i * rec!.cw, 0); g.fillStyle = '#fff'; g.font = '16px monospace'; g.fillText(`${i * rec!.every} ms`, i * rec!.cw + 8, 22); });
    const url = s.toDataURL('image/png');
    (document.getElementById('stripImg') as HTMLImageElement).src = url;
    document.getElementById('strip')!.style.display = 'flex';
    const done = rec.done; rec = null; done(url);
  }
}

// ---------------------------------------------------------------- GPU timer (EXT_disjoint_timer_query_webgl2)
const gl = renderer.getContext() as WebGL2RenderingContext;
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const pendingQ: WebGLQuery[] = [];
let gpuAcc = 0, gpuN = 0;
function gpuBegin() { if (!tq || pendingQ.length > 4) return null; const qq = gl.createQuery()!; gl.beginQuery(tq.TIME_ELAPSED_EXT, qq); return qq; }
function gpuEnd(qq: WebGLQuery | null) { if (!qq || !tq) return; gl.endQuery(tq.TIME_ELAPSED_EXT); pendingQ.push(qq); }
function gpuPoll() {
  if (!tq) return;
  while (pendingQ.length && gl.getQueryParameter(pendingQ[0], gl.QUERY_RESULT_AVAILABLE)) {
    const qq = pendingQ.shift()!;
    if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { gpuAcc += gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6; gpuN++; }
    gl.deleteQuery(qq);
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let fps = 0, frames = 0, fpsT = 0, updMs = 0, last = { calls: 0, triangles: 0 };
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now();
  // player input (world axes), eased like a game controller
  if (player) {
    let ix = 0, iz = 0, jog = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (driveOverride) { ix = driveOverride.dx; iz = driveOverride.dz; jog = driveOverride.jog; }
    else { if (keys.has('KeyW')) iz -= 1; if (keys.has('KeyS')) iz += 1; if (keys.has('KeyA')) ix -= 1; if (keys.has('KeyD')) ix += 1; }
    const len = Math.hypot(ix, iz);
    const top = jog ? 2.4 : walkSpeed;
    const tx = len ? (ix / len) * top : 0, tz = len ? (iz / len) * top : 0;
    const acc = 1 - Math.exp(-(len ? 6 : 9) * dt);
    pv.vx += (tx - pv.vx) * acc; pv.vz += (tz - pv.vz) * acc;
    if (Math.hypot(pv.vx, pv.vz) < 0.01 && !len) { pv.vx = pv.vz = 0; }
    pv.x += pv.vx * dt; pv.z += pv.vz * dt;
    if (len) pv.face = Math.atan2(ix, iz);
    player.place(pv.x, pv.z, pv.face);
    player.move(Math.hypot(pv.vx, pv.vz));
    ring.position.x = pv.x; ring.position.z = pv.z;
  }
  for (const w of walkers) {
    if (w.speed > 0) {
      w.a += w.w * dt;
      const x = w.cx + Math.cos(w.a) * w.r, z = w.cz + Math.sin(w.a) * w.r;
      const vx = -Math.sin(w.a) * w.w, vz = Math.cos(w.a) * w.w;
      w.tr.place(x, z, Math.atan2(vx, vz));
      w.tr.move(w.speed);
    } else { w.tr.place(w.cx, w.cz, w.a); w.tr.move(0); }
    if (player) w.tr.lookAt(w.speed === 0 ? player.root.position.clone().setY(0.85) : null);
  }
  const t0 = performance.now();
  player?.update(dt);
  for (const w of walkers) w.tr.update(dt);
  const n = (player ? 1 : 0) + walkers.length;
  updMs += n ? (performance.now() - t0) / n : 0;
  followCam(dt);
  if (controls.enabled) controls.update();
  renderer.info.reset();
  gpuPoll();
  const gq = gpuBegin();
  composer.render(dt);
  gpuEnd(gq);
  last = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  if (rec && now >= rec.next) { grab(); if (rec) rec.next += rec.every; }
  frames++; fpsT += dt;
  if (fpsT >= 0.5) {
    fps = frames / fpsT;
    qa.updateMs = updMs / frames;
    qa.gpuMs = gpuN ? gpuAcc / gpuN : -1; gpuAcc = 0; gpuN = 0;
    frames = 0; fpsT = 0; updMs = 0;
    Object.assign(qa, { fps: Math.round(fps), calls: last.calls, triangles: last.triangles, programs: renderer.info.programs?.length ?? 0, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, n });
    info.textContent = `fps ${qa.fps}  trainers ${n}\ncalls ${qa.calls}  tris ${qa.triangles}\nprograms ${qa.programs}  geo ${qa.geometries}  tex ${qa.textures}\nupdate ${qa.updateMs.toFixed(3)} ms / trainer  gpu ${qa.gpuMs.toFixed(2)} ms\nspeed ${Math.hypot(pv.vx, pv.vz).toFixed(2)} u/s  height ${player?.height.toFixed(3)}`;
  }
}

const qa = {
  fps: 0, calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, updateMs: 0, gpuMs: 0, n: 0,
  spawn: (n: number) => spawn(n),
  view: (v: View) => setView(v),
  drive: (dx: number, dz: number, jog = false) => { driveOverride = dx || dz ? { dx, dz, jog } : null; if (!dx && !dz) driveOverride = { dx: 0, dz: 0, jog: false }; },
  release: () => { driveOverride = null; },
  teleport: (x: number, z: number, face = 0) => { pv.x = x; pv.z = z; pv.vx = pv.vz = 0; pv.face = face; },
  setWalk: (v: number) => { walkSpeed = v; },
  wave: () => player?.wave(), cheer: () => player?.cheer(),
  hideOthers: (h: boolean) => walkers.forEach(w => (w.tr.root.visible = !h)),
  record: (n = 6, every = 80, cw = 520, ch = 620) => new Promise<string>(done => { document.getElementById('strip')!.style.display = 'none'; rec = { n, every, next: performance.now(), shots: [], done, cw, ch }; }),
  hideStrip: () => { document.getElementById('strip')!.style.display = 'none'; },
  get player() { return player; },
  scene, camera, renderer, controls, Trainer,
};
(window as unknown as { __qa: typeof qa }).__qa = qa;

await spawn(+(q.get('n') ?? 1));
setView((q.get('view') as View) ?? 'threeq');
frame();
