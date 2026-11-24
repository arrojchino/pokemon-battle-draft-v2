import * as THREE from 'three';
import { GLSL_NOISE } from './shared.js';

/**
 * The intro's night sky: deep navy overhead, a cool moonlit band and a faint warm glow over the town on the horizon,
 * twinkling stars with a soft milky band, thin drifting cloud wisps kept low (the upper centre stays calm for the
 * title card), and a large moon with a cratered disc and halo (bright enough to bloom). One draw call.
 */
export function createIntroSky(moonDir: THREE.Vector3, uTime: { value: number }): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime,
      uMoonDir: { value: moonDir.clone().normalize() },
      uTop: { value: new THREE.Color('#02040c') },
      uMid: { value: new THREE.Color('#081331') },
      uHorizon: { value: new THREE.Color('#1a2c5e') },
      uWarm: { value: new THREE.Color('#ff9a5a') },
      uMoonTint: { value: new THREE.Color('#4a6ad8') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uMoonDir, uTop, uMid, uHorizon, uWarm, uMoonTint;
      varying vec3 vDir;
      ${GLSL_NOISE}
      float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float fbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * iNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.2, h));
        col = mix(col, uTop, smoothstep(0.16, 0.7, h));
        float m = dot(d, uMoonDir);
        // moonlit sky around the moon, strongest low down
        col += uMoonTint * pow(max(m, 0.0), 5.0) * 0.22 * (1.0 - smoothstep(0.0, 0.7, h));
        // warm town glow over the valley (ahead, -z), hugging the horizon
        vec2 hz = normalize(d.xz + 1e-5);
        float town = pow(max(dot(hz, normalize(vec2(0.18, -1.0))), 0.0), 5.0);
        col += uWarm * town * exp(-max(h, 0.0) * 16.0) * 0.16 * smoothstep(-0.08, 0.0, h);
        // stars (twinkling), fewer near the horizon, a faint milky band crossing the sky
        float band = exp(-pow(dot(d, normalize(vec3(0.7, 0.35, 0.62))) / 0.22, 2.0));
        vec3 cell = floor(d * 260.0);
        float s = hash3(cell);
        float thresh = 0.9972 - band * 0.004;
        float star = step(thresh, s) * smoothstep(0.06, 0.4, h);
        float tw = 0.6 + 0.4 * sin(uTime * (0.7 + s * 2.6) + s * 50.0);
        vec3 f = fract(d * 260.0) - 0.5;
        star *= smoothstep(0.32, 0.0, length(f)) * tw * (0.5 + 0.9 * fract(s * 91.0));
        vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), step(0.7, fract(s * 37.0)));
        col += starCol * star * 1.5 * (1.0 - smoothstep(0.995, 0.9995, m));
        col += vec3(0.25, 0.3, 0.5) * band * fbm2(d.xz * 6.0 + d.y * 3.0) * 0.06 * smoothstep(0.05, 0.4, h);
        // cloud wisps: long thin streaks low in the sky, silver-lined near the moon, drifting slowly
        vec2 cp = vec2(atan(d.x, -d.z) * 3.0, h * 26.0);
        float c = fbm2(vec2(cp.x * 1.2 + uTime * 0.012, cp.y * 0.9));
        c = smoothstep(0.52, 0.8, c) * smoothstep(0.02, 0.07, h) * (1.0 - smoothstep(0.16, 0.3, h));
        vec3 cloudCol = mix(vec3(0.05, 0.08, 0.17), vec3(0.42, 0.5, 0.75), pow(max(m, 0.0), 14.0));
        col = mix(col, cloudCol, c * 0.75);
        // the moon: disc with soft maria and limb darkening, halo; clouds pass in front of the halo only
        float ang = sqrt(max(2.0 * (1.0 - m), 0.0));
        float R = 0.027;
        vec3 T = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec3 B = cross(T, uMoonDir);
        vec2 mu = vec2(dot(d, T), dot(d, B)) / R;
        float disc = smoothstep(R + 0.0009, R - 0.0009, ang);
        float maria = fbm2(mu * 2.2 + 3.0);
        float limb = sqrt(max(1.0 - dot(mu, mu), 0.0));
        vec3 moon = vec3(1.0, 0.97, 0.9) * (0.72 + 0.28 * limb) * (1.0 - smoothstep(0.45, 0.75, maria) * 0.28) * 2.1;
        col = mix(col, moon, disc);
        col += vec3(0.55, 0.66, 1.0) * exp(-ang * 34.0) * 0.38 * (1.0 - disc);
        col += vec3(0.3, 0.4, 0.85) * exp(-ang * 7.0) * 0.07;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'intro-sky';
  return sky;
}
