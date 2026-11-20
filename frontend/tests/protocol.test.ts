import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, cleanName, isRoomCode } from '../../shared/src/protocol.js';

describe('protocol validation', () => {
  it('accepts every v1 client message shape', () => {
    expect(parseClientMessage({ type: 'create', name: 'Ana', bestOf: 5 })).toEqual({ type: 'create', name: 'Ana', bestOf: 5, avatar: null });
    expect(parseClientMessage({ type: 'join', code: 'ABC123', name: 'Beto' })).toEqual({ type: 'join', code: 'ABC123', name: 'Beto', avatar: null });
    expect(parseClientMessage({ type: 'resume', code: 'ABC123', token: 't' })).toEqual({ type: 'resume', code: 'ABC123', token: 't' });
    expect(parseClientMessage({ type: 'call', side: 'tails' })).toEqual({ type: 'call', side: 'tails' });
    expect(parseClientMessage({ type: 'pick', team: 0 })).toEqual({ type: 'pick', team: 0 });
    expect(parseClientMessage({ type: 'pick', team: 1 })).toEqual({ type: 'pick', team: 1 });
    expect(parseClientMessage({ type: 'result', winner: 0 })).toEqual({ type: 'result', winner: 0 });
    expect(parseClientMessage({ type: 'reset', bestOf: 7 })).toEqual({ type: 'reset', bestOf: 3 });
    expect(parseClientMessage('{"type":"flip"}')).toEqual({ type: 'flip' });
  });
  it('rejects malformed or hostile input', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage([])).toBeNull();
    expect(parseClientMessage({ type: 'call', side: 'edge' })).toBeNull();
    expect(parseClientMessage({ type: 'join', code: '../x', name: 'a' })).toBeNull();
    expect(parseClientMessage({ type: 'avatar', avatar: 'admin' })).toBeNull();
    expect(parseClientMessage({ type: 'resume', code: 'ABC123', token: 'x'.repeat(65) })).toBeNull();
    expect(parseClientMessage({ type: '__proto__' })).toBeNull();
  });
  it('cleans names', () => {
    expect(cleanName('  A‮B\u0007  C ', 'x')).toBe('AB C');
    expect(cleanName('', 'Player 1')).toBe('Player 1');
    expect(cleanName(42, 'P')).toBe('P');
    expect(cleanName('x'.repeat(50), 'P')).toHaveLength(24);
  });
  it('accepts backend and PeerJS room codes', () => {
    expect(isRoomCode('A1B2C3')).toBe(true);
    expect(isRoomCode('3f1c2a9e-7d1b-4c1e-9b8a-1a2b3c4d5e6f')).toBe(true);
    expect(isRoomCode('a b')).toBe(false);
    expect(isRoomCode('')).toBe(false);
  });
  it('normalises v1 server state so the UI sees one shape', () => {
    const v1 = { type: 'state', room: { code: 'ABC123', players: [{ name: 'Ana', token: 'secret' }, null], phase: 'calls' } };
    const m = parseServerMessage(JSON.stringify(v1));
    expect(m && m.type === 'state' && m.room.protocol).toBe(1);
    expect(m && m.type === 'state' && m.room.players[0]).toEqual({ name: 'Ana', avatar: null, connected: true });
    expect(parseServerMessage({ type: 'joined', code: 'A', token: 't', seat: 2 })).toBeNull();
    expect(parseServerMessage({ type: 'nope' })).toBeNull();
  });
});
