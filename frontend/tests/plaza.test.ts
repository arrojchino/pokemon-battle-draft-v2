import { describe, it, expect } from 'vitest';
import { CHAT_KEEP, MAX_CHAT, cleanChat, createRoom, publicView, reduce, seatGuest, type RoomState, type Rng } from '../../shared/src/room.js';
import { HUB_R, PLAZA_R, cleanSpot, parseClientMessage, parseServerMessage } from '../../shared/src/protocol.js';
import { PLAZA_SPAWN, Plaza, REACH, RIVAL, platform, withObstacles } from '../src/engine/world/Plaza.js';

const rng: Rng = { coin: () => 'heads', float: () => 0.25 };
const host = { name: 'Ana', token: 'tok-a', avatar: 'greninja' as const };
const guest = { name: 'Beto', token: 'tok-b', avatar: null };
function seated(): RoomState {
  const r = seatGuest(createRoom('ABC123', host, 3, 'app'), guest, rng);
  if (!r.ok) throw new Error(r.error);
  return r.room;
}
const say = (room: RoomState, seat: 0 | 1, text: string) => {
  const r = reduce(room, seat, { type: 'chat', text }, rng);
  if (!r.ok) throw new Error(r.error);
  return r.room;
};

describe('room chat', () => {
  it('numbers, cleans and keeps lines for both seats', () => {
    let s = seated();
    s = say(s, 0, '  hola\u0000   mundo \u202e');
    s = say(s, 1, 'gg');
    expect(s.chat).toEqual([{ id: 1, seat: 0, text: 'hola mundo' }, { id: 2, seat: 1, text: 'gg' }]);
    for (const viewer of [0, 1] as const) expect(publicView(s, [true, true], 5, viewer).chat).toEqual(s.chat);
  });
  it('keeps the latest lines only, and ids keep counting', () => {
    let s = seated();
    for (let i = 0; i < CHAT_KEEP + 5; i++) s = say(s, (i % 2) as 0 | 1, `line ${i}`);
    expect(s.chat).toHaveLength(CHAT_KEEP);
    expect(s.chat[0].id).toBe(6);
    expect(s.chat[CHAT_KEEP - 1]).toMatchObject({ id: CHAT_KEEP + 5, text: `line ${CHAT_KEEP + 4}` });
  });
  it('refuses blank lines and empty seats, clamps long ones by code point', () => {
    const lone = createRoom('ABC123', host, 3);
    expect(reduce(lone, 1, { type: 'chat', text: 'hi' }, rng)).toEqual({ ok: false, error: 'Not seated' });
    expect(reduce(seated(), 0, { type: 'chat', text: ' \n\t ' }, rng).ok).toBe(false);
    const long = cleanChat('🙂'.repeat(MAX_CHAT + 10));
    expect(Array.from(long)).toHaveLength(MAX_CHAT);
    expect(long.endsWith('\ud83d')).toBe(false);
  });
  it('accepts rooms persisted before chat existed', () => {
    const old = { ...seated() } as Partial<RoomState>;
    delete old.chat;
    expect(say(old as RoomState, 0, 'still works').chat).toHaveLength(1);
  });
});

describe('plaza protocol', () => {
  it('parses chat, presence and emotes from clients', () => {
    expect(parseClientMessage({ type: 'chat', text: ' hi\u0007 ' })).toEqual({ type: 'chat', text: 'hi' });
    expect(parseClientMessage({ type: 'chat', text: '   ' })).toBeNull();
    expect(parseClientMessage({ type: 'chat', text: 42 })).toBeNull();
    expect(parseClientMessage({ type: 'move', x: 30, z: 0, face: 7 })).toEqual({ type: 'move', x: PLAZA_R, z: 0, face: 0.717 });
    expect(parseClientMessage({ type: 'move', x: NaN, z: 0, face: 0 })).toBeNull();
    expect(parseClientMessage({ type: 'move', x: '1', z: 0, face: 0 })).toBeNull();
    expect(parseClientMessage({ type: 'emote', emote: 'twirl' })).toEqual({ type: 'emote', emote: 'twirl' });
    expect(parseClientMessage({ type: 'emote', emote: 'faceplant' })).toBeNull();
    for (const g of ['happy', 'stretch', 'nap', 'sit', 'rise']) expect(parseClientMessage({ type: 'emote', emote: g })).toEqual({ type: 'emote', emote: g });
  });
  it('checks presence and chat arriving at a client', () => {
    expect(parseServerMessage({ type: 'move', seat: 1, x: 1, z: 2, face: 0 })).toEqual({ type: 'move', seat: 1, x: 1, z: 2, face: 0 });
    expect(parseServerMessage({ type: 'move', seat: 2, x: 1, z: 2, face: 0 })).toBeNull();
    expect(parseServerMessage({ type: 'emote', seat: 0, emote: 'bow' })).toEqual({ type: 'emote', seat: 0, emote: 'bow' });
    expect(parseServerMessage({ type: 'emote', seat: 0, emote: 'nope' })).toBeNull();
    const room = publicView(say(seated(), 0, 'hey'), [true, true], 5, 1) as unknown as Record<string, unknown>;
    const bad = { ...room, chat: [{ id: 1, seat: 0, text: 'ok' }, { id: 'x', seat: 0, text: 'no' }, { id: 3, seat: 5, text: 'no' }, { id: 4, seat: 1, text: '\u0000' }] };
    const m = parseServerMessage({ type: 'state', room: bad });
    expect(m?.type === 'state' && m.room.chat).toEqual([{ id: 1, seat: 0, text: 'ok' }]);
    const old = { ...room }; delete old.chat;
    const v4 = parseServerMessage({ type: 'state', room: old });
    expect(v4?.type === 'state' && v4.room.chat).toEqual([]);
  });
  it('keeps spots on the platform', () => {
    const s = cleanSpot(-40, 30, -Math.PI * 3);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(PLAZA_R, 2);
    expect(Math.abs(s.face)).toBeCloseTo(Math.PI, 2);
  });
});

describe('plaza walking', () => {
  const run = (p: Plaza, seconds: number) => { const out = []; for (let t = 0; t < seconds; t += 1 / 60) { const s = p.update(1 / 60); if (s) out.push(s); } return out; };

  it('walks up the field with W, never past the edge, and reports at most ten spots a second', () => {
    const p = new Plaza(); p.enter(PLAZA_SPAWN[0]);
    expect(p.spot()).toEqual(PLAZA_SPAWN[0]);
    p.keys.add('KeyW');
    const sent = run(p, 2);
    expect(p.me.z).toBeLessThan(PLAZA_SPAWN[0].z - 1.5);
    expect(Math.abs(p.me.face)).toBeGreaterThan(Math.PI - 0.2); // facing away from the camera
    expect(sent.length).toBeLessThanOrEqual(21);
    expect(sent.length).toBeGreaterThan(10);
    // Plazas only walk: holding W for long never goes past the walking pace (or the edge).
    let fastest = 0;
    for (let t = 0; t < 10; t += 1 / 60) { p.update(1 / 60); fastest = Math.max(fastest, p.me.speed); }
    expect(fastest).toBeLessThanOrEqual(p.me.walk + 1e-6);
    expect(Math.hypot(p.me.x, p.me.z)).toBeCloseTo(PLAZA_R, 6);
    p.keys.clear(); run(p, 1);
    expect(p.me.speed).toBe(0);
    expect(run(p, 1)).toHaveLength(0); // standing still: nothing to send
  });
  it('walks to a clicked point and stops there', () => {
    const p = new Plaza(); p.enter(PLAZA_SPAWN[1]);
    p.walkTo(2, -2);
    expect(p.target).toMatchObject({ x: 2, z: -2 });
    run(p, 5);
    expect(Math.hypot(p.me.x - 2, p.me.z + 2)).toBeLessThan(0.06);
    expect(p.target).toBeNull();
    p.walkTo(50, 0); run(p, 10);
    expect(Math.hypot(p.me.x, p.me.z)).toBeLessThanOrEqual(PLAZA_R + 1e-9);
  });
  it('never walks through someone, and greets on arrival even when they move away', () => {
    const p = new Plaza(); p.enter({ x: -3, z: 0, face: 0 });
    p.peer(RIVAL, { x: 0, z: 0, face: 0 }); p.setHere(RIVAL, true);
    p.keys.add('KeyD'); run(p, 4); p.keys.clear();
    expect(p.gap(RIVAL)).toBeGreaterThanOrEqual(-1e-6);
    p.me.set({ x: -3, z: 0, face: 0 });
    p.approach(RIVAL);
    p.hear(RIVAL, { x: 1.5, z: 1.2, face: 0 });
    run(p, 6);
    expect(p.arrived).toBe(RIVAL);
    expect(p.gap(RIVAL)).toBeLessThan(0.3);
    expect(Math.hypot(p.peer(RIVAL).x - 1.5, p.peer(RIVAL).z - 1.2)).toBeLessThan(0.02);
  });
  it('eases others toward reported spots, snaps long jumps and forgets those who leave', () => {
    const p = new Plaza(); p.enter(PLAZA_SPAWN[0]);
    p.peer('m7', PLAZA_SPAWN[1]);
    p.hear('m7', { x: 1.6, z: 0.6, face: 0 });
    run(p, 2);
    expect(Math.hypot(p.peer('m7').x - 1.6, p.peer('m7').z - 0.6)).toBeLessThan(0.02);
    p.hear('m7', { x: -4, z: -2, face: 1 });
    expect(p.peer('m7').x).toBe(-4);
    p.hear('m9', { x: 0, z: 0, face: 0 });
    expect(p.peers.has('m9')).toBe(false); // spots for strangers are ignored until they are on the list
    p.approach('m7'); p.drop('m7');
    expect(p.peers.size).toBe(0);
    run(p, 1);
    expect(p.arrived).toBeNull();
  });
  it('turns before it sets off instead of snapping round', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 0, face: 0 });
    p.keys.add('KeyW'); // straight behind it
    p.update(1 / 60);
    expect(Math.abs(p.me.face)).toBeLessThan(0.3);
    expect(p.me.speed).toBeLessThan(0.05);
    run(p, 1);
    expect(Math.abs(p.me.face)).toBeGreaterThan(Math.PI - 0.05);
  });
  it('replays a peer at an even pace a fraction of a second behind its reports', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 5, face: 0 });
    p.peer('m1', { x: -4, z: 0, face: Math.PI / 2 }); p.setHere('m1', true);
    // Reports ten times a second, walking +x at 1.2 units per second.
    const paces: number[] = [];
    let x = -4;
    for (let f = 0; f < 240; f++) {
      if (f % 6 === 0) { x += 0.12; p.hear('m1', { x, z: 0, face: Math.PI / 2 }); }
      p.update(1 / 60);
      if (f > 60 && f < 230) paces.push(p.peer('m1').speed);
    }
    const avg = paces.reduce((a, b) => a + b, 0) / paces.length;
    expect(avg).toBeGreaterThan(1.0); expect(avg).toBeLessThan(1.4);
    expect(Math.min(...paces)).toBeGreaterThan(0.7); // no stop-and-go between reports
    expect(p.peer('m1').x).toBeLessThan(x); // drawn behind the newest report
    expect(x - p.peer('m1').x).toBeLessThan(0.45);
  });
  it('keeps a peer moving evenly when its reports come slower than usual', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 5, face: 0 });
    p.peer('m1', { x: -4, z: 0, face: Math.PI / 2 }); p.setHere('m1', true);
    const paces: number[] = [];
    let x = -4;
    for (let f = 0; f < 480; f++) {
      if (f % 15 === 0) { x += 0.3; p.hear('m1', { x, z: 0, face: Math.PI / 2 }); } // four a second, 1.2 units per second
      p.update(1 / 60);
      if (f > 240 && f < 470) paces.push(p.peer('m1').speed);
    }
    expect(Math.min(...paces)).toBeGreaterThan(0.8);
    expect(Math.max(...paces)).toBeLessThan(1.6);
  });
  it('stops on the spot for a gesture and keeps a turn going', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 0, face: 0 });
    p.walkTo(0, 4); run(p, 0.6);
    expect(p.me.speed).toBeGreaterThan(0.3);
    p.me.faceTo(p.me.x + 3, p.me.z); p.halt();
    expect(p.me.speed).toBe(0);
    const at = p.spot();
    run(p, 1);
    expect(p.spot().x).toBeCloseTo(at.x, 6); expect(p.spot().z).toBeCloseTo(at.z, 6);
    expect(p.me.face).toBeCloseTo(Math.PI / 2, 1);
    expect(p.target).toBeNull();
  });
  it('walks around an obstacle instead of through it', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 0, face: Math.PI });
    p.bounds = withObstacles(platform, [{ x: 0, z: -2, r: 0.3 }]);
    p.walkTo(0, -4);
    let closest = Infinity;
    for (let t = 0; t < 8; t += 1 / 60) { p.update(1 / 60); closest = Math.min(closest, Math.hypot(p.me.x, p.me.z + 2)); }
    expect(closest).toBeGreaterThanOrEqual(0.3 + p.me.radius - 1e-6);
  });
  it('finds who is within reach', () => {
    const p = new Plaza(); p.enter({ x: 0, z: 0, face: 0 });
    p.peer('m1', { x: 0.9, z: 0, face: 0 }); p.peer('m2', { x: 0, z: 3, face: 0 }); p.peer('m3', { x: -0.75, z: 0, face: 0 });
    for (const id of ['m1', 'm2', 'm3']) p.setHere(id, true);
    expect(p.nearest(REACH)).toBe('m3');
    p.setHere('m3', false);
    expect(p.nearest(REACH)).toBe('m1');
    expect(p.nearest(REACH, p.peer('m2'))).toBeNull();
  });
});

describe('main plaza protocol', () => {
  it('parses plaza and spectator messages from clients', () => {
    expect(parseClientMessage({ type: 'hub', on: true, name: ' Ana\u202e ', avatar: 'greninja', at: { x: 20, z: 0, face: 0 } }))
      .toEqual({ type: 'hub', on: true, name: 'Ana', avatar: 'greninja', at: { x: HUB_R, z: 0, face: 0 } });
    expect(parseClientMessage({ type: 'hub', on: false })).toEqual({ type: 'hub', on: false, name: 'Trainer', avatar: null, at: null });
    expect(parseClientMessage({ type: 'hubMove', x: 1, z: 2, face: 0 })).toEqual({ type: 'hubMove', x: 1, z: 2, face: 0 });
    expect(parseClientMessage({ type: 'hubChat', text: ' \u0000 ' })).toBeNull();
    expect(parseClientMessage({ type: 'hubEmote', emote: 'bow' })).toEqual({ type: 'hubEmote', emote: 'bow' });
    expect(parseClientMessage({ type: 'watch', code: 'ABC123' })).toEqual({ type: 'watch', code: 'ABC123' });
    expect(parseClientMessage({ type: 'watch', code: '../x' })).toBeNull();
    expect(parseClientMessage({ type: 'unwatch' })).toEqual({ type: 'unwatch' });
  });
  it('checks plaza updates, live battles and the watched room arriving at a client', () => {
    const member = { id: 'm3', name: 'Beto', avatar: 'lugia', x: 1, z: 2, face: 0 };
    const line = { id: 1, from: 'm3', name: 'Beto', text: 'hi' };
    expect(parseServerMessage({ type: 'hub', you: 'm3', members: [member, { id: 'x', name: 'bad', x: 0, z: 0, face: 0 }], chat: [line, { ...line, id: 2, text: '\u0000' }] }))
      .toEqual({ type: 'hub', you: 'm3', members: [{ ...member, pose: null }], chat: [line] });
    // v9: a held pose survives parsing, anything else reads as standing
    expect(parseServerMessage({ type: 'hub', you: 'm3', members: [{ ...member, pose: 'nap' }, { ...member, id: 'm4', pose: 'dance' }], chat: [] }))
      .toEqual({ type: 'hub', you: 'm3', members: [{ ...member, pose: 'nap' }, { ...member, id: 'm4', pose: null }], chat: [] });
    expect(parseServerMessage({ type: 'hubMove', id: 'm3', x: 99, z: 0, face: 0 })).toEqual({ type: 'hubMove', id: 'm3', x: HUB_R, z: 0, face: 0 });
    expect(parseServerMessage({ type: 'hubLeave', id: 'rival' })).toBeNull();
    expect(parseServerMessage({ type: 'watching', code: null })).toEqual({ type: 'watching', code: null });
    const live = { code: 'ABC123', names: ['A', 'B'], avatars: ['lugia', 'nope'], bestOf: 5, wins: [1, -2], turn: 7, watchers: 2 };
    expect(parseServerMessage({ type: 'lobbies', lobbies: [], now: 5, live: [live, { code: 'bad code' }] }))
      .toEqual({ type: 'lobbies', lobbies: [], now: 5, live: [{ ...live, avatars: ['lugia', null], wins: [1, 0] }] });
    const v5 = parseServerMessage({ type: 'lobbies', lobbies: [], now: 5 });
    expect(v5?.type === 'lobbies' && v5.live).toEqual([]);
    const room = publicView(seated(), [true, true], 6, null, 2) as unknown as Record<string, unknown>;
    const st = parseServerMessage({ type: 'state', room });
    expect(st?.type === 'state' && st.room.watchers).toBe(2);
    const old = { ...room }; delete old.watchers;
    const v4 = parseServerMessage({ type: 'state', room: old });
    expect(v4?.type === 'state' && v4.room.watchers).toBe(0);
  });
});
