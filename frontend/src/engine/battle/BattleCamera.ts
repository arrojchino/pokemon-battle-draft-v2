import * as THREE from 'three';
import type { Shot } from '../CameraDirector.js';

/**
 * Field geometry, shared by the stage, the partners and the camera. Pokémon-style diagonal: your
 * side near the lens on the left, the opponent across the field on the right, each partner
 * standing behind their Pokémon and squared up to the other partner.
 */
export const ARENA = {
  mon: [new THREE.Vector3(-1.0, 0, 1.15), new THREE.Vector3(1.15, 0, -1.35)] as const,
  trainer: [{ x: -2.25, z: 2.45 }, { x: 2.55, z: -2.85 }] as const,
  cardY: 1.0,
  /** Top of the stage platform. */
  floorY: 0.205,
};
/** Yaw for a partner at `from` facing `to` (0 faces +z, toward the default lens). */
export const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - from.x, to.z - from.z);

type Beat = { shot: Shot; hold: number; cut?: boolean };
const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

/**
 * Battle cinematography. The stage asks for a beat sequence per event (attack, impact, faint, Tera,
 * switch); between events the camera settles into a slowly breathing establishing shot. The World
 * feeds the result into the spring-driven CameraDirector, so even hard cuts land on smooth motion.
 */
export class BattleCamera {
  private beats: Beat[] = [];
  private t = 0;
  private clock = 0;
  private pendingCut = false;
  enabled = true;

  private mon(side: 0 | 1) { const m = ARENA.mon[side]; return { x: m.x, y: ARENA.cardY, z: m.z }; }

  neutral(): Shot {
    const s = Math.sin(this.clock * 0.11), c = Math.cos(this.clock * 0.083);
    return { pos: v(-1.5 + s * 0.35, 1.78 + c * 0.07, 5.8 + c * 0.22), target: v(-0.3 + s * 0.1, 0.88, -0.6), fov: 40, time: 1.6, roll: 0 };
  }
  /** Over the attacker's shoulder (yours), or a low hero angle on the opponent's Pokémon. */
  private windup(side: 0 | 1): Shot {
    const m = this.mon(side);
    if (side === 0) return { pos: v(m.x - 0.95, m.y + 0.55, m.z + 2.45), target: v(m.x + 1.5, 0.95, m.z - 1.9), fov: 38, time: 0.45, roll: 0.02 };
    return { pos: v(m.x + 1.2, m.y - 0.25, m.z + 3.0), target: v(m.x - 0.25, m.y + 0.12, m.z), fov: 35, time: 0.45, roll: -0.03 };
  }
  private impact(side: 0 | 1, hard: boolean): Shot {
    const m = this.mon(side);
    // From the far side of the incoming line of fire, so streams and beams never sweep across the lens.
    if (side === 1) return { pos: v(m.x + 1.0, m.y + 0.3, m.z + 2.9), target: v(m.x - 0.1, m.y, m.z), fov: hard ? 31 : 34, time: 0.3, roll: hard ? 0.06 : 0.025 };
    return { pos: v(m.x + 1.3, m.y + 0.3, m.z + 2.7), target: v(m.x, m.y, m.z), fov: hard ? 31 : 34, time: 0.3, roll: hard ? 0.06 : 0.025 };
  }
  /** Side-on tracking for physical rushes. */
  private chase(): Shot { return { pos: v(0.35, 1.05, 3.5), target: v(0.05, 0.95, -0.1), fov: 42, time: 0.35, roll: 0 }; }
  private wide(): Shot { return { pos: v(0.7, 3.5, 5.9), target: v(0.05, 0.35, -0.2), fov: 44, time: 0.55, roll: 0 }; }
  private focus(side: 0 | 1, k: number): Shot {
    // Orbit on the side away from the partner standing behind, so they never block the lens.
    const m = this.mon(side); const a = side === 0 ? 0.15 + k * 0.45 : -0.15 - k * 0.45;
    return { pos: v(m.x + Math.sin(a) * 2.7, m.y + 0.3, m.z + Math.cos(a) * 2.7), target: v(m.x, m.y + 0.05, m.z), fov: 30, time: 0.9, roll: 0 };
  }

  private play(beats: Beat[]) { if (!this.enabled) return; this.beats = beats; this.t = 0; this.pendingCut = !!beats[0]?.cut; }

  intro() {
    this.play([
      { shot: { pos: v(0.2, 4.6, 9.2), target: v(0.1, 0.6, -0.6), fov: 38, time: 0.01 }, hold: 0.05, cut: true },
      { shot: { ...this.neutral(), time: 2.2 }, hold: 2.0 },
    ]);
  }
  attack(side: 0 | 1, style: 'projectile' | 'dash' | 'field' | 'self', impactAt: number, target: 0 | 1 | null, big: boolean) {
    const tgt = target ?? ((1 - side) as 0 | 1);
    if (style === 'self') { this.play([{ shot: this.focus(side, 0), hold: 0.45, cut: true }, { shot: this.focus(side, 1), hold: 0.9 }]); return; }
    if (style === 'field') { this.play([{ shot: this.wide(), hold: impactAt + 0.9, cut: true }]); return; }
    const lead = style === 'dash' ? this.chase() : this.windup(side);
    this.play([
      { shot: lead, hold: Math.max(0.12, impactAt - 0.06), cut: style !== 'dash' },
      { shot: this.impact(tgt, big), hold: 0.85, cut: true },
    ]);
  }
  switchIn(side: 0 | 1) {
    const m = this.mon(side);
    const dx = side === 0 ? 0.7 : -0.7;
    this.play([{ shot: { pos: v(m.x + dx * 1.3, m.y + 0.4, m.z + 3.3), target: v(m.x, m.y + 0.05, m.z), fov: 34, time: 0.5 }, hold: 1.0, cut: true }]);
  }
  faint(side: 0 | 1) {
    const m = this.mon(side);
    this.play([{ shot: { pos: v(m.x + (side === 0 ? 0.5 : -0.5), m.y + 0.3, m.z + 2.8), target: v(m.x, m.y - 0.05, m.z), fov: 32, time: 1.8 }, hold: 1.4, cut: true }]);
  }
  tera(side: 0 | 1) {
    this.play([{ shot: this.focus(side, -0.6), hold: 0.4, cut: true }, { shot: this.focus(side, 0.9), hold: 1.2 }]);
  }

  /** Advance; returns the shot to steer toward and whether to cut to it this frame. */
  update(dt: number): { shot: Shot; cut: boolean } {
    this.clock += dt;
    while (this.beats.length) {
      this.t += dt; dt = 0;
      if (this.t < this.beats[0].hold) break;
      this.t -= this.beats[0].hold; this.beats.shift();
      this.pendingCut = !!this.beats[0]?.cut;
    }
    const beat = this.beats[0];
    const cut = this.pendingCut; this.pendingCut = false;
    return { shot: beat ? beat.shot : this.neutral(), cut };
  }
  reset() { this.beats = []; this.t = 0; }
}
