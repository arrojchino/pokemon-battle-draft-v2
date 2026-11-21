import * as THREE from 'three';
import { addGrime } from '../materials.js';
import { rand } from '../math.js';

/**
 * The back alley around the pit: rain-soaked asphalt, brick walls with graffiti, flickering neon,
 * a burning barrel, a steam vent, strings of bare bulbs, a chain-link fence and a dumpster.
 * Everything is procedural (canvas textures and shaders); the only real lights are the barrel fire
 * and the pink neon, both flickering, so the bots and the floor catch them.
 */
export class Alley {
  readonly group = new THREE.Group();
  readonly fireLight = new THREE.PointLight('#ff7a2a', 7, 11, 1.6);
  readonly neonLight = new THREE.PointLight('#ff2f8a', 5, 12, 1.6);
  private signs: { mat: THREE.ShaderMaterial; seed: number; broken: boolean; on: number }[] = [];
  private timed: THREE.ShaderMaterial[] = [];
  private flash = 0;
  private time = 0;
  reduced = false;

  constructor() {
    this.ground();
    this.walls();
    this.neon('BOT PIT', '#ff2f8a', new THREE.Vector3(-3.0, 4.5, -10.82), 5.6, 0, false);
    this.neon('OPEN 24/7', '#2fe6ff', new THREE.Vector3(5.6, 3.6, -10.82), 3.4, 0, true);
    this.neon('NO REFUNDS', '#ffd21a', new THREE.Vector3(-11.83, 3.6, -4.6), 3.6, Math.PI / 2 - 0.12, true);
    this.barrel(new THREE.Vector3(-5.4, 0, -3.7));
    this.steam(new THREE.Vector3(5.9, 0, -2.6));
    this.bulbs();
    this.fence();
    this.dumpster(new THREE.Vector3(8.3, 0, -7.6), -0.45);
    this.neonLight.position.set(-3.0, 4.2, -9.6);
    this.group.add(this.fireLight, this.neonLight);
  }

  /** Lightning (0..1) brightens the wet ground and walls a touch on top of the real light. */
  setFlash(f: number) { this.flash = f; }

  /* ------------------------------------------------------------ ground */
  private ground() {
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uFlash: { value: 0 } }]),
      vertexShader: /* glsl */`varying vec3 vW;
        #include <fog_pars_vertex>
        void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vec4 mvPosition = viewMatrix * vec4(vW, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`uniform float uTime, uFlash; varying vec3 vW;
        #include <fog_pars_fragment>
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.03 + 11.0) * 0.3 + vn(p * 4.1 + 3.0) * 0.2; }
        void main() {
          vec2 p = vW.xz;
          vec3 col = vec3(0.016, 0.015, 0.014) * (0.7 + 0.6 * fbm(p * 2.5)) * (0.85 + 0.3 * h21(floor(p * 90.0)));
          float puddle = smoothstep(0.5, 0.58, fbm(p * 0.35 + 7.0));
          // Puddles pick up the neon and the fire as long smeared glints (a cheap stand-in for reflections).
          vec3 glint = vec3(0.0);
          glint += vec3(1.0, 0.18, 0.55) * smoothstep(2.6, 0.0, length((p - vec2(-3.0, -8.0)) * vec2(1.2, 0.22))) * 0.12;
          glint += vec3(0.2, 0.9, 1.0) * smoothstep(1.8, 0.0, length((p - vec2(5.6, -8.0)) * vec2(1.4, 0.22))) * 0.09;
          glint += vec3(1.0, 0.45, 0.12) * smoothstep(2.4, 0.0, length((p - vec2(-5.4, -3.0)) * vec2(1.0, 0.5))) * 0.2;
          float shimmer = 0.75 + 0.25 * sin(p.x * 9.0 + uTime * 1.7) * sin(p.y * 7.0 - uTime * 1.3);
          col = col * (1.0 - puddle * 0.5) + glint * mix(0.08, 1.0, puddle) * shimmer;
          // Painted lane line and a manhole cover, for scale and grime.
          float lane = smoothstep(0.06, 0.04, abs(p.x - 9.0)) * step(0.5, fract(p.y * 0.4)) * smoothstep(0.3, 0.6, fbm(p * 5.0));
          col += vec3(0.5, 0.42, 0.18) * lane * 0.25;
          vec2 mh = p - vec2(-7.5, 1.5); float mr = length(mh);
          float cover = smoothstep(0.62, 0.6, mr);
          col = mix(col, vec3(0.03, 0.028, 0.026) * (0.8 + 0.2 * step(0.5, fract((mh.x + mh.y) * 6.0))), cover * 0.8);
          col += vec3(0.6, 0.65, 0.75) * uFlash * 0.05 * (0.3 + puddle);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.timed.push(mat);
    const g = new THREE.Mesh(new THREE.CircleGeometry(34, 96), mat);
    g.rotation.x = -Math.PI / 2; g.position.y = -0.01;
    this.group.add(g);
  }

  /* ------------------------------------------------------------ walls */
  private walls() {
    const tex = brickTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mk = (w: number, h: number) => {
      const t = tex.clone(); t.repeat.set(w / 4, h / 2); t.needsUpdate = true;
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0.05, color: '#8a8580' });
      addGrime(m, 0.35);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    };
    // Walls stay low enough for the city skyline to loom over them.
    const back = mk(34, 6); back.position.set(0, 3, -11); this.group.add(back);
    const left = mk(18, 5.5); left.position.set(-12, 2.75, -3); left.rotation.y = Math.PI / 2 - 0.12; this.group.add(left);
    // Graffiti decals on top of the bricks.
    const tags: [string, THREE.Vector3, number, number][] = [
      ['tag1', new THREE.Vector3(2.4, 1.5, -10.95), 0, 3.6],
      ['tag2', new THREE.Vector3(-8.8, 1.7, -10.95), 0, 3.2],
      ['tag3', new THREE.Vector3(-11.9, 1.8, 0.4), Math.PI / 2 - 0.12, 3.2],
    ];
    for (const [kind, pos, ry, w] of tags) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshStandardMaterial({ map: graffitiTexture(kind), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.copy(pos); m.rotation.y = ry; this.group.add(m);
    }
  }

  /* ------------------------------------------------------------ neon */
  private neon(text: string, color: string, pos: THREE.Vector3, width: number, ry: number, broken: boolean) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const x = c.getContext('2d')!;
    x.font = '700 150px "Chakra Petch", "Arial Black", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.strokeStyle = '#fff'; x.lineWidth = 14;
    x.strokeText(text, 512, 132, 980);
    x.lineWidth = 3; x.strokeRect(14, 14, 996, 228);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { map: { value: tex }, uColor: { value: new THREE.Color(color) }, uOn: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D map; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
        void main() {
          float a = texture2D(map, vUv).a;
          // Soft halo from blurred samples, a hot white core where the tube is.
          float halo = 0.0;
          for (int i = 0; i < 8; i++) { float ang = float(i) * 0.785; halo += texture2D(map, vUv + vec2(cos(ang), sin(ang) * 4.0) * 0.012).a; }
          halo /= 8.0;
          vec3 col = uColor * halo * 0.28 + mix(uColor, vec3(1.0), 0.35) * a * 3.2;
          gl_FragColor = vec4(col * uOn + uColor * a * 0.06, 1.0);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
    m.position.copy(pos); m.rotation.y = ry; m.renderOrder = 4;
    // A dark backing plate with mounting brackets.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.04, width / 4 * 1.1), new THREE.MeshStandardMaterial({ color: '#050404', roughness: 0.8, metalness: 0.3 }));
    plate.position.copy(pos).add(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(-0.03)); plate.rotation.y = ry;
    this.group.add(plate, m);
    this.signs.push({ mat, seed: rand(pos.x * 3.1 + pos.y), broken, on: 1 });
  }

  /* ------------------------------------------------------------ burning barrel */
  private barrel(at: THREE.Vector3) {
    const rust = new THREE.MeshStandardMaterial({ color: '#5a3018', roughness: 0.85, metalness: 0.45 });
    addGrime(rust, 1);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 1.0, 22, 1, true), rust);
    body.position.copy(at).setY(0.5); body.castShadow = true;
    const rimGeo = new THREE.TorusGeometry(0.42, 0.025, 6, 22); rimGeo.rotateX(Math.PI / 2);
    for (const y of [0.18, 0.55, 0.98]) { const r = new THREE.Mesh(rimGeo, rust); r.position.copy(at).setY(y); this.group.add(r); }
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.4, 22), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a1a').multiplyScalar(1.6), toneMapped: false }));
    inside.rotation.x = -Math.PI / 2; inside.position.copy(at).setY(0.9);
    this.group.add(body, inside);

    const flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 uv = vUv; float y = uv.y;
          float n = vn(vec2(uv.x * 4.0, y * 3.0 - uTime * 3.2)) * 0.6 + vn(vec2(uv.x * 9.0, y * 6.0 - uTime * 5.0)) * 0.4;
          float shape = 1.0 - abs(uv.x - 0.5) * 2.0 * (1.0 + y * 1.4);
          float f = smoothstep(0.15, 0.75, shape * (1.0 - y) * 1.6 * n + (1.0 - y) * 0.15 * shape);
          vec3 col = mix(vec3(1.0, 0.15, 0.02), vec3(1.0, 0.75, 0.25), smoothstep(0.3, 0.9, f)) * f * 2.2;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.timed.push(flameMat);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.2), flameMat);
      f.position.copy(at).setY(1.45); f.rotation.y = i * Math.PI / 3; f.renderOrder = 6;
      this.group.add(f);
    }
    // Embers drifting up out of the barrel, animated in the vertex shader.
    const n = 48;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seeds.set([rand(i + 0.5), rand(i * 2.1 + 3), rand(i * 3.3 + 1), rand(i * 4.7 + 2)], i * 4);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const emberMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uOrigin: { value: at.clone().setY(1.0) } },
      vertexShader: /* glsl */`uniform float uTime; uniform vec3 uOrigin; attribute vec4 aSeed; varying float vA;
        void main() {
          float life = fract(uTime * (0.25 + aSeed.w * 0.25) + aSeed.x);
          vec3 p = uOrigin + vec3((aSeed.y - 0.5) * 0.5 + sin(uTime * 2.0 + aSeed.z * 9.0) * 0.15 * life, life * 3.2, (aSeed.z - 0.5) * 0.5 + cos(uTime * 1.7 + aSeed.y * 7.0) * 0.15 * life);
          vA = (1.0 - life) * smoothstep(0.0, 0.08, life);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + aSeed.w * 3.0) * 30.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 2.5 * vA * smoothstep(0.5, 0.0, d), 1.0); }`,
    });
    this.timed.push(emberMat);
    const embers = new THREE.Points(eg, emberMat); embers.frustumCulled = false; embers.renderOrder = 6;
    this.group.add(embers);
    this.fireLight.position.copy(at).setY(1.6);
  }

  /* ------------------------------------------------------------ steam vent */
  private steam(at: THREE.Vector3) {
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.ShaderMaterial({
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`varying vec2 vUv; void main() { float slot = step(0.5, fract(vUv.x * 9.0)); float edge = step(0.06, vUv.x) * step(vUv.x, 0.94) * step(0.1, vUv.y) * step(vUv.y, 0.9);
        gl_FragColor = vec4(mix(vec3(0.05, 0.045, 0.04), vec3(0.003), slot * edge), 1.0); }`,
    }));
    grate.rotation.x = -Math.PI / 2; grate.position.copy(at).setY(0.005);
    this.group.add(grate);
    const n = 22;
    const geo = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seeds.set([i / n, rand(i * 1.3 + 2), rand(i * 2.7 + 5), rand(i * 3.9 + 1)], i * 4);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uOrigin: { value: at.clone() } }]),
      vertexShader: /* glsl */`uniform float uTime; uniform vec3 uOrigin; attribute vec4 aSeed; varying vec2 vUv; varying float vA; varying float vS;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vS = aSeed.y;
          float life = fract(uTime * 0.16 + aSeed.x);
          vec3 c = uOrigin + vec3((aSeed.y - 0.5) * 0.4 + life * 0.9, 0.1 + life * 3.6, (aSeed.z - 0.5) * 0.3 - life * 0.3);
          float size = 0.5 + life * 2.2;
          vA = smoothstep(0.0, 0.15, life) * (1.0 - life);
          // Camera-facing quad built in view space.
          vec4 mvPosition = viewMatrix * vec4(c, 1.0);
          float a = aSeed.w * 6.28 + uTime * 0.2 * (aSeed.z - 0.5);
          mvPosition.xy += mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * size;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying float vA; varying float vS;
        #include <fog_pars_fragment>
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float n = vn(vUv * 4.0 + vS * 10.0 + uTime * 0.15) * 0.6 + vn(vUv * 9.0 - uTime * 0.2) * 0.4;
          float a = smoothstep(1.0, 0.2, d) * n * vA * 0.22;
          gl_FragColor = vec4(vec3(0.62, 0.58, 0.52), a);
          #include <fog_fragment>
        }`,
    });
    this.timed.push(mat);
    const puffs = new THREE.InstancedMesh(geo, mat, n);
    puffs.frustumCulled = false; puffs.renderOrder = 5;
    this.group.add(puffs);
  }

  /* ------------------------------------------------------------ bulbs */
  private bulbs() {
    const strings: Array<[THREE.Vector3, THREE.Vector3, number]> = [
      [new THREE.Vector3(-11.8, 6.6, -8.5), new THREE.Vector3(1.5, 7.2, -10.9), 9],
      [new THREE.Vector3(1.5, 7.2, -10.9), new THREE.Vector3(10.5, 6.2, -6.5), 7],
      [new THREE.Vector3(-11.8, 5.8, -1.5), new THREE.Vector3(10.2, 6.2, -3.5), 12],
    ];
    const total = strings.reduce((n, s) => n + s[2], 0);
    const geo = new THREE.SphereGeometry(0.075, 10, 8);
    const seeds = new Float32Array(total);
    const mat = new THREE.ShaderMaterial({
      fog: true, toneMapped: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: /* glsl */`attribute float aSeed; varying float vSeed; uniform float uTime;
        #include <fog_pars_vertex>
        void main() { vSeed = aSeed; vec3 p = position; p.x += sin(uTime * 1.1 + aSeed * 6.28) * 0.03;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`uniform float uTime; varying float vSeed;
        #include <fog_pars_fragment>
        void main() {
          // A couple of bulbs are dying: they stutter.
          float dying = step(0.86, vSeed);
          float stutter = step(0.35, fract(sin(floor(uTime * 9.0) * 12.9 + vSeed * 70.0) * 437.5));
          float on = mix(1.0, stutter * (0.5 + 0.5 * step(0.5, fract(uTime * 0.13 + vSeed))), dying);
          gl_FragColor = vec4(vec3(1.0, 0.66, 0.32) * (0.12 + 2.6 * on), 1.0);
          #include <fog_fragment>
        }`,
    });
    this.timed.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    const lineMat = new THREE.LineBasicMaterial({ color: '#0b0a0a', fog: true });
    const m = new THREE.Matrix4(); let k = 0;
    for (const [a, b, n] of strings) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.8; pts.push(p); }
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.8 + 0.16;
        m.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(k, m); seeds[k] = rand(k * 3.3 + 1); k++;
      }
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  /* ------------------------------------------------------------ fence */
  private fence() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: /* glsl */`varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec2 g = vec2(vUv.x * 13.0 * 9.0, vUv.y * 4.2 * 9.0);
          vec2 d = vec2(g.x + g.y, g.x - g.y) * 0.7071;
          // Antialiased wires: width in screen pixels via derivatives, fading to a faint haze when they
          // get denser than the pixels (no shimmering moire at a distance).
          vec2 fw = fwidth(d);
          vec2 dist = abs(fract(d) - 0.5);
          vec2 line = smoothstep(vec2(0.5) - fw * 1.5, vec2(0.5), dist);
          float dense = clamp(max(fw.x, fw.y) * 3.0, 0.0, 1.0);
          float wire = mix(max(line.x, line.y), 0.12, dense);
          float top = smoothstep(0.985, 0.995, vUv.y) + smoothstep(0.015, 0.005, vUv.y);
          float a = max(wire, top);
          if (a < 0.08) discard;
          gl_FragColor = vec4(vec3(0.07, 0.066, 0.06) * (0.6 + 0.4 * vUv.y), a);
          #include <fog_fragment>
        }`,
    });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.2), mat);
    f.position.set(10.6, 2.1, -3.8); f.rotation.y = -Math.PI / 2 + 0.1;
    this.group.add(f);
    const postMat = new THREE.MeshStandardMaterial({ color: '#2a2826', roughness: 0.6, metalness: 0.7 });
    for (let i = -3; i <= 3; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.3, 8), postMat);
      const along = i * 2.1;
      p.position.set(10.6 + Math.sin(0.1) * along, 2.15, -3.8 + Math.cos(0.1) * along);
      this.group.add(p);
    }
  }

  /* ------------------------------------------------------------ dumpster */
  private dumpster(at: THREE.Vector3, ry: number) {
    const paint = new THREE.MeshStandardMaterial({ color: '#1f3a24', roughness: 0.7, metalness: 0.5 });
    addGrime(paint, 1);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), paint); body.position.y = 0.75; body.castShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.4), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
    lid.position.set(0, 1.5, -0.15); lid.rotation.x = -0.35;
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#0a0a0a' });
    for (const x of [-0.95, 0.95]) for (const z of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), wheelMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.1, z); g.add(w); }
    g.add(body, lid);
    g.position.copy(at); g.rotation.y = ry;
    this.group.add(g);
  }

  update(t: number, dt: number) {
    this.time = t;
    for (const m of this.timed) { m.uniforms.uTime.value = t; if (m.uniforms.uFlash) m.uniforms.uFlash.value = this.flash; }
    // Neon: mostly steady with a faint hum; broken signs drop out in bursts. Reduced motion keeps them steady.
    for (const s of this.signs) {
      let on = 0.94 + 0.06 * Math.sin(t * 50 + s.seed * 10);
      if (s.broken && !this.reduced) {
        const slot = Math.floor(t * 2.2 + s.seed * 17);
        const bad = rand(slot * 1.7 + s.seed * 31) > 0.82;
        if (bad) on = rand(Math.floor(t * 18) + s.seed * 7) > 0.45 ? 1 : 0.05;
      }
      s.on += (on - s.on) * Math.min(1, dt * 40);
      s.mat.uniforms.uOn.value = s.on;
    }
    this.neonLight.intensity = 5 * this.signs[0].on;
    const fl = this.reduced ? 1 : 0.8 + 0.12 * Math.sin(t * 13) + 0.08 * Math.sin(t * 31 + 1.3) + 0.06 * (rand(Math.floor(t * 24)) - 0.5);
    this.fireLight.intensity = 7 * fl;
    void this.time;
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
  }
}

/* ------------------------------------------------------------ canvas textures */

function brickTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1a1614'; x.fillRect(0, 0, 1024, 512);
  const bw = 64, bh = 21; // the tile is 4 m x 2 m: bricks of roughly 25 x 8 cm
  for (let row = 0; row * bh < 512; row++) {
    for (let col = -1; col * bw < 1024 + bw; col++) {
      const ox = (row % 2) * (bw / 2);
      const r = rand(row * 31.7 + col * 7.3);
      const base = 34 + r * 26;
      x.fillStyle = `rgb(${base + 22}, ${base * 0.55}, ${base * 0.42})`;
      x.fillRect(col * bw + ox + 2, row * bh + 2, bw - 4, bh - 4);
      if (r > 0.82) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(col * bw + ox + 2, row * bh + 2, bw - 4, bh - 4); }
    }
  }
  // Water streaks and soot.
  for (let i = 0; i < 40; i++) {
    const sx = rand(i * 9.1) * 1024, w = 2 + rand(i * 3.3) * 10;
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(0.3 + rand(i) * 0.4, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(sx, 0, w, 512);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Spray-paint tags. Original doodles and words only: no real-world logos or crews. */
function graffitiTexture(kind: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 1024, 512);
  x.lineJoin = 'round'; x.lineCap = 'round';
  const spray = (fn: () => void, color: string, glow = 18) => { x.save(); x.shadowColor = color; x.shadowBlur = glow; fn(); x.restore(); };
  if (kind === 'tag1') {
    x.font = '900 200px "Chakra Petch", "Arial Black", sans-serif'; x.textAlign = 'center';
    x.translate(512, 300); x.rotate(-0.08);
    spray(() => { x.lineWidth = 26; x.strokeStyle = '#111'; x.strokeText('ZAP!', 0, 0); }, '#000', 0);
    spray(() => { x.fillStyle = '#b6ff3a'; x.fillText('ZAP!', 0, 0); }, 'rgba(182,255,58,0.5)');
    // Drips.
    x.fillStyle = '#b6ff3a';
    for (let i = 0; i < 9; i++) { const dx = -300 + i * 70 + rand(i) * 30; x.fillRect(dx, 10, 7, 40 + rand(i * 3) * 90); }
  } else if (kind === 'tag2') {
    // A grinning robot head doodle and an arrow.
    x.translate(380, 260); x.rotate(0.05);
    x.lineWidth = 16; x.strokeStyle = '#ff2f8a';
    spray(() => { x.strokeRect(-150, -130, 300, 240); x.beginPath(); x.arc(-60, -30, 34, 0, Math.PI * 2); x.arc(60, -30, 34, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.moveTo(-80, 60); x.quadraticCurveTo(0, 110, 80, 60); x.stroke(); x.beginPath(); x.moveTo(0, -130); x.lineTo(0, -190); x.stroke(); x.beginPath(); x.arc(0, -205, 14, 0, Math.PI * 2); x.stroke(); }, 'rgba(255,47,138,0.5)');
    x.strokeStyle = '#ffd21a';
    spray(() => { x.beginPath(); x.moveTo(230, 40); x.lineTo(480, 40); x.moveTo(430, -10); x.lineTo(480, 40); x.lineTo(430, 90); x.stroke(); }, 'rgba(255,210,26,0.5)');
  } else {
    x.font = 'italic 900 150px "Chakra Petch", "Arial Black", sans-serif'; x.textAlign = 'center';
    x.translate(512, 290); x.rotate(-0.12);
    spray(() => { x.lineWidth = 12; x.strokeStyle = '#2fe6ff'; x.strokeText('KO OR GO', 0, 0); }, 'rgba(47,230,255,0.5)');
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
