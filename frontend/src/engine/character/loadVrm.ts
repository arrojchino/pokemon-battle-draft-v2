import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

/** Parse a VRM (0.x or 1.0) into a ready, upright, optimized instance. */
export async function loadVrm(url: string, onProgress?: (loaded: number, total: number) => void, figure?: { bust: number }): Promise<VRM> {
  const data = await fetchModel(url, onProgress);
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(data.slice(0), url.substring(0, url.lastIndexOf('/') + 1));
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} is not a VRM`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  mergeSkinnedMeshes(vrm.scene);
  if (figure) applyFigure(vrm, figure);
  // MToon reads lights; make sure textures get mipmaps/anisotropy for close-ups.
  vrm.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) map.anisotropy = 4;
    }
  });
  return vrm;
}

/**
 * Reshape with the model's own secondary chest bones (VRoid `J_Sec_*_Bust1`). Body and outfit are
 * skinned to them, so clothing follows. Spring-bone rest state is re-captured so physics settles on the
 * new shape. Clamped so the mesh never tears through the outfit.
 */
function applyFigure(vrm: VRM, figure: { bust: number }) {
  const s = THREE.MathUtils.clamp(figure.bust, 0.8, 1.5);
  if (s === 1) return;
  let found = 0;
  vrm.scene.traverse(o => {
    if (/^J_Sec_[LR]_Bust1$/.test(o.name)) { o.scale.setScalar(s); found++; }
  });
  if (found) { vrm.scene.updateMatrixWorld(true); vrm.springBoneManager?.setInitState(); }
}

/**
 * Draw-call reduction. VRoid exports split hair and accessories into dozens of skinned meshes. After
 * `combineSkeletons` they share one skeleton, so meshes with identical materials, attribute layout,
 * bind matrix and local transform can be merged into one. Meshes with morph targets (face, expressions)
 * are left untouched. MToon outlines use a [surface, outline] material pair over two full-range groups;
 * that pattern is preserved on the merged geometry.
 */
export function mergeSkinnedMeshes(root: THREE.Object3D): { before: number; after: number } {
  const buckets = new Map<string, THREE.SkinnedMesh[]>();
  let before = 0;
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    before++;
    const g = m.geometry;
    if (Object.keys(g.morphAttributes).length) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const count = g.index ? g.index.count : g.attributes.position.count;
    const groupsOk = Array.isArray(m.material)
      ? g.groups.length === mats.length && g.groups.every((gr, i) => gr.start === 0 && gr.count >= count && gr.materialIndex === i)
      : g.groups.length <= 1;
    if (!groupsOk || !g.index) return;
    m.updateMatrix();
    const key = [
      m.skeleton.uuid, m.parent?.uuid, mats.map(x => x.uuid).join(','),
      Object.entries(g.attributes).map(([n, a]) => `${n}:${a.itemSize}:${a.normalized}:${(a as THREE.BufferAttribute).array.constructor.name}`).sort().join(','),
      m.bindMatrix.elements.map(v => v.toFixed(5)).join(','), m.matrix.elements.map(v => v.toFixed(5)).join(','),
    ].join('|');
    const list = buckets.get(key) ?? [];
    list.push(m); buckets.set(key, list);
  });
  let removed = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map(m => { const c = m.geometry.clone(); c.clearGroups(); return c; });
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    const target = list[0];
    if (Array.isArray(target.material)) target.material.forEach((_, i) => merged.addGroup(0, Infinity, i));
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    target.geometry.dispose();
    target.geometry = merged;
    for (const m of list.slice(1)) { m.geometry.dispose(); m.removeFromParent(); removed++; }
  }
  return { before, after: before - removed };
}
