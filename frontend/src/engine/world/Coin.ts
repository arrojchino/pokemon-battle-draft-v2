import * as THREE from 'three';
import { easeOutCubic } from '../math.js';
import type { CoinSide } from '@shared';

/** Engraved face texture: sun (heads) or crescent moon (tails), drawn procedurally. */
function faceTexture(side: CoinSide): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const make = (glowOnly: boolean) => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d')!;
    if (!glowOnly) {
      const g = x.createRadialGradient(190, 170, 30, 256, 256, 260);
      g.addColorStop(0, '#f4f1ff'); g.addColorStop(0.55, '#b9b6d6'); g.addColorStop(1, '#5d5a7a');
      x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    } else { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); }
    x.translate(256, 256);
    x.strokeStyle = glowOnly ? '#ffffff' : '#2b2840'; x.fillStyle = x.strokeStyle;
    x.lineWidth = 7; x.beginPath(); x.arc(0, 0, 228, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 206, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 48; i++) { x.save(); x.rotate(i / 48 * Math.PI * 2); x.fillRect(-1.5, -224, 3, i % 4 ? 8 : 16); x.restore(); }
    if (side === 'heads') {
      x.beginPath(); x.arc(0, 0, 62, 0, Math.PI * 2); glowOnly ? x.fill() : x.stroke();
      for (let i = 0; i < 12; i++) { x.save(); x.rotate(i / 12 * Math.PI * 2); x.beginPath(); x.moveTo(-14, -82); x.lineTo(0, -150); x.lineTo(14, -82); x.closePath(); glowOnly ? x.fill() : x.stroke(); x.restore(); }
    } else {
      x.beginPath(); x.arc(0, 0, 110, 0.35 * Math.PI, 1.65 * Math.PI, false); x.arc(-48, 0, 92, 1.55 * Math.PI, 0.45 * Math.PI, true); x.closePath(); glowOnly ? x.fill() : x.stroke();
      for (const [sx, sy, r] of [[86, -70, 9], [118, 10, 6], [70, 84, 7]] as const) { x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill(); }
    }
    x.font = '600 34px "Chakra Petch", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(side === 'heads' ? 'HEADS' : 'TAILS', 0, 176);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  return { map: make(false), emissive: make(true) };
}

/**
 * The toss coin. The animation only decorates a result the authority already chose: rotation is
 * solved so the coin lands on that face. Sparks are a GPU particle burst driven by one uniform.
 */
export class Coin {
  readonly group = new THREE.Group();
  private coin = new THREE.Group();
  private sparks: THREE.Points;
  private sparkMat: THREE.ShaderMaterial;
  private flipping = false; private t0 = 0; private dur = 2.1; private startRot = 0; private targetRot = 0;
  private resolve: (() => void) | null = null;
  private burstT = 10;
  private hover = 0;
  visibleTarget = 0; private vis = 0;
  onLand: (() => void) | null = null;

  constructor(private reducedMotion: () => boolean) {
    const metal = new THREE.MeshStandardMaterial({ color: '#c9c6e6', metalness: 1, roughness: 0.28 });
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 72, 1, true), metal);
    edge.rotation.x = Math.PI / 2; this.coin.add(edge);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ff3ff').multiplyScalar(1.6), toneMapped: false }));
    this.coin.add(rim);
    for (const side of ['heads', 'tails'] as const) {
      const tex = faceTexture(side);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 72), new THREE.MeshStandardMaterial({
        map: tex.map, emissiveMap: tex.emissive, emissive: new THREE.Color('#7fe9ff'), emissiveIntensity: 0.9, metalness: 0.85, roughness: 0.32,
      }));
      face.position.z = side === 'heads' ? 0.026 : -0.026;
      // Rotated about X (not Y) so the face reads upright after the coin's half turn about X.
      if (side === 'tails') face.rotation.x = Math.PI;
      this.coin.add(face);
    }
    this.group.add(this.coin);

    const N = 160;
    const g = new THREE.BufferGeometry();
    const dir = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.1;
      dir.set([Math.cos(a) * e, 0.6 + Math.random() * 1.4, Math.sin(a) * e, 0.4 + Math.random() * 0.6], i * 4);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
    this.sparkMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 10 }, uColor: { value: new THREE.Color('#9ff3ff') }, uScale: { value: 1 } },
      vertexShader: /* glsl */`uniform float uT, uScale; attribute vec4 aDir; varying float vA;
        void main() {
          float t = uT * aDir.w;
          vec3 p = vec3(aDir.x, aDir.y, aDir.z) * t * 1.6; p.y -= 2.2 * t * t;
          vA = 1.0 - smoothstep(0.2, 1.0, uT);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (14.0 * aDir.w) * uScale / -mv.z; gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor * 2.5 * smoothstep(0.5, 0.0, d) * vA, 1.0); }`,
    });
    this.sparks = new THREE.Points(g, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.group.visible = false;
  }

  setPixelScale(s: number) { this.sparkMat.uniforms.uScale.value = s; }

  flip(result: CoinSide, now: number): Promise<void> {
    this.resolve?.();
    this.visibleTarget = 1;
    this.startRot = this.coin.rotation.x;
    const turns = this.reducedMotion() ? 0 : 6;
    const base = Math.ceil(this.startRot / (Math.PI * 2)) * Math.PI * 2;
    // Heads faces +Z at rotation 0; tails needs half a turn.
    this.targetRot = base + turns * Math.PI * 2 + (result === 'tails' ? Math.PI : 0);
    this.dur = this.reducedMotion() ? 0.6 : 2.1;
    this.t0 = now; this.flipping = true;
    return new Promise(r => { this.resolve = r; });
  }

  showFace(result: CoinSide | null) {
    if (this.flipping) return;
    this.coin.rotation.x = result === 'tails' ? Math.PI : 0;
  }

  update(dt: number) {
    this.vis += (this.visibleTarget - this.vis) * (1 - Math.exp(-6 * dt));
    this.group.visible = this.vis > 0.01;
    this.group.scale.setScalar(Math.max(0.001, this.vis) * 0.62);
    if (!this.group.visible) return;
    this.hover += dt;
    if (this.flipping) {
      const p = Math.min(1, (performance.now() / 1000 - this.t0) / this.dur);
      const e = easeOutCubic(p);
      this.coin.rotation.x = this.startRot + (this.targetRot - this.startRot) * e;
      this.coin.position.y = this.reducedMotion() ? 0 : Math.sin(p * Math.PI) * 1.25;
      this.coin.rotation.z = Math.sin(p * Math.PI * 2) * 0.35 * (1 - p);
      if (p >= 1) { this.flipping = false; this.burstT = 0; this.onLand?.(); this.resolve?.(); this.resolve = null; }
    } else {
      this.coin.position.y = Math.sin(this.hover * 1.4) * 0.04;
      this.coin.rotation.z *= Math.exp(-4 * dt);
      this.coin.rotation.y = Math.sin(this.hover * 0.6) * 0.35;
    }
    this.burstT += dt;
    this.sparkMat.uniforms.uT.value = this.burstT;
    this.sparks.visible = this.burstT < 1.2;
  }
}
