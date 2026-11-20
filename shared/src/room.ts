import type { Pokemon } from './pool.js';
import type { CharacterId } from './characters.js';
import { coinWinner, generateTeams, winsNeeded, type CoinSide } from './rules.js';

export type Phase = 'calls' | 'spin' | 'pick' | 'battle' | 'between' | 'complete';
export type Seat = 0 | 1;
export type Pair<T> = [T, T];

/** Server-side seat record. `token` is a bearer secret and must never be broadcast. */
export type SeatRecord = { name: string; token: string; avatar: CharacterId | null };

export type RoundRecord = { game: number; winner: Seat; teams: Pair<Pokemon[]>; toss: CoinSide | null };

export type RoomState = {
  code: string;
  players: Pair<SeatRecord | null>;
  bestOf: 3 | 5;
  phase: Phase;
  calls: Pair<CoinSide | null>;
  result: CoinSide | null;
  tossWinner: Seat | null;
  candidates: Pair<Pokemon[]> | null;
  teams: Pair<Pokemon[]>;
  wins: Pair<number>;
  games: number;
  history: RoundRecord[];
};

/** What clients receive. Same field names as protocol v1 so older clients keep working. */
export type PublicPlayer = { name: string; avatar: CharacterId | null; connected: boolean };
export type PublicRoom = Omit<RoomState, 'players'> & { players: Pair<PublicPlayer | null>; protocol: number };

export type GameAction =
  | { type: 'call'; side: CoinSide }
  | { type: 'flip' }
  | { type: 'spin' }
  | { type: 'pick'; team: 0 | 1 }
  | { type: 'result'; winner: Seat }
  | { type: 'next' }
  | { type: 'reset'; bestOf: 3 | 5 }
  | { type: 'avatar'; avatar: CharacterId };

/** Randomness is injected so the reducer stays pure and testable. Hosts pass crypto-backed sources. */
export type Rng = { coin(): CoinSide; float(): number };

export type ReduceResult = { ok: true; room: RoomState } | { ok: false; error: string };

export const normalizeBestOf = (v: unknown): 3 | 5 => (Number(v) === 5 ? 5 : 3);

export function createRoom(code: string, host: SeatRecord, bestOf: 3 | 5): RoomState {
  return {
    code, players: [host, null], bestOf, phase: 'calls', calls: [null, null], result: null, tossWinner: null,
    candidates: null, teams: [[], []], wins: [0, 0], games: 0, history: [],
  };
}

const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)) as T);

const clearRound = (s: RoomState) => {
  s.phase = 'calls'; s.calls = [null, null]; s.result = null; s.tossWinner = null; s.candidates = null; s.teams = [[], []];
};

/**
 * The authoritative game rules. Both the WebSocket backend and the PeerJS host call this, so the two
 * transports can no longer drift apart. Returns a new state; the input is never mutated.
 */
export function reduce(room: RoomState, seat: Seat, action: GameAction, rng: Rng): ReduceResult {
  const s = clone(room);
  const fail = (error: string): ReduceResult => ({ ok: false, error });
  switch (action.type) {
    case 'avatar': {
      const p = s.players[seat];
      if (!p) return fail('Not seated');
      p.avatar = action.avatar;
      return { ok: true, room: s };
    }
    case 'call': {
      if (s.phase !== 'calls') return fail('Calls are closed');
      if (s.calls[1 - seat] === action.side) return fail('Calls must be opposite');
      s.calls[seat] = action.side;
      return { ok: true, room: s };
    }
    case 'flip': {
      if (s.phase !== 'calls') return fail('Not time to flip');
      if (!s.players[1]) return fail('Waiting for an opponent');
      if (!s.calls[0] || !s.calls[1]) return fail('Both players must call');
      s.result = rng.coin();
      s.tossWinner = coinWinner(s.calls, s.result) as Seat | null;
      if (s.tossWinner === null) return fail('Calls must be opposite');
      s.phase = 'spin';
      return { ok: true, room: s };
    }
    case 'spin': {
      if (s.phase !== 'spin') return fail('Not time to deal');
      s.candidates = generateTeams(() => rng.float());
      s.phase = 'pick';
      return { ok: true, room: s };
    }
    case 'pick': {
      if (s.phase !== 'pick' || !s.candidates) return fail('Not time to pick');
      if (seat !== s.tossWinner) return fail('Only the toss winner picks');
      const t = action.team;
      s.teams[seat] = s.candidates[t].slice();
      s.teams[1 - seat] = s.candidates[1 - t].slice();
      s.phase = 'battle';
      return { ok: true, room: s };
    }
    case 'result': {
      if (s.phase !== 'battle' || s.teams[0].length !== 6) return fail('No battle in progress');
      const w = action.winner;
      s.games++; s.wins[w]++;
      s.history.push({ game: s.games, winner: w, teams: [s.teams[0].slice(), s.teams[1].slice()], toss: s.result });
      s.phase = s.wins[w] >= winsNeeded(s.bestOf) ? 'complete' : 'between';
      return { ok: true, room: s };
    }
    case 'next': {
      if (s.phase !== 'between') return fail('Not between games');
      clearRound(s);
      return { ok: true, room: s };
    }
    case 'reset': {
      clearRound(s);
      s.wins = [0, 0]; s.games = 0; s.history = []; s.bestOf = action.bestOf;
      return { ok: true, room: s };
    }
  }
}

/** Seat a joining player. Returns the seat or an error; the caller owns token generation. */
export function seatGuest(room: RoomState, guest: SeatRecord): { ok: true; room: RoomState; seat: Seat } | { ok: false; error: string } {
  if (room.players[1]) return { ok: false, error: 'Room is full' };
  const s = clone(room);
  s.players[1] = guest;
  return { ok: true, room: s, seat: 1 };
}

export function seatForToken(room: RoomState, token: unknown): Seat | null {
  if (typeof token !== 'string' || !token) return null;
  const i = room.players.findIndex(p => p !== null && p.token === token);
  return i === 0 || i === 1 ? i : null;
}

/** Strip bearer tokens before anything leaves the authority. (v1 broadcast every player's token.) */
export function publicView(room: RoomState, connected: Pair<boolean>, protocol: number): PublicRoom {
  const players = room.players.map((p, i) => (p ? { name: p.name, avatar: p.avatar, connected: connected[i] } : null)) as Pair<PublicPlayer | null>;
  return { ...clone(room), players, protocol };
}
