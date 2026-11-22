import * as THREE from 'three';
import { PLATFORM_R, STADIUM, WALL_R } from './dims.js';

/** Floodlight towers stand behind the stands; angles are atan2(z, x), so negative ones sit across the field. */
const TOWERS = [-38, -142, 38, 142].map(d => THREE.MathUtils.degToRad(d));
const TOWER_R = 21.5 * STADIUM;
const TOWER_H = 15.5 * STADIUM;
/** Rows of seats: more of them, not bigger ones, so the crowd stays people-sized around the larger field. */
const ROWS = Math.round(18 * STADIUM);

export type StadiumOptions = { fogColor: THREE.Color; fogDensity: number };

const FOG = /* glsl */`
  uniform vec3 uFog; uniform float uFogD;
  vec3 applyFog(vec3 col, vec3 w) { float d = length(w - cameraPosition); return mix(col, uFog, 1.0 - exp(-uFogD * uFogD * d * d)); }`;

/**
 * The night stadium around the field: a ground ring, LED boards on the barrier wall, a bowl of stands
 * with a crowd (and the odd phone flash), and four floodlight towers. Everything is procedural: a few
 * draw calls, no textures to download.
 */
export class Stadium {
  readonly group = new THREE.Group();
  /** Floodlight heads in world space (for light shafts). */
  readonly lamps: THREE.Vector3[] = [];
  private stands: THREE.ShaderMaterial;
  private boards: THREE.ShaderMaterial;
  private lampMat: THREE.ShaderMaterial;
  private boardTex: THREE.CanvasTexture;
  reduced = false;

  constructor(o: StadiumOptions) {
    const fogU = { uFog: { value: o.fogColor }, uFogD: { value: o.fogDensity } };

    const ground = new THREE.Mesh(new THREE.RingGeometry(PLATFORM_R + 0.1, WALL_R + 0.05, 160, 1), new THREE.MeshStandardMaterial({ color: '#060912', roughness: 0.9, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.002; ground.receiveShadow = true;
    this.group.add(ground);

    // LED boards along the barrier wall: a scrolling ribbon of the game's name between accent chevrons.
    this.boardTex = boardTexture();
    this.boards = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uAccent: { value: new THREE.Color('#40e0ff') }, uMap: { value: this.boardTex }, ...fogU },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uAccent; uniform sampler2D uMap; varying vec2 vUv; varying vec3 vW; ${FOG}
        void main() {
          float y = vUv.y;
          vec2 uv = vec2(fract(-vUv.x * 8.0 + uTime * 0.012), clamp((y - 0.18) / 0.64, 0.0, 1.0));
          float text = texture2D(uMap, uv).r * step(0.18, y) * step(y, 0.82);
          float pix = 0.75 + 0.25 * step(0.35, fract(vUv.x * 1800.0)) * step(0.35, fract(y * 36.0));
          vec3 col = vec3(0.012, 0.016, 0.03);
          col += uAccent * text * 0.55 * pix;
          col += uAccent * 0.35 * (smoothstep(0.06, 0.0, abs(y - 0.08)) + smoothstep(0.06, 0.0, abs(y - 0.92)));
          gl_FragColor = vec4(applyFog(col, vW), 1.0);
        }`,
    });
    const boards = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R - 0.02, WALL_R - 0.02, 0.85, 192, 1, true), this.boards);
    boards.position.y = 0.55;
    this.group.add(boards);

    // The bowl: a stepped profile revolved around the field.
    const pts: THREE.Vector2[] = [new THREE.Vector2(WALL_R, 0), new THREE.Vector2(WALL_R, 1.05)];
    let r = WALL_R + 0.5, y = 1.05;
    pts.push(new THREE.Vector2(r, y));
    for (let i = 0; i < ROWS; i++) { y += 0.42; pts.push(new THREE.Vector2(r, y)); r += 0.62; pts.push(new THREE.Vector2(r, y)); }
    const top = y;
    pts.push(new THREE.Vector2(r, top + 2.4), new THREE.Vector2(r + 0.8, top + 2.4));
    this.stands = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFlashes: { value: 1 }, uAccent: { value: new THREE.Color('#40e0ff') }, uTop: { value: top }, ...fogU },
      vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime, uFlashes, uTop; uniform vec3 uAccent; varying vec3 vW; varying vec3 vN; ${FOG}
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float ang = atan(vW.z, vW.x);
          float rr = length(vW.xz);
          float tread = step(0.6, abs(vN.y));
          vec3 col = vec3(0.045, 0.055, 0.085) * (0.7 + 0.5 * tread);
          // Aisles every 15 degrees: stairs, no crowd.
          float sector = fract(ang / 0.2618);
          float aisle = step(abs(sector - 0.5), 0.035);
          float row = floor((vW.y - 1.05) / 0.42);
          float inRows = step(1.05, vW.y) * step(vW.y, uTop);
          // Spectators on the risers: a head and shoulders per seat, muted shirt colours, lit from the field.
          vec2 cell = vec2(floor(ang * rr / 0.34), row);
          vec2 f = vec2(fract(ang * rr / 0.34), fract((vW.y - 1.05) / 0.42));
          float seated = step(0.28, h(cell)) * (1.0 - tread) * inRows * (1.0 - aisle);
          float head = smoothstep(0.2, 0.16, length((f - vec2(0.5, 0.78)) * vec2(1.0, 1.3)));
          float body = smoothstep(0.34, 0.3, abs(f.x - 0.5)) * smoothstep(0.62, 0.56, f.y);
          float shape = max(head, body) * seated;
          vec3 shirt = 0.1 + 0.22 * vec3(h(cell + 1.3), h(cell + 7.1), h(cell + 3.7));
          vec3 skin = vec3(0.24, 0.17, 0.13) * (0.7 + 0.6 * h(cell + 9.2));
          col = mix(col, mix(shirt, skin, head), shape);
          // Floodlit from above the field: lower rows catch more light.
          col *= 0.7 + 0.6 * smoothstep(uTop, 1.0, vW.y);
          // The odd phone camera flash in the crowd.
          float fl = step(0.99965, h(cell + floor(uTime * 3.0) * 1.7)) * shape * uFlashes;
          col += vec3(2.4, 2.5, 2.8) * fl;
          col = mix(col, vec3(0.05, 0.055, 0.07), aisle * (1.0 - tread) * inRows * 0.6);
          // An accent light ribbon along the top of the bowl.
          col += uAccent * 0.6 * smoothstep(0.05, 0.0, abs(vW.y - (uTop + 1.6))) * step(rr, ${(r + 1.5).toFixed(1)});
          gl_FragColor = vec4(applyFog(col, vW), 1.0);
        }`,
    });
    this.group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 192), this.stands));

    // Floodlight towers: masts and lamp heads aimed at the field (instanced: two draw calls for all four).
    const mastGeo = new THREE.BoxGeometry(0.45 * STADIUM, TOWER_H, 0.45 * STADIUM); mastGeo.translate(0, TOWER_H / 2, 0);
    const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: '#0c1120', roughness: 0.6, metalness: 0.7 }), TOWERS.length);
    this.lampMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uOn: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOn; varying vec2 vUv;
        void main() {
          vec2 g = vUv * vec2(7.0, 3.0); vec2 l = fract(g) - 0.5;
          float core = smoothstep(0.33, 0.1, length(l));
          vec3 col = vec3(0.04, 0.05, 0.08) + vec3(0.92, 0.96, 1.0) * core * 4.2 * uOn;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.4 * STADIUM, 2.0 * STADIUM), this.lampMat, TOWERS.length);
    const dummy = new THREE.Object3D();
    TOWERS.forEach((a, i) => {
      const x = Math.cos(a) * TOWER_R, z = Math.sin(a) * TOWER_R;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      masts.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x * 0.98, TOWER_H + 0.6, z * 0.98); dummy.lookAt(0, 2, 0); dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
      this.lamps.push(dummy.position.clone());
    });
    this.group.add(masts, lamps);
  }

  setAccent(c: THREE.Color) { this.stands.uniforms.uAccent.value.copy(c); this.boards.uniforms.uAccent.value.copy(c); }
  update(t: number) {
    this.stands.uniforms.uTime.value = t;
    this.stands.uniforms.uFlashes.value = this.reduced ? 0 : 1;
    this.boards.uniforms.uTime.value = this.reduced ? 0 : t;
  }
  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    this.boardTex.dispose();
  }
}

/** One tile of the LED ribbon: the game's name between two diamonds, white on black (tinted in the shader). */
function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff'; x.font = '800 40px "Outfit", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('POKÉMON BATTLE DRAFT', 512, 34);
  for (const cx of [90, 934]) { x.beginPath(); x.moveTo(cx, 14); x.lineTo(cx + 18, 32); x.lineTo(cx, 50); x.lineTo(cx - 18, 32); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
