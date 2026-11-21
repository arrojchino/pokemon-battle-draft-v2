import { describe, it, expect } from 'vitest';
import { createRoom, reduce, seatGuest, seatForToken, publicView, type RoomState, type Rng, type GameAction, type ServerAction, type Seat } from '../../shared/src/room.js';

const rng = (side: 'heads' | 'tails' = 'heads'): Rng => { let x = 0.123; return { coin: () => side, float: () => (x = (x * 9301 + 49297) % 233280 / 233280) }; };
const host = { name: 'Ana', token: 'tok-a', avatar: 'rust' as const };
const guest = { name: 'Beto', token: 'tok-b', avatar: null };

function seated(): RoomState {
  const r = seatGuest(createRoom('ABC123', host, 3), guest);
  if (!r.ok) throw new Error(r.error);
  return r.room;
}
function apply(room: RoomState, seat: Seat, action: GameAction | ServerAction, side: 'heads' | 'tails' = 'heads'): RoomState {
  const r = reduce(room, seat, action, rng(side));
  if (!r.ok) throw new Error(r.error);
  return r.room;
}
const rejects = (room: RoomState, seat: Seat, action: GameAction) => { const r = reduce(room, seat, action, rng()); expect(r.ok).toBe(false); return r.ok ? '' : r.error; };

describe('room reducer', () => {
  it('runs a full game and records history', () => {
    let s = seated();
    s = apply(s, 0, { type: 'call', side: 'heads' });
    s = apply(s, 1, { type: 'call', side: 'tails' });
    s = apply(s, 1, { type: 'flip' }, 'tails');
    expect(s.phase).toBe('spin'); expect(s.result).toBe('tails'); expect(s.tossWinner).toBe(1);
    s = apply(s, 0, { type: 'spin' });
    expect(s.phase).toBe('pick'); expect(s.candidates![0]).toHaveLength(6);
    const chosen = s.candidates![1].map(p => p.name);
    s = apply(s, 1, { type: 'pick', team: 1 });
    expect(s.teams[1].map(p => p.name)).toEqual(chosen);
    expect(s.phase).toBe('battle');
    s = apply(s, 0, { type: 'result', winner: 1 });
    expect(s.wins).toEqual([0, 1]); expect(s.phase).toBe('between');
    expect(s.history[0]).toEqual({ game: 1, winner: 1, teams: s.history[0].teams, toss: 'tails' });
    s = apply(s, 0, { type: 'next' });
    expect(s.phase).toBe('calls'); expect(s.teams).toEqual([[], []]); expect(s.calls).toEqual([null, null]);
  });

  it('rejects illegal transitions', () => {
    const s = seated();
    expect(rejects(s, 0, { type: 'flip' })).toBe('Both players must call');
    expect(rejects(s, 0, { type: 'spin' })).toBe('Not time to deal');
    expect(rejects(s, 0, { type: 'pick', team: 0 })).toBe('Not time to pick');
    expect(rejects(s, 0, { type: 'result', winner: 0 })).toBe('No battle in progress');
    expect(rejects(s, 0, { type: 'next' })).toBe('Not between games');
    const called = apply(s, 0, { type: 'call', side: 'heads' });
    expect(rejects(called, 1, { type: 'call', side: 'heads' })).toBe('Calls must be opposite');
  });

  it('needs an opponent before flipping', () => {
    let s = createRoom('ABC123', host, 3);
    s = apply(s, 0, { type: 'call', side: 'heads' });
    expect(rejects(s, 0, { type: 'flip' })).toBe('Waiting for an opponent');
  });

  it('only lets the toss winner pick', () => {
    let s = seated();
    s = apply(s, 0, { type: 'call', side: 'heads' }); s = apply(s, 1, { type: 'call', side: 'tails' });
    s = apply(s, 0, { type: 'flip' }, 'heads'); s = apply(s, 0, { type: 'spin' });
    expect(rejects(s, 1, { type: 'pick', team: 0 })).toBe('Only the toss winner picks');
  });

  it('completes a best-of-5 at three wins and resets', () => {
    let s = apply(seated(), 0, { type: 'reset', bestOf: 5 });
    for (let g = 0; g < 3; g++) {
      s = apply(s, 0, { type: 'call', side: 'heads' }); s = apply(s, 1, { type: 'call', side: 'tails' });
      s = apply(s, 0, { type: 'flip' }); s = apply(s, 0, { type: 'spin' }); s = apply(s, 0, { type: 'pick', team: 0 });
      s = apply(s, 1, { type: 'result', winner: 0 });
      if (g < 2) { expect(s.phase).toBe('between'); s = apply(s, 0, { type: 'next' }); }
    }
    expect(s.phase).toBe('complete'); expect(s.wins).toEqual([3, 0]); expect(s.history).toHaveLength(3);
    s = apply(s, 1, { type: 'reset', bestOf: 3 });
    expect(s.bestOf).toBe(3); expect(s.games).toBe(0); expect(s.history).toHaveLength(0);
  });

  it('never mutates its input', () => {
    const s = seated();
    const before = JSON.stringify(s);
    apply(s, 0, { type: 'call', side: 'heads' });
    apply(s, 0, { type: 'avatar', avatar: 'toxic' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('seats one guest only and resolves tokens', () => {
    const s = seated();
    const again = seatGuest(s, { name: 'Eve', token: 'x', avatar: null });
    expect(again.ok).toBe(false);
    expect(seatForToken(s, 'tok-a')).toBe(0);
    expect(seatForToken(s, 'tok-b')).toBe(1);
    expect(seatForToken(s, 'nope')).toBeNull();
    expect(seatForToken(s, '')).toBeNull();
  });

  it('strips tokens from the public view and adds presence', () => {
    const v = publicView(seated(), [true, false], 2);
    const text = JSON.stringify(v);
    expect(text.includes('tok-a') || text.includes('tok-b')).toBe(false);
    expect(v.players[0]).toEqual({ name: 'Ana', avatar: 'rust', connected: true });
    expect(v.players[1]!.connected).toBe(false);
    expect(v.protocol).toBe(2);
  });

  it('runs in-app battles: server decides results, draws replay the game', () => {
    let s = seatGuest(createRoom('ABC123', host, 3, 'app'), guest);
    if (!s.ok) throw new Error(s.error);
    let r = s.room;
    r = apply(r, 0, { type: 'call', side: 'heads' }); r = apply(r, 1, { type: 'call', side: 'tails' });
    r = apply(r, 0, { type: 'flip' }); r = apply(r, 0, { type: 'spin' }); r = apply(r, 0, { type: 'pick', team: 0 });
    expect(r.battle).toEqual({ id: 1, status: 'preview', turn: 0 });
    expect(rejects(r, 0, { type: 'result', winner: 0 })).toBe('This battle is decided in the arena');
    expect(rejects(r, 0, { type: 'mode', mode: 'showdown' })).toBe('Finish this game first');
    r = apply(r, 0, { type: 'battleStatus', status: 'active', turn: 7 });
    expect(r.battle!.turn).toBe(7);
    const draw = apply(r, 0, { type: 'battleEnd', winner: null, turns: 7 });
    expect(draw.phase).toBe('calls'); expect(draw.games).toBe(0); expect(draw.battle).toBeNull();
    r = apply(r, 0, { type: 'battleEnd', winner: 1, turns: 12 });
    expect(r.phase).toBe('between'); expect(r.wins).toEqual([0, 1]); expect(r.history[0].turns).toBe(12); expect(r.battle).toBeNull();
    r = apply(r, 0, { type: 'mode', mode: 'showdown' });
    expect(r.mode).toBe('showdown');
  });
});

