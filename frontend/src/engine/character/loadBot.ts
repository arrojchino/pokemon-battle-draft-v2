import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { addGrime } from '../materials.js';

const bytes = new Map<string, Promise<ArrayBuffer>>();

/** Fetch once with streamed progress; the ArrayBuffer is cached so a second instance never re-downloads. */
export function fetchModel(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  let p = bytes.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Model ${url}: HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = []; let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.byteLength; onProgress?.(loaded, total);
      }
      const out = new Uint8Array(loaded); let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.byteLength; }
      return out.buffer;
    })();
    bytes.set(url, p);
    p.catch(() => bytes.delete(url));
  }
  return p;
}

const parsed = new Map<string, Promise<GLTF>>();

/** Bot height in metres: a little shorter than the holograms, so the Pokémon stay the stars. */
export const BOT_HEIGHT = 1.28;

export type BotInstance = { scene: THREE.Group; clips: THREE.AnimationClip[]; paint: THREE.MeshStandardMaterial; face: THREE.Mesh | null; head: THREE.Object3D | null; height: number };

/**
 * Parse the bot once, then hand out independent skinned clones. Each clone gets its own paint
 * material (the model's "Main" material) and a procedural grime layer, so every player's bot can be
 * a different colour while geometry and animation clips stay shared.
 */
export async function loadBot(url: string, paintHex: string, onProgress?: (loaded: number, total: number) => void): Promise<BotInstance> {
  let p = parsed.get(url);
  if (!p) {
    p = fetchModel(url, onProgress).then(data => new GLTFLoader().parseAsync(data.slice(0), url.substring(0, url.lastIndexOf('/') + 1)));
    parsed.set(url, p);
    p.catch(() => parsed.delete(url));
  }
  const gltf = await p;
  const scene = cloneSkinned(gltf.scene) as THREE.Group;
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const s = BOT_HEIGHT / (box.max.y - box.min.y);
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;

  const paint = new THREE.MeshStandardMaterial({ color: paintHex, roughness: 0.62, metalness: 0.35, flatShading: true });
  addGrime(paint);
  let face: THREE.Mesh | null = null;
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.frustumCulled = false;
    const swap = (mat: THREE.Material) => {
      if (mat.name === 'Main') return paint;
      const c = (mat as THREE.MeshStandardMaterial).clone();
      c.roughness = mat.name === 'Black' ? 0.35 : 0.75; c.metalness = mat.name === 'Grey' ? 0.55 : 0.2;
      if (mat.name === 'Grey') addGrime(c, 0.55);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    if (m.morphTargetDictionary && 'Surprised' in m.morphTargetDictionary) face = m;
  });
  return { scene, clips: gltf.animations, paint, face, head: scene.getObjectByName('Head') ?? null, height: BOT_HEIGHT };
}
