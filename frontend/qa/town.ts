// QA stage for the town plaza (dev server only, not part of the build):
// http://localhost:5181/pokemon-battle-draft-v2/qa/town.html   (?tier=low|medium|high  ?view=1..7  ?clean  ?env)
// Rendering conditions match the World (NeutralToneMapping 0.82, half-float composer, bloom, output pass).
// window.__qa = { fps, calls, triangles, sceneCalls, sceneTriangles, programs, geometries, textures, tier }.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTown } from '../src/engine/scenes/town/Town.ts';

const q = new URLSearchParams(location.search);
if (q.has('clean')) document.body.classList.add('clean');
const tier = (q.get('tier') ?? 'high') as 'low' | 'medium' | 'high';
const info = document.getElementById('info')!;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = tier !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const t0 = performance.now();
const town = createTown({ tier });
const buildMs = performance.now() - t0;
const { scene, camera } = town;

if (q.has('env')) {
  const pm = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene(); es.background = new THREE.Color('#05070f');
  for (const p of town.envPanels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size), new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide }));
    m.position.set(...p.pos); m.lookAt(0, 0, 0); es.add(m);
  }
  scene.environment = pm.fromScene(es, 0.04).texture; scene.environmentIntensity = 0.35;
}

// scale references: trainer 0.98 and partner 0.7 at the spawn, partner 0.95 on the showcase, host 0.98
const capsule = (h: number, col: string, x: number, z: number) => {
  const r = Math.min(0.17, h * 0.22);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - 2 * r, 6, 16), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
  m.position.set(x, town.groundY + h / 2, z); m.castShadow = true; scene.add(m); return m;
};
capsule(0.98, '#e8e2f8', town.spawn.x - 0.35, town.spawn.z);
capsule(0.7, '#ffd25a', town.spawn.x + 0.4, town.spawn.z);
capsule(0.98, '#ff9db1', town.spots.host.x, town.spots.host.z);
capsule(0.95, '#ffd25a', town.spots.showcase.x, town.spots.showcase.z);
capsule(0.98, '#e8e2f8', town.spots.gate.x, town.spots.gate.z);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: tier === 'high' ? 4 : 0 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const sceneStats = { calls: 0, triangles: 0 };
const origRender = renderPass.render.bind(renderPass);
renderPass.render = (...a: Parameters<RenderPass['render']>) => { origRender(...a); sceneStats.calls = renderer.info.render.calls; sceneStats.triangles = renderer.info.render.triangles; };
composer.addPass(renderPass);
if (tier !== 'low') composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.15));
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
type View = { pos: [number, number, number]; target: [number, number, number]; fov?: number };
const sc = town.spots.showcaseCam;
const VIEWS: Record<string, View> = {
  1: { pos: [15, 13, 21], target: [0, 0.4, -1.5] },
  2: { pos: [0, 2.3, 11.2], target: [0, 1.3, 0] },
  3: { pos: [2.6, 1.9, 3.2], target: [10, 1.9, 1.2] },
  4: { pos: sc.pos, target: sc.target, fov: sc.fov },
  5: { pos: [2.2, 1.7, -1.8], target: [9.2, 2.6, -9.2] },
  6: { pos: [0.4, 1.5, -3.2], target: [0, 2.4, -10] },
  7: { pos: [-4.6, 2.2, 5.6], target: [-10, 1.0, -0.8] },
};
const setView = (k: string) => {
  const v = VIEWS[k]; if (!v) return;
  camera.position.set(...v.pos); controls.target.set(...v.target); camera.fov = v.fov ?? 40; camera.updateProjectionMatrix(); controls.update();
};
setView(q.get('view') ?? '2');
addEventListener('keydown', e => setView(e.key));

const resize = () => {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
};
addEventListener('resize', resize); resize();

const keyOffset = town.key.position.clone().sub(town.key.target.position);
const qa = { fps: 0, calls: 0, triangles: 0, sceneCalls: 0, sceneTriangles: 0, programs: 0, geometries: 0, textures: 0, tier, buildMs: Math.round(buildMs) };
(window as unknown as { __qa: typeof qa; __town: typeof town }).__qa = qa;
(window as unknown as { __town: typeof town }).__town = town;
let frames = 0, acc = 0, last = performance.now();
const start = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(); const dt = (now - last) / 1000; last = now;
  controls.update();
  // follow the view like the World follows the player
  town.key.target.position.set(controls.target.x, town.groundY, controls.target.z);
  town.key.position.copy(town.key.target.position).add(keyOffset);
  town.update((now - start) / 1000, dt);
  renderer.info.reset();
  composer.render(dt);
  frames++; acc += dt;
  if (acc > 0.5) {
    qa.fps = Math.round(frames / acc); frames = 0; acc = 0;
    qa.calls = renderer.info.render.calls; qa.triangles = renderer.info.render.triangles;
    qa.sceneCalls = sceneStats.calls; qa.sceneTriangles = sceneStats.triangles;
    qa.programs = renderer.info.programs?.length ?? 0; qa.geometries = renderer.info.memory.geometries; qa.textures = renderer.info.memory.textures;
    info.textContent = `tier ${tier}  fps ${qa.fps}\nscene calls ${qa.sceneCalls}  tris ${qa.sceneTriangles}\nframe calls ${qa.calls}  tris ${qa.triangles}\nprograms ${qa.programs}  geos ${qa.geometries}  tex ${qa.textures}\nbuild ${qa.buildMs} ms`;
  }
});
