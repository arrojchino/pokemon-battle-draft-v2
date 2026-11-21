/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MOVES } from '@shared';
import { BattleStage } from '../src/engine/battle/BattleStage.js';

describe('battle stage', () => {
  it('plays every move in the pool from both sides without errors and settles back to idle', () => {
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    cam.position.set(0, 1.6, 5);
    const stage = new BattleStage(cam, () => false);
    let n = 0;
    for (const m of Object.values(MOVES)) {
      for (const side of [0, 1] as const) {
        stage.move(side, m.name, m.type, m.category, (1 - side) as 0 | 1);
        stage.hit((1 - side) as 0 | 1, 0.3, n % 7 === 0, n % 5 === 0 ? 'super' : 'normal', '#ffffff');
        for (let f = 0; f < 45; f++) { stage.update(1 / 30); stage.cam.update(1 / 30); }
        n++;
      }
    }
    for (let f = 0; f < 120; f++) stage.update(1 / 30);
    expect(n).toBe(Object.keys(MOVES).length * 2);
    // Every effect has finished: nothing left alive in the pools.
    expect((stage as unknown as { particles: { active: number } }).particles.active).toBe(0);
    stage.dispose();
  });
});
