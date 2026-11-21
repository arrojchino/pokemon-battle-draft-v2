import * as THREE from 'three';

/** Dirt, scuffs and rust creeping up from the feet: world-space noise baked into the lit material. */
export function addGrime(mat: THREE.MeshStandardMaterial, amount = 1) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uGrime = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimePos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrimePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGrimePos; uniform float uGrime;
float gHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
float gNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float n = gNoise(vGrimePos * 9.0) * 0.6 + gNoise(vGrimePos * 31.0) * 0.4;
  float low = 1.0 - smoothstep(0.25, 0.9, vGrimePos.y);
  float dirt = smoothstep(0.45, 0.95, n + low * 0.35) * uGrime;
  vec3 rust = vec3(0.24, 0.11, 0.05);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35 + rust * 0.4, dirt * 0.75);
  diffuseColor.rgb *= 1.0 - 0.12 * uGrime * gNoise(vGrimePos * 70.0);
}`);
  };
  mat.customProgramCacheKey = () => `grime-${amount}`;
}
