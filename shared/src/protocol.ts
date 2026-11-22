import { isCharacterId, type CharacterId } from './characters.js';
import { cleanChat, normalizeBestOf, type BattleMode, type ChatLine, type GameAction, type PublicRoom, type RivalPreview, type Seat, type Visibility } from './room.js';

/**
 * Wire protocol.
 * v1: original casino build (players[].token was broadcast, no avatars).
 * v2: tokens stripped from broadcasts, `avatar` + `connected` on players, `hello.protocol`, typed errors.
 * v3: in-app battles. `mode` on create, `mode`/`choose`/`forfeit` messages, `room.battle`, and per-player
 *     `battle` messages carrying that player's view of the simulator stream (secret info only for its owner).
 * v4: public lobbies. `visibility` on create and on the room, `lobbies` (list open public rooms) and
 *     `quick` (join the longest-waiting public room, else open one). Clients send these only to servers
 *     whose `hello.protocol` is at least LOBBIES_SINCE.
 *     Also v4: one caller per coin (`caller`; calling flips it, `flip` is retired) and per-seat room views
 *     (the dealt teams reach only the toss winner; during a game the rival's six arrive as `rival`, species
 *     and types only).
 * v5: the plaza, a walkable waiting room. Room chat (`chat` action, `room.chat`) and presence relayed
 *     between the two seats and never stored: `move` (where a partner stands) and `emote`. Clients send
 *     these only to servers whose `hello.protocol` is at least PLAZA_SINCE.
 * v6: the main plaza and spectators. `hub` enters or leaves the plaza every connected trainer shares; inside
 *     it `hubMove`, `hubEmote` and `hubChat` reach everyone else there. `watch` follows a room without a seat
 *     (its state and the public stream of its battle); `lobbies` also lists live battles. Clients send these
 *     only to servers whose `hello.protocol` is at least HUB_SINCE.
 * v7: plaza gestures are the partner models' own clips (`happy`, `stretch`, `notice`, `nap`, `sit`, `rise`); the
 *     original emotes stay valid for older clients. Plazas are walk-only. Clients send the new gestures only to
 *     servers whose `hello.protocol` is at least GESTURES_SINCE.
 * Servers accept every older client message unchanged, and older clients can read newer state.
 */
export const PROTOCOL_VERSION = 7;
export const LOBBIES_SINCE = 4;
export const PLAZA_SINCE = 5;
export const HUB_SINCE = 6;
export const GESTURES_SINCE = 7;

/**
 * Gestures a partner can play in a plaza. The first six (v7) are the models' own clips; `rise` gets up from a nap
 * or a rest. The rest are the original emotes, still accepted from older clients.
 */
export const PLAZA_EMOTES = ['happy', 'stretch', 'notice', 'nap', 'sit', 'rise', 'greet', 'excited', 'twirl', 'bow', 'thumbs', 'punch'] as const;
export type PlazaEmote = (typeof PLAZA_EMOTES)[number];
export const isPlazaEmote = (v: unknown): v is PlazaEmote => typeof v === 'string' && (PLAZA_EMOTES as readonly string[]).includes(v);
/** Partners walk the stage platform inside this radius (stage units); the authority pulls anything further back to it. */
export const PLAZA_R = 9;
/** A partner's spot in the plaza: floor position and facing (radians; 0 faces the camera side of the field). */
export type Spot = { x: number; z: number; face: number };
const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** Keep a spot on the platform, facing wrapped to -pi..pi, rounded to keep messages small. */
export function cleanSpot(x: number, z: number, face: number): Spot {
  const r = Math.hypot(x, z);
  const k = r > PLAZA_R ? PLAZA_R / r : 1;
  return { x: round3(x * k), z: round3(z * k), face: round3(Math.atan2(Math.sin(face), Math.cos(face))) };
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The main plaza holds at most this many trainers at once. */
export const MAX_HUB = 20;
/** Someone in the main plaza: a server-issued id, their name and partner, and where the partner stands. */
export type HubMember = { id: string; name: string; avatar: CharacterId | null } & Spot;
/** A line said in the main plaza. The speaker's name travels with it, so it still reads right after they leave. */
export type HubLine = { id: number; from: string; name: string; text: string };
/** An in-app battle in a public room, listed for spectators. */
export type LiveBattle = {
  code: string; names: [string, string]; avatars: [CharacterId | null, CharacterId | null];
  bestOf: 3 | 5; wins: [number, number]; turn: number; watchers: number;
};
const HUB_ID = /^m\d{1,9}$/;
export const isHubId = (v: unknown): v is string => typeof v === 'string' && HUB_ID.test(v);

/** A public room waiting for a rival, as listed by the server. `createdAt` is on the server clock (compare with `now`). */
export type LobbySummary = { code: string; host: string; avatar: CharacterId | null; bestOf: 3 | 5; mode: BattleMode; createdAt: number; players: number };

export type ClientMessage =
  | { type: 'create'; name: string; bestOf: 3 | 5; avatar: CharacterId | null; mode: BattleMode; visibility: Visibility }
  | { type: 'join'; code: string; name: string; avatar: CharacterId | null }
  | { type: 'resume'; code: string; token: string }
  | { type: 'lobbies' }
  /** An empty `name` lets the server name the player after the seat they land in. */
  | { type: 'quick'; name: string; avatar: CharacterId | null; bestOf: 3 | 5; mode: BattleMode }
  | GameAction
  | { type: 'choose'; choice: string }
  | { type: 'forfeit' }
  /** v5 presence: relayed to the rival, never stored. */
  | ({ type: 'move' } & Spot)
  | { type: 'emote'; emote: PlazaEmote }
  /** v6 main plaza: enter (or, once in, change name and partner) with `on`; leave with `on: false`. `at` is where to appear. */
  | { type: 'hub'; on: boolean; name: string; avatar: CharacterId | null; at: Spot | null }
  | ({ type: 'hubMove' } & Spot)
  | { type: 'hubEmote'; emote: PlazaEmote }
  | { type: 'hubChat'; text: string }
  /** v6 spectators: follow a room without a seat, or stop. */
  | { type: 'watch'; code: string }
  | { type: 'unwatch' };

export type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'joined'; code: string; token: string; seat: Seat }
  | { type: 'state'; room: PublicRoom }
  | { type: 'error'; message: string }
  /** Lines from the simulator stream for this player. `reset` means: discard what you have, this is the full log. */
  | { type: 'battle'; id: number; lines: string[]; reset: boolean; deadline: number | null }
  | { type: 'lobbies'; lobbies: LobbySummary[]; now: number; live: LiveBattle[] }
  /** v5 presence from the other seat. */
  | ({ type: 'move'; seat: Seat } & Spot)
  | { type: 'emote'; seat: Seat; emote: PlazaEmote }
  /** v6 main plaza: everyone there and the recent lines (on entering), then each change as it happens. */
  | { type: 'hub'; you: string; members: HubMember[]; chat: HubLine[] }
  | { type: 'hubJoin'; member: HubMember }
  | { type: 'hubLeave'; id: string }
  | ({ type: 'hubMove'; id: string } & Spot)
  | { type: 'hubEmote'; id: string; emote: PlazaEmote }
  | { type: 'hubChat'; line: HubLine }
  /** v6 spectators: the room this socket now follows (null: none). Its state and battle stream follow. */
  | { type: 'watching'; code: string | null };

export const MAX_NAME = 24;

/** Strip control/bidi characters, collapse whitespace, clamp length. React escapes on render; this keeps names tidy. */
export function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v : '';
  // eslint-disable-next-line no-control-regex
  const out = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return out || fallback;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const avatarOf = (v: unknown): CharacterId | null => (isCharacterId(v) ? v : null);
const modeOf = (v: unknown): BattleMode => (v === 'app' ? 'app' : 'showdown');
/** Backend room codes are 6 hex chars; PeerJS room codes are the host's peer id. */
/** Simulator choices a player may send. Anything else is rejected before it reaches the simulator. */
export const CHOICE = /^(move [1-4]( terastallize)?|switch [1-6]|team [1-6]{1,6}|default|undo)$/;
const ROOM_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
export const isRoomCode = (v: unknown): v is string => typeof v === 'string' && ROOM_CODE.test(v);

/** Validate an untrusted message. Returns null for anything malformed so callers can reject uniformly. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'create': return { type: 'create', name: cleanName(m.name, 'Player 1'), bestOf: normalizeBestOf(m.bestOf), avatar: avatarOf(m.avatar), mode: modeOf(m.mode), visibility: m.visibility === 'public' ? 'public' : 'private' };
    case 'join': return isRoomCode(m.code) ? { type: 'join', code: m.code, name: cleanName(m.name, 'Player 2'), avatar: avatarOf(m.avatar) } : null;
    case 'resume': return isRoomCode(m.code) && typeof m.token === 'string' && m.token.length <= 64 ? { type: 'resume', code: m.code, token: m.token } : null;
    case 'lobbies': return { type: 'lobbies' };
    case 'quick': return { type: 'quick', name: cleanName(m.name, ''), avatar: avatarOf(m.avatar), bestOf: normalizeBestOf(m.bestOf), mode: modeOf(m.mode) };
    case 'call': return m.side === 'heads' || m.side === 'tails' ? { type: 'call', side: m.side } : null;
    case 'flip': return { type: 'flip' };
    case 'spin': return { type: 'spin' };
    case 'pick': return { type: 'pick', team: Number(m.team) === 0 ? 0 : 1 };
    case 'result': return { type: 'result', winner: Number(m.winner) === 0 ? 0 : 1 };
    case 'next': return { type: 'next' };
    case 'reset': return { type: 'reset', bestOf: normalizeBestOf(m.bestOf) };
    case 'avatar': return isCharacterId(m.avatar) ? { type: 'avatar', avatar: m.avatar } : null;
    case 'mode': return m.mode === 'app' || m.mode === 'showdown' ? { type: 'mode', mode: m.mode } : null;
    case 'choose': return typeof m.choice === 'string' && CHOICE.test(m.choice) ? { type: 'choose', choice: m.choice } : null;
    case 'forfeit': return { type: 'forfeit' };
    case 'chat': { const text = cleanChat(m.text); return text ? { type: 'chat', text } : null; }
    case 'move': return num(m.x) && num(m.z) && num(m.face) ? { type: 'move', ...cleanSpot(m.x, m.z, m.face) } : null;
    case 'emote': return isPlazaEmote(m.emote) ? { type: 'emote', emote: m.emote } : null;
    case 'hub': {
      const at = isObj(m.at) && num(m.at.x) && num(m.at.z) && num(m.at.face) ? cleanSpot(m.at.x, m.at.z, m.at.face) : null;
      return { type: 'hub', on: m.on !== false, name: cleanName(m.name, 'Trainer'), avatar: avatarOf(m.avatar), at };
    }
    case 'hubMove': return num(m.x) && num(m.z) && num(m.face) ? { type: 'hubMove', ...cleanSpot(m.x, m.z, m.face) } : null;
    case 'hubEmote': return isPlazaEmote(m.emote) ? { type: 'hubEmote', emote: m.emote } : null;
    case 'hubChat': { const text = cleanChat(m.text); return text ? { type: 'hubChat', text } : null; }
    case 'watch': return isRoomCode(m.code) ? { type: 'watch', code: m.code } : null;
    case 'unwatch': return { type: 'unwatch' };
    default: return null;
  }
}

/** One listed lobby, or null when the entry is unusable (it is then left out of the list). */
function parseLobby(v: unknown): LobbySummary | null {
  if (!isObj(v) || !isRoomCode(v.code) || typeof v.createdAt !== 'number') return null;
  return { code: v.code, host: cleanName(v.host, 'Player 1'), avatar: avatarOf(v.avatar), bestOf: normalizeBestOf(v.bestOf), mode: modeOf(v.mode), createdAt: v.createdAt, players: typeof v.players === 'number' ? v.players : 1 };
}

function parseMember(v: unknown): HubMember | null {
  if (!isObj(v) || !isHubId(v.id) || !num(v.x) || !num(v.z) || !num(v.face)) return null;
  return { id: v.id, name: cleanName(v.name, 'Trainer'), avatar: avatarOf(v.avatar), ...cleanSpot(v.x, v.z, v.face) };
}
function parseHubLine(v: unknown): HubLine | null {
  if (!isObj(v) || !num(v.id) || !isHubId(v.from) || typeof v.text !== 'string') return null;
  const text = cleanChat(v.text);
  return text ? { id: v.id, from: v.from, name: cleanName(v.name, 'Trainer'), text } : null;
}
function parseLive(v: unknown): LiveBattle | null {
  if (!isObj(v) || !isRoomCode(v.code) || !Array.isArray(v.names) || !Array.isArray(v.avatars) || !Array.isArray(v.wins)) return null;
  const n = (x: unknown) => (num(x) && x >= 0 ? Math.floor(x) : 0);
  return {
    code: v.code, names: [cleanName(v.names[0], 'Player 1'), cleanName(v.names[1], 'Player 2')], avatars: [avatarOf(v.avatars[0]), avatarOf(v.avatars[1])],
    bestOf: normalizeBestOf(v.bestOf), wins: [n(v.wins[0]), n(v.wins[1])], turn: n(v.turn), watchers: n(v.watchers),
  };
}
const keep = <T,>(xs: unknown, f: (v: unknown) => T | null): T[] => (Array.isArray(xs) ? xs.map(f).filter((x): x is T => x !== null) : []);

const SERVER_TYPES = new Set(['hello', 'joined', 'state', 'error', 'battle', 'lobbies', 'move', 'emote', 'hub', 'hubJoin', 'hubLeave', 'hubMove', 'hubEmote', 'hubChat', 'watching']);
const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;
/** Chat lines from the authority: malformed lines are dropped, text is cleaned again. */
function parseChat(v: unknown): ChatLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l): l is ChatLine => isObj(l) && num(l.id) && isSeat(l.seat) && typeof l.text === 'string')
    .map(l => ({ id: l.id, seat: l.seat, text: cleanChat(l.text) })).filter(l => l.text);
}
/** Light structural check for messages arriving at a client. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || typeof m.type !== 'string' || !SERVER_TYPES.has(m.type)) return null;
  if (m.type === 'hello') return { type: 'hello', protocol: typeof m.protocol === 'number' ? m.protocol : 1 };
  if (m.type === 'lobbies') {
    if (!Array.isArray(m.lobbies) || typeof m.now !== 'number') return null;
    return { type: 'lobbies', lobbies: m.lobbies.map(parseLobby).filter((l): l is LobbySummary => l !== null), now: m.now, live: keep(m.live, parseLive) };
  }
  if (m.type === 'hub') return isHubId(m.you) ? { type: 'hub', you: m.you, members: keep(m.members, parseMember), chat: keep(m.chat, parseHubLine) } : null;
  if (m.type === 'hubJoin') { const member = parseMember(m.member); return member ? { type: 'hubJoin', member } : null; }
  if (m.type === 'hubLeave') return isHubId(m.id) ? { type: 'hubLeave', id: m.id } : null;
  if (m.type === 'hubMove') return isHubId(m.id) && num(m.x) && num(m.z) && num(m.face) ? { type: 'hubMove', id: m.id, ...cleanSpot(m.x, m.z, m.face) } : null;
  if (m.type === 'hubEmote') return isHubId(m.id) && isPlazaEmote(m.emote) ? { type: 'hubEmote', id: m.id, emote: m.emote } : null;
  if (m.type === 'hubChat') { const line = parseHubLine(m.line); return line ? { type: 'hubChat', line } : null; }
  if (m.type === 'watching') return { type: 'watching', code: isRoomCode(m.code) ? m.code : null };
  if (m.type === 'move') return isSeat(m.seat) && num(m.x) && num(m.z) && num(m.face) ? { type: 'move', seat: m.seat, ...cleanSpot(m.x, m.z, m.face) } : null;
  if (m.type === 'emote') return isSeat(m.seat) && isPlazaEmote(m.emote) ? { type: 'emote', seat: m.seat, emote: m.emote } : null;
  if (m.type === 'state' && !isObj(m.room)) return null;
  if (m.type === 'joined' && (typeof m.code !== 'string' || typeof m.token !== 'string' || (m.seat !== 0 && m.seat !== 1))) return null;
  if (m.type === 'error') return { type: 'error', message: String(m.message ?? 'Unknown error').slice(0, 200) };
  if (m.type === 'battle') {
    if (typeof m.id !== 'number' || !Array.isArray(m.lines) || !m.lines.every(l => typeof l === 'string')) return null;
    return { type: 'battle', id: m.id, lines: m.lines as string[], reset: m.reset === true, deadline: typeof m.deadline === 'number' ? m.deadline : null };
  }
  if (m.type === 'state') {
    // v1 servers don't send `protocol` / `connected` / `avatar`, nor pre-v4 servers `visibility`; normalise so the UI has one shape.
    const room = m.room as PublicRoom & { players: Array<Record<string, unknown> | null> };
    room.protocol = typeof room.protocol === 'number' ? room.protocol : 1;
    room.mode = modeOf(room.mode);
    room.battle = room.battle ?? null;
    room.visibility = room.visibility === 'public' ? 'public' : 'private';
    room.caller = room.caller === 0 || room.caller === 1 ? room.caller : null;
    room.chat = parseChat(room.chat);
    room.watchers = num(room.watchers) && room.watchers > 0 ? Math.floor(room.watchers) : 0;
    room.rival = Array.isArray(room.rival) ? (room.rival as unknown[]).filter((p): p is RivalPreview => isObj(p) && typeof p.name === 'string' && Array.isArray(p.types)) : null;
    room.players = room.players.map(p => (p ? { name: cleanName(p.name, 'Player'), avatar: avatarOf(p.avatar), connected: p.connected !== false } : null)) as PublicRoom['players'];
    return { type: 'state', room };
  }
  return m as ServerMessage;
}
