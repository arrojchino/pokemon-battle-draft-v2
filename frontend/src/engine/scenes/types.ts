import type * as THREE from 'three';
import type { QualityTier } from '../quality.js';

/**
 * Contracts between the World (one renderer, one loop, one post chain) and the environments it shows.
 * Every environment owns its own THREE.Scene (lights, sky, fog, props) and its own camera; the World renders
 * exactly one of them per frame and never shares objects between them. Partner rigs and trainers are the only
 * things that move between scenes: the World re-parents them on a scene switch (models are cached).
 */
export type Vec3 = [number, number, number];
/** A camera framing in the environment's world units. */
export type EnvShot = { pos: Vec3; target: Vec3; fov: number };
/** A floor spot: position and facing (radians, 0 faces +z). */
export type EnvSpot = { x: number; z: number; face: number };

/** Something walkers cannot pass: an oriented box (half sizes, rotation about y) or a circle. */
export type Collider =
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; rot: number }
  | { kind: 'circle'; x: number; z: number; r: number };

export interface Environment {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Per frame while this environment is the one on screen. `t` is seconds since start. */
  update(t: number, dt: number): void;
  /** Quality tier changed (shadows, particle counts, light counts). Must be cheap to call repeatedly. */
  setQuality(tier: QualityTier): void;
  /** Free every GPU resource this environment created. */
  dispose(): void;
}

/** The main plaza: a night town square, the player's home and the multiplayer gathering place. */
export interface TownEnvironment extends Environment {
  /** Ground height: the town floor sits at FLOOR_Y (0.205) so partner rigs stand on it. */
  readonly groundY: number;
  /**
   * Walkable ground height (world y) at a point: `groundY` on the open floor, higher on the few raised walkable
   * surfaces (the shrine stage's deck and rim). Cached heightfield, no allocation per call.
   */
  heightAt?(x: number, z: number): number;
  /** Every point a walker of radius `r` may stand on is within this radius of the origin. */
  readonly radius: number;
  readonly colliders: readonly Collider[];
  /** Keep a walker (circle of radius r) inside the walkable area and outside every collider. */
  bounds(x: number, z: number, r: number): { x: number; z: number };
  /** Where arriving trainers appear (spread around it), and fixed places the game uses. */
  readonly spawn: EnvSpot;
  readonly spots: {
    /** The plaza host NPC stands here, facing `face`. */
    host: EnvSpot;
    /** Partner preview stage (My Partner): the partner stands here, the camera frames it from `showcaseCam`. */
    showcase: EnvSpot;
    showcaseCam: EnvShot;
    /** The open multiplayer gathering area (centre). */
    gathering: EnvSpot;
    /** The stadium gate: where a trainer walks off to battle (transition point). */
    gate: EnvSpot;
  };
  /** The shadow-casting key light; the World moves it (and its target) to follow the player. */
  readonly key: THREE.DirectionalLight;
  /** Light panels for the prefiltered environment map (Pokémon reflections), in world space. */
  readonly envPanels: ReadonlyArray<{ color: string; pos: Vec3; size: number }>;
}

/** The opening cinematic: a short, skippable camera flight that ends on the partner's reveal. */
export interface IntroEnvironment extends Environment {
  /** Total length in seconds. */
  readonly duration: number;
  /** Where the partner rig stands (the World places it there, hidden until `reveal`). */
  readonly partnerSpot: EnvSpot;
  /** The camera at time t (0..duration), already eased; the World copies it onto `camera`. */
  shotAt(t: number, out: EnvShot): EnvShot;
  /** Moments the World reacts to: `reveal` shows the partner (send-out flash), `title` shows the logo card. */
  readonly beats: ReadonlyArray<{ t: number; kind: 'reveal' | 'title' | 'end' }>;
  /** Called by the World at the reveal beat: burst of light at the partner spot. */
  burst(): void;
  /** The partner's height in world units (0.4 to 2.2): shots near the partner frame it at its size. */
  setPartnerHeight(h: number): void;
  /** Light panels for the environment map, as in the town. */
  readonly envPanels: ReadonlyArray<{ color: string; pos: Vec3; size: number }>;
}
