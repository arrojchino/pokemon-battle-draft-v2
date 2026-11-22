import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FIELD, PLATFORM_R } from './dims.js';

export const MAX_SLOTS = 4;

/** Field axis: from your Pokémon's spot to the opponent's (see BattleCamera ARENA), so the lines frame the battle. */
const MID = new THREE.Vector2(0.075, -0.1).multiplyScalar(FIELD);
/** GLSL literals: field scale and platform radius. */
const SF = FIELD.toFixed(4), R = PLATFORM_R.toFixed(4);
const AXIS = new THREE.Vector2(2.15, -2.5).normalize();

/**
 * The stadium platform and its battle field: mown turf inside classic white field lines (boundary, centre
 * line, centre circle with a Poké Ball core, trainer boxes), a polished rim around it with an accent
 * light strip, optional planar reflection, a pulse wave for big moments and a soft glow under each
 * Pokémon standing on it. Around the field the platform is the plaza: faint paving rings and spokes with a
 * dashed accent walkway.
 */
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
    uMid: { value: MID.clone() },
    uAxis: { value: AXIS.clone() },
  };
  private reflector: Reflector | null = null;
  private surface: THREE.Mesh;
  private pulseT = 10;

  constructor(reflections: boolean, reflectionSize: number) {
    const radius = PLATFORM_R;
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
        uniform sampler2D tDiffuse; uniform vec3 color; uniform float uTime, uPulse, uReflect;
        uniform vec3 uAccent, uPulseColor; uniform vec4 uSlots[${MAX_SLOTS}]; uniform vec2 uMid, uAxis;
        varying vec4 vUvRefl; varying vec3 vWorld;
        float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
        float line(float d, float w) { float aa = fwidth(d) * 1.2 + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
        void main() {
          vec2 p = vWorld.xz; float r = length(p);
          // Field space: x along the battle axis, y across it.
          vec2 d = p - uMid; vec2 q = vec2(dot(d, uAxis), dot(d, vec2(-uAxis.y, uAxis.x)));
          vec2 hb = vec2(2.9, 2.0) * ${SF};
          float inField = 1.0 - smoothstep(-0.02, 0.02, sdBox(q, hb));
          // Mown turf: alternating bands across the field, fine grain, darker toward the edges.
          float band = step(0.5, fract(q.x * 0.6 / ${SF} + 0.25));
          float grain = vn(p * 38.0) * 0.6 + vn(p * 9.0) * 0.4;
          vec3 turf = mix(vec3(0.018, 0.050, 0.060), vec3(0.024, 0.064, 0.074), band) * (0.82 + 0.3 * grain);
          turf *= 1.0 - 0.25 * smoothstep(1.2, 3.2, length(q / hb * vec2(2.4, 1.6)));
          // Polished rim outside the field: near-black with soft concentric sheen.
          vec3 rim = vec3(0.016, 0.019, 0.030) * (0.9 + 0.2 * sin(r * 40.0) * 0.5);
          // The plaza around the field: paving rings and spokes, fading out toward the platform edge.
          float sec = 6.2831853 / 28.0;
          float da = (fract(atan(p.y, p.x) / sec + 0.5) - 0.5) * sec;
          float paving = max(line(fract(r / 1.35 + 0.5) - 0.5, 0.008), line(r * da, 0.01) * step(${SF} * 3.8, r));
          rim += vec3(0.032, 0.038, 0.058) * paving * smoothstep(${R} - 0.5, ${R} - 1.4, r);
          vec3 col = mix(rim, turf, inField);
          #ifdef USE_REFLECTION
            vec2 ruv = vUvRefl.xy / vUvRefl.w;
            vec3 refl = texture2D(tDiffuse, ruv + (vec2(vn(p * 7.0), vn(p * 7.0 + 9.0)) - 0.5) * 0.004).rgb;
            col += refl * uReflect * mix(0.22, 0.05, inField);
          #endif
          // Field lines.
          float lw = 0.022;
          float cr = length(q);
          float lines = line(sdBox(q, hb), lw);
          // The centre line is the Poké Ball's band: it stops at the button ring in the middle.
          lines = max(lines, line(q.x, lw) * step(abs(q.y), hb.y) * step(0.24 * ${SF}, cr));
          lines = max(lines, line(cr - 0.9 * ${SF}, lw));
          lines = max(lines, line(cr - 0.24 * ${SF}, lw * 0.9));
          lines = max(lines, line(sdBox(q - vec2(2.35, 0.0) * ${SF}, vec2(0.55, 0.8) * ${SF}), lw * 0.8));
          lines = max(lines, line(sdBox(q + vec2(2.35, 0.0) * ${SF}, vec2(0.55, 0.8) * ${SF}), lw * 0.8));
          // The button itself, filled in softly.
          float core = (1.0 - smoothstep(0.14 * ${SF}, 0.155 * ${SF}, cr)) * 0.3;
          float wear = 0.85 + 0.15 * vn(p * 22.0);
          col = mix(col, vec3(0.86, 0.9, 0.97), clamp(lines * 0.78 * wear + core, 0.0, 1.0));
          // Accent light strip near the platform edge.
          vec3 glow = uAccent * ring(r, ${R} - 0.45, 0.025) * 0.75;
          glow += vec3(0.75, 0.82, 1.0) * ring(r, ${R} - 0.15, 0.012) * 0.25;
          // A dashed walkway ring of accent light out in the plaza.
          glow += uAccent * ring(r, ${R} - 2.1, 0.03) * step(0.45, fract(atan(p.y, p.x) * 9.549)) * 0.32;
          // Pulse wave from the centre on events (coin landing, confirm, big hits).
          glow += uPulseColor * ring(r, uPulse * (${R} + 1.0), 0.35) * (1.0 - uPulse) * 2.2;
          // Soft glow and ring under each Pokémon on the platform (xy = position, z = radius, w = intensity).
          for (int i = 0; i < ${MAX_SLOTS}; i++) {
            vec4 s = uSlots[i];
            float dd = length(p - s.xy);
            glow += uAccent * (ring(dd, s.z, 0.03) * 1.1 + smoothstep(s.z, 0.0, dd) * 0.1) * s.w;
          }
          col += glow;
          col *= smoothstep(${R}, ${R} - 0.1, r) * 0.9 + 0.1;
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
    this.group.add(this.surface);

    // Platform body and a shadow catcher sharing the disc footprint.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.25, 0.2, 96, 1, true), new THREE.MeshStandardMaterial({ color: '#0b0f1c', roughness: 0.45, metalness: 0.6 }));
    body.position.y = 0.1;
    this.group.add(body);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.ShadowMaterial({ opacity: 0.5, color: '#000006' }));
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
