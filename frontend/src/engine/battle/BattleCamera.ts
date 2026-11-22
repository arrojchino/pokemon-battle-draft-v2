import * as THREE from 'three';
import type { Shot } from '../CameraDirector.js';
import { FIELD } from '../world/dims.js';

/**
 * Field geometry, shared by the stage, the partners and the camera. Pokémon-style diagonal: your
 * side near the lens on the left, the opponent across the field on the right, each partner
 * standing behind their Pokémon and squared up to the other partner.
 */
export const ARENA = {
  mon: [new THREE.Vector3(-1.0 * FIELD, 0, 1.15 * FIELD), new THREE.Vector3(1.15 * FIELD, 0, -1.35 * FIELD)] as const,
  trainer: [{ x: -2.25 * FIELD, z: 2.45 * FIELD }, { x: 2.55 * FIELD, z: -2.85 * FIELD }] as const,
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
 * feeds the result into the spring-driven CameraDirector: beats glide into each other, and only the
 * battle intro and the biggest impacts use hard cuts.
 */
export class BattleCamera {
  private beats: Beat[] = [];
  private t = 0;
  private clock = 0;
  private pendingCut = false;
  enabled = true;

  /** Body heights of the two active Pokémon: every close-up frames each one at its own size. */
  private h: [number, number] = [0.7, 0.7];
  setHeights(h0: number, h1: number) { this.h[0] = h0; this.h[1] = h1; }
  /** Chest height of a Pokémon. */
  private mon(side: 0 | 1) { const m = ARENA.mon[side]; return { x: m.x, y: ARENA.floorY + this.h[side] * 0.6, z: m.z }; }
  /** Camera distance factor: the shots were composed for 1.2-unit bodies; smaller ones get a closer lens. */
  private fr(side: 0 | 1) { return THREE.MathUtils.clamp(0.3 + 0.7 * this.h[side] / 1.2, 0.55, 1.1); }

  neutral(): Shot {
    // Disabled (steady camera style or reduced motion): a locked-off establishing shot instead of a slow breathe.
    const k = this.enabled ? this.clock : 0;
    const s = Math.sin(k * 0.11), c = Math.cos(k * 0.083);
    const yc = (this.mon(0).y + this.mon(1).y) / 2, d = 0.78 + 0.2 * (this.fr(0) + this.fr(1)) / 2;
    // Both Pokémon in frame: the lens stands back as far as the field is wide.
    return { pos: v((-1.5 * d + s * 0.35) * FIELD, yc + 0.95 * d * FIELD + c * 0.07, (-0.6 + 6.4 * d + c * 0.22) * FIELD), target: v((-0.3 + s * 0.1) * FIELD, yc + 0.04, -0.6 * FIELD), fov: 40, time: 1.6, roll: 0 };
  }
  /** Over the attacker's shoulder (yours), or a low hero angle on the opponent's Pokémon. */
  private windup(side: 0 | 1): Shot {
    const m = this.mon(side), f = this.fr(side);
    if (side === 0) { const o = this.mon(1); return { pos: v(m.x - 0.95 * f, m.y + 0.55 * f, m.z + 2.45 * f), target: v(m.x + 1.5 * FIELD, (m.y + o.y) / 2 + 0.05, m.z - 1.9 * FIELD), fov: 38, time: 0.45, roll: 0.02 }; }
    return { pos: v(m.x + 1.2 * f, m.y - 0.25 * f, m.z + 3.0 * f), target: v(m.x - 0.25 * f, m.y + 0.12 * f, m.z), fov: 35, time: 0.45, roll: -0.03 };
  }
  private impact(side: 0 | 1, hard: boolean): Shot {
    const m = this.mon(side), f = this.fr(side);
    // From the far side of the incoming line of fire, so streams and beams never sweep across the lens.
    if (side === 1) return { pos: v(m.x + 1.0 * f, m.y + 0.3 * f, m.z + 2.9 * f), target: v(m.x - 0.1 * f, m.y, m.z), fov: hard ? 31 : 34, time: 0.3, roll: hard ? 0.06 : 0.025 };
    return { pos: v(m.x + 1.3 * f, m.y + 0.3 * f, m.z + 2.7 * f), target: v(m.x, m.y, m.z), fov: hard ? 31 : 34, time: 0.3, roll: hard ? 0.06 : 0.025 };
  }
  /** Side-on tracking for physical rushes. */
  private chase(): Shot {
    const yc = (this.mon(0).y + this.mon(1).y) / 2, f = (this.fr(0) + this.fr(1)) / 2;
    return { pos: v(0.35 * FIELD, yc + 0.1 * f + 0.05, (-0.1 + 3.6 * f) * FIELD), target: v(0.05 * FIELD, yc, -0.1 * FIELD), fov: 42, time: 0.35, roll: 0 };
  }
  private wide(): Shot { return { pos: v(0.7 * FIELD, 3.5 * FIELD, 5.9 * FIELD), target: v(0.05 * FIELD, 0.35, -0.2 * FIELD), fov: 44, time: 0.55, roll: 0 }; }
  private focus(side: 0 | 1, k: number): Shot {
    // Orbit on the side away from the partner standing behind, so they never block the lens.
    const m = this.mon(side), f = this.fr(side); const a = side === 0 ? 0.15 + k * 0.45 : -0.15 - k * 0.45;
    return { pos: v(m.x + Math.sin(a) * 2.7 * f, m.y + 0.3 * f, m.z + Math.cos(a) * 2.7 * f), target: v(m.x, m.y + 0.05 * f, m.z), fov: 30, time: 0.9, roll: 0 };
  }

  private play(beats: Beat[]) { if (!this.enabled) return; this.beats = beats; this.t = 0; this.pendingCut = !!beats[0]?.cut; }

  intro() {
    this.play([
      { shot: { pos: v(0.2 * FIELD, 4.6 * FIELD, 9.2 * FIELD), target: v(0.1 * FIELD, 0.6, -0.6 * FIELD), fov: 38, time: 0.01 }, hold: 0.05, cut: true },
      { shot: { ...this.neutral(), time: 2.2 }, hold: 2.0 },
    ]);
  }
  attack(side: 0 | 1, style: 'projectile' | 'dash' | 'field' | 'self', impactAt: number, target: 0 | 1 | null, big: boolean) {
    const tgt = target ?? ((1 - side) as 0 | 1);
    if (style === 'self') { this.play([{ shot: this.focus(side, 0), hold: 0.45 }, { shot: this.focus(side, 1), hold: 0.9 }]); return; }
    if (style === 'field') { this.play([{ shot: this.wide(), hold: impactAt + 0.9 }]); return; }
    const lead = style === 'dash' ? this.chase() : this.windup(side);
    this.play([
      { shot: lead, hold: Math.max(0.12, impactAt - 0.12) },
      // A fast push onto the target as the hit lands; only the biggest hits smash-cut.
      { shot: { ...this.impact(tgt, big), time: big ? 0.3 : 0.16 }, hold: 0.85, cut: big },
    ]);
  }
  switchIn(side: 0 | 1) {
    const m = this.mon(side), f = this.fr(side);
    const dx = side === 0 ? 0.7 : -0.7;
    this.play([{ shot: { pos: v(m.x + dx * 1.3 * f, m.y + 0.4 * f, m.z + 3.3 * f), target: v(m.x, m.y + 0.05 * f, m.z), fov: 34, time: 0.5 }, hold: 1.0 }]);
  }
  faint(side: 0 | 1) {
    const m = this.mon(side), f = this.fr(side);
    this.play([{ shot: { pos: v(m.x + (side === 0 ? 0.5 : -0.5) * f, m.y + 0.3 * f, m.z + 2.8 * f), target: v(m.x, m.y - 0.05 * f, m.z), fov: 32, time: 1.2 }, hold: 1.4 }]);
  }
  tera(side: 0 | 1) {
    this.play([{ shot: { ...this.focus(side, -0.6), time: 0.35 }, hold: 0.4 }, { shot: this.focus(side, 0.9), hold: 1.2 }]);
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
