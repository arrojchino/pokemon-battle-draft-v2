import * as THREE from 'three';
import { ARENA } from './BattleCamera.js';

/**
 * Lasting field conditions on the battle stage. Entry hazards (Stealth Rock, Spikes, Toxic Spikes, Sticky Web)
 * and screens (Reflect, Light Screen, Aurora Veil, Safeguard, Mist, Tailwind) stay visible on their side from the
 * moment they land until the battle removes them (Rapid Spin, Defog, a screen running out, the battle ending),
 * instead of vanishing with the throw animation. Spikes and Toxic Spikes show one cluster per layer.
 *
 * Cost: one instanced mesh per hazard kind for both sides (stones 12, spikes 30, toxic 20), one line mesh per web,
 * one plane per screen kind per side, one ground ring per side for the softer conditions. All built up front so the
 * arena prewarm compiles them; nothing is allocated per frame.
 */
export type SideLayers = Record<string, number>;

const KEY: Record<string, string> = {
  'Stealth Rock': 'rock', Spikes: 'spikes', 'Toxic Spikes': 'toxic', 'Sticky Web': 'web',
  Reflect: 'reflect', 'Light Screen': 'light', 'Aurora Veil': 'veil', Safeguard: 'safeguard', Mist: 'mist', Tailwind: 'tailwind',
};
/** The stage's name for a simulator side condition, or null if it has no lasting visual. */
export const persistKey = (condition: string) => KEY[condition] ?? null;

const SCREEN_HEX = { reflect: '#ff9f6b', light: '#ffe46b', veil: '#8ff0ff' } as const;
const RING_HEX = { safeguard: '#9dff9d', mist: '#cfefff', tailwind: '#bfe8ff' } as const;
const ROCKS = 6, SPIKES = 5, TOXIC = 5;

/** Fixed pseudo-random numbers per slot, so props never jump between updates or reconnects. */
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

type Fade = { a: number; to: number };

export class FieldPersist {
  readonly group = new THREE.Group();
  private stones: THREE.InstancedMesh;
  private spikes: THREE.InstancedMesh;
  private toxic: THREE.InstancedMesh;
  private webs: [THREE.LineSegments, THREE.LineSegments];
  private screens: Record<keyof typeof SCREEN_HEX, [THREE.Mesh, THREE.Mesh]>;
  private rings: [THREE.Mesh, THREE.Mesh];
  /** Current layer counts per stage side, and a fade per prop (0 hidden .. 1 shown). */
  private layers: [SideLayers, SideLayers] = [{}, {}];
  private fades = new Map<string, Fade>();
  private delayUntil = new Map<string, number>();
  private time = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private sc = new THREE.Vector3();

  constructor(private heights: () => [number, number], private reduced: () => boolean) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#8f7a5c', roughness: 0.85, metalness: 0.05, emissive: '#3a2c18', emissiveIntensity: 0.35, flatShading: true });
    this.stones = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0).scale(0.75, 1.25, 0.75), stoneMat, ROCKS * 2);
    const spikeMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.35, metalness: 0.75, emissive: '#1d2229', emissiveIntensity: 0.4 });
    this.spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 1, 5).translate(0, 0.5, 0), spikeMat, SPIKES * 3 * 2);
    const toxicMat = new THREE.MeshStandardMaterial({ color: '#8d3fb8', roughness: 0.4, metalness: 0.2, emissive: '#b55bd6', emissiveIntensity: 0.7 });
    this.toxic = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 1, 4).translate(0, 0.5, 0), toxicMat, TOXIC * 2 * 2);
    for (const im of [this.stones, this.spikes, this.toxic]) { im.count = im.instanceMatrix.count; im.frustumCulled = false; this.hideAll(im); this.group.add(im); }

    // Sticky Web: spokes and rings on the ground around the side.
    const pts: number[] = [];
    const R = 1.05, spokes = 10, circles = 4;
    for (let i = 0; i < spokes; i++) { const a = (i / spokes) * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * R, 0, Math.sin(a) * R); }
    for (let c = 1; c <= circles; c++) {
      const r = (c / circles) * R;
      for (let i = 0; i < spokes; i++) {
        const a0 = (i / spokes) * Math.PI * 2, a1 = ((i + 1) / spokes) * Math.PI * 2, sag = 0.9;
        pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r * sag + Math.cos(a0) * r * (1 - sag), 0, Math.sin(a1) * r * sag + Math.sin(a0) * r * (1 - sag));
      }
    }
    const webGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const web = () => { const l = new THREE.LineSegments(webGeo, new THREE.LineBasicMaterial({ color: '#f4f1ff', transparent: true, opacity: 0, depthWrite: false })); l.visible = false; this.group.add(l); return l; };
    this.webs = [web(), web()];

    // Screens: a standing hex panel in front of the side, softer than the flash when the move is used.
    const panel = new THREE.PlaneGeometry(1.8, 1.5);
    const screenMat = (hex: string) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(hex) }, uA: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uA, uTime; varying vec2 vUv;
        float hex(vec2 p) { p *= vec2(1.0, 1.1547); p.x += mod(floor(p.y), 2.0) * 0.5; vec2 f = abs(fract(p) - 0.5); return max(f.x * 1.5 + f.y, f.y * 2.0); }
        void main() {
          vec2 c = vUv - 0.5; float edge = smoothstep(0.5, 0.38, max(abs(c.x), abs(c.y) * 1.05));
          float h = smoothstep(0.9, 1.0, hex(vUv * vec2(14.0, 7.0)));
          float sweep = smoothstep(0.08, 0.0, abs(fract(vUv.y - uTime * 0.25) - 0.5) - 0.42);
          gl_FragColor = vec4(uColor * edge * (0.14 + h * 0.5 + sweep * 0.25) * uA, 1.0);
        }`,
    });
    const scr = (hex: string): [THREE.Mesh, THREE.Mesh] => {
      const pair = ([0, 1] as const).map(s => {
        const m = ARENA.mon[s], o = ARENA.mon[1 - s];
        const mesh = new THREE.Mesh(panel, screenMat(hex)); mesh.renderOrder = 7; mesh.visible = false;
        mesh.position.lerpVectors(m, o, 0.3).setY(ARENA.cardY); mesh.lookAt(o.x, ARENA.cardY, o.z);
        this.group.add(mesh); return mesh;
      });
      return [pair[0], pair[1]];
    };
    this.screens = { reflect: scr(SCREEN_HEX.reflect), light: scr(SCREEN_HEX.light), veil: scr(SCREEN_HEX.veil) };

    // Safeguard, Mist, Tailwind: a soft coloured ring on the ground under the side.
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 48).rotateX(-Math.PI / 2);
    const rings = ([0, 1] as const).map(s => {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      r.position.set(ARENA.mon[s].x, ARENA.floorY + 0.02, ARENA.mon[s].z); r.visible = false; this.group.add(r); return r;
    });
    this.rings = [rings[0], rings[1]];
  }

  private hideAll(im: THREE.InstancedMesh) { this.m.makeScale(0, 0, 0); for (let i = 0; i < im.instanceMatrix.count; i++) im.setMatrixAt(i, this.m); im.instanceMatrix.needsUpdate = true; }
  private fade(id: string) { let f = this.fades.get(id); if (!f) { f = { a: 0, to: 0 }; this.fades.set(id, f); } return f; }

  /** What one side has now. `instant` (reconnect, replay) shows props at once; otherwise they appear after `landIn` s. */
  set(side: 0 | 1, layers: SideLayers, instant: boolean) {
    const next: SideLayers = {};
    for (const [c, n] of Object.entries(layers)) { const k = persistKey(c); if (k) next[k] = Math.max(next[k] ?? 0, n); }
    this.layers[side] = next;
    const all = ['rock', 'spikes', 'toxic', 'web', 'reflect', 'light', 'veil', 'safeguard', 'mist', 'tailwind'];
    for (const k of all) {
      const layerCount = k === 'spikes' ? 3 : k === 'toxic' ? 2 : 1;
      for (let l = 0; l < layerCount; l++) {
        const id = `${side}:${k}:${l}`, f = this.fade(id), on = (next[k] ?? 0) > l;
        if (on && f.to === 0) {
          f.to = 1;
          // New props wait for the throw to land (Stealth Rock crossfades with its hovering throw).
          const landIn = instant ? 0 : k === 'rock' ? 1.9 : k === 'spikes' || k === 'toxic' ? 0.75 : k === 'web' ? 0.6 : 0.5;
          this.delayUntil.set(id, this.time + landIn);
          if (instant) f.a = 1;
        } else if (!on && f.to === 1) { f.to = 0; if (instant) f.a = 0; }
      }
    }
  }
  /** True while a side shows anything (tests and QA). */
  shown(side: 0 | 1, key: string) { for (const [id, f] of this.fades) if (id.startsWith(`${side}:${key}:`) && f.a > 0) return true; return false; }
  layersOf(side: 0 | 1) { return { ...this.layers[side] }; }

  clear() { for (const f of this.fades.values()) { f.a = 0; f.to = 0; } this.layers = [{}, {}]; this.delayUntil.clear(); this.update(0); }

  update(dt: number) {
    this.time += dt;
    const reduced = this.reduced(), speed = reduced ? 6 : 2.5;
    for (const [id, f] of this.fades) {
      if (f.to === 1 && (this.delayUntil.get(id) ?? 0) > this.time) continue;
      f.a = f.to > f.a ? Math.min(1, f.a + dt * speed) : Math.max(0, f.a - dt * speed);
    }
    const [h0, h1] = this.heights();
    const t = this.time;
    for (const side of [0, 1] as const) {
      const foot = ARENA.mon[side], H = side === 0 ? h0 : h1, k = THREE.MathUtils.clamp(0.3 + 0.7 * H / 1.2, 0.6, 1.1);
      // Stealth Rock: pointed stones hovering in a slow ring at the side's chest height.
      const fr = this.fade(`${side}:rock:0`).a;
      for (let i = 0; i < ROCKS; i++) {
        const a = (i / ROCKS) * Math.PI * 2 + rnd(i + side * 50) * 0.4 + (reduced ? 0 : t * 0.25), rad = (0.72 + rnd(i + 7) * 0.22) * Math.max(0.75, k);
        const y = ARENA.floorY + (0.35 + rnd(i + 13) * 0.45) * Math.max(0.55, H) + (reduced ? 0 : Math.sin(t * 1.3 + i) * 0.04);
        const s = (0.13 + rnd(i + 21) * 0.05) * Math.max(0.8, k) * fr;
        this.e.set(rnd(i + 3) * 0.6, a * 2 + (reduced ? 0 : t * 0.6), rnd(i + 5) * 0.4); this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(foot.x + Math.cos(a) * rad, y, foot.z + Math.sin(a) * rad), this.q, this.sc.setScalar(s));
        this.stones.setMatrixAt(side * ROCKS + i, this.m);
      }
      // Spikes: one ring of caltrops on the ground per layer, a little further out each layer.
      for (let l = 0; l < 3; l++) {
        const fa = this.fade(`${side}:spikes:${l}`).a;
        for (let i = 0; i < SPIKES; i++) {
          const a = ((i + l * 0.5) / SPIKES) * Math.PI * 2 + rnd(i * 3 + l * 17 + side * 90) * 0.5, rad = (0.8 + l * 0.18 + rnd(i + l * 11) * 0.12) * Math.max(0.75, k);
          const pop = fa < 1 ? 1 - Math.pow(1 - fa, 3) : 1;
          this.e.set((rnd(i + l * 5) - 0.5) * 0.5, rnd(i + 31) * 6, (rnd(i + l * 9) - 0.5) * 0.5); this.q.setFromEuler(this.e);
          this.m.compose(this.v.set(foot.x + Math.cos(a) * rad, ARENA.floorY, foot.z + Math.sin(a) * rad), this.q, this.sc.set(0.11, 0.2 * pop, 0.11).multiplyScalar(fa > 0 ? 1 : 0));
          this.spikes.setMatrixAt((side * 3 + l) * SPIKES + i, this.m);
        }
      }
      // Toxic Spikes: glowing purple barbs, one ring per layer, with a slow throb.
      for (let l = 0; l < 2; l++) {
        const fa = this.fade(`${side}:toxic:${l}`).a, throb = reduced ? 1 : 1 + Math.sin(t * 2.2 + l) * 0.08;
        for (let i = 0; i < TOXIC; i++) {
          const a = ((i + 0.25 + l * 0.5) / TOXIC) * Math.PI * 2 + rnd(i * 7 + l * 23 + side * 70) * 0.5, rad = (0.95 + l * 0.2 + rnd(i + l * 13) * 0.1) * Math.max(0.75, k);
          this.e.set((rnd(i + l * 3) - 0.5) * 0.6, rnd(i + 41) * 6, (rnd(i + l * 7) - 0.5) * 0.6); this.q.setFromEuler(this.e);
          this.m.compose(this.v.set(foot.x + Math.cos(a) * rad, ARENA.floorY, foot.z + Math.sin(a) * rad), this.q, this.sc.set(0.1, 0.18 * throb, 0.1).multiplyScalar(fa));
          this.toxic.setMatrixAt((side * 2 + l) * TOXIC + i, this.m);
        }
      }
      // Sticky Web: spread on the ground, sized to the Pokemon standing on it.
      const fw = this.fade(`${side}:web:0`).a, w = this.webs[side];
      w.visible = fw > 0.001; (w.material as THREE.LineBasicMaterial).opacity = 0.75 * fw;
      w.position.set(foot.x, ARENA.floorY + 0.015, foot.z); w.scale.setScalar(Math.max(0.75, k) * (0.6 + 0.4 * fw)); w.rotation.y = side * 0.7;
      // Screens stand in front of the side at the Pokemon's size, with a slow shimmer.
      for (const key of ['reflect', 'light', 'veil'] as const) {
        const fs = this.fade(`${side}:${key}:0`).a, mesh = this.screens[key][side], mat = mesh.material as THREE.ShaderMaterial;
        mesh.visible = fs > 0.001;
        const ks = Math.max(0.42, H / 1.2);
        mesh.scale.setScalar(ks * (key === 'light' ? 1.06 : key === 'veil' ? 1.12 : 1));
        mesh.position.y = ARENA.floorY + H * 0.55;
        mat.uniforms.uA.value = fs * (reduced ? 0.8 : 0.75 + Math.sin(t * 1.7 + (key === 'light' ? 1 : 0)) * 0.12);
        mat.uniforms.uTime.value = reduced ? 0 : t;
      }
      // Safeguard / Mist / Tailwind: the strongest active one tints a ring on the ground.
      const ring = this.rings[side], rm = ring.material as THREE.MeshBasicMaterial;
      let best: keyof typeof RING_HEX | null = null, ba = 0;
      for (const key of ['safeguard', 'mist', 'tailwind'] as const) { const fa = this.fade(`${side}:${key}:0`).a; if (fa > ba) { ba = fa; best = key; } }
      ring.visible = ba > 0.001;
      if (best) rm.color.set(RING_HEX[best]);
      rm.opacity = ba * (reduced ? 0.45 : 0.4 + Math.sin(t * 2) * 0.1);
      ring.scale.setScalar(Math.max(0.75, k) * (best === 'tailwind' && !reduced ? 1 + ((t * 0.6) % 1) * 0.15 : 1));
    }
    this.stones.instanceMatrix.needsUpdate = true; this.spikes.instanceMatrix.needsUpdate = true; this.toxic.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of [this.stones, this.spikes, this.toxic]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
    this.webs[0].geometry.dispose(); for (const w of this.webs) (w.material as THREE.Material).dispose();
    const panels = Object.values(this.screens).flat(); panels[0].geometry.dispose(); for (const p of panels) (p.material as THREE.Material).dispose();
    this.rings[0].geometry.dispose(); for (const r of this.rings) (r.material as THREE.Material).dispose();
  }
}
