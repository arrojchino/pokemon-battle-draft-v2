import * as THREE from 'three';

/**
 * Air over the field: faint light shafts from the floodlights across the field and slow motes drifting
 * through the light. All cheap: a couple of additive cones with analytic falloff and one point cloud.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private shaftMat: THREE.ShaderMaterial;
  private motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly accent = new THREE.Color('#40e0ff');
  reduced = false;

  constructor(shafts: boolean, lamps: THREE.Vector3[]) {
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#bcd0ff') }, uIntensity: { value: 0.045 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform float uTime, uIntensity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float n(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(n(i), n(i + vec2(1, 0)), f.x), mix(n(i + vec2(0, 1)), n(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float along = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          float dust = 0.7 + 0.3 * vn(vec2(vUv.x * 16.0, vUv.y * 3.0 - uTime * 0.08));
          gl_FragColor = vec4(uColor * edge * along * dust * uIntensity, 1.0);
        }`,
    });
    if (shafts) {
      // Only the towers across the field: the ones behind the camera would just wash over the lens.
      const target = new THREE.Vector3(0, 0.4, 0);
      for (const lamp of lamps.filter(l => l.z < 0)) {
        const dir = new THREE.Vector3().subVectors(lamp, target);
        const len = dir.length();
        const geo = new THREE.CylinderGeometry(0.6, 4.2, len, 32, 1, true);
        const m = new THREE.Mesh(geo, this.shaftMat);
        m.position.copy(target).addScaledVector(dir, 0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        m.renderOrder = 4;
        this.group.add(m);
      }
    }

    // Motes: a few hundred specks drifting up through the light, animated in the vertex shader.
    const N = 320;
    const pos = new Float32Array(N * 3); const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 7.5;
      pos.set([Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r], i * 3); seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.motes = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 1 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`attribute float aSeed; uniform float uTime, uSpeed, uScale; varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * uSpeed * (0.05 + aSeed * 0.08);
          p.y = mod(p.y + t, 5.0) + 0.25;
          p.x += sin(uTime * 0.3 * uSpeed + aSeed * 30.0) * 0.25;
          p.z += cos(uTime * 0.25 * uSpeed + aSeed * 17.0) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = smoothstep(0.25, 1.0, p.y) * smoothstep(5.25, 3.8, p.y) * (0.35 + 0.65 * aSeed);
          gl_PointSize = uScale * (6.0 + aSeed * 5.0) / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * a * 0.8, 1.0); }`,
    }));
    this.motes.frustumCulled = false; this.motes.renderOrder = 4;
    this.group.add(this.motes);
  }

  setAccent(c: THREE.Color) { this.accent.copy(c); }
  setPixelScale(s: number) { this.motes.material.uniforms.uScale.value = s; }
  update(t: number, _dt: number) {
    this.shaftMat.uniforms.uTime.value = t;
    this.motes.material.uniforms.uTime.value = t;
    this.motes.material.uniforms.uSpeed.value = this.reduced ? 0.2 : 1;
  }
}
