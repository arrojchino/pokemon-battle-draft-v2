import type { Pokemon } from './pool.js';
import type { CharacterId } from './characters.js';
import { coinWinner, generateTeams, winsNeeded, type CoinSide } from './rules.js';

export type Phase = 'calls' | 'spin' | 'pick' | 'battle' | 'between' | 'complete';
export type Seat = 0 | 1;
export type Pair<T> = [T, T];

/** Server-side seat record. `token` is a bearer secret and must never be broadcast. */
export type SeatRecord = { name: string; token: string; avatar: CharacterId | null };

export type RoundRecord = { game: number; winner: Seat; teams: Pair<Pokemon[]>; toss: CoinSide | null; turns?: number };

/** 'app': battles run on the server's simulator inside this app. 'showdown': players battle on Pokémon Showdown and report the winner. */
export type BattleMode = 'app' | 'showdown';
/** 'public' rooms are listed in the dedicated server's lobby browser while they wait for a rival; 'private' rooms are invite-only. */
export type Visibility = 'public' | 'private';
export type BattleStatus = { id: number; status: 'preview' | 'active' | 'ended'; turn: number };

export type RoomState = {
  code: string;
  players: Pair<SeatRecord | null>;
  bestOf: 3 | 5;
  phase: Phase;
  /**
   * Who calls this game's coin: picked at random when the rival sits down (and for each new series),
   * then the winner of the previous game. Calling flips the coin at once.
   */
  caller: Seat | null;
  calls: Pair<CoinSide | null>;
  result: CoinSide | null;
  tossWinner: Seat | null;
  candidates: Pair<Pokemon[]> | null;
  teams: Pair<Pokemon[]>;
  wins: Pair<number>;
  games: number;
  history: RoundRecord[];
  mode: BattleMode;
  battle: BattleStatus | null;
  visibility: Visibility;
};

/** What a rival may know about a set before it is revealed in battle: species and types (Team Preview). */
export type RivalPreview = Pick<Pokemon, 'name' | 'id' | 'artId' | 'types'>;

/** What clients receive. Same field names as protocol v1 so older clients keep working. */
export type PublicPlayer = { name: string; avatar: CharacterId | null; connected: boolean };
export type PublicRoom = Omit<RoomState, 'players'> & { players: Pair<PublicPlayer | null>; protocol: number; rival: RivalPreview[] | null };

export type GameAction =
  | { type: 'call'; side: CoinSide }
  /** Retired in protocol v4 (the call flips the coin); still parsed so older clients get a clear error. */
  | { type: 'flip' }
  | { type: 'spin' }
  | { type: 'pick'; team: 0 | 1 }
  | { type: 'result'; winner: Seat }
  | { type: 'next' }
  | { type: 'reset'; bestOf: 3 | 5 }
  | { type: 'avatar'; avatar: CharacterId }
  | { type: 'mode'; mode: BattleMode };

/** Actions only the authority itself may apply (never parsed from a client message). */
export type ServerAction =
  | { type: 'battleStatus'; status: BattleStatus['status']; turn: number }
  | { type: 'battleEnd'; winner: Seat | null; turns: number };

/** Randomness is injected so the reducer stays pure and testable. Hosts pass crypto-backed sources. */
export type Rng = { coin(): CoinSide; float(): number };

export type ReduceResult = { ok: true; room: RoomState } | { ok: false; error: string };

export const normalizeBestOf = (v: unknown): 3 | 5 => (Number(v) === 5 ? 5 : 3);
const randomSeat = (rng: Rng): Seat => (rng.float() < 0.5 ? 0 : 1);

export function createRoom(code: string, host: SeatRecord, bestOf: 3 | 5, mode: BattleMode = 'showdown', visibility: Visibility = 'private'): RoomState {
  return {
    code, players: [host, null], bestOf, phase: 'calls', caller: null, calls: [null, null], result: null, tossWinner: null,
    candidates: null, teams: [[], []], wins: [0, 0], games: 0, history: [], mode, battle: null, visibility,
  };
}

const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)) as T);

const clearRound = (s: RoomState) => {
  s.phase = 'calls'; s.calls = [null, null]; s.result = null; s.tossWinner = null; s.candidates = null; s.teams = [[], []]; s.battle = null;
};

const recordWin = (s: RoomState, w: Seat, turns?: number) => {
  s.games++; s.wins[w]++;
  s.history.push({ game: s.games, winner: w, teams: [s.teams[0].slice(), s.teams[1].slice()], toss: s.result, ...(turns !== undefined ? { turns } : {}) });
  s.phase = s.wins[w] >= winsNeeded(s.bestOf) ? 'complete' : 'between';
  s.battle = null;
};

/**
 * The authoritative game rules. Both the WebSocket backend and the PeerJS host call this, so the two
 * transports can no longer drift apart. Returns a new state; the input is never mutated.
 */
export function reduce(room: RoomState, seat: Seat, action: GameAction | ServerAction, rng: Rng): ReduceResult {
  const s = clone(room);
  // Rooms persisted by older hosts lack mode/battle (v2), visibility (v3) or the caller (v3).
  s.mode ??= 'showdown'; s.battle ??= null; s.visibility ??= 'private';
  if (s.caller === undefined) s.caller = s.players[1] ? randomSeat(rng) : null;
  const fail = (error: string): ReduceResult => ({ ok: false, error });
  switch (action.type) {
    case 'avatar': {
      const p = s.players[seat];
      if (!p) return fail('Not seated');
      p.avatar = action.avatar;
      return { ok: true, room: s };
    }
    case 'call': {
      if (s.phase !== 'calls') return fail('The coin has already been called');
      if (!s.players[1] || s.caller === null) return fail('Waiting for an opponent');
      if (seat !== s.caller) return fail(`${s.players[s.caller]?.name ?? 'Your rival'} calls this coin`);
      const other: CoinSide = action.side === 'heads' ? 'tails' : 'heads';
      s.calls = seat === 0 ? [action.side, other] : [other, action.side];
      s.result = rng.coin();
      s.tossWinner = coinWinner(s.calls, s.result) as Seat;
      s.phase = 'spin';
      return { ok: true, room: s };
    }
    case 'flip': return fail('The coin flips as soon as it is called');
    case 'spin': {
      if (s.phase === 'pick') return { ok: true, room: s }; // both clients may deal after the reveal; the first one wins
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
      s.candidates = null;
      s.phase = 'battle';
      s.battle = s.mode === 'app' ? { id: s.games + 1, status: 'preview', turn: 0 } : null;
      return { ok: true, room: s };
    }
    case 'result': {
      if (s.phase !== 'battle' || s.teams[0].length !== 6) return fail('No battle in progress');
      if (s.mode === 'app') return fail('This battle is decided in the arena');
      recordWin(s, action.winner);
      return { ok: true, room: s };
    }
    case 'battleStatus': {
      if (s.phase !== 'battle' || !s.battle) return fail('No battle in progress');
      s.battle = { ...s.battle, status: action.status, turn: action.turn };
      return { ok: true, room: s };
    }
    case 'battleEnd': {
      if (s.phase !== 'battle') return fail('No battle in progress');
      if (action.winner === null) { clearRound(s); return { ok: true, room: s }; } // draw: replay the game from a new toss, same caller
      recordWin(s, action.winner, action.turns);
      return { ok: true, room: s };
    }
    case 'mode': {
      if (s.phase === 'battle' || s.phase === 'pick') return fail('Finish this game first');
      s.mode = action.mode;
      return { ok: true, room: s };
    }
    case 'next': {
      if (s.phase !== 'between') return fail('Not between games');
      clearRound(s);
      s.caller = s.history[s.history.length - 1]?.winner ?? s.caller; // the winner of the last game calls
      return { ok: true, room: s };
    }
    case 'reset': {
      clearRound(s);
      s.wins = [0, 0]; s.games = 0; s.history = []; s.bestOf = action.bestOf;
      s.caller = s.players[1] ? randomSeat(rng) : null; // a new series opens with a random caller
      return { ok: true, room: s };
    }
  }
}

/** Seat a joining player and draw the first caller at random. The caller owns token generation. */
export function seatGuest(room: RoomState, guest: SeatRecord, rng: Rng): { ok: true; room: RoomState; seat: Seat } | { ok: false; error: string } {
  if (room.players[1]) return { ok: false, error: 'Room is full' };
  const s = clone(room);
  s.players[1] = guest;
  if (s.phase === 'calls' && s.games === 0) s.caller = randomSeat(rng);
  else s.caller ??= randomSeat(rng);
  return { ok: true, room: s, seat: 1 };
}

export function seatForToken(room: RoomState, token: unknown): Seat | null {
  if (typeof token !== 'string' || !token) return null;
  const i = room.players.findIndex(p => p !== null && p.token === token);
  return i === 0 || i === 1 ? i : null;
}

/**
 * What one seat receives. Bearer tokens never leave the authority, and nothing the viewer has not earned
 * is sent: the two dealt teams go only to the toss winner while they choose, and during a game each player
 * gets their own six in full but only the rival's species and types (Team Preview). Finished games are
 * revealed in `history`.
 */
export function publicView(room: RoomState, connected: Pair<boolean>, protocol: number, viewer: Seat): PublicRoom {
  const players = room.players.map((p, i) => (p ? { name: p.name, avatar: p.avatar, connected: connected[i] } : null)) as Pair<PublicPlayer | null>;
  const view: PublicRoom = { ...clone(room), players, protocol, rival: null };
  if (room.phase === 'pick' && room.tossWinner !== viewer) view.candidates = null;
  if (room.phase === 'battle') {
    const opp = (1 - viewer) as Seat;
    view.rival = room.teams[opp].map(({ name, id, artId, types }) => ({ name, id, ...(artId === undefined ? {} : { artId }), types }));
    view.teams[opp] = [];
  }
  return view;
}
