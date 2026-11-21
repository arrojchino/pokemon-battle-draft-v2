import * as THREE from 'three';

/**
 * Final display-space grade: split toning (cool navy shadows, warm-neutral highlights), a gentle
 * saturation lift, vignette, a subtle edge colour fringe and fine grain against gradient banding, plus
 * the impact punch (radial blur), screen flashes and the screen-change fade.
 * Runs after OutputPass, so inputs are already tone-mapped and sRGB-encoded.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.5 },
    uSaturation: { value: 1.05 },
    uShadowTint: { value: new THREE.Color('#14245c') },
    uHighlightTint: { value: new THREE.Color('#fff4e8') },
    uSplit: { value: 0.07 },
    uFringe: { value: 0.0025 },
    uGrain: { value: 0.012 },
    uFade: { value: 0 },
    /** Impact punch: radial zoom blur + stronger fringe. */
    uPunch: { value: 0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
    uFlashAmt: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSaturation, uSplit, uFringe, uGrain, uFade, uPunch, uFlashAmt;
    uniform vec3 uShadowTint, uHighlightTint, uFlashColor; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * r2 * uFringe * (1.0 + uPunch * 8.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      if (uPunch > 0.002) {
        vec3 acc = col;
        for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, 0.5 + c * (1.0 - float(i) * 0.008 * uPunch)).rgb;
        col = acc / 7.0;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col += uShadowTint * uSplit * (1.0 - smoothstep(0.0, 0.45, l));
      col = mix(col, col * uHighlightTint, uSplit * smoothstep(0.55, 1.0, l));
      col *= 1.0 - uVignette * smoothstep(0.06, 0.55, r2 * 1.6);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 13.0) * 100.0) - 0.5) * uGrain;
      col += uFlashColor * uFlashAmt;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
