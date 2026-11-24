import { describe, expect, it } from 'vitest';
import { HUB_SINCE, PROTOCOL_VERSION } from '../../shared/src/protocol.js';
import { UNREACHABLE_AFTER, plazaLink } from '../src/net/plazaLink.js';

// Regression: the plaza silently showed "your own plaza" (nobody else) when the configured server was unreachable
// (a remembered quick-tunnel host that no longer exists) or too old, so other trainers never appeared.
describe('plaza link state', () => {
  it('is solo only without a backend', () => {
    expect(plazaLink({ kind: 'peer', link: 'online', serverProtocol: null }, 0)).toEqual({ kind: 'solo' });
  });
  it('waits, then says the server cannot be reached (not solo)', () => {
    const s = { kind: 'backend' as const, link: 'connecting' as const, serverProtocol: null };
    expect(plazaLink(s, 100).kind).toBe('connecting');
    expect(plazaLink(s, UNREACHABLE_AFTER + 1).kind).toBe('unreachable');
  });
  it('is shared on the current protocol', () => {
    expect(plazaLink({ kind: 'backend', link: 'online', serverProtocol: PROTOCOL_VERSION }, 0)).toEqual({ kind: 'shared', outdated: null });
  });
  it('flags an older server instead of failing silently', () => {
    expect(plazaLink({ kind: 'backend', link: 'online', serverProtocol: PROTOCOL_VERSION - 1 }, 0)).toEqual({ kind: 'shared', outdated: PROTOCOL_VERSION - 1 });
    expect(plazaLink({ kind: 'backend', link: 'online', serverProtocol: HUB_SINCE - 1 }, 0)).toEqual({ kind: 'tooOld', server: HUB_SINCE - 1 });
  });
  it('stays shared while reconnecting to a server it already saw', () => {
    expect(plazaLink({ kind: 'backend', link: 'connecting', serverProtocol: PROTOCOL_VERSION }, UNREACHABLE_AFTER * 3).kind).toBe('shared');
  });
});
