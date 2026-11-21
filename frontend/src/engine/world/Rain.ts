import * as THREE from 'three';
import { rand } from '../math.js';

/**
 * Rain streaks, fully GPU-driven: every instance is a thin quad with a seed; the vertex shader moves it
 * down a wrapped volume around the stage, slants it with the wind, stretches it with its speed and
 * turns it to face the camera around its fall axis. One draw call, zero CPU work beyond a uniform.
 */
export class Rain {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;

  constructor(count: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seeds.set([rand(i + 0.3), rand(i * 1.9 + 2.2), rand(i * 3.1 + 7.7), rand(i * 5.3 + 0.9)], i * 4);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSpeed: { value: 1 }, uFlash: { value: 0 }, uWind: { value: 0.18 } }]),
      vertexShader: /* glsl */`
        uniform float uTime, uSpeed, uWind; attribute vec4 aSeed; varying vec2 vUv; varying float vFade;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          float fall = 11.0;
          float v = 9.0 + aSeed.w * 4.0;                       // metres per second
          float y = 10.0 - mod(uTime * uSpeed * v + aSeed.x * fall, fall);
          vec3 c = vec3((aSeed.y - 0.5) * 26.0, y, (aSeed.z - 0.7) * 22.0);
          c.x += (10.0 - y) * uWind;
          vec3 dir = normalize(vec3(uWind, -1.0, 0.0));
          // Billboard around the fall axis.
          vec3 toCam = normalize(cameraPosition - c);
          vec3 side = normalize(cross(dir, toCam));
          float len = 0.28 + aSeed.w * 0.32;
          vec3 p = c + side * (position.x * 0.012) - dir * (position.y * len);
          vFade = smoothstep(0.2, 1.4, y);                     // vanish into the ground rather than clip
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uFlash; varying vec2 vUv; varying float vFade;
        #include <fog_pars_fragment>
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          float a = across * along * vFade;
          gl_FragColor = vec4(vec3(0.55, 0.6, 0.66) * a * (0.32 + uFlash * 1.6), 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  setSpeed(s: number) { this.mat.uniforms.uSpeed.value = s; }
  setFlash(f: number) { this.mat.uniforms.uFlash.value = f; }
  update(t: number) { this.mat.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}
