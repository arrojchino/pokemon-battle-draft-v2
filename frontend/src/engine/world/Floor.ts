import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const MAX_SLOTS = 4;

/** Polished stage disc: optional planar reflection, engraved light rings, per-character pedestal glow. */
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
        uniform sampler2D tDiffuse; uniform vec3 color; uniform float uTime, uPulse, uReflect; uniform vec3 uAccent, uPulseColor; uniform vec4 uSlots[${MAX_SLOTS}];
        varying vec4 vUvRefl; varying vec3 vWorld;
        float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 p = vWorld.xz; float r = length(p); float a = atan(p.y, p.x);
          // Stone: concentric segmented tiles with tiny tonal variation.
          float band = floor(r / 0.75); float seg = floor((a + 3.14159) / (6.28318 / (8.0 + band * 6.0)));
          float tone = h21(vec2(band, seg));
          vec3 base = vec3(0.012, 0.012, 0.02) * (0.8 + 0.4 * tone);
          float seam = smoothstep(0.012, 0.0, abs(fract(r / 0.75) - 0.5) - 0.488);
          base *= 1.0 - seam * 0.5;
          vec3 col = base;
          #ifdef USE_REFLECTION
            vec2 ruv = vUvRefl.xy / vUvRefl.w;
            // Low-frequency ripple instead of per-pixel jitter: reads as wet stone, not noise.
            vec2 j = vec2(sin(p.x * 7.0 + uTime * 0.6) + sin(p.y * 5.3 - uTime * 0.4), cos(p.y * 6.1 + uTime * 0.5) + sin(p.x * 4.7)) * 0.25;
            vec3 refl = texture2D(tDiffuse, ruv + j * 0.003).rgb * 0.6 + texture2D(tDiffuse, ruv + j * 0.007 + vec2(0.0, 0.004)).rgb * 0.4;
            col += refl * uReflect * (0.42 + 0.2 * tone);
          #endif
          // Engraved rings: steady outer rings, rotating dashed inner ring tinted by the focused partner.
          float dash = step(0.35, fract(a * 6.0 / 3.14159 + uTime * 0.05));
          vec3 glow = vec3(0.0);
          glow += vec3(0.55, 0.65, 1.0) * ring(r, 5.75, 0.025) * 0.7;
          glow += vec3(0.5, 0.6, 1.0) * ring(r, 4.1, 0.012) * 0.35;
          glow += uAccent * ring(r, 2.55, 0.02) * dash * 1.5;
          float tick = step(0.92, fract(a * 36.0 / 6.28318)) * smoothstep(3.15, 3.05, r) * smoothstep(2.85, 2.95, r);
          glow += uAccent * tick * 0.9;
          // Pulse wave expanding from the centre on events (coin landing, confirm).
          float wave = ring(r, uPulse * 7.0, 0.35) * (1.0 - uPulse);
          glow += uPulseColor * wave * 2.5;
          // Pedestal glow under each active character slot (xz = position, z = radius, w = intensity).
          for (int i = 0; i < ${MAX_SLOTS}; i++) {
            vec4 s = uSlots[i];
            float d = length(p - s.xy);
            glow += uAccent * (ring(d, s.z, 0.03) * 1.6 + smoothstep(s.z, 0.0, d) * 0.12) * s.w;
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
