import * as THREE from 'three';

/** Night sky dome: graded gradient, horizon glow, procedural stars and a haloed moon. One draw call. */
export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.42, 0.36, -0.83).normalize() },
      uTop: { value: new THREE.Color('#03040c') },
      uMid: { value: new THREE.Color('#140c2e') },
      uHorizon: { value: new THREE.Color('#5a1d5e') },
      uGlow: { value: new THREE.Color('#ff5c8a') },
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
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        col = mix(col, uTop, smoothstep(0.18, 0.75, h));
        // Warm city glow hugging the horizon, stronger toward the back of the stage.
        float back = smoothstep(0.2, -1.0, d.z);
        col += uGlow * pow(1.0 - abs(h), 18.0) * (0.35 + 0.45 * back);
        col = mix(col, uHorizon * 0.35, smoothstep(0.0, -0.25, h));
        // Stars: hashed cells on the sphere, twinkling, fading near the horizon glow.
        vec3 cell = floor(d * 220.0);
        float s = hash(cell);
        float star = step(0.9965, s) * smoothstep(0.08, 0.35, h);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
        vec3 f = fract(d * 220.0) - 0.5;
        star *= smoothstep(0.32, 0.0, length(f)) * tw;
        col += vec3(0.8, 0.85, 1.0) * star * 1.6;
        // Moon disc with a soft halo; values above 1.0 feed the bloom pass.
        float m = dot(d, uMoonDir);
        col += vec3(1.0, 0.93, 0.86) * smoothstep(0.9986, 0.9992, m) * 2.2;
        col += vec3(0.55, 0.6, 0.95) * pow(max(m, 0.0), 220.0) * 0.55;
        col += vec3(0.35, 0.3, 0.6) * pow(max(m, 0.0), 12.0) * 0.08;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}
