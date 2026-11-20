import * as THREE from 'three';

/**
 * Volumetric-style light shafts (additive, noise-scrolled cones), low ground mist and floating sigil rings.
 * All cheap: a handful of transparent quads/cones with analytic falloff, no raymarching.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private shaftMat: THREE.ShaderMaterial;
  private mistMat: THREE.ShaderMaterial;
  private sigils: THREE.Mesh[] = [];
  readonly accent = new THREE.Color('#40e0ff');

  constructor(shafts: boolean) {
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#5b5fc4') }, uIntensity: { value: 0.045 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform float uTime, uIntensity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float n(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(n(i), n(i + vec2(1, 0)), f.x), mix(n(i + vec2(0, 1)), n(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float dust = 0.65 + 0.35 * vn(vec2(vUv.x * 18.0, vUv.y * 4.0 - uTime * 0.15));
          gl_FragColor = vec4(uColor * edge * along * dust * uIntensity, 1.0);
        }`,
    });
    if (shafts) {
      const geo = new THREE.CylinderGeometry(0.25, 1.9, 9, 32, 1, true);
      geo.translate(0, -4.5, 0);
      for (const [x, z, rz, s] of [[-2.2, -1.5, 0.22, 1], [2.4, -1.8, -0.2, 0.9], [0, -3.8, 0.04, 1.2]] as const) {
        const m = new THREE.Mesh(geo, this.shaftMat);
        m.position.set(x, 9.2, z); m.rotation.z = rz; m.scale.setScalar(s); m.renderOrder = 4;
        this.group.add(m);
      }
    }

    this.mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#2e2370') } },
      vertexShader: /* glsl */`varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uColor; varying vec3 vW;
        float n(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(n(i), n(i + vec2(1, 0)), f.x), mix(n(i + vec2(0, 1)), n(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 7.0) * 0.3 + vn(p * 4.3 + 3.0) * 0.15; }
        void main() {
          vec2 p = vW.xz * 0.22 + vec2(uTime * 0.03, uTime * 0.012);
          float d = fbm(p);
          float r = length(vW.xz);
          float a = smoothstep(0.35, 0.85, d) * smoothstep(26.0, 6.0, r) * smoothstep(2.0, 5.5, r) * 0.22;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    for (const y of [0.25, 0.6]) {
      const mist = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), this.mistMat);
      mist.rotation.x = -Math.PI / 2; mist.position.y = y; mist.renderOrder = 3;
      this.group.add(mist);
    }

    // Sigil rings: canvas-drawn glyph bands orbiting high behind the stage.
    const tex = this.sigilTexture();
    for (const [r, y, tilt, speed] of [[7.5, 8.2, 0.12, 0.03]] as const) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.42, 96, 1, true), new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: new THREE.Color('#7fe9ff'), opacity: 0.28, toneMapped: false,
      }));
      ring.position.set(0, y, -9); ring.rotation.x = tilt; ring.userData.speed = speed; ring.renderOrder = 4;
      this.sigils.push(ring); this.group.add(ring);
    }
  }

  private sigilTexture() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.fillStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 6); x.lineTo(2048, 6); x.moveTo(0, 58); x.lineTo(2048, 58); x.stroke();
    // Abstract glyphs: hexagons, ticks and short runes. Deliberately not any real script or logo.
    for (let i = 0; i < 64; i++) {
      const cx = 16 + i * 32; const k = (i * 7) % 5;
      x.beginPath();
      if (k === 0) { for (let j = 0; j <= 6; j++) { const a = j / 6 * Math.PI * 2; x.lineTo(cx + Math.cos(a) * 9, 32 + Math.sin(a) * 9); } }
      else if (k === 1) { x.moveTo(cx - 8, 22); x.lineTo(cx + 8, 22); x.moveTo(cx, 22); x.lineTo(cx, 44); }
      else if (k === 2) { x.arc(cx, 32, 7, 0, Math.PI * 1.5); }
      else if (k === 3) { x.moveTo(cx - 8, 42); x.lineTo(cx, 20); x.lineTo(cx + 8, 42); x.moveTo(cx - 4, 34); x.lineTo(cx + 4, 34); }
      else { x.fillRect(cx - 2, 18, 4, 28); }
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  setAccent(c: THREE.Color) { this.accent.copy(c); }
  update(t: number, dt: number) {
    this.shaftMat.uniforms.uTime.value = t;
    this.mistMat.uniforms.uTime.value = t;
    for (const s of this.sigils) {
      s.rotation.y += (s.userData.speed as number) * dt;
      ((s.material as THREE.MeshBasicMaterial).color).lerp(this.accent, 1 - Math.exp(-2 * dt));
    }
  }
}
