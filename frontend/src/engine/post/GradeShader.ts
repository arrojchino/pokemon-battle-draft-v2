import * as THREE from 'three';

/**
 * Final display-space grade: split toning (cool shadows, warm highlights), gentle saturation lift,
 * vignette, subtle edge chromatic fringe and fine animated grain to break up gradient banding.
 * Runs after OutputPass, so inputs are already tone-mapped and sRGB-encoded.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.08 },
    uShadowTint: { value: new THREE.Color('#2a3a7a') },
    uHighlightTint: { value: new THREE.Color('#ffd9c4') },
    uSplit: { value: 0.09 },
    uFringe: { value: 0.0035 },
    uGrain: { value: 0.025 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSaturation, uSplit, uFringe, uGrain, uFade;
    uniform vec3 uShadowTint, uHighlightTint; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * r2 * uFringe; // ≈1.5 px at the corners, zero in the centre
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col += uShadowTint * uSplit * (1.0 - smoothstep(0.0, 0.45, l)) - uSplit * 0.5 * (1.0 - smoothstep(0.0, 0.45, l)) * vec3(0.12);
      col = mix(col, col * uHighlightTint, uSplit * smoothstep(0.55, 1.0, l));
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2 * 1.6);
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 13.0) * 100.0) - 0.5;
      col += g * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
