import * as THREE from 'three';
import type { QualityTier } from '../../quality.js';
import type { EnvShot, EnvSpot, IntroEnvironment, Vec3 } from '../types.js';
import { BEATS, CameraTrack, DURATION } from './camera.js';
import { buildFx } from './fx.js';
import { DAIS_LANTERNS, FLOOR_Y, heightAt, MOON_AZ, moonDir, pathX } from './layout.js';
import { buildProps } from './props.js';
import { clamp, createShared, disposeTree, mulberry32, type Shared } from './shared.js';
import { createIntroSky } from './sky.js';
import { buildTerrain } from './terrain.js';
import { buildTown, GLOW_RECT, glowPoints, glowTexture, townLayout } from './town.js';

/**
 * The opening cinematic's world: a moonlit shrine path of vermilion gates and stone lanterns climbing to a crest,
 * the partner's engraved stone dais at the top under an old blossom tree, and below the cliff a valley town of warm
 * lights, a lake holding the moon and a glowing stadium. `shotAt` flies the camera through it in 12.5 s:
 * a low dolly through the gates, a crane over the crest revealing the valley, the partner's reveal burst on the
 * dais, a sweeping push-in to a hero shot against the moon and the town, then a rise to a calm wide closing frame.
 *
 * Budget (high): ~45 draw calls plus shadow and post passes, ~110k triangles; 4 real lights (moon with shadows,
 * hemisphere fill, one warm shrine lantern, the burst flash). Lanterns light the ground through a shared shader
 * patch instead of real lights.
 */

export type IntroDebug = {
  heightAt(x: number, z: number): number;
  shared: Shared;
};

class Intro implements IntroEnvironment {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600);
  readonly duration = DURATION;
  readonly beats = BEATS;
  readonly partnerSpot: EnvSpot = { x: 0, z: 0, face: 0.32 };
  readonly envPanels: ReadonlyArray<{ color: string; pos: Vec3; size: number }>;
  readonly debug: IntroDebug;

  private readonly S: Shared;
  private readonly track = new CameraTrack(1.0);
  private readonly moon: THREE.DirectionalLight;
  private readonly flash: THREE.PointLight;
  private readonly shrine: THREE.PointLight;
  private readonly daisGlow: THREE.MeshStandardMaterial;
  private readonly fxSync: () => void;
  private readonly quality: Array<(t: QualityTier) => void> = [];
  private readonly extraDispose: Array<{ dispose(): void }> = [];
  private tier: QualityTier;
  private now = 0;
  private burstAt = -1;

  constructor(tier: QualityTier) {
    this.tier = tier;
    const S = (this.S = createShared());
    const scene = this.scene;
    scene.name = 'intro';
    scene.fog = new THREE.FogExp2(S.uFogColor.value.getHex(), S.uFogDensity.value);
    (scene.fog as THREE.FogExp2).color = S.uFogColor.value;
    scene.background = S.uFogColor.value.clone();

    // Sky follows the camera; it also refreshes the pixel scale for sized point sprites.
    const sky = createIntroSky(moonDir(), S.uTime);
    const buf = new THREE.Vector2();
    sky.onBeforeRender = (renderer, _s, cam) => {
      sky.position.copy(cam.position); sky.updateMatrixWorld();
      const rt = renderer.getRenderTarget();
      const hgt = rt ? rt.height : renderer.getDrawingBufferSize(buf).y;
      const fov = (cam as THREE.PerspectiveCamera).fov ?? 36;
      S.uPx.value = hgt / (2 * Math.tan((fov * Math.PI) / 360));
    };
    scene.add(sky);

    // Valley first (the floor samples its glow map), then the ground, props, particles.
    const layout = townLayout(tier);
    const glowTex = glowTexture(layout);
    this.extraDispose.push(glowTex);
    const terrain = buildTerrain(S, tier, glowTex, GLOW_RECT);
    const props = buildProps(S, tier);
    const town = buildTown(S, tier, layout);
    scene.add(terrain.group, props.group, town.group);
    this.daisGlow = props.daisGlow;
    props.lamps.forEach((l, i) => { if (i < S.uLamp.value.length) S.uLamp.value[i].copy(l); });

    // Lantern flames, gate lanterns and small glowing flowers along the banks: one sprite cloud.
    const glows = props.glows.slice();
    {
      const r = mulberry32(919);
      for (let i = 0; i < 140; i++) {
        const z = -1.8 + r() * 42, s = r() < 0.5 ? -1 : 1;
        const x = pathX(z) + s * (1.45 + Math.pow(r(), 1.5) * 6);
        if (Math.hypot(x, z) < 2.3) continue;
        const c = r() < 0.7 ? new THREE.Color('#5fe8ff') : new THREE.Color('#9f8bff');
        glows.push({ pos: new THREE.Vector3(x, heightAt(x, z) + 0.12 + r() * 0.15, z), color: c.multiplyScalar(1.6), size: 0.16, flicker: 0.5 });
      }
    }
    const glowPts = glowPoints(S, glows.map((g) => ({ ...g, color: g.color.clone().multiplyScalar(g.size > 0.5 ? 1.25 : 1) })), { minPx: 1.5, fogK: 1 });
    glowPts.name = 'glows';
    scene.add(glowPts);

    const fx = buildFx(S, tier, props.canopy);
    scene.add(fx.group);
    this.fxSync = (fx.group.userData as { sync: () => void }).sync;

    // Lights: moon (key, shadows), sky fill, one warm shrine lantern for the partner, the burst flash.
    const md = moonDir();
    const el = 0.5; // the light comes from higher than the visible moon, so shadows stay readable
    const ld = new THREE.Vector3(Math.sin(MOON_AZ) * Math.cos(el), Math.sin(el), -Math.cos(MOON_AZ) * Math.cos(el));
    const moon = (this.moon = new THREE.DirectionalLight('#a3bcff', 1.35));
    moon.target.position.set(0.5, -1, 15);
    moon.position.copy(moon.target.position).addScaledVector(ld, 70);
    const sc = moon.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 150;
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.035;
    scene.add(moon, moon.target);
    void md;
    scene.add(new THREE.HemisphereLight('#4d62a6', '#1b1713', 0.75));
    const [lx, lz] = DAIS_LANTERNS[0];
    this.shrine = new THREE.PointLight('#ffad62', 5.5, 9, 2);
    this.shrine.position.set(lx + 0.3, heightAt(lx, lz) + 1.1, lz + 0.4);
    scene.add(this.shrine);
    this.flash = new THREE.PointLight('#c4ecff', 0, 18, 2);
    this.flash.position.set(0, FLOOR_Y + 1.1, 0.2);
    scene.add(this.flash);

    this.envPanels = [
      { color: '#cfdcff', pos: [md.x * 9, 1 + md.y * 9 + 1.5, md.z * 9], size: 5 },
      { color: '#ffb069', pos: [DAIS_LANTERNS[0][0] * 1.4, 1.2, DAIS_LANTERNS[0][1] + 1], size: 2.5 },
      { color: '#ffb069', pos: [DAIS_LANTERNS[1][0] * 1.4, 1.2, DAIS_LANTERNS[1][1] + 1], size: 2.5 },
      { color: '#3a5cff', pos: [0, 4, 7], size: 6 },
      { color: '#ffcf8a', pos: [0, -2.5, -8], size: 6 },
    ];

    this.quality.push((t) => terrain.setQuality(t), (t) => town.setQuality(t), (t) => fx.setQuality(t), (t) => props.setQuality(t));
    this.applyQuality(tier, true);

    this.debug = { heightAt, shared: S };
    this.camera.name = 'intro-camera';
    const s0 = this.shotAt(0, { pos: [0, 0, 0], target: [0, 0, 0], fov: 36 });
    this.camera.position.set(...s0.pos); this.camera.lookAt(...s0.target); this.camera.fov = s0.fov; this.camera.updateProjectionMatrix();
  }

  shotAt(t: number, out: EnvShot): EnvShot { return this.track.shotAt(t, out); }

  setPartnerHeight(h: number) { this.track.setHeight(clamp(h, 0.4, 2.2)); }

  burst() { this.burstAt = this.now; this.writeBurst(); }

  private writeBurst() {
    const S = this.S;
    const bt = this.burstAt < 0 ? -1 : this.now - this.burstAt;
    const active = bt >= 0 && bt < 6;
    S.uBurst.value.w = active ? bt : -1;
    this.fxSync();
    // flash: a fast rise, then an exponential fall
    const fl = active ? (bt < 0.05 ? bt / 0.05 : Math.exp(-(bt - 0.05) * 3.4)) : 0;
    this.flash.intensity = 32 * fl;
    // the dais engraving flares, then settles brighter than before; lanterns swell for a moment
    const settle = this.burstAt < 0 ? 0 : Math.min(1, Math.max(bt, 0) / 1.2);
    this.daisGlow.emissiveIntensity = 0.13 + settle * 0.1 + (active ? 6 * Math.exp(-bt * 2.2) * Math.min(1, bt / 0.05) : 0);
    S.uLampGain.value = 1 + (active ? 0.6 * Math.exp(-bt * 1.5) * Math.min(1, bt / 0.1) : 0);
  }

  update(t: number, dt: number) {
    void dt;
    this.now = t;
    this.S.uTime.value = t;
    this.writeBurst();
  }

  setQuality(tier: QualityTier) { if (tier !== this.tier) this.applyQuality(tier, false); }

  private applyQuality(tier: QualityTier, first: boolean) {
    this.tier = tier;
    const shadows = tier !== 'low';
    if (this.moon.castShadow !== shadows || first) {
      this.moon.castShadow = shadows;
      const size = tier === 'high' ? 2048 : 1024;
      if (this.moon.shadow.mapSize.x !== size) {
        this.moon.shadow.mapSize.set(size, size);
        this.moon.shadow.map?.dispose(); this.moon.shadow.map = null;
      }
    }
    for (const q of this.quality) q(tier);
  }

  dispose() {
    disposeTree(this.scene);
    this.moon.dispose(); this.flash.dispose(); this.shrine.dispose();
    for (const d of this.extraDispose) d.dispose();
    this.scene.clear();
  }
}

export function createIntro(opts: { tier: QualityTier }): IntroEnvironment & { readonly debug: IntroDebug } {
  return new Intro(opts.tier);
}
