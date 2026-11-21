import * as THREE from 'three';

/** Smoggy night sky: sodium city glow from below, drifting low clouds lit by it, a moon smudged by haze,
 *  and lightning that lights the clouds from inside. One draw call. */
export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.42, 0.36, -0.83).normalize() },
      uTop: { value: new THREE.Color('#020203') },
      uMid: { value: new THREE.Color('#0a0807') },
      uHorizon: { value: new THREE.Color('#2a1508') },
      uGlow: { value: new THREE.Color('#c4561a') },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFlash; uniform vec3 uMoonDir, uTop, uMid, uHorizon, uGlow;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.03 + 7.1; a *= 0.5; } return s; }
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
        float star = step(0.9985, s) * smoothstep(0.25, 0.6, h) * 0.5; // smog hides most of them
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
        vec3 f = fract(d * 220.0) - 0.5;
        star *= smoothstep(0.32, 0.0, length(f)) * tw;
        col += vec3(0.8, 0.85, 1.0) * star * 1.6;
        // Moon disc with a soft halo; values above 1.0 feed the bloom pass.
        float m = dot(d, uMoonDir);
        col += vec3(1.0, 0.86, 0.7) * smoothstep(0.9986, 0.9992, m) * 1.1;
        col += vec3(0.55, 0.6, 0.95) * pow(max(m, 0.0), 220.0) * 0.55;
        col += vec3(0.35, 0.3, 0.6) * pow(max(m, 0.0), 12.0) * 0.08;
        // Low cloud deck: projected onto a plane overhead, drifting, lit orange from the city below.
        if (h > 0.0) {
          vec2 cp = d.xz / max(h, 0.06) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = smoothstep(0.42, 0.78, fbm(cp));
          float under = pow(1.0 - h, 3.0);
          vec3 cloud = mix(vec3(0.03, 0.025, 0.022), uGlow * 0.32, under);
          col = mix(col, cloud, c * smoothstep(0.02, 0.25, h) * 0.85);
          // Lightning lights the clouds from inside.
          col += vec3(0.6, 0.65, 0.8) * uFlash * (0.25 + c) * smoothstep(0.0, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}
