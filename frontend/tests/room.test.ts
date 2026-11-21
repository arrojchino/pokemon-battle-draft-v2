import { describe, it, expect } from 'vitest';
import { createRoom, reduce, seatGuest, seatForToken, publicView, type RoomState, type Rng, type GameAction, type ServerAction, type Seat } from '../../shared/src/room.js';

const rng = (side: 'heads' | 'tails' = 'heads'): Rng => { let x = 0.123; return { coin: () => side, float: () => (x = (x * 9301 + 49297) % 233280 / 233280) }; };
const fixed = (float: number): Rng => ({ coin: () => 'heads', float: () => float });
const host = { name: 'Ana', token: 'tok-a', avatar: 'rust' as const };
const guest = { name: 'Beto', token: 'tok-b', avatar: null };

/** Seated room; `caller` overrides the random first caller so each test reads deterministically. */
function seated(caller: Seat = 0, mode: 'showdown' | 'app' = 'showdown'): RoomState {
  const r = seatGuest(createRoom('ABC123', host, 3, mode), guest, rng());
  if (!r.ok) throw new Error(r.error);
  return { ...r.room, caller };
}
function apply(room: RoomState, seat: Seat, action: GameAction | ServerAction, side: 'heads' | 'tails' = 'heads'): RoomState {
  const r = reduce(room, seat, action, rng(side));
  if (!r.ok) throw new Error(r.error);
  return r.room;
}
const rejects = (room: RoomState, seat: Seat, action: GameAction) => { const r = reduce(room, seat, action, rng()); expect(r.ok).toBe(false); return r.ok ? '' : r.error; };
/** One coin call by whoever holds it, then the deal and the pick of team A. */
const playToBattle = (s: RoomState) => {
  s = apply(s, s.caller!, { type: 'call', side: 'heads' });
  s = apply(s, 0, { type: 'spin' });
  return apply(s, s.tossWinner!, { type: 'pick', team: 0 });
};

describe('room reducer', () => {
  it('draws the first caller at random when the rival sits down', () => {
    const open = createRoom('ABC123', host, 3);
    expect(open.caller).toBeNull();
    const low = seatGuest(open, guest, fixed(0.2)), high = seatGuest(open, guest, fixed(0.8));
    expect(low.ok && low.room.caller).toBe(0);
    expect(high.ok && high.room.caller).toBe(1);
  });

  it('runs a full game: one call flips the coin, the winner of the game calls next', () => {
    let s = seated(1);
    s = apply(s, 1, { type: 'call', side: 'heads' }, 'tails');
    expect(s.phase).toBe('spin'); expect(s.calls).toEqual(['tails', 'heads']); expect(s.result).toBe('tails'); expect(s.tossWinner).toBe(0);
    s = apply(s, 1, { type: 'spin' });
    expect(s.phase).toBe('pick'); expect(s.candidates![0]).toHaveLength(6);
    const chosen = s.candidates![1].map(p => p.name);
    s = apply(s, 0, { type: 'pick', team: 1 });
    expect(s.teams[0].map(p => p.name)).toEqual(chosen);
    expect(s.phase).toBe('battle'); expect(s.candidates).toBeNull();
    s = apply(s, 0, { type: 'result', winner: 1 });
    expect(s.wins).toEqual([0, 1]); expect(s.phase).toBe('between');
    expect(s.history[0]).toEqual({ game: 1, winner: 1, teams: s.history[0].teams, toss: 'tails' });
    s = apply(s, 0, { type: 'next' });
    expect(s.phase).toBe('calls'); expect(s.teams).toEqual([[], []]); expect(s.calls).toEqual([null, null]);
    expect(s.caller).toBe(1);
  });

  it('rejects illegal transitions', () => {
    const s = seated(0);
    expect(rejects(s, 1, { type: 'call', side: 'heads' })).toBe('Ana calls this coin');
    expect(rejects(s, 0, { type: 'flip' })).toBe('The coin flips as soon as it is called');
    expect(rejects(s, 0, { type: 'spin' })).toBe('Not time to deal');
    expect(rejects(s, 0, { type: 'pick', team: 0 })).toBe('Not time to pick');
    expect(rejects(s, 0, { type: 'result', winner: 0 })).toBe('No battle in progress');
    expect(rejects(s, 0, { type: 'next' })).toBe('Not between games');
    const called = apply(s, 0, { type: 'call', side: 'heads' });
    expect(rejects(called, 0, { type: 'call', side: 'tails' })).toBe('The coin has already been called');
  });

  it('needs an opponent before the coin can be called', () => {
    expect(rejects(createRoom('ABC123', host, 3), 0, { type: 'call', side: 'heads' })).toBe('Waiting for an opponent');
  });

  it('only lets the toss winner pick, and dealing twice is harmless', () => {
    let s = apply(seated(0), 0, { type: 'call', side: 'heads' }, 'heads');
    s = apply(s, 0, { type: 'spin' });
    expect(s.tossWinner).toBe(0);
    expect(rejects(s, 1, { type: 'pick', team: 0 })).toBe('Only the toss winner picks');
    expect(apply(s, 1, { type: 'spin' }).candidates).toEqual(s.candidates);
  });

  it('completes a best-of-5 at three wins and resets with a random caller', () => {
    let s = apply(seated(0), 0, { type: 'reset', bestOf: 5 });
    expect([0, 1]).toContain(s.caller);
    for (let g = 0; g < 3; g++) {
      s = playToBattle(s);
      s = apply(s, 1, { type: 'result', winner: 0 });
      if (g < 2) { expect(s.phase).toBe('between'); s = apply(s, 0, { type: 'next' }); expect(s.caller).toBe(0); }
    }
    expect(s.phase).toBe('complete'); expect(s.wins).toEqual([3, 0]); expect(s.history).toHaveLength(3);
    s = apply(s, 1, { type: 'reset', bestOf: 3 });
    expect(s.bestOf).toBe(3); expect(s.games).toBe(0); expect(s.history).toHaveLength(0); expect([0, 1]).toContain(s.caller);
  });

  it('never mutates its input', () => {
    const s = seated(0);
    const before = JSON.stringify(s);
    apply(s, 0, { type: 'call', side: 'heads' });
    apply(s, 0, { type: 'avatar', avatar: 'toxic' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('seats one guest only and resolves tokens', () => {
    const s = seated();
    const again = seatGuest(s, { name: 'Eve', token: 'x', avatar: null }, rng());
    expect(again.ok).toBe(false);
    expect(seatForToken(s, 'tok-a')).toBe(0);
    expect(seatForToken(s, 'tok-b')).toBe(1);
    expect(seatForToken(s, 'nope')).toBeNull();
    expect(seatForToken(s, '')).toBeNull();
  });

  it('strips tokens from the public view and adds presence', () => {
    const v = publicView(seated(), [true, false], 2, 0);
    const text = JSON.stringify(v);
    expect(text.includes('tok-a') || text.includes('tok-b')).toBe(false);
    expect(v.players[0]).toEqual({ name: 'Ana', avatar: 'rust', connected: true });
    expect(v.players[1]!.connected).toBe(false);
    expect(v.protocol).toBe(2);
  });

  it('shows the dealt teams only to the picker and hides the rival sets until the game ends', () => {
    let s = apply(seated(0), 0, { type: 'call', side: 'heads' }, 'heads');
    s = apply(s, 0, { type: 'spin' });
    expect(publicView(s, [true, true], 4, 0).candidates).toHaveLength(2);
    expect(publicView(s, [true, true], 4, 1).candidates).toBeNull();
    s = apply(s, 0, { type: 'pick', team: 1 });
    const mine = publicView(s, [true, true], 4, 0), theirs = publicView(s, [true, true], 4, 1);
    expect(mine.teams[0]).toHaveLength(6); expect(mine.teams[1]).toEqual([]);
    expect(theirs.teams[1]).toHaveLength(6); expect(theirs.teams[0]).toEqual([]);
    expect(theirs.rival!.map(p => p.name)).toEqual(s.teams[0].map(p => p.name));
    expect(theirs.rival!.every(p => !('moves' in p) && !('item' in p) && !('ability' in p) && !('tera' in p))).toBe(true);
    s = apply(s, 1, { type: 'result', winner: 1 });
    const after = publicView(s, [true, true], 4, 1);
    expect(after.teams[0]).toHaveLength(6); expect(after.rival).toBeNull(); expect(after.history[0].teams[0]).toHaveLength(6);
  });

  it('runs in-app battles: server decides results, draws replay the game', () => {
    let r = playToBattle(seated(1, 'app'));
    expect(r.battle).toEqual({ id: 1, status: 'preview', turn: 0 });
    expect(rejects(r, 0, { type: 'result', winner: 0 })).toBe('This battle is decided in the arena');
    expect(rejects(r, 0, { type: 'mode', mode: 'showdown' })).toBe('Finish this game first');
    r = apply(r, 0, { type: 'battleStatus', status: 'active', turn: 7 });
    expect(r.battle!.turn).toBe(7);
    const draw = apply(r, 0, { type: 'battleEnd', winner: null, turns: 7 });
    expect(draw.phase).toBe('calls'); expect(draw.games).toBe(0); expect(draw.battle).toBeNull(); expect(draw.caller).toBe(1);
    r = apply(r, 0, { type: 'battleEnd', winner: 1, turns: 12 });
    expect(r.phase).toBe('between'); expect(r.wins).toEqual([0, 1]); expect(r.history[0].turns).toBe(12); expect(r.battle).toBeNull();
    r = apply(r, 0, { type: 'mode', mode: 'showdown' });
    expect(r.mode).toBe('showdown');
  });
});
