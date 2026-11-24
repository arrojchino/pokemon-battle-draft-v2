import * as THREE from 'three';
import type { QualityTier } from '../../quality.js';
import type { Collider, EnvShot, EnvSpot, TownEnvironment, Vec3 } from '../types.js';
import { FLOOR_Y, GARDEN, RADIUS, SPAWN, SPOTS, buildColliders, solveBounds, ringPos } from './layout.js';
import {
  createCardMaterial, createClothMaterial, createEmissiveMaterial, createFoliageMaterial, createGroundMaterial, createStaticMaterial,
  createTownUniforms,
} from './materials.js';
import { createCardAtlas, createClothAtlas, createNoiseTexture, bakeLightMaps, LM_SCALE, mulberry } from './textures.js';
import { SKY, createBeamMaterial, createFarMaterial, createTownSky } from './sky.js';
import { createFx, createPortalMaterial, createWaterMaterial, createWindowMaterial } from './fx.js';
import {
  buildBenches, buildCenter, buildFountain, buildGarden, buildGate, buildLamps, buildPlanters, buildRim, buildShops, buildSouthGate,
  buildStringLights, newCtx,
} from './structures.js';
import { buildTrees, createCards, createFarGeometry, createFarTrees, createHouses } from './nature.js';

const G = FLOOR_Y;
const FOG_DENSITY = 0.021;
/** Key light direction (toward the light): high moonlight from the north-west. */
const KEY_DIR = new THREE.Vector3(-0.5, 0.82, -0.32).normalize();

/**
 * The main plaza: a night town square around a moon-and-ball fountain, a Pokemon Center style hall to the north,
 * tiled-roof shops to the east, a shrine garden with a partner stage to the west, the stadium gate to the
 * north-east and the town entrance to the south. Built from a handful of merged meshes (one per material),
 * a baked light map for lantern pools and GPU-animated particles.
 */
export function createTown(opts: { tier: QualityTier }): TownEnvironment {
  const scene = new THREE.Scene();
  scene.name = 'town';
  scene.fog = new THREE.FogExp2(SKY.horizon.clone(), FOG_DENSITY);
  scene.background = SKY.horizon.clone();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  camera.position.set(0, 2.6, 12);
  camera.lookAt(0, 1.2, 0);

  const u = createTownUniforms();
  const fogDensity = { value: FOG_DENSITY };
  const textures: THREE.Texture[] = [];

  // ---- build everything into bags -------------------------------------------------------------------
  const ctx = newCtx();
  buildCenter(ctx); buildShops(ctx); buildGate(ctx); buildSouthGate(ctx); buildGarden(ctx); buildFountain(ctx);
  buildBenches(ctx); buildLamps(ctx); buildPlanters(ctx); buildRim(ctx); buildStringLights(ctx); buildTrees(ctx);

  const lmRect = { minX: -20, minZ: -20, size: 40 };
  const { lm, ao } = bakeLightMaps(ctx.pools, ctx.ao, lmRect);
  textures.push(lm, ao);
  u.uLM.value = lm; u.uAO.value = ao;
  u.uLMRect.value.set(lmRect.minX, lmRect.minZ, lmRect.size, LM_SCALE);

  const clothTex = createClothAtlas(); const cardTex = createCardAtlas(); const noiseTex = createNoiseTexture();
  textures.push(clothTex, cardTex, noiseTex);
  u.uNoise.value = noiseTex;

  const matStatic = createStaticMaterial(u);
  const matEmis = createEmissiveMaterial(u);
  const matFol = createFoliageMaterial(u);
  const matCloth = createClothMaterial(u, clothTex);
  const matWin = createWindowMaterial(u);
  const matWater = createWaterMaterial(u, new THREE.Vector2(GARDEN.pond.x, GARDEN.pond.z));
  const matGround = createGroundMaterial(u);
  const matCards = createCardMaterial(u, cardTex);

  const add = <T extends THREE.Object3D>(o: T, cast = false, receive = false): T => { o.castShadow = cast; o.receiveShadow = receive; scene.add(o); return o; };

  // sky and far scenery
  const sky = add(createTownSky(noiseTex));
  const far = createFarGeometry();
  const matFar = createFarMaterial(scene.fog.color, u.uTime);
  add(new THREE.Mesh(far.hills, matFar));
  add(new THREE.Mesh(far.stadium, matFar));
  const beams = add(new THREE.Mesh(far.beams, createBeamMaterial(u.uTime)));
  beams.renderOrder = 2;
  const houses = createHouses(u, 110);
  add(houses.mesh, false, true);
  const farTrees = createFarTrees(matFol, 90);
  const farTreesFull = farTrees.count;
  add(farTrees, false, true);

  // town floor
  const groundGeo = new THREE.CircleGeometry(150, 128);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = add(new THREE.Mesh(groundGeo, matGround), false, true);
  ground.position.y = G;
  ground.name = 'town-ground';

  // merged families
  add(new THREE.Mesh(ctx.stat.build(), matStatic), true, true).name = 'town-static';
  add(new THREE.Mesh(ctx.fol.build(), matFol), true, true).name = 'town-foliage';
  add(new THREE.Mesh(ctx.cloth.build(), matCloth), false, true).name = 'town-cloth';
  add(new THREE.Mesh(ctx.emis.build(), matEmis)).name = 'town-glow';
  add(new THREE.Mesh(ctx.win.build(), matWin)).name = 'town-windows';
  const water = add(new THREE.Mesh(ctx.water.build(), matWater));
  water.renderOrder = 1;
  const sculpt = new THREE.Group();
  sculpt.position.y = G;
  sculpt.add(new THREE.Mesh(ctx.sculpt.build(), matStatic), new THREE.Mesh(ctx.sculptGlow.build(), matEmis));
  sculpt.children[0].castShadow = true;
  scene.add(sculpt);
  if (ctx.portal) {
    const { frame, w, h } = ctx.portal;
    const sh = new THREE.Shape();
    sh.moveTo(-w, 0); sh.lineTo(w, 0); sh.lineTo(w, h - w); sh.absarc(0, h - w, w, 0, Math.PI, false); sh.lineTo(-w, 0);
    const pg = new THREE.ShapeGeometry(sh, 24);
    const portal = add(new THREE.Mesh(pg, createPortalMaterial(u.uTime, w, h)));
    portal.applyMatrix4(frame.m(0, 0.01, 0));
    portal.renderOrder = 3;
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(ctx.wires, 3));
  add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: '#0c0d12' })));
  const cards = createCards(matCards, opts.tier);
  add(cards.mesh, false, true);

  // particles and glows
  const rnd = mulberry(77);
  const halos = add(createFx('halo', u, fogDensity, ctx.halos));
  halos.renderOrder = 4;
  const ffItems: Parameters<typeof createFx>[3] = [];
  const ffSources = [...ctx.fireflies, ...[60, 120, -150, 30].map(d => ({ ...ringPos(d, 9.6), y: G + 0.8, r: 2.2 })), { x: 0, z: 0, y: G + 1.6, r: 5.5 }];
  for (const s of ffSources) for (let i = 0; i < 22; i++) {
    ffItems.push({ pos: new THREE.Vector3(s.x + (rnd() - 0.5) * s.r * 2, s.y + rnd() * 0.9, s.z + (rnd() - 0.5) * s.r * 2), col: new THREE.Color(1.6, 2.6, 0.7), data: [0.045, rnd(), 0.5 + rnd() * 0.8, 0] });
  }
  const fireflies = add(createFx('firefly', u, fogDensity, ffItems)); fireflies.renderOrder = 4;
  const petalItems: Parameters<typeof createFx>[3] = [];
  for (const s of ctx.petals) for (let i = 0; i < 46; i++) {
    const y = s.y + (rnd() - 0.3) * 0.6;
    petalItems.push({ pos: new THREE.Vector3(s.x + (rnd() - 0.5) * s.r * 2, y, s.z + (rnd() - 0.5) * s.r * 2), col: new THREE.Color(rnd() < 0.5 ? '#ffc2d6' : '#ff9cc0'), data: [0.055, rnd(), 0, y - G] });
  }
  const petals = add(createFx('petal', u, fogDensity, petalItems));
  const sprayItems: Parameters<typeof createFx>[3] = [];
  for (let i = 0; i < 240; i++) sprayItems.push({ pos: new THREE.Vector3(0, G + 1.22, 0), col: new THREE.Color(0.55, 1.1, 1.5), data: [0.028, rnd(), 1.0 + rnd() * 0.1, 1.75 + rnd() * 0.1] });
  const spray = add(createFx('spray', u, fogDensity, sprayItems)); spray.renderOrder = 4;
  const particleSets = [fireflies, petals, spray].map(m => ({ geo: m.geometry, full: m.geometry.instanceCount }));

  // ---- lights ----------------------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#6079c4', '#1e1a2c', 0.95);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#a9bcff', 1.35);
  key.name = 'town-key';
  key.target.position.set(0, G, 0);
  key.position.copy(key.target.position).addScaledVector(KEY_DIR, 24);
  const sc = key.shadow.camera;
  sc.left = -6.5; sc.right = 6.5; sc.top = 6.5; sc.bottom = -6.5; sc.near = 1; sc.far = 60;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.025;
  scene.add(key, key.target);
  const mkPoint = (col: string, i: number, d: number, p: THREE.Vector3) => { const l = new THREE.PointLight(col, i, d, 2); l.position.copy(p); scene.add(l); return l; };
  const points = [
    mkPoint('#ffd8a8', 4, 6.5, ctx.lightSpots.center),
    mkPoint('#7fe4ff', 6, 6.5, ctx.lightSpots.fountain),
    mkPoint('#ffb27a', 7, 6.5, ctx.lightSpots.shops),
    mkPoint('#ffc9b0', 6, 5.5, ctx.lightSpots.stage),
  ];

  // ---- quality --------------------------------------------------------------------------------------
  let tier: QualityTier | null = null;
  const setQuality = (t: QualityTier) => {
    if (t === tier) return;
    tier = t;
    key.castShadow = t !== 'low';
    const size = t === 'high' ? 2048 : 1024;
    if (key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose(); key.shadow.map = null;
    }
    for (const p of particleSets) p.geo.instanceCount = t === 'low' ? Math.floor(p.full / 2) : p.full;
    cards.mesh.count = t === 'low' ? Math.floor(cards.full / 2) : cards.full;
    points[2].visible = t !== 'low';
    points[3].visible = t !== 'low';
    farTrees.count = t === 'low' ? Math.min(30, farTreesFull) : farTreesFull;
  };
  setQuality(opts.tier);

  // ---- walkers ---------------------------------------------------------------------------------------
  const colliders: readonly Collider[] = buildColliders();
  const bounds = (x: number, z: number, r: number) => solveBounds(colliders, RADIUS, x, z, r);

  const moon = SKY.moonDir.clone().multiplyScalar(60);
  const envPanels: ReadonlyArray<{ color: string; pos: Vec3; size: number }> = [
    { color: '#9fb4ff', pos: [moon.x, moon.y, moon.z], size: 26 },
    { color: '#ffb46a', pos: [9, 2.2, 1.5], size: 6 },
    { color: '#ffe2c0', pos: [0, 1.6, -8.6], size: 4 },
    { color: '#3ee6ff', pos: [8.2, 3, -8.2], size: 5 },
    { color: '#ffc9a8', pos: [-10, 2, 0], size: 4 },
    { color: '#1a2a52', pos: [0, -20, 0], size: 40 },
  ];

  const update = (t: number) => {
    u.uTime.value = t;
    sky.material.uniforms.uTime.value = t;
    sculpt.rotation.y = t * 0.22;
  };

  const dispose = () => {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => mats.add(x));
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    geos.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
    key.shadow.map?.dispose(); key.shadow.map = null;
    key.dispose();
    for (const p of points) p.dispose();
    hemi.dispose();
    scene.clear();
  };

  const spawn: EnvSpot = { ...SPAWN };
  const spots = {
    host: { ...SPOTS.host }, showcase: { ...SPOTS.showcase },
    showcaseCam: { pos: [...SPOTS.showcaseCam.pos] as Vec3, target: [...SPOTS.showcaseCam.target] as Vec3, fov: SPOTS.showcaseCam.fov } as EnvShot,
    gathering: { ...SPOTS.gathering }, gate: { ...SPOTS.gate },
  };

  return {
    scene, camera, groundY: G, radius: RADIUS, colliders, bounds, spawn, spots, key, envPanels,
    update: (t: number) => update(t),
    setQuality,
    dispose,
  };
}
