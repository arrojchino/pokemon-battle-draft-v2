import { isCharacterId, type CharacterId } from './characters.js';
import { normalizeBestOf, type GameAction, type PublicRoom, type Seat } from './room.js';

/**
 * Wire protocol.
 * v1: original casino build (players[].token was broadcast, no avatars).
 * v2: tokens stripped from broadcasts, `avatar` + `connected` on players, `hello.protocol`, typed errors.
 * v2 servers accept every v1 client message unchanged, and v1 clients can read v2 state.
 */
export const PROTOCOL_VERSION = 2;

export type ClientMessage =
  | { type: 'create'; name: string; bestOf: 3 | 5; avatar: CharacterId | null }
  | { type: 'join'; code: string; name: string; avatar: CharacterId | null }
  | { type: 'resume'; code: string; token: string }
  | GameAction;

export type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'joined'; code: string; token: string; seat: Seat }
  | { type: 'state'; room: PublicRoom }
  | { type: 'error'; message: string };

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
/** Backend room codes are 6 hex chars; PeerJS room codes are the host's peer id. */
const ROOM_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
export const isRoomCode = (v: unknown): v is string => typeof v === 'string' && ROOM_CODE.test(v);

/** Validate an untrusted message. Returns null for anything malformed so callers can reject uniformly. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'create': return { type: 'create', name: cleanName(m.name, 'Player 1'), bestOf: normalizeBestOf(m.bestOf), avatar: avatarOf(m.avatar) };
    case 'join': return isRoomCode(m.code) ? { type: 'join', code: m.code, name: cleanName(m.name, 'Player 2'), avatar: avatarOf(m.avatar) } : null;
    case 'resume': return isRoomCode(m.code) && typeof m.token === 'string' && m.token.length <= 64 ? { type: 'resume', code: m.code, token: m.token } : null;
    case 'call': return m.side === 'heads' || m.side === 'tails' ? { type: 'call', side: m.side } : null;
    case 'flip': return { type: 'flip' };
    case 'spin': return { type: 'spin' };
    case 'pick': return { type: 'pick', team: Number(m.team) === 0 ? 0 : 1 };
    case 'result': return { type: 'result', winner: Number(m.winner) === 0 ? 0 : 1 };
    case 'next': return { type: 'next' };
    case 'reset': return { type: 'reset', bestOf: normalizeBestOf(m.bestOf) };
    case 'avatar': return isCharacterId(m.avatar) ? { type: 'avatar', avatar: m.avatar } : null;
    default: return null;
  }
}

const SERVER_TYPES = new Set(['hello', 'joined', 'state', 'error']);
/** Light structural check for messages arriving at a client. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m) || typeof m.type !== 'string' || !SERVER_TYPES.has(m.type)) return null;
  if (m.type === 'state' && !isObj(m.room)) return null;
  if (m.type === 'joined' && (typeof m.code !== 'string' || typeof m.token !== 'string' || (m.seat !== 0 && m.seat !== 1))) return null;
  if (m.type === 'error') return { type: 'error', message: String(m.message ?? 'Unknown error').slice(0, 200) };
  if (m.type === 'state') {
    // v1 servers don't send `protocol` / `connected` / `avatar`; normalise so the UI has one shape.
    const room = m.room as PublicRoom & { players: Array<Record<string, unknown> | null> };
    room.protocol = typeof room.protocol === 'number' ? room.protocol : 1;
    room.players = room.players.map(p => (p ? { name: cleanName(p.name, 'Player'), avatar: avatarOf(p.avatar), connected: p.connected !== false } : null)) as PublicRoom['players'];
    return { type: 'state', room };
  }
  return m as ServerMessage;
}
