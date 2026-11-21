import * as THREE from 'three';

/**
 * Clear night over the stadium: deep navy overhead, a cool glow of stadium light along the horizon,
 * stars and a moon with a soft halo. One draw call.
 */
export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.42, -0.76).normalize() },
      uTop: { value: new THREE.Color('#02040b') },
      uMid: { value: new THREE.Color('#06102a') },
      uHorizon: { value: new THREE.Color('#13265a') },
      uGlow: { value: new THREE.Color('#4a74d8') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoonDir, uTop, uMid, uHorizon, uGlow;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
        col = mix(col, uTop, smoothstep(0.2, 0.8, h));
        // Stadium light spilling into the sky just above the stands.
        col += uGlow * pow(1.0 - abs(h), 14.0) * 0.35;
        col = mix(col, uHorizon * 0.3, smoothstep(0.0, -0.25, h));
        // Stars: hashed cells on the sphere, twinkling, fading into the horizon glow.
        vec3 cell = floor(d * 240.0);
        float s = hash(cell);
        float star = step(0.9975, s) * smoothstep(0.12, 0.5, h);
        float tw = 0.65 + 0.35 * sin(uTime * (0.8 + s * 2.5) + s * 40.0);
        vec3 f = fract(d * 240.0) - 0.5;
        star *= smoothstep(0.34, 0.0, length(f)) * tw;
        col += vec3(0.82, 0.88, 1.0) * star * 1.4;
        // Moon disc with a soft halo; values above 1.0 feed the bloom pass.
        float m = dot(d, uMoonDir);
        col += vec3(0.95, 0.97, 1.0) * smoothstep(0.9986, 0.9992, m) * 1.15;
        col += vec3(0.5, 0.62, 1.0) * pow(max(m, 0.0), 200.0) * 0.5;
        col += vec3(0.25, 0.35, 0.8) * pow(max(m, 0.0), 10.0) * 0.06;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}
