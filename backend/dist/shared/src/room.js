import { coinWinner, generateTeams, winsNeeded } from './rules.js';
export const normalizeBestOf = (v) => (Number(v) === 5 ? 5 : 3);
export function createRoom(code, host, bestOf, mode = 'showdown') {
    return {
        code, players: [host, null], bestOf, phase: 'calls', calls: [null, null], result: null, tossWinner: null,
        candidates: null, teams: [[], []], wins: [0, 0], games: 0, history: [], mode, battle: null,
    };
}
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const clearRound = (s) => {
    s.phase = 'calls';
    s.calls = [null, null];
    s.result = null;
    s.tossWinner = null;
    s.candidates = null;
    s.teams = [[], []];
    s.battle = null;
};
const recordWin = (s, w, turns) => {
    s.games++;
    s.wins[w]++;
    s.history.push({ game: s.games, winner: w, teams: [s.teams[0].slice(), s.teams[1].slice()], toss: s.result, ...(turns !== undefined ? { turns } : {}) });
    s.phase = s.wins[w] >= winsNeeded(s.bestOf) ? 'complete' : 'between';
    s.battle = null;
};
/**
 * The authoritative game rules. Both the WebSocket backend and the PeerJS host call this, so the two
 * transports can no longer drift apart. Returns a new state; the input is never mutated.
 */
export function reduce(room, seat, action, rng) {
    const s = clone(room);
    // Rooms persisted by v2 hosts have no mode/battle fields.
    s.mode ??= 'showdown';
    s.battle ??= null;
    const fail = (error) => ({ ok: false, error });
    switch (action.type) {
        case 'avatar': {
            const p = s.players[seat];
            if (!p)
                return fail('Not seated');
            p.avatar = action.avatar;
            return { ok: true, room: s };
        }
        case 'call': {
            if (s.phase !== 'calls')
                return fail('Calls are closed');
            if (s.calls[1 - seat] === action.side)
                return fail('Calls must be opposite');
            s.calls[seat] = action.side;
            return { ok: true, room: s };
        }
        case 'flip': {
            if (s.phase !== 'calls')
                return fail('Not time to flip');
            if (!s.players[1])
                return fail('Waiting for an opponent');
            if (!s.calls[0] || !s.calls[1])
                return fail('Both players must call');
            s.result = rng.coin();
            s.tossWinner = coinWinner(s.calls, s.result);
            if (s.tossWinner === null)
                return fail('Calls must be opposite');
            s.phase = 'spin';
            return { ok: true, room: s };
        }
        case 'spin': {
            if (s.phase !== 'spin')
                return fail('Not time to deal');
            s.candidates = generateTeams(() => rng.float());
            s.phase = 'pick';
            return { ok: true, room: s };
        }
        case 'pick': {
            if (s.phase !== 'pick' || !s.candidates)
                return fail('Not time to pick');
            if (seat !== s.tossWinner)
                return fail('Only the toss winner picks');
            const t = action.team;
            s.teams[seat] = s.candidates[t].slice();
            s.teams[1 - seat] = s.candidates[1 - t].slice();
            s.phase = 'battle';
            s.battle = s.mode === 'app' ? { id: s.games + 1, status: 'preview', turn: 0 } : null;
            return { ok: true, room: s };
        }
        case 'result': {
            if (s.phase !== 'battle' || s.teams[0].length !== 6)
                return fail('No battle in progress');
            if (s.mode === 'app')
                return fail('This battle is decided in the arena');
            recordWin(s, action.winner);
            return { ok: true, room: s };
        }
        case 'battleStatus': {
            if (s.phase !== 'battle' || !s.battle)
                return fail('No battle in progress');
            s.battle = { ...s.battle, status: action.status, turn: action.turn };
            return { ok: true, room: s };
        }
        case 'battleEnd': {
            if (s.phase !== 'battle')
                return fail('No battle in progress');
            if (action.winner === null) {
                clearRound(s);
                return { ok: true, room: s };
            } // draw: replay the game from a new toss
            recordWin(s, action.winner, action.turns);
            return { ok: true, room: s };
        }
        case 'mode': {
            if (s.phase === 'battle' || s.phase === 'pick')
                return fail('Finish this game first');
            s.mode = action.mode;
            return { ok: true, room: s };
        }
        case 'next': {
            if (s.phase !== 'between')
                return fail('Not between games');
            clearRound(s);
            return { ok: true, room: s };
        }
        case 'reset': {
            clearRound(s);
            s.wins = [0, 0];
            s.games = 0;
            s.history = [];
            s.bestOf = action.bestOf;
            return { ok: true, room: s };
        }
    }
}
/** Seat a joining player. Returns the seat or an error; the caller owns token generation. */
export function seatGuest(room, guest) {
    if (room.players[1])
        return { ok: false, error: 'Room is full' };
    const s = clone(room);
    s.players[1] = guest;
    return { ok: true, room: s, seat: 1 };
}
export function seatForToken(room, token) {
    if (typeof token !== 'string' || !token)
        return null;
    const i = room.players.findIndex(p => p !== null && p.token === token);
    return i === 0 || i === 1 ? i : null;
}
/** Strip bearer tokens before anything leaves the authority. (v1 broadcast every player's token.) */
export function publicView(room, connected, protocol) {
    const players = room.players.map((p, i) => (p ? { name: p.name, avatar: p.avatar, connected: connected[i] } : null));
    return { ...clone(room), players, protocol };
}
