import { describe, it, expect } from 'vitest';
import { MAX_FEED_LINES, PROTOCOL_VERSION, parseClientMessage, parseServerMessage } from '../../shared/src/protocol.js';

describe('plaza feed messages (v8)', () => {
  it('is protocol 8', () => expect(PROTOCOL_VERSION).toBe(8));

  it('accepts only the strict hubFeed shape from clients', () => {
    expect(parseClientMessage({ type: 'hubFeed', on: true })).toEqual({ type: 'hubFeed', on: true });
    expect(parseClientMessage({ type: 'hubFeed', on: false })).toEqual({ type: 'hubFeed', on: false });
    expect(parseClientMessage({ type: 'hubFeed', on: 'yes' })).toBeNull();
    expect(parseClientMessage({ type: 'hubFeed' })).toBeNull();
    expect(parseClientMessage({ type: 'hubFeed', on: true, code: 'ABC123' })).toBeNull();
  });

  it('reads the featured battle and cleans it', () => {
    const f = { code: 'ABC123', names: ['Ana\u202e', 'Beto'], avatars: ['greninja', 'nope'], wins: [1, -3], bestOf: 5 };
    expect(parseServerMessage({ type: 'hubFeature', feature: f })).toEqual({ type: 'hubFeature', feature: { code: 'ABC123', names: ['Ana', 'Beto'], avatars: ['greninja', null], wins: [1, 0], bestOf: 5 } });
    expect(parseServerMessage({ type: 'hubFeature', feature: null })).toEqual({ type: 'hubFeature', feature: null });
    expect(parseServerMessage({ type: 'hubFeature', feature: { code: 'bad code!' } })).toBeNull();
  });

  it('reads feed lines, drops private request lines and rejects oversized messages', () => {
    const m = parseServerMessage({ type: 'hubFeed', code: 'ABC123', id: 2, lines: ['|turn|3', '|request|{"side":{}}', '|move|p1a: X|Tackle|p2a: Y'], reset: true });
    expect(m).toEqual({ type: 'hubFeed', code: 'ABC123', id: 2, lines: ['|turn|3', '|move|p1a: X|Tackle|p2a: Y'], reset: true });
    expect(parseServerMessage({ type: 'hubFeed', code: 'ABC123', id: 2, lines: Array(MAX_FEED_LINES + 1).fill('|'), reset: false })).toBeNull();
    expect(parseServerMessage({ type: 'hubFeed', code: 'ABC123', id: 2, lines: [3], reset: false })).toBeNull();
  });
});
