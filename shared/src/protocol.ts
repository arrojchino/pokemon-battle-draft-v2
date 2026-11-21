import { isCharacterId, type CharacterId } from './characters.js';
import { normalizeBestOf, type BattleMode, type GameAction, type PublicRoom, type RivalPreview, type Seat, type Visibility } from './room.js';

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
 * Servers accept every older client message unchanged, and older clients can read newer state.
 */
export const PROTOCOL_VERSION = 4;
export const LOBBIES_SINCE = 4;

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
  | { type: 'forfeit' };

export type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'joined'; code: string; token: string; seat: Seat }
  | { type: 'state'; room: PublicRoom }
  | { type: 'error'; message: string }
  /** Lines from the simulator stream for this player. `reset` means: discard what you have, this is the full log. */
  | { type: 'battle'; id: number; lines: string[]; reset: boolean; deadline: number | null }
  | { type: 'lobbies'; lobbies: LobbySummary[]; now: number };

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
    default: return null;
  }
}

/** One listed lobby, or null when the entry is unusable (it is then left out of the list). */
function parseLobby(v: unknown): LobbySummary | null {
  if (!isObj(v) || !isRoomCode(v.code) || typeof v.createdAt !== 'number') return null;
  return { code: v.code, host: cleanName(v.host, 'Player 1'), avatar: avatarOf(v.avatar), bestOf: normalizeBestOf(v.bestOf), mode: modeOf(v.mode), createdAt: v.createdAt, players: typeof v.players === 'number' ? v.players : 1 };
}

const SERVER_TYPES = new Set(['hello', 'joined', 'state', 'error', 'battle', 'lobbies']);
/** Light structural check for messages arriving at a client. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || typeof m.type !== 'string' || !SERVER_TYPES.has(m.type)) return null;
  if (m.type === 'hello') return { type: 'hello', protocol: typeof m.protocol === 'number' ? m.protocol : 1 };
  if (m.type === 'lobbies') {
    if (!Array.isArray(m.lobbies) || typeof m.now !== 'number') return null;
    return { type: 'lobbies', lobbies: m.lobbies.map(parseLobby).filter((l): l is LobbySummary => l !== null), now: m.now };
  }
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
    room.rival = Array.isArray(room.rival) ? (room.rival as unknown[]).filter((p): p is RivalPreview => isObj(p) && typeof p.name === 'string' && Array.isArray(p.types)) : null;
    room.players = room.players.map(p => (p ? { name: cleanName(p.name, 'Player'), avatar: avatarOf(p.avatar), connected: p.connected !== false } : null)) as PublicRoom['players'];
    return { type: 'state', room };
  }
  return m as ServerMessage;
}
