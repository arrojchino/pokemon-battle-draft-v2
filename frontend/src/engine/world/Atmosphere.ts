import * as THREE from 'three';

/**
* Volumetric-style light shafts (additive, noise-scrolled cones) from the street lamps and low smog.
 * All cheap: a handful of transparent quads/cones with analytic falloff, no raymarching.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  private shaftMat: THREE.ShaderMaterial;
  private mistMat: THREE.ShaderMaterial;
  readonly accent = new THREE.Color('#40e0ff');

  constructor(shafts: boolean) {
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#d27a32') }, uIntensity: { value: 0.06 } },
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
      // Sodium street lamps mounted high on the walls, raking down through the rain.
      for (const [x, z, rz, s] of [[-6.2, -4.5, 0.42, 1], [6.6, -5.5, -0.36, 0.9]] as const) {
        const m = new THREE.Mesh(geo, this.shaftMat);
        m.position.set(x, 9.2, z); m.rotation.z = rz; m.scale.setScalar(s); m.renderOrder = 4;
        this.group.add(m);
      }
    }

    this.mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#3b3a30') } },
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

  }

  setAccent(c: THREE.Color) { this.accent.copy(c); }
  update(t: number, _dt: number) {
    this.shaftMat.uniforms.uTime.value = t;
    this.mistMat.uniforms.uTime.value = t;
  }
}
