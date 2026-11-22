// QA stage for the plaza presenter NPC (dev server only, not part of the build):
// http://127.0.0.1:5184/pokemon-battle-draft-v2/qa/npc.html   (?reduced  ?clean  ?cam=dialogue)
// A golden-hour stage lit like the game (NeutralToneMapping, warm key, cool fill), orbit controls, buttons for
// every Presenter call, a draggable 'player' marker she turns toward and looks at, and fps / load-size readouts.
// `window.__npc` exposes the presenter, camera helpers and the scene for scripted checks.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Presenter } from '../src/engine/npc/Presenter.ts';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const info = document.getElementById('info')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// golden-hour sky: warm horizon, dusky violet-blue zenith
const sky = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2a3a78'); gr.addColorStop(0.45, '#7b6aa8'); gr.addColorStop(0.72, '#f0a27a'); gr.addColorStop(0.86, '#ffd29a'); gr.addColorStop(1, '#5a4a52');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
})();
scene.background = sky;
scene.fog = new THREE.Fog('#c99a8a', 14, 42);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromEquirectangular(sky).texture;
scene.environmentIntensity = 0.45;

const hemi = new THREE.HemisphereLight('#a9bcff', '#3b2a22', 0.75); scene.add(hemi);
const key = new THREE.DirectionalLight('#ffc48a', 2.4); key.position.set(-4.5, 3.4, 4.2); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key);
const fill = new THREE.DirectionalLight('#8aa6ff', 0.65); fill.position.set(4, 2.5, 2); scene.add(fill);
const rim = new THREE.DirectionalLight('#ff9fbf', 1.1); rim.position.set(1.5, 3, -4); scene.add(rim);

// plaza floor: warm stone disc + grass ring
const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshStandardMaterial({ color: '#cdb59a', roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grass = new THREE.Mesh(new THREE.RingGeometry(4.2, 30, 64), new THREE.MeshStandardMaterial({ color: '#5f8a4a', roughness: 1 }));
grass.rotation.x = -Math.PI / 2; grass.position.y = -0.002; grass.receiveShadow = true; scene.add(grass);
for (let i = 0; i < 12; i++) { // tile seams
  const seam = new THREE.Mesh(new THREE.RingGeometry(0.6 + i * 0.3, 0.61 + i * 0.3, 64), new THREE.MeshBasicMaterial({ color: '#b39b82' }));
  seam.rotation.x = -Math.PI / 2; seam.position.y = 0.001; scene.add(seam);
}
// a counter behind her so the framing reads like a reception desk spot
const desk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.95, 0.5), new THREE.MeshStandardMaterial({ color: '#f4eef2', roughness: 0.5 }));
desk.position.set(0, 0.475, -1.15); desk.castShadow = desk.receiveShadow = true; scene.add(desk);
const deskBand = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.14, 0.52), new THREE.MeshStandardMaterial({ color: '#ff5a7a', roughness: 0.45 }));
deskBand.position.set(0, 0.8, -1.15); scene.add(deskBand);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 0.95, 0);

const CAMS: Record<string, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  full: { pos: [0, 1.0, 3.6], target: [0, 0.86, 0], fov: 40 },
  threeq: { pos: [2.1, 1.3, 2.6], target: [0, 0.9, 0], fov: 40 },
  dialogue: { pos: [0.32, 1.5, 1.32], target: [0, 1.4, 0], fov: 40 },
  side: { pos: [3.4, 1.0, 0.2], target: [0, 0.86, 0], fov: 40 },
  back: { pos: [0.4, 1.2, -3.4], target: [0, 0.95, 0], fov: 40 },
  face: { pos: [0, 1.53, 0.72], target: [0, 1.5, 0], fov: 35 },
  game: { pos: [1.2, 2.3, 6.0], target: [0, 0.9, 0], fov: 40 },
};
function setCam(name: string) {
  const c = CAMS[name] ?? CAMS.full;
  camera.position.set(...c.pos); controls.target.set(...c.target); camera.fov = c.fov; camera.updateProjectionMatrix(); controls.update();
}
setCam(q.get('cam') ?? 'full');

// the 'player': a pink ring with a small trainer-height pole and a head ball (what she looks at)
const marker = new THREE.Group();
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 10, 40), new THREE.MeshStandardMaterial({ color: '#ff4f7b', emissive: '#ff2f63', emissiveIntensity: 0.6 }));
ring.rotation.x = Math.PI / 2; ring.position.y = 0.04;
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 8), new THREE.MeshStandardMaterial({ color: '#ffd1dc' }));
pole.position.y = 0.725;
const headBall = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffe3ea', emissive: '#ff8fae', emissiveIntensity: 0.25 }));
headBall.position.y = 1.5;
marker.add(ring, pole, headBall); marker.position.set(0.9, 0, 2.4); scene.add(marker);

// drag the marker on the ground
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = false;
const toNdc = (e: PointerEvent) => ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
renderer.domElement.addEventListener('pointerdown', e => {
  toNdc(e); ray.setFromCamera(ndc, camera);
  if (ray.intersectObjects(marker.children, false).length) { dragging = true; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!dragging) return;
  toNdc(e); ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(ground, p)) { p.setLength(Math.min(p.length(), 4)); marker.position.set(p.x, 0, p.z); }
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; controls.enabled = true; });

const state = { look: true, turn: true, talk: false, attentive: false, reduced: q.has('reduced') };
let presenter: Presenter | null = null;
let loadMs = 0, loadBytes = 0;
const t0 = performance.now();
Presenter.load({ reducedMotion: state.reduced }).then(p => {
  presenter = p; loadMs = performance.now() - t0;
  const res = performance.getEntriesByType('resource').find(r => r.name.includes('npc/presenter.vrm')) as PerformanceResourceTiming | undefined;
  loadBytes = res?.encodedBodySize || res?.transferSize || p.bytes;
  scene.add(p.root);
  api.presenter = p;
  api.ready = true;
}, err => { info.textContent = 'load failed: ' + String(err?.message ?? err); console.error(err); });

document.querySelectorAll<HTMLButtonElement>('#ui button').forEach(b => {
  if (b.dataset.act === 'reduced' && state.reduced) b.classList.add('on');
  b.onclick = () => {
    if (b.dataset.cam) { setCam(b.dataset.cam); return; }
    const act = b.dataset.act!;
    if (b.dataset.toggle !== undefined) b.classList.toggle('on');
    const on = b.classList.contains('on');
    if (!presenter) return;
    switch (act) {
      case 'greet': presenter.greet(); break;
      case 'talk': state.talk = on; presenter.talk(on); break;
      case 'present': presenter.gesture('present'); break;
      case 'point': presenter.gesture('point'); break;
      case 'nod': presenter.gesture('nod'); break;
      case 'attentive': state.attentive = on; presenter.setAttentive(on); break;
      case 'look': state.look = on; if (!on) presenter.lookAt(null); break;
      case 'turn': state.turn = on; break;
      case 'reduced': state.reduced = on; presenter.setReducedMotion(on); break;
    }
  };
});

const headWorld = new THREE.Vector3();
let fps = 60, frames = 0, acc = 0;
const timer = new THREE.Timer();
const api: Record<string, unknown> = { scene, camera, renderer, controls, marker, setCam, state, ready: false, presenter: null, CAMS, THREE };
(window as unknown as { __npc: unknown }).__npc = api;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  frames++; acc += dt; if (acc > 0.5) { fps = fps * 0.5 + (frames / acc) * 0.5; frames = 0; acc = 0; }
  controls.update();
  if (presenter) {
    if (state.turn) presenter.turnToward(marker.position.x, marker.position.z);
    if (state.look) presenter.lookAt(headBall.getWorldPosition(headWorld));
    presenter.update(dt);
  }
  renderer.render(scene, camera);
  const r = renderer.info.render;
  info.textContent = presenter
    ? `fps        ${fps.toFixed(0)}\nload       ${(loadBytes / 1048576).toFixed(2)} MB in ${(loadMs / 1000).toFixed(2)} s\nheight     ${presenter.height.toFixed(2)} m\ndraws/tris ${r.calls} / ${(r.triangles / 1000).toFixed(1)}k\nbusy       ${presenter.busy}\ntalk ${state.talk}  attentive ${state.attentive}\nreduced    ${state.reduced}`
    : 'loading…';
  api.fps = fps; api.loadBytes = loadBytes; api.loadMs = loadMs;
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
