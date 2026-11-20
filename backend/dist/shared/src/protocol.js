import { isCharacterId } from './characters.js';
import { normalizeBestOf } from './room.js';
/**
 * Wire protocol.
 * v1: original casino build (players[].token was broadcast, no avatars).
 * v2: tokens stripped from broadcasts, `avatar` + `connected` on players, `hello.protocol`, typed errors.
 * v3: in-app battles. `mode` on create, `mode`/`choose`/`forfeit` messages, `room.battle`, and per-player
 *     `battle` messages carrying that player's view of the simulator stream (secret info only for its owner).
 * Servers accept every older client message unchanged, and older clients can read newer state.
 */
export const PROTOCOL_VERSION = 3;
export const MAX_NAME = 24;
/** Strip control/bidi characters, collapse whitespace, clamp length. React escapes on render; this keeps names tidy. */
export function cleanName(v, fallback) {
    const s = typeof v === 'string' ? v : '';
    // eslint-disable-next-line no-control-regex
    const out = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return out || fallback;
}
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const avatarOf = (v) => (isCharacterId(v) ? v : null);
/** Backend room codes are 6 hex chars; PeerJS room codes are the host's peer id. */
/** Simulator choices a player may send. Anything else is rejected before it reaches the simulator. */
export const CHOICE = /^(move [1-4]( terastallize)?|switch [1-6]|team [1-6]{1,6}|default|undo)$/;
const ROOM_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
export const isRoomCode = (v) => typeof v === 'string' && ROOM_CODE.test(v);
/** Validate an untrusted message. Returns null for anything malformed so callers can reject uniformly. */
export function parseClientMessage(raw) {
    let m = raw;
    if (typeof raw === 'string') {
        try {
            m = JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    if (!isObj(m) || typeof m.type !== 'string')
        return null;
    switch (m.type) {
        case 'create': return { type: 'create', name: cleanName(m.name, 'Player 1'), bestOf: normalizeBestOf(m.bestOf), avatar: avatarOf(m.avatar), mode: m.mode === 'app' ? 'app' : 'showdown' };
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
        case 'mode': return m.mode === 'app' || m.mode === 'showdown' ? { type: 'mode', mode: m.mode } : null;
        case 'choose': return typeof m.choice === 'string' && CHOICE.test(m.choice) ? { type: 'choose', choice: m.choice } : null;
        case 'forfeit': return { type: 'forfeit' };
        default: return null;
    }
}
const SERVER_TYPES = new Set(['hello', 'joined', 'state', 'error', 'battle']);
/** Light structural check for messages arriving at a client. */
export function parseServerMessage(raw) {
    let m = raw;
    if (typeof raw === 'string') {
        try {
            m = JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    if (!isObj(m) || typeof m.type !== 'string' || !SERVER_TYPES.has(m.type))
        return null;
    if (m.type === 'state' && !isObj(m.room))
        return null;
    if (m.type === 'joined' && (typeof m.code !== 'string' || typeof m.token !== 'string' || (m.seat !== 0 && m.seat !== 1)))
        return null;
    if (m.type === 'error')
        return { type: 'error', message: String(m.message ?? 'Unknown error').slice(0, 200) };
    if (m.type === 'battle') {
        if (typeof m.id !== 'number' || !Array.isArray(m.lines) || !m.lines.every(l => typeof l === 'string'))
            return null;
        return { type: 'battle', id: m.id, lines: m.lines, reset: m.reset === true, deadline: typeof m.deadline === 'number' ? m.deadline : null };
    }
    if (m.type === 'state') {
        // v1 servers don't send `protocol` / `connected` / `avatar`; normalise so the UI has one shape.
        const room = m.room;
        room.protocol = typeof room.protocol === 'number' ? room.protocol : 1;
        room.mode = room.mode === 'app' ? 'app' : 'showdown';
        room.battle = room.battle ?? null;
        room.players = room.players.map(p => (p ? { name: cleanName(p.name, 'Player'), avatar: avatarOf(p.avatar), connected: p.connected !== false } : null));
        return { type: 'state', room };
    }
    return m;
}
