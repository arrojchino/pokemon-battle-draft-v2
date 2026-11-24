import { describe, expect, it } from 'vitest';
import {
  buildColliders, solveBounds, RADIUS, SPAWN, SPOTS, CENTER, FOUNTAIN, SHOPS, SHOP_R, ringPos, pushOut,
} from '../src/engine/scenes/town/layout.js';

const colliders = buildColliders();
const bounds = (x: number, z: number, r: number) => solveBounds(colliders, RADIUS, x, z, r);
const R = 0.35;

function overlapsAny(x: number, z: number, r: number): boolean {
  return colliders.some(c => pushOut(c, x, z, r - 1e-6) !== null);
}

describe('town bounds', () => {
  it('leaves the spawn and every spot where they are (walkable for r = 0.35)', () => {
    const spots = { spawn: SPAWN, host: SPOTS.host, showcase: SPOTS.showcase, gathering: SPOTS.gathering, gate: SPOTS.gate };
    for (const [name, s] of Object.entries(spots)) {
      const p = bounds(s.x, s.z, R);
      expect(Math.hypot(p.x - s.x, p.z - s.z), name).toBeLessThan(1e-9);
    }
  });

  it('pushes a point inside the fountain out of it', () => {
    const p = bounds(FOUNTAIN.x + 0.3, FOUNTAIN.z + 0.2, R);
    expect(Math.hypot(p.x - FOUNTAIN.x, p.z - FOUNTAIN.z)).toBeGreaterThanOrEqual(FOUNTAIN.collider + R - 1e-6);
    expect(overlapsAny(p.x, p.z, R)).toBe(false);
    const c = bounds(0, 0, R); // dead centre
    expect(Math.hypot(c.x, c.z)).toBeGreaterThanOrEqual(FOUNTAIN.collider + R - 1e-6);
  });

  it('pushes points inside buildings out to the nearest face', () => {
    const p = bounds(CENTER.x + 1, CENTER.z + CENTER.hd - 0.3, R);
    expect(p.z).toBeGreaterThanOrEqual(CENTER.z + CENTER.hd + R - 1e-6);
    expect(overlapsAny(p.x, p.z, R)).toBe(false);
    for (const s of SHOPS) {
      const c = ringPos(s.deg, SHOP_R);
      const q = bounds(c.x, c.z, R);
      expect(overlapsAny(q.x, q.z, R), s.kind).toBe(false);
      expect(Math.hypot(q.x - c.x, q.z - c.z)).toBeGreaterThan(1);
    }
  });

  it('brings far points back inside the walkable radius', () => {
    for (const [x, z] of [[100, 0], [-40, 60], [0, -500], [30, 30], [0, 80]]) {
      const p = bounds(x, z, R);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(RADIUS - R + 1e-6);
    }
  });

  it('never leaves a walker overlapping a collider across a grid of starts', () => {
    let bad = 0;
    for (let x = -14; x <= 14; x += 0.5) for (let z = -14; z <= 14; z += 0.5) {
      const p = bounds(x, z, R);
      if (Math.hypot(p.x, p.z) > RADIUS - R + 1e-6) bad++;
      else if (overlapsAny(p.x, p.z, R - 0.02)) bad++;
    }
    expect(bad).toBe(0);
  });

  it('slides along a wall instead of stopping dead', () => {
    // walking diagonally into the Center front: z is held at the face, x keeps moving
    const p = bounds(1.2, CENTER.z + CENTER.hd + 0.1, R);
    expect(p.x).toBeCloseTo(1.2, 6);
    expect(p.z).toBeCloseTo(CENTER.z + CENTER.hd + R, 6);
  });
});
