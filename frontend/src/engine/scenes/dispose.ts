import * as THREE from 'three';
import type { Vec3 } from './types.js';

/** Dispose every geometry, material and texture under a root. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k in u) { const val = u[k]?.value; if (val instanceof THREE.Texture) val.dispose(); }
      mat.dispose();
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

/**
 * A prefiltered environment map from a few light panels around the origin (and an optional sky), for an
 * environment's reflections on the Pokemon and trainers. Returns the render target; the caller owns it.
 */
export function envFromPanels(renderer: THREE.WebGLRenderer, panels: ReadonlyArray<{ color: string; pos: Vec3; size: number }>, sky?: THREE.Object3D, background = '#03060f'): THREE.WebGLRenderTarget {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(background);
  if (sky) envScene.add(sky);
  for (const p of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size * 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(4), side: THREE.DoubleSide }));
    m.position.set(...p.pos); m.lookAt(0, 1, 0); envScene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose(); disposeTree(envScene);
  return rt;
}
