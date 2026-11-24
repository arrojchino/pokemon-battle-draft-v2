import { describe, expect, it } from 'vitest';
import { Follower, type Leader } from '../src/engine/world/Follower.js';
import type { Bounds } from '../src/engine/world/Plaza.js';

const open: Bounds = (x, z) => ({ x, z });
const wall: Bounds = (x, z) => ({ x: Math.min(x, 2), z });

function walk(f: Follower, l: Leader, seconds: number, bounds = open, step?: (l: Leader) => void) {
  for (let t = 0; t < seconds; t += 1 / 60) { step?.(l); f.update(1 / 60, l, bounds); }
}

describe('partner follows its trainer', () => {
  it('starts beside the trainer, behind and to one side', () => {
    const f = new Follower(); f.w.size(0.8);
    const l: Leader = { x: 0, z: 0, face: Math.PI, speed: 0, radius: 0.3 };
    f.update(1 / 60, l, open);
    const d = Math.hypot(f.w.x - l.x, f.w.z - l.z);
    expect(d).toBeGreaterThan(l.radius + f.w.radius);
    expect(d).toBeLessThan(1.6);
    // Facing -z, "behind" is +z.
    expect(f.w.z).toBeGreaterThan(0);
  });

  it('keeps up with a walking trainer and never falls far behind', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: Math.PI, speed: 1.6, radius: 0.3 };
    let worst = 0;
    walk(f, l, 6, open, ll => { ll.z -= 1.6 / 60; worst = Math.max(worst, Math.hypot(f.w.x - ll.x, f.w.z - ll.z)); });
    expect(worst).toBeLessThan(2.6);
    expect(f.w.speed).toBeGreaterThan(1.2);
  });

  it('stops and settles when the trainer stops, facing the same way', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: Math.PI, speed: 1.6, radius: 0.3 };
    walk(f, l, 3, open, ll => { ll.z -= 1.6 / 60; });
    l.speed = 0;
    walk(f, l, 4);
    expect(f.w.speed).toBeLessThan(0.02);
    expect(Math.abs(Math.atan2(Math.sin(f.w.face - l.face), Math.cos(f.w.face - l.face)))).toBeLessThan(0.35);
  });

  it('respects bounds (never walks through walls)', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 1.5, z: 0, face: Math.PI / 2, speed: 1.6, radius: 0.3 };
    walk(f, l, 4, wall, ll => { ll.x = Math.min(1.8, ll.x + 1.6 / 60); });
    expect(f.w.x).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('appears beside the trainer after a teleport instead of crossing the map', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: 0, speed: 0, radius: 0.3 };
    walk(f, l, 1);
    l.x = 12; l.z = -5;
    f.update(1 / 60, l, open);
    expect(Math.hypot(f.w.x - 12, f.w.z + 5)).toBeLessThan(1.6);
  });

  it('holds still while told to (sitting, sleeping, a gesture)', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: 0, speed: 0, radius: 0.3 };
    walk(f, l, 1);
    const x = f.w.x, z = f.w.z;
    l.x = 2;
    for (let i = 0; i < 60; i++) f.update(1 / 60, l, open, true);
    expect(Math.hypot(f.w.x - x, f.w.z - z)).toBeLessThan(1e-6);
  });
});

describe('partner follow feels natural', () => {
  it('stays put while the trainer turns on the spot (no lap around them)', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: 0, speed: 0, radius: 0.3 };
    walk(f, l, 1);
    const x = f.w.x, z = f.w.z;
    walk(f, l, 2, open, ll => { ll.face += Math.PI / 60; }); // a full turn in place
    expect(Math.hypot(f.w.x - x, f.w.z - z)).toBeLessThan(0.05);
  });

  it('walks in the trainer\'s footsteps round a corner instead of cutting across', () => {
    const f = new Follower(); f.w.size(0.7, 1.1);
    const l: Leader = { x: 0, z: 0, face: 0, speed: 1.4, radius: 0.3 };
    // North 3 units, then east 3 units: the partner should pass near the corner (0, 3), not cut the diagonal.
    let nearCorner = Infinity;
    walk(f, l, 3 / 1.4, open, ll => { ll.z += 1.4 / 60; });
    l.face = Math.PI / 2;
    walk(f, l, 3 / 1.4 + 1.5, open, ll => { if (ll.x < 3) ll.x += 1.4 / 60; else ll.speed = 0; nearCorner = Math.min(nearCorner, Math.hypot(f.w.x, f.w.z - 3)); });
    expect(nearCorner).toBeLessThan(0.55);
  });

  it('settles on the side it is already on when the trainer stops', () => {
    const f = new Follower(); f.w.size(0.7, 1.1); f.side = 1;
    const l: Leader = { x: 0, z: 0, face: 0, speed: 1.4, radius: 0.3 };
    walk(f, l, 2, open, ll => { ll.z += 1.4 / 60; });
    // Nudge the partner to the trainer's left (+x when facing +z) just before the stop.
    f.w.x = l.x + 0.5;
    l.speed = 0;
    walk(f, l, 3);
    expect(f.side).toBe(-1);
    expect(f.w.x).toBeGreaterThan(l.x); // it did not cross behind to the right
  });
});
