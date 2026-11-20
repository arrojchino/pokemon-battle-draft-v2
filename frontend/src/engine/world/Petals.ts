import * as THREE from 'three';
import { rand } from '../math.js';

/**
 * Falling sakura petals, fully GPU-driven: each instance carries a seed, the vertex shader derives
 * position, flutter and spin from time. Zero CPU work per frame beyond one uniform.
 */
export class Petals {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;

  constructor(count: number) {
    const geo = new THREE.PlaneGeometry(0.055, 0.042, 2, 1);
    // Cup the petal slightly so it catches light as it spins.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.abs(pos.getX(i)) * 0.4);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { seeds.set([rand(i + 0.1), rand(i * 1.7 + 4.2), rand(i * 2.9 + 8.4), rand(i * 4.3 + 1.9)], i * 4); }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSpeed: { value: 1 } }]),
      vertexShader: /* glsl */`
        uniform float uTime, uSpeed; attribute vec4 aSeed; varying vec2 vUv; varying float vShade;
        #include <fog_pars_vertex>
        mat3 rot(vec3 a, float r) { a = normalize(a); float s = sin(r), c = cos(r), oc = 1.0 - c;
          return mat3(oc*a.x*a.x+c, oc*a.x*a.y+a.z*s, oc*a.z*a.x-a.y*s, oc*a.x*a.y-a.z*s, oc*a.y*a.y+c, oc*a.y*a.z+a.x*s, oc*a.z*a.x+a.y*s, oc*a.y*a.z-a.x*s, oc*a.z*a.z+c); }
        void main() {
          vUv = uv;
          float t = uTime * uSpeed * (0.35 + aSeed.w * 0.3) + aSeed.x * 40.0;
          float fall = 9.0;
          float y = 8.5 - mod(t * 0.55, fall);
          vec3 c = vec3((aSeed.x - 0.5) * 22.0, y, (aSeed.y - 0.62) * 18.0);
          c.x += t * 0.35 + sin(t * 1.3 + aSeed.z * 6.0) * 0.6;   // drift with the breeze + flutter
          c.z += cos(t * 0.9 + aSeed.w * 6.0) * 0.4;
          c.x = mod(c.x + 11.0, 22.0) - 11.0;
          mat3 r = rot(vec3(aSeed.y - 0.5, 1.0, aSeed.z - 0.5), t * (2.0 + aSeed.z * 3.0));
          vec3 p = r * position * (0.75 + aSeed.w * 0.6);
          vShade = 0.65 + 0.35 * abs((r * vec3(0.0, 0.0, 1.0)).y);
          vec4 mvPosition = viewMatrix * vec4(c + p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          // Teardrop petal with the characteristic notch at the tip.
          vec2 p = vUv * 2.0 - 1.0;
          float body = 1.0 - smoothstep(0.85, 1.0, length(vec2(p.x * 0.75, p.y * 1.25 + p.x * p.x * 0.3)));
          float notch = smoothstep(0.0, 0.12, length(vec2(p.x - 0.95, p.y * 2.6)));
          float a = body * notch;
          if (a < 0.05) discard;
          vec3 col = mix(vec3(0.98, 0.55, 0.72), vec3(1.0, 0.82, 0.9), vUv.x) * vShade * 0.8;
          gl_FragColor = vec4(col, a * 0.92);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    // Positions come from the shader; the identity matrices only exist to satisfy InstancedMesh.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  setSpeed(s: number) { this.mat.uniforms.uSpeed.value = s; }
  update(t: number) { this.mat.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}
