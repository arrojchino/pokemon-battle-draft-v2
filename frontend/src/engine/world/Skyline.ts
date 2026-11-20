import * as THREE from 'three';
import { rand } from '../math.js';

/**
 * Instanced night city. Every tower is one instance of a unit box; windows, neon crowns and aviation
 * beacons are computed in the shader from world-space size, so there is no per-frame CPU work.
 */
export function createSkyline(count: number): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(count);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uFacade: { value: new THREE.Color('#07070f') },
      uWarm: { value: new THREE.Color('#ffb46b') },
      uCool: { value: new THREE.Color('#7fd8ff') },
      uNeonA: { value: new THREE.Color('#ff3d9a') },
      uNeonB: { value: new THREE.Color('#33e1ff') },
    }]),
    vertexShader: /* glsl */`
      attribute float aSeed;
      varying vec3 vLocal; varying vec3 vSize; varying vec3 vNormalW; varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vSeed = aSeed;
        vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = position * vSize;
        vNormalW = normalize(mat3(instanceMatrix) * normal);
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uFacade, uWarm, uCool, uNeonA, uNeonB;
      varying vec3 vLocal; varying vec3 vSize; varying vec3 vNormalW; varying float vSeed;
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = abs(vNormalW);
        vec2 uv = n.x > 0.5 ? vLocal.zy : vLocal.xy;
        float top = step(0.5, vNormalW.y);
        vec3 col = uFacade * (0.6 + 0.4 * h21(vec2(vSeed, 1.0)));
        // Window grid in metres (1.8 m bays, 2.8 m floors). Far away the grid is sub-pixel, so it fades to its
        // average brightness using screen-space derivatives instead of aliasing into noise.
        vec2 g = uv / vec2(1.8, 2.8);
        vec2 cell = floor(g); vec2 f = fract(g);
        vec2 fw = fwidth(g);
        float detail = 1.0 - smoothstep(0.18, 0.45, max(fw.x, fw.y));
        float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.72);
        float r = h21(cell + vSeed * 17.0);
        float lit = step(0.7, r) * (1.0 - top);
        float flicker = 0.85 + 0.15 * sin(uTime * (0.5 + r * 2.0) + r * 31.0);
        vec3 wc = mix(uWarm, uCool, step(0.5, fract(r * 7.0)));
        vec3 sharp = wc * win * lit * flicker * (0.5 + 0.55 * r);
        vec3 avg = mix(uWarm, uCool, 0.5) * 0.36 * 0.3 * 0.75 * (1.0 - top);
        col += mix(avg, sharp, detail);
        // Neon crown strip near the roof on some towers.
        float crown = step(0.7, fract(vSeed * 3.7)) * smoothstep(vSize.y - 1.2, vSize.y - 0.9, vLocal.y) * (1.0 - smoothstep(vSize.y - 0.5, vSize.y - 0.3, vLocal.y)) * (1.0 - top);
        col += mix(uNeonA, uNeonB, step(0.5, fract(vSeed * 11.3))) * crown * 2.4;
        // Red aviation beacon on the tallest towers.
        float beacon = top * step(55.0, vSize.y) * smoothstep(0.6, 0.0, length(vLocal.xz)) * step(0.5, fract(uTime * 0.5 + vSeed));
        col += vec3(3.0, 0.2, 0.15) * beacon;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const r1 = rand(i + 1), r2 = rand(i * 3.1 + 7), r3 = rand(i * 7.7 + 3);
    // Dense behind the stage (−Z), sparser to the sides, nothing directly in front of the camera.
    const a = (r1 - 0.5) * Math.PI * 1.8 + Math.PI;
    // Keep the sightline behind the torii open: towers there sit further out, so the sky and moon frame the stage.
    const behind = Math.abs(a - Math.PI) < 0.55 ? 90 : 0;
    const ring = 62 + behind + Math.pow(r2, 0.75) * 210;
    // The plaza is a rooftop: tower bases sit far below it, so near towers read as skyline, not walls.
    p.set(Math.sin(a) * ring, -60, Math.cos(a) * ring);
    // Most roofs sit just below the plaza's horizon so the sky reads; a few distant spires break it.
    const tall = 44 + Math.pow(r3, 2.6) * 95 * Math.min(1.4, ring / 150);
    s.set(10 + rand(i * 5.3) * 18, tall, 10 + rand(i * 9.1) * 18);
    q.setFromAxisAngle(up, rand(i * 2.2) * Math.PI);
    m.compose(p, q, s); mesh.setMatrixAt(i, m);
    seeds[i] = rand(i * 13.37);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
