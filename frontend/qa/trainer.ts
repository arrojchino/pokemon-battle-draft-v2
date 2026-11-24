// QA stage for plaza trainers (dev server only, not part of the build):
// http://localhost:5183/pokemon-battle-draft-v2/qa/trainer.html   (?n=5  ?clean  ?reduced  ?model=<id>  ?floor=0.205)
// The floor sits at the game's FLOOR_Y (0.205) by default and carries a ground course along +z: paving, a copy of
// the town's partner stage (deck +0.012, rim +0.03), a 0.05 curb step and a 0.1 ramp. Every trainer stands on it
// through `Trainer.setGround`, and the info box reads the foot contact of the player's soles against the ground
// under each sole vertex (`__qa.contact()`, `__qa.course()` walks the whole course and returns the worst gaps).
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
import { TRAINER_MODELS, DEFAULT_TRAINER, isTrainerId, type TrainerId } from '../../shared/src/trainers.ts';
import { bonePoolStats } from '../src/engine/character/trainerAsset.ts';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const info = document.getElementById('info')!;
let reduced = q.has('reduced');
let model: TrainerId = isTrainerId(q.get('model')) ? q.get('model') as TrainerId : DEFAULT_TRAINER;
const G = +(q.get('floor') ?? 0.205);

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
floor.rotation.x = -Math.PI / 2; floor.position.y = G; floor.receiveShadow = true; scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.34, 40), new THREE.MeshBasicMaterial({ color: '#3ee6ff', transparent: true, opacity: 0.8 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = G + 0.004; scene.add(ring);

// ---------------------------------------------------------------- ground course (analytic heights + matching meshes)
const STAGE = { x: 0, z: 0, r: 1.05 };
const CURB = { x0: -1.5, x1: 1.5, z0: 2.5, z1: 3.5, h: 0.05 };
const RAMP = { x0: -1.5, x1: 1.5, z0: 4.5, z1: 6, z2: 7, z3: 8.5, h: 0.1 };
/** Ground height (world y) at a point: the same numbers the meshes below are built from. */
function heightAt(x: number, z: number): number {
  let h = 0;
  const r = Math.hypot(x - STAGE.x, z - STAGE.z);
  if (r < STAGE.r - 0.005) h = 0.012;                                  // wooden deck (town: cyl 0.06 at -0.018)
  else if (r < STAGE.r + 0.1) h = 0.03;                                // stone rim top
  else if (r < STAGE.r + 0.115) h = 0.03 * (1 - (r - STAGE.r - 0.1) / 0.015);
  if (x > CURB.x0 && x < CURB.x1 && z > CURB.z0 && z < CURB.z1) h = Math.max(h, CURB.h);
  if (x > RAMP.x0 && x < RAMP.x1 && z > RAMP.z0 && z < RAMP.z3) {
    const k = z < RAMP.z1 ? (z - RAMP.z0) / (RAMP.z1 - RAMP.z0) : z < RAMP.z2 ? 1 : 1 - (z - RAMP.z2) / (RAMP.z3 - RAMP.z2);
    h = Math.max(h, RAMP.h * k);
  }
  return G + h;
}
{
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.7 });
  const stone = new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(STAGE.r, STAGE.r, 0.06, 48), wood);
  deck.position.set(STAGE.x, G - 0.018, STAGE.z);
  const rim = new THREE.Mesh(new THREE.LatheGeometry([[STAGE.r - 0.005, -0.03], [STAGE.r - 0.005, 0.03], [STAGE.r + 0.1, 0.03], [STAGE.r + 0.13, -0.03]].map(([a, b]) => new THREE.Vector2(a, b)), 48), stone);
  rim.position.set(STAGE.x, G, STAGE.z);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(CURB.x1 - CURB.x0, CURB.h, CURB.z1 - CURB.z0), stone);
  curb.position.set((CURB.x0 + CURB.x1) / 2, G + CURB.h / 2, (CURB.z0 + CURB.z1) / 2);
  const prof = new THREE.Shape();
  prof.moveTo(RAMP.z0, 0); prof.lineTo(RAMP.z1, RAMP.h); prof.lineTo(RAMP.z2, RAMP.h); prof.lineTo(RAMP.z3, 0); prof.lineTo(RAMP.z0, 0);
  const rampGeo = new THREE.ExtrudeGeometry(prof, { depth: RAMP.x1 - RAMP.x0, bevelEnabled: false });
  rampGeo.rotateY(-Math.PI / 2);                                       // shape x -> world z, extrusion -> world x
  const ramp = new THREE.Mesh(rampGeo, wood);
  ramp.position.set(RAMP.x0, G, 0);
  for (const m of [deck, rim, curb, ramp]) { m.receiveShadow = true; scene.add(m); }
}

// ---------------------------------------------------------------- foot contact probe (player only)
// Every body vertex skinned mostly to a foot or toe bone is a sole candidate; each frame the lowest gap
// between such a vertex and the ground under it is that foot's contact (negative: inside the ground).
type Probe = { tr: Trainer; lists: [number[], number[]] };
let probe: Probe | null = null;
const _pv = new THREE.Vector3();
type Priv = { body: THREE.SkinnedMesh; bones: THREE.Bone[]; hb: Record<string, THREE.Bone | undefined>; feet: { planted: boolean; settle: boolean; pitch: number }[]; sp: number };
const priv = (tr: Trainer) => tr as unknown as Priv;
function makeProbe(tr: Trainer): Probe {
  const p = priv(tr);
  const geo = p.body.geometry, si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const idx = (n: string) => { const b = p.hb[n]; return b ? p.bones.indexOf(b) : -2; };
  const sets = [[idx('leftFoot'), idx('leftToes')], [idx('rightFoot'), idx('rightToes')]];
  const lists: [number[], number[]] = [[], []];
  for (let i = 0; i < si.count; i++) {
    let best = -1, bw = 0;
    for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
    for (let k = 0; k < 2; k++) if (sets[k].includes(best)) lists[k].push(i);
  }
  return { tr, lists };
}
/** Lowest sole gap per foot (world units, sole minus ground under it). */
function contact(): [number, number] | null {
  if (!probe) return null;
  const p = priv(probe.tr), pos = p.body.geometry.getAttribute('position');
  probe.tr.root.updateMatrixWorld(true);
  const out: [number, number] = [Infinity, Infinity];
  for (let k = 0; k < 2; k++) for (const i of probe.lists[k]) {
    _pv.fromBufferAttribute(pos, i); p.body.applyBoneTransform(i, _pv); _pv.applyMatrix4(p.body.matrixWorld);
    const gap = _pv.y - heightAt(_pv.x, _pv.z);
    if (gap < out[k]) out[k] = gap;
  }
  return out;
}
type Stat = { plantedMin: number; plantedMax: number; anyMin: number; n: number };
const stats = new Map<string, Stat>();
let statKey = 'free';
function sampleContact() {
  const c = contact();
  if (!c || !probe) return null;
  const f = priv(probe.tr).feet;
  let st = stats.get(statKey);
  if (!st) { st = { plantedMin: Infinity, plantedMax: -Infinity, anyMin: Infinity, n: 0 }; stats.set(statKey, st); }
  for (let k = 0; k < 2; k++) {
    st.anyMin = Math.min(st.anyMin, c[k]);
    if (f[k].planted && !f[k].settle) { st.plantedMin = Math.min(st.plantedMin, c[k]); st.plantedMax = Math.max(st.plantedMax, c[k]); }
  }
  st.n++;
  return c;
}

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
  player = await Trainer.load({ outfit: '#2f5fd0', accent: '#ffc94a', hair: '#3b2a22' }, { reducedMotion: reduced, model });
  player.root.position.y = G;
  player.setGround(heightAt);
  scene.add(player.root);
  player.place(pv.x, pv.z, pv.face);
  probe = makeProbe(player);
  const speeds = [0, 0.55, 0.9, 1.15, 1.3, 1.6, 2.3, 1.0, 0.75, 1.2];
  for (let i = 1; i < n; i++) {
    const tr = await Trainer.load(lookFor(i), { reducedMotion: reduced, model: TRAINER_MODELS[i % TRAINER_MODELS.length].id });
    tr.root.position.y = G;
    tr.setGround(heightAt);
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
type View = 'side' | 'front' | 'threeq' | 'face' | 'group' | 'free' | 'feet';
let view: View = 'threeq';
function setView(v: View) { view = v; controls.enabled = v === 'free' || v === 'group'; if (v === 'group') { camera.position.set(0, 6.5, 11); controls.target.set(0, G + 0.4, 0); } }
const camGoal = new THREE.Vector3(), tgtGoal = new THREE.Vector3();
function followCam(dt: number) {
  if (!player || view === 'free' || view === 'group') return;
  const x = player.root.position.x, z = player.root.position.z, f = pv.face, y0 = G;
  const sx = Math.sin(f), cz = Math.cos(f);
  if (view === 'side') { camGoal.set(x + 2.6, y0 + 0.55, z); tgtGoal.set(x, y0 + 0.48, z); }
  else if (view === 'front') { camGoal.set(x + sx * 2.4, y0 + 0.62, z + cz * 2.4); tgtGoal.set(x, y0 + 0.5, z); }
  else if (view === 'threeq') { camGoal.set(x + sx * 1.8 + cz * 1.3, y0 + 0.85, z + cz * 1.8 - sx * 1.3); tgtGoal.set(x, y0 + 0.5, z); }
  else if (view === 'face') { camGoal.set(x + sx * 0.62 + cz * 0.12, y0 + 0.9, z + cz * 0.62 - sx * 0.12); tgtGoal.set(x, y0 + 0.86, z); }
  else if (view === 'feet') { camGoal.set(x + 1.1, y0 + 0.16, z + 0.25); tgtGoal.set(x, y0 + 0.08, z); }
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
  if (e.code === 'KeyC') void runCourse().then(r => console.table(r));
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
  if (act === 'course') void runCourse().then(r => console.table(r));
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
    ring.position.set(pv.x, heightAt(pv.x, pv.z) + 0.004, pv.z);
  }
  for (const w of walkers) {
    if (w.speed > 0) {
      w.a += w.w * dt;
      const x = w.cx + Math.cos(w.a) * w.r, z = w.cz + Math.sin(w.a) * w.r;
      const vx = -Math.sin(w.a) * w.w, vz = Math.cos(w.a) * w.w;
      w.tr.place(x, z, Math.atan2(vx, vz));
      w.tr.move(w.speed);
    } else { w.tr.place(w.cx, w.cz, w.a); w.tr.move(0); }
    if (player) w.tr.lookAt(w.speed === 0 ? player.root.position.clone().setY(G + 0.85) : null);
  }
  const t0 = performance.now();
  player?.update(dt);
  for (const w of walkers) w.tr.update(dt);
  for (const t of extra) t.update(dt);
  const n = (player ? 1 : 0) + walkers.length;
  updMs += n ? (performance.now() - t0) / n : 0;
  if (course) course.tick(dt);
  const cc = sampleContact();
  if (cc) { lastContact = cc; }
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
    const ft = player ? priv(player).feet : null;
    const mm = (v: number) => `${v >= 0 ? '+' : ''}${(v * 1000).toFixed(1)}`;
    const foot = (k: number) => ft ? `${k ? 'R' : 'L'} ${ft[k].planted && !ft[k].settle ? 'down' : 'step'} ${mm(lastContact[k])} mm` : '';
    const st = stats.get(statKey);
    info.textContent = `fps ${qa.fps}  trainers ${n}  model ${model}\ncalls ${qa.calls}  tris ${qa.triangles}\nprograms ${qa.programs}  geo ${qa.geometries}  tex ${qa.textures}\nupdate ${qa.updateMs.toFixed(3)} ms / trainer  gpu ${qa.gpuMs.toFixed(2)} ms\nspeed ${Math.hypot(pv.vx, pv.vz).toFixed(2)} u/s  height ${player?.height.toFixed(3)}\nground ${mm(heightAt(pv.x, pv.z) - G)} mm  ${course ? course.label : statKey}\nsole ${foot(0)}   ${foot(1)}\nplanted gap ${st ? `${mm(st.plantedMin)} .. ${mm(st.plantedMax)}` : '-'} mm  min ${st ? mm(st.anyMin) : '-'}`;
  }
}

let lastContact: [number, number] = [0, 0];

// ---------------------------------------------------------------- picker portraits (offline assets)
/**
 * Render every trainer model for the picker on a small transparent canvas: a neutral portrait (light grey
 * outfit) and an outfit mask (where a red and a blue outfit differ). Resolves with PNG data URLs per model;
 * the picker multiplies the player's colour through the mask. Saved to public/trainers/<id>.png and
 * <id>-mask.png (see docs/ASSETS.md).
 */
async function portraits(w = 192, h = 256) {
  const r2 = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r2.setPixelRatio(1); r2.setSize(w, h);
  r2.outputColorSpace = THREE.SRGBColorSpace; r2.toneMapping = THREE.NeutralToneMapping; r2.toneMappingExposure = 1.0;
  r2.setClearColor(0x000000, 0);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight('#e4e9ff', '#3a3442', 1.5));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(1.4, 3, 4); sc.add(key);
  const rim = new THREE.DirectionalLight('#a9c6ff', 1.3); rim.position.set(-2.5, 2, -3); sc.add(rim);
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.05, 30);
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const g = c2.getContext('2d', { willReadFrequently: true })!;
  const grab = () => { g.clearRect(0, 0, w, h); g.drawImage(r2.domElement, 0, 0); return g.getImageData(0, 0, w, h); };
  const out: Record<string, { png: string; mask: string }> = {};
  const hair = '#5c3b2a';
  for (const m of TRAINER_MODELS) {
    const tr = await Trainer.load({ outfit: '#dcdce4', accent: '#dcdce4', hair }, { model: m.id, reducedMotion: true });
    sc.add(tr.root); tr.place(0, 0, 0.32);
    for (let i = 0; i < 40; i++) tr.update(1 / 30);
    const H = tr.height;
    cam.position.set(0.0, H * 0.6, H * 2.75); cam.lookAt(0, H * 0.5, 0); cam.updateMatrixWorld();
    r2.render(sc, cam); r2.render(sc, cam);
    const neutral = grab();
    g.putImageData(neutral, 0, 0); const png = c2.toDataURL('image/png');
    tr.setLook({ outfit: '#ff0000', accent: '#ff0000', hair }); r2.render(sc, cam); const red = grab();
    tr.setLook({ outfit: '#0000ff', accent: '#0000ff', hair }); r2.render(sc, cam); const blue = grab();
    const mk = g.createImageData(w, h);
    for (let i = 0; i < red.data.length; i += 4) {
      const d = ((red.data[i] - blue.data[i]) + (blue.data[i + 2] - red.data[i + 2])) / 2;
      const a = Math.max(0, Math.min(1, (d - 6) / 70)) * (neutral.data[i + 3] / 255);
      mk.data[i] = mk.data[i + 1] = mk.data[i + 2] = 255; mk.data[i + 3] = Math.round(a * 255);
    }
    g.putImageData(mk, 0, 0);
    out[m.id] = { png, mask: c2.toDataURL('image/png') };
    tr.dispose();
  }
  r2.dispose();
  return out;
}

// ---------------------------------------------------------------- bone pool stress + culling check
const extra: Trainer[] = [];
/**
 * Create and dispose trainers `cycles` times keeping `alive` of them (each disposed one is disposed twice to
 * exercise the guard), then line the survivors up in front of the camera. Resolves with the pool stats and,
 * per survivor, its bone slot and whether its slice of the pool holds non-zero matrices after a frame.
 */
async function poolCycle(cycles = 45, alive = 5) {
  for (const t of extra.splice(0)) t.dispose();
  for (let i = 0; i < cycles; i++) {
    const tr = await Trainer.load(lookFor(i + 3), { reducedMotion: reduced, model: TRAINER_MODELS[i % TRAINER_MODELS.length].id });
    tr.root.position.y = G; tr.setGround(heightAt);
    scene.add(tr.root);
    tr.place(-2 + (i % 5), -2.5, 0);
    extra.push(tr);
    if (extra.length > alive) { const old = extra.shift()!; old.dispose(); old.dispose(); }
  }
  extra.forEach((t, i) => t.place(-1.6 + i * 0.8, 1.6, 0));
  await new Promise(r => setTimeout(r, 600));
  const slices = extra.map(t => {
    const p = t as unknown as { pool: { data: Float32Array; stride: number; tex: THREE.Texture }; slot: number };
    const a = p.slot * p.pool.stride * 16, b = a + p.pool.stride * 16;
    let nz = 0; for (let k = a; k < b; k++) if (p.pool.data[k] !== 0) nz++;
    return { slot: p.slot, tex: p.pool.tex.id, nonZero: nz, inScene: !!t.root.parent };
  });
  return { pools: bonePoolStats(), slices, distinct: new Set(slices.map(x => `${x.tex}:${x.slot}`)).size };
}
/**
 * Largest distance of any skinned body vertex (every 3rd) from the culling sphere's centre, as a share of its
 * radius (world space), over `ms` of the player's motion. Below 1 means the sphere always holds the real pose.
 */
function cullCheck(ms = 4000): Promise<{ maxRatio: number; frames: number }> {
  return new Promise(done => {
    const tr = player!; const p = priv(tr); const pos = p.body.geometry.getAttribute('position');
    const c = new THREE.Vector3(), v = new THREE.Vector3(); let maxRatio = 0, frames = 0; const t0 = performance.now();
    const tick = () => {
      tr.root.updateMatrixWorld(true);
      const sph = p.body.boundingSphere!; c.copy(sph.center).applyMatrix4(p.body.matrixWorld);
      const r = sph.radius * p.body.matrixWorld.getMaxScaleOnAxis();
      for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i); p.body.applyBoneTransform(i, v); v.applyMatrix4(p.body.matrixWorld); maxRatio = Math.max(maxRatio, v.distanceTo(c) / r); }
      frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done({ maxRatio, frames });
    };
    requestAnimationFrame(tick);
  });
}
// ---------------------------------------------------------------- scripted course: every ground type, then stop/turn/gestures
type Leg = { label: string; dur: number; run: () => void };
let course: { label: string; tick: (dt: number) => void } | null = null;
function runCourse(speed = 1.25): Promise<Record<string, Stat>> {
  stats.clear();
  const legs: Leg[] = [
    { label: 'start', dur: 0.8, run: () => { qa.teleport(0, -3.2, 0); walkSpeed = speed; driveOverride = { dx: 0, dz: 0, jog: false }; } },
    { label: 'walk:paving+stage', dur: 3.0, run: () => { driveOverride = { dx: 0, dz: 1, jog: false }; } },
    { label: 'walk:curb+ramp', dur: 5.6, run: () => { driveOverride = { dx: 0, dz: 1, jog: false }; } },
    { label: 'stop:paving', dur: 1.6, run: () => { driveOverride = { dx: 0, dz: 0, jog: false }; } },
    { label: 'walk:back over ramp+curb', dur: 6.4, run: () => { driveOverride = { dx: 0, dz: -1, jog: false }; } },
    { label: 'stop:stage', dur: 1.5, run: () => { driveOverride = { dx: 0, dz: 0, jog: false }; } },
    { label: 'turn:stage', dur: 1.6, run: () => { pv.face += Math.PI * 0.9; } },
    { label: 'turn2:stage', dur: 1.6, run: () => { pv.face -= Math.PI * 0.6; } },
    { label: 'wave:stage', dur: 2.2, run: () => { player?.wave(); } },
    { label: 'cheer:stage', dur: 2.2, run: () => { player?.cheer(); } },
    { label: 'walk:onto rim', dur: 0.7, run: () => { driveOverride = { dx: 1, dz: 0, jog: false }; } },
    { label: 'stop:rim', dur: 1.5, run: () => { driveOverride = { dx: 0, dz: 0, jog: false }; } },
    { label: 'jog:course', dur: 5.0, run: () => { qa.teleport(0.3, -3.2, 0); driveOverride = { dx: 0, dz: 1, jog: true }; } },
    { label: 'stop:end', dur: 1.5, run: () => { driveOverride = { dx: 0, dz: 0, jog: false }; } },
  ];
  return new Promise(done => {
    let i = -1, left = 0;
    const next = () => {
      i++;
      if (i >= legs.length) { course = null; driveOverride = null; statKey = 'free'; done(Object.fromEntries(stats)); return; }
      statKey = legs[i].label; legs[i].run(); left = legs[i].dur;
      if (course) course.label = legs[i].label;
    };
    course = { label: '', tick: (dt: number) => { left -= dt; if (left <= 0) next(); } };
    next();
  });
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
  scene, camera, renderer, controls, Trainer, heightAt, G,
  /** Lowest sole gap per foot right now (world units). */
  contact: () => contact(),
  /** Walk the ground course (paving, stage, curb, ramp, stops, turns, gestures, jog); resolves with gap stats. */
  course: (speed?: number) => runCourse(speed),
  stats: () => Object.fromEntries(stats),
  setModel: async (id: string) => { if (isTrainerId(id)) { model = id; await spawn(1 + walkers.length); } },
  poolCycle: (cycles?: number, alive?: number) => poolCycle(cycles, alive),
  cullCheck: (ms?: number) => cullCheck(ms),
  poolStats: () => bonePoolStats(),
  portraits: (w?: number, h?: number) => portraits(w, h),
};
(window as unknown as { __qa: typeof qa }).__qa = qa;

await spawn(+(q.get('n') ?? 1));
setView((q.get('view') as View) ?? 'threeq');
frame();
