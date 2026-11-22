import { describe, expect, it } from 'vitest';
import { parseServerMessage, poseAfter, type PublicRoom } from '@shared';
import { GestureQueue } from '../src/engine/world/gestureQueue.js';
import { PresenceRelay, SnapshotStore, type PresenceMessage } from '../src/net/types.js';

describe('queued gestures from other partners', () => {
  it('waits while the partner is still moving, then plays once it stops', () => {
    const q = new GestureQueue<string>(1.5);
    q.push('m1', 'happy', 10);
    expect(q.take('m1', 10.1, false)).toBeNull();
    expect(q.take('m1', 10.6, false)).toBeNull();
    expect(q.take('m1', 10.9, true)).toBe('happy');
    expect(q.take('m1', 11, true)).toBeNull();
  });
  it('drops a gesture the partner never got still for', () => {
    const q = new GestureQueue<string>(1.5);
    q.push('m1', 'stretch', 10);
    expect(q.take('m1', 11.6, false)).toBeNull();
    expect(q.has('m1')).toBe(false);
    expect(q.take('m1', 11.7, true)).toBeNull();
  });
  it('keeps the latest gesture per partner, and partners apart', () => {
    const q = new GestureQueue<string>(1.5);
    q.push('m1', 'happy', 10); q.push('m1', 'stretch', 10.2); q.push('m2', 'happy', 10.2);
    expect(q.take('m1', 10.3, true)).toBe('stretch');
    q.drop('m2');
    expect(q.take('m2', 10.3, true)).toBeNull();
  });
});

describe('held poses', () => {
  it('Sit and Nap start a pose, rise ends it, other gestures keep it', () => {
    expect(poseAfter(null, 'sit')).toBe('sit');
    expect(poseAfter('sit', 'nap')).toBe('nap');
    expect(poseAfter('nap', 'happy')).toBe('nap');
    expect(poseAfter('nap', 'rise')).toBeNull();
    expect(poseAfter(null, 'stretch')).toBeNull();
  });
  it('hub members carry their pose, and older servers read as standing', () => {
    const member = { id: 'm1', name: 'Ana', avatar: 'greninja', x: 0, z: 0, face: 0 };
    const join = (m: object) => parseServerMessage(JSON.stringify({ type: 'hubJoin', member: m }));
    expect(join({ ...member, pose: 'nap' })).toMatchObject({ member: { pose: 'nap' } });
    expect(join(member)).toMatchObject({ member: { pose: null } });
    expect(join({ ...member, pose: 'dance' })).toMatchObject({ member: { pose: null } });
  });

  const room = (connected: [boolean, boolean]) => ({ players: connected.map(c => ({ name: 'x', avatar: null, connected: c })) }) as unknown as PublicRoom;
  const make = () => new SnapshotStore({ kind: 'backend', link: 'online', room: room([true, true]), seat: 0, serverProtocol: 9, watching: null, error: '', errorId: 0 });

  it('a plaza screen that subscribes late still hears the pose the other seat holds', () => {
    const store = make(); const relay = new PresenceRelay(store);
    relay.hear({ type: 'emote', seat: 1, emote: 'sit' });
    const heard: PresenceMessage[] = [];
    relay.subscribe(m => heard.push(m));
    expect(heard).toEqual([{ type: 'emote', seat: 1, emote: 'sit' }]);
    relay.hear({ type: 'emote', seat: 1, emote: 'rise' });
    const later: PresenceMessage[] = [];
    relay.subscribe(m => later.push(m));
    expect(later).toEqual([]);
  });
  it('a trainer who drops comes back standing, so their pose is forgotten', () => {
    const store = make(); const relay = new PresenceRelay(store);
    relay.hear({ type: 'emote', seat: 1, emote: 'nap' });
    store.set({ room: room([true, false]) });
    const heard: PresenceMessage[] = [];
    relay.subscribe(m => heard.push(m));
    expect(heard).toEqual([]);
  });
});
