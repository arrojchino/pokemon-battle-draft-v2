import * as THREE from 'three';
import { rand } from '../math.js';

/**
 * Rooftop shrine plaza: a neon-lined torii behind the stage, two strings of paper lanterns, stone lantern
 * posts and a wet plaza floor. Lanterns are instanced and sway in the vertex shader.
 */
export class Shrine {
  readonly group = new THREE.Group();
  private lanternMat: THREE.ShaderMaterial;

  constructor() {
    const vermilion = new THREE.MeshStandardMaterial({ color: '#6e1712', roughness: 0.6, metalness: 0.05, emissive: '#140101' });
    const black = new THREE.MeshStandardMaterial({ color: '#0d0b10', roughness: 0.4, metalness: 0.3 });
    const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4f7a').multiplyScalar(3.2), toneMapped: false, fog: true });

    // Torii: two pillars, kasagi (upper lintel, swept ends), shimaki, nuki, central plaque.
    const torii = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(0.26, 0.3, 6.2, 24);
    for (const x of [-2.9, 2.9]) {
      const p = new THREE.Mesh(pillarGeo, vermilion); p.position.set(x, 3.1, 0); torii.add(p);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.45, 24), black); base.position.set(x, 0.22, 0); torii.add(base);
    }
    const kasagi = new THREE.Mesh(this.sweptBeam(8.6, 0.32, 0.6, 0.38), black); kasagi.position.y = 6.45; torii.add(kasagi);
    const shimaki = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.32, 0.5), vermilion); shimaki.position.y = 6.12; torii.add(shimaki);
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.3, 0.32), vermilion); nuki.position.y = 5.05; torii.add(nuki);
    const gakuzuka = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), vermilion); gakuzuka.position.y = 5.6; torii.add(gakuzuka);
    // Futuristic touch: neon strips under the lintels and down the inner pillar faces.
    const strip = (w: number, h: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), neon); m.position.set(x, y, z); torii.add(m); };
    strip(7.4, 0.035, 0.06, 0, 5.94, 0.26); strip(6.8, 0.035, 0.06, 0, 4.88, 0.17);
    strip(0.035, 4.6, 0.06, -2.62, 2.6, 0.2); strip(0.035, 4.6, 0.06, 2.62, 2.6, 0.2);
    torii.position.set(0, 0, -11.5); torii.scale.setScalar(1.3);
    torii.traverse(o => { (o as THREE.Mesh).castShadow = false; });
    this.group.add(torii);

    // Plaza: dark wet stone with a large-scale tile grid that fades into fog.
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(32, 96), new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTint: { value: new THREE.Color('#ff5c8a') } }]),
      vertexShader: /* glsl */`
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main() {
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`uniform vec3 uTint; varying vec3 vW;
        #include <fog_pars_fragment>
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 g = vW.xz / 1.8; vec2 f = abs(fract(g) - 0.5);
          float seam = smoothstep(0.47, 0.5, max(f.x, f.y));
          float t = h21(floor(g));
          vec3 col = vec3(0.008, 0.008, 0.014) * (0.75 + 0.5 * t) * (1.0 - seam * 0.6);
          // Wet sheen: faint warm glow toward the torii and lanterns.
          col += uTint * 0.025 * smoothstep(18.0, 0.0, length(vW.xz - vec2(0.0, -11.5))) * (0.6 + 0.4 * t);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = -0.01;
    this.group.add(plaza);

    // Stone lantern posts (toro) flanking the stage.
    const stone = new THREE.MeshStandardMaterial({ color: '#2a2a33', roughness: 0.9 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb36b').multiplyScalar(2.4), toneMapped: false });
    for (const [x, z] of [[-7.2, -2.2], [7.2, -2.2], [-6.4, -6.0], [6.4, -6.0]] as const) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 12), stone); post.position.y = 0.75;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), stone); box.position.y = 1.72;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.64), glow); light.position.y = 1.72;
      const light2 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.3, 0.44), glow); light2.position.y = 1.72;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4), stone); roof.position.y = 2.18; roof.rotation.y = Math.PI / 4;
      g.add(post, box, light, light2, roof); g.position.set(x, 0, z); this.group.add(g);
    }

    // Lantern strings: catenaries between poles, instanced chochin with shader sway and flicker.
    const strings: Array<[THREE.Vector3, THREE.Vector3, number]> = [
      [new THREE.Vector3(-10, 5.4, -5.5), new THREE.Vector3(-4.2, 7.4, -11.3), 8],
      [new THREE.Vector3(4.2, 7.4, -11.3), new THREE.Vector3(10, 5.4, -5.5), 8],
      [new THREE.Vector3(-11, 4.6, 1.5), new THREE.Vector3(-8.5, 5.4, -4.2), 5],
      [new THREE.Vector3(8.5, 5.4, -4.2), new THREE.Vector3(11, 4.6, 1.5), 5],
    ];
    const total = strings.reduce((n, s) => n + s[2], 0);
    const lgeo = new THREE.SphereGeometry(0.26, 16, 12); lgeo.scale(1, 1.35, 1);
    this.lanternMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: /* glsl */`
        attribute float aSeed; varying float vSeed; varying vec3 vN; varying vec3 vP;
        #include <fog_pars_vertex>
        uniform float uTime;
        void main() {
          vSeed = aSeed; vP = position; vN = normal;
          vec3 pos = position;
          float sway = sin(uTime * 0.9 + aSeed * 6.28) * 0.06;
          pos.x += sway * (0.4 - position.y);
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying float vSeed; varying vec3 vN; varying vec3 vP;
        #include <fog_pars_fragment>
        void main() {
          float ribs = 0.8 + 0.2 * smoothstep(0.3, 0.5, abs(fract(vP.y * 14.0) - 0.5) * 2.0);
          float caps = smoothstep(0.30, 0.33, abs(vP.y));
          float flick = 0.9 + 0.1 * sin(uTime * 7.0 + vSeed * 40.0) * sin(uTime * 3.1 + vSeed * 9.0);
          vec3 warm = mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.72, 0.4), 0.5 + 0.5 * vN.y);
          vec3 col = mix(warm * 1.6 * ribs * flick, vec3(0.03, 0.015, 0.015), caps);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    const lanterns = new THREE.InstancedMesh(lgeo, this.lanternMat, total);
    const seeds = new Float32Array(total);
    const m = new THREE.Matrix4(); let k = 0;
    const lineMat = new THREE.LineBasicMaterial({ color: '#1a1520', fog: true });
    for (const [a, b, n] of strings) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.7; pts.push(p); }
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.7 + 0.42;
        m.makeTranslation(p.x, p.y, p.z); lanterns.setMatrixAt(k, m); seeds[k] = rand(k * 3.3 + 1); k++;
      }
    }
    lgeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    lanterns.computeBoundingSphere();
    this.group.add(lanterns);
  }

  /** Box whose ends sweep upward, the signature kasagi silhouette. */
  private sweptBeam(len: number, h: number, depth: number, lift: number) {
    const g = new THREE.BoxGeometry(len, h, depth, 24, 1, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (len / 2); pos.setY(i, pos.getY(i) + Math.pow(Math.abs(x), 3) * lift); }
    g.computeVertexNormals();
    return g;
  }

  update(t: number) { this.lanternMat.uniforms.uTime.value = t; }
}
