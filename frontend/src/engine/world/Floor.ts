import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const MAX_SLOTS = 4;

/** Rain-soaked asphalt pit: optional planar reflection in the puddles, rain ripples, a spray-painted ring and per-character glows. */
export class StageFloor {
  readonly group = new THREE.Group();
  readonly uniforms = {
    color: { value: new THREE.Color('#ffffff') },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color('#40e0ff') },
    uPulse: { value: 0 },
    uPulseColor: { value: new THREE.Color('#40e0ff') },
    uSlots: { value: Array.from({ length: MAX_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uReflect: { value: 0 },
    /** Rain ripple strength (0 when reduced motion asks for calm). */
    uRain: { value: 1 },
  };
  private reflector: Reflector | null = null;
  private surface: THREE.Mesh;
  private pulseT = 10;

  constructor(reflections: boolean, reflectionSize: number) {
    const radius = 6;
    const geo = new THREE.CircleGeometry(radius, 128);
    const shader = {
      name: 'StageFloorShader',
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 vUvRefl; varying vec3 vWorld;
        void main() {
          vUvRefl = textureMatrix * vec4(position, 1.0);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec3 color; uniform float uTime, uPulse, uReflect, uRain; uniform vec3 uAccent, uPulseColor; uniform vec4 uSlots[${MAX_SLOTS}];
        varying vec4 vUvRefl; varying vec3 vWorld;
        float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.03 + 11.0) * 0.3 + vn(p * 4.1 + 3.0) * 0.2; }
        // Rain ripples: one drop per cell, each on its own clock; returns ring brightness and a normal tilt.
        vec3 ripples(vec2 p, float t) {
          vec3 acc = vec3(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 q = p * (k == 0 ? 2.2 : 3.1) + float(k) * 17.0;
            vec2 id = floor(q); vec2 f = fract(q) - 0.5;
            float s = h21(id + float(k) * 3.7);
            vec2 o = (vec2(h21(id + 1.3), h21(id + 7.1)) - 0.5) * 0.6;
            float life = fract(t * (0.9 + s * 0.6) + s * 13.0);
            vec2 d = f - o; float r = length(d);
            float w = ring(r, life * 0.45, 0.03) * (1.0 - life) * (1.0 - life) * step(0.45, s);
            acc += vec3(normalize(d + 1e-4) * w, w);
          }
          return acc;
        }
        void main() {
          vec2 p = vWorld.xz; float r = length(p); float a = atan(p.y, p.x);
          // Wet asphalt: grainy aggregate, cracks along noise ridges, oil stains with a faint rainbow.
          float g = fbm(p * 3.0); float grain = h21(floor(p * 140.0));
          vec3 base = vec3(0.020, 0.019, 0.018) * (0.75 + 0.5 * g) * (0.85 + 0.3 * grain);
          float crack = smoothstep(0.035, 0.0, abs(fbm(p * 0.9 + 4.0) - 0.5)) * smoothstep(0.4, 0.7, fbm(p * 2.0));
          base *= 1.0 - crack * 0.7;
          float oil = smoothstep(0.62, 0.8, fbm(p * 0.55 + 21.0));
          base += oil * 0.02 * (0.5 + 0.5 * cos(6.28 * (fbm(p * 4.0) + vec3(0.0, 0.33, 0.67))));
          // Puddles collect in low spots; they are darker, smoother and mirror the scene.
          float puddle = smoothstep(0.52, 0.6, fbm(p * 0.42 + 2.0));
          vec3 rip = ripples(p, uTime) * uRain;
          vec3 col = base * (1.0 - puddle * 0.55);
          #ifdef USE_REFLECTION
            vec2 ruv = vUvRefl.xy / vUvRefl.w;
            vec2 j = rip.xy * 0.012 + (vec2(fbm(p * 6.0), fbm(p * 6.0 + 9.0)) - 0.5) * 0.006 * (1.0 - puddle);
            vec3 refl = texture2D(tDiffuse, ruv + j).rgb * 0.6 + texture2D(tDiffuse, ruv + j * 1.8 + vec2(0.0, 0.004)).rgb * 0.4;
            col += refl * uReflect * mix(0.12, 0.75, puddle);
          #endif
          col += vec3(0.25, 0.28, 0.32) * rip.z * (0.04 + 0.96 * puddle) * 0.45;
          // The fight ring is spray-painted: chipped hazard stripes on the rim, a scuffed accent line inside.
          float wear = smoothstep(0.35, 0.6, fbm(p * 7.0 + 5.0));
          float band = smoothstep(0.32, 0.3, abs(r - 5.55));
          float stripe = step(0.5, fract((a * 5.55 + r) * 1.6));
          vec3 paint = mix(vec3(0.02), vec3(0.85, 0.65, 0.05), stripe) * band * wear;
          col = mix(col, paint * 0.55 + col * 0.3, band * wear);
          float dash = step(0.35, fract(a * 6.0 / 3.14159 + uTime * 0.03));
          vec3 glow = uAccent * ring(r, 2.55, 0.03) * dash * 0.9 * (0.4 + 0.6 * wear);
          glow += vec3(0.9, 0.85, 0.75) * ring(r, 4.1, 0.02) * 0.12 * wear;
          // Pulse wave expanding from the centre on events (coin landing, confirm, big hits).
          float wave = ring(r, uPulse * 7.0, 0.35) * (1.0 - uPulse);
          glow += uPulseColor * wave * 2.5;
          // Painted circle and a soft glow under each active character slot (xz = position, z = radius, w = intensity).
          for (int i = 0; i < ${MAX_SLOTS}; i++) {
            vec4 s = uSlots[i];
            float d = length(p - s.xy);
            glow += uAccent * (ring(d, s.z, 0.03) * 1.3 * (0.5 + 0.5 * wear) + smoothstep(s.z, 0.0, d) * 0.1) * s.w;
          }
          col += glow;
          col *= smoothstep(6.0, 5.85, r) * 0.9 + 0.1;
          gl_FragColor = vec4(col * color, 1.0);
        }`,
    };
    if (reflections) {
      this.reflector = new Reflector(geo, { textureWidth: reflectionSize, textureHeight: reflectionSize, clipBias: 0.003, shader, multisample: 0, color: 0xffffff });
      // Reflector replaces material uniforms with its own objects; adopt them so our updates land.
      const mat = this.reflector.material as THREE.ShaderMaterial;
      mat.defines = { USE_REFLECTION: '' };
      Object.assign(this.uniforms, { tDiffuse: mat.uniforms.tDiffuse, textureMatrix: mat.uniforms.textureMatrix, color: mat.uniforms.color });
      mat.uniforms = this.uniforms as unknown as Record<string, THREE.IUniform>;
      this.uniforms.uReflect.value = 1;
      this.surface = this.reflector;
    } else {
      this.surface = new THREE.Mesh(geo, new THREE.ShaderMaterial(shader));
    }
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.y = 0.201;
    this.surface.receiveShadow = false;
    this.group.add(this.surface);

    // Platform body and a shadow catcher sharing the disc footprint.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.25, 0.2, 96, 1, true), new THREE.MeshStandardMaterial({ color: '#0c0d16', roughness: 0.5, metalness: 0.6 }));
    body.position.y = 0.1;
    this.group.add(body);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.ShadowMaterial({ opacity: 0.55, color: '#000004' }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.203; shadow.receiveShadow = true;
    this.group.add(shadow);
  }

  setSlot(i: number, x: number, z: number, radius: number, intensity: number) { this.uniforms.uSlots.value[i].set(x, z, radius, intensity); }
  pulse(color?: THREE.ColorRepresentation) { this.pulseT = 0; this.uniforms.uPulseColor.value.set(color ?? this.uniforms.uAccent.value); }
  update(t: number, dt: number) {
    this.uniforms.uTime.value = t;
    this.pulseT = Math.min(1, this.pulseT + dt / 1.6);
    this.uniforms.uPulse.value = this.pulseT >= 1 ? 2 : this.pulseT;
  }
  dispose() {
    this.reflector?.dispose();
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  }
}
