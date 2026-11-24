import * as THREE from 'three';
import type { QualitySettings, QualityTier } from '../quality.js';
import { TIERS } from '../quality.js';
import { createSky } from '../world/Sky.js';
import { StageFloor } from '../world/Floor.js';
import { Stadium } from '../world/Stadium.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { Coin } from '../world/Coin.js';
import { FIELD } from '../world/dims.js';
import { BattleStage } from '../battle/BattleStage.js';
import type { Environment } from './types.js';
import { disposeTree } from './dispose.js';

export const FOG_COLOR = new THREE.Color('#060a18');
export const FOG_DENSITY = 0.0105;
/** The floodlight key: high in front of the field (in the room plaza it follows this player's partner). */
export const KEY_POS = new THREE.Vector3(2.4, 7.5, 5.5);

/**
 * The battle stadium as its own environment: its scene (night sky, bowl of stands, floodlights, the field
 * floor, atmosphere, the coin, the battle stage with its effects), its lights and its camera. Rooms, the
 * draft, battles, victories and spectating happen here; nothing in it is shared with the town or the intro.
 */
export class StadiumScene implements Environment {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 900);
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly stadium: Stadium;
  readonly coin: Coin;
  readonly battle: BattleStage;
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly rimA: THREE.DirectionalLight;
  readonly rimB: THREE.DirectionalLight;
  floor!: StageFloor;
  atmosphere!: Atmosphere;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(opts: { reduced: () => boolean; onCoinLand: () => void }) {
    const s = this.scene;
    s.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.sky = createSky();
    s.add(this.sky);
    this.stadium = new Stadium({ fogColor: FOG_COLOR, fogDensity: FOG_DENSITY });
    s.add(this.stadium.group);
    this.coin = new Coin(opts.reduced);
    this.coin.group.position.set(0, 1.08, 0.75);
    this.coin.onLand = opts.onCoinLand;
    s.add(this.coin.group);
    this.battle = new BattleStage(this.camera, opts.reduced);
    s.add(this.battle.group);
    // Lighting: the floodlights as one cool key with shadows from high in front, a sky fill, and two rims
    // (the partner's accent and a stadium blue) that cut the Pokemon out of the night.
    this.hemi = new THREE.HemisphereLight('#a9bcff', '#0b0e1a', 0.75);
    s.add(this.hemi);
    this.key = new THREE.DirectionalLight('#f1f5ff', 2.4);
    this.key.position.copy(KEY_POS); this.key.target.position.set(0, 1, 0);
    const sc = this.key.shadow.camera;
    sc.left = -3.2 * FIELD; sc.right = 3.2 * FIELD; sc.top = 3.2 * FIELD; sc.bottom = -1.5 * FIELD;
    sc.near = 2; sc.far = 16; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.025;
    s.add(this.key, this.key.target);
    this.rimA = new THREE.DirectionalLight('#3ee6ff', 1.8); this.rimA.position.set(-4, 3, -4);
    this.rimB = new THREE.DirectionalLight('#6f8cff', 1.4); this.rimB.position.set(4, 2.5, -3.5);
    s.add(this.rimA, this.rimB);
  }

  /** Floor (planar reflections on high only), floodlight shafts and the key's shadow map for a quality tier. */
  buildTierDependent(q: QualitySettings, accent: THREE.Color, reduced: boolean) {
    if (this.floor) { this.floor.dispose(); this.scene.remove(this.floor.group); }
    this.floor = new StageFloor(q.reflections, 1024);
    this.floor.uniforms.uAccent.value.copy(accent);
    this.scene.add(this.floor.group);
    if (this.atmosphere) { this.scene.remove(this.atmosphere.group); disposeTree(this.atmosphere.group); }
    this.atmosphere = new Atmosphere(q.shafts, this.stadium.lamps);
    this.atmosphere.reduced = reduced;
    this.atmosphere.setAccent(accent);
    this.scene.add(this.atmosphere.group);
    this.key.castShadow = q.shadows;
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
    this.key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  }
  setQuality(tier: QualityTier) { this.buildTierDependent(TIERS[tier], this.floor?.uniforms.uAccent.value ?? new THREE.Color('#3ee6ff'), this.atmosphere?.reduced ?? false); }

  /**
   * Reflections for the Pokemon, the coin and the platform rim: the night sky plus four floodlight panels high
   * around the field and a stadium-blue glow behind it, prefiltered once (again after a lost context).
   */
  buildEnvironmentMap(renderer: THREE.WebGLRenderer) {
    this.envRT?.dispose();
    const envScene = new THREE.Scene();
    envScene.add(createSky());
    const panel = (c: string, x: number, y: number, z: number, s: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.45), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(5), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); envScene.add(m); };
    for (const l of this.stadium.lamps) panel('#eef3ff', l.x * 0.45, l.y * 0.5, l.z * 0.45, 4);
    panel('#3a5cff', 0, 2, -9, 6);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose(); disposeTree(envScene);
  }

  /** The partner's colour on the field accents, the floodlight haze, the boards and one rim. */
  setAccent(c: THREE.Color) {
    this.floor.uniforms.uAccent.value.copy(c);
    this.atmosphere.setAccent(c);
    this.stadium.setAccent(c);
    this.rimA.color.copy(c);
  }

  update(t: number, dt: number) {
    this.floor.update(t, dt);
    this.stadium.update(t);
    this.atmosphere.update(t, dt);
    this.coin.update(dt);
    this.sky.material.uniforms.uTime.value = t;
  }

  dispose() {
    this.floor.dispose(); this.stadium.dispose(); this.battle.dispose();
    disposeTree(this.scene);
    this.envRT?.dispose(); this.envRT = null;
  }
}
