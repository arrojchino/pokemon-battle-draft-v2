// Trainer bone pool and town ground field: pure data checks (no WebGL).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BonePool, POOL_CAP, bonePoolStats, takeBoneSlot } from '../src/engine/character/trainerAsset';
import { bakeGroundField } from '../src/engine/scenes/town/ground';
import { DEFAULT_TRAINER, TRAINER_MODELS, isTrainerId, trainerModel } from '../../shared/src/trainers';

describe('trainer bone pool', () => {
  it('hands out every slot once and takes each back once', () => {
    const pool = new BonePool(150);
    const slots = Array.from({ length: POOL_CAP }, () => pool.take());
    expect(new Set(slots).size).toBe(POOL_CAP);
    expect(pool.full).toBe(true);
    expect(() => pool.take()).toThrow();
    expect(pool.give(slots[3])).toBe(true);
    // a double dispose must not free the slot twice (two trainers would then share one bone slice)
    expect(pool.give(slots[3])).toBe(false);
    expect(pool.give(999)).toBe(false);
    expect(pool.take()).toBe(slots[3]);
    expect(pool.full).toBe(true);
  });

  it('sizes a slot to whole texture rows and keeps slots apart', () => {
    const pool = new BonePool(150);
    expect(pool.stride).toBeGreaterThanOrEqual(150);
    expect((pool.stride * 4) % 256).toBe(0);
    expect(pool.tex.image.height).toBe((pool.stride * 4 / 256) * POOL_CAP);
  });

  it('survives 60 create/dispose cycles without growing or leaking', () => {
    const live: { pool: BonePool; slot: number }[] = [];
    for (let i = 0; i < 60; i++) {
      live.push(takeBoneSlot(120, 'cycle-test'));
      if (live.length > 6) { const x = live.shift()!; expect(x.pool.give(x.slot)).toBe(true); }
      // no two live trainers share a slot
      const keys = new Set(live.map(x => `${x.pool.tex.id}:${x.slot}`));
      expect(keys.size).toBe(live.length);
    }
    expect(bonePoolStats()['cycle-test']).toEqual({ pools: 1, inUse: 6 });
    for (const x of live) x.pool.give(x.slot);
    expect(bonePoolStats()['cycle-test'].inUse).toBe(0);
  });

  it('opens a second texture past POOL_CAP trainers and keeps models in separate pools', () => {
    const a = Array.from({ length: POOL_CAP + 3 }, () => takeBoneSlot(100, 'cap-test'));
    expect(bonePoolStats()['cap-test'].pools).toBe(2);
    const other = takeBoneSlot(300, 'other-model');
    expect(a.some(x => x.pool === other.pool)).toBe(false);
    expect(other.pool.stride).toBeGreaterThanOrEqual(300);
  });
});

describe('town ground field', () => {
  const G = 0.205;
  // a 1 x 1 deck 0.012 above the floor at the origin, a 0.03 kerb strip, and a tall box top (an obstacle)
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const field = bakeGroundField([box(1, 0.06, 1, 0, G + 0.012 - 0.03, 0), box(0.2, 0.03, 2, 2, G + 0.015, 0), box(1, 0.4, 1, -3, G + 0.2, 0)], { floor: G, radius: 5 });

  it('reads the floor where nothing is raised', () => {
    expect(field.heightAt(1, 3)).toBeCloseTo(G, 6);
    expect(field.heightAt(-4.9, 4.9)).toBeCloseTo(G, 6);
  });
  it('reads raised walkable tops', () => {
    expect(field.heightAt(0, 0)).toBeCloseTo(G + 0.012, 4);
    expect(field.heightAt(0.3, -0.3)).toBeCloseTo(G + 0.012, 4);
    expect(field.heightAt(2, 0.5)).toBeCloseTo(G + 0.03, 4);
  });
  it('ignores tops taller than a step (obstacles)', () => {
    expect(field.heightAt(-3, 0)).toBeCloseTo(G, 6);
  });
  it('keeps a kerb edge crisp (a sole on the edge reads the kerb)', () => {
    expect(field.heightAt(2.09, 0)).toBeCloseTo(G + 0.03, 3);
  });
});

describe('trainer models', () => {
  it('has a valid default and unique ids', () => {
    expect(isTrainerId(DEFAULT_TRAINER)).toBe(true);
    expect(new Set(TRAINER_MODELS.map(m => m.id)).size).toBe(TRAINER_MODELS.length);
    expect(isTrainerId('nope')).toBe(false);
    expect(trainerModel('nope').id).toBe(TRAINER_MODELS[0].id);
    for (const m of TRAINER_MODELS) expect(m.license).toMatch(/CC0|CC-BY|VRoid/);
  });
});
