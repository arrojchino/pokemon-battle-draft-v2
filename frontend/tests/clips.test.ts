import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clipKey, fallbackIdle, findClip } from '../src/engine/character/monModel.js';

const clips = (...names: string[]) => names.map(n => new THREE.AnimationClip(n, 1, []));
// Great Tusk's API export: clips decorated with `.001`, notes and stray spaces, attack first, no defaultwait.
const tusk = clips('Normal|attack01', 'Normal|attack02', 'Normal|battlewait01_loop.001', 'Normal|damage01', 'Normal|defaultidle01',
  'Normal|down01_start ', 'Normal|glad01', 'Normal|glad01.001', 'Normal|pm1082_00_00_00300_roar01.gfbanm', 'Normal|rangeattack01/ range',
  'Normal|run01_loop', 'Normal|run01_loop.001', 'Normal|walk01_loop w/ run In Place', 'Normal|walk01_loop.001');

describe('clip lookup', () => {
  it('reads the game name out of exporter decoration', () => {
    expect(clipKey('Normal|battlewait01_loop.001')).toBe('battlewait01_loop');
    expect(clipKey('Normal|walk01_loop w/ run In Place')).toBe('walk01_loop');
    expect(clipKey('Normal|down01_start ')).toBe('down01_start');
    expect(clipKey('home_battlewait01_loop')).toBe('home_battlewait01_loop');
  });
  it('finds decorated clips instead of falling back to the first clip (an attack)', () => {
    expect(findClip(tusk, ['battlewait01_loop', 'defaultwait01_loop'])?.name).toBe('Normal|battlewait01_loop.001');
    expect(findClip(tusk, ['down01_start', 'down01'])?.name).toBe('Normal|down01_start ');
    expect(findClip(tusk, ['roar01'])?.name).toBe('Normal|pm1082_00_00_00300_roar01.gfbanm');
  });
  it('prefers the plainest copy of a clip', () => {
    expect(findClip(tusk, ['glad01'])?.name).toBe('Normal|glad01');
    expect(findClip(tusk, ['run01_loop'])?.name).toBe('Normal|run01_loop');
    // The walk annotated "run in place" loses to the clean copy.
    expect(findClip(tusk, ['walk01_loop'])?.name).toBe('Normal|walk01_loop.001');
  });
  it('never mistakes one clip for another that merely ends the same way', () => {
    expect(findClip(clips('rangeattack01'), ['attack01'])).toBeNull();
    expect(findClip(clips('home_attack01'), ['attack01'])?.name).toBe('home_attack01');
  });
  it('falls back to an idle, never an attack', () => {
    expect(fallbackIdle(clips('Normal|attack01', 'Normal|defaultidle01'))?.name).toBe('Normal|defaultidle01');
    expect(fallbackIdle(clips('attack01', 'damage01', 'Static Pose'))?.name).toBe('Static Pose');
    expect(fallbackIdle(clips('attack01', 'damage01'))).toBeNull();
  });
});
