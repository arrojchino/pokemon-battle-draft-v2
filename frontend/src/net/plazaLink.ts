import { HUB_SINCE, PROTOCOL_VERSION } from '@shared';
import type { SessionSnapshot } from './types.js';

/**
 * What the main plaza can be right now, from the session: shared with everyone, waiting for a server it cannot reach,
 * on a server too old for the shared plaza or older than this client, or the player's own (no server configured).
 * The plaza used to fall back to "your own" silently in the unreachable and outdated cases, so other trainers just
 * never appeared; every case now has its own message.
 */
export type PlazaLink =
  | { kind: 'shared'; outdated: number | null }
  | { kind: 'connecting' }
  | { kind: 'unreachable' }
  | { kind: 'tooOld'; server: number }
  | { kind: 'solo' };

/** How long a backend may stay unconnected before the plaza says it cannot reach it (ms). */
export const UNREACHABLE_AFTER = 6000;

export function plazaLink(s: Pick<SessionSnapshot, 'kind' | 'link' | 'serverProtocol'>, waitedMs: number): PlazaLink {
  if (s.kind !== 'backend') return { kind: 'solo' };
  const v = s.serverProtocol;
  if (s.link === 'online' && v !== null) {
    if (v < HUB_SINCE) return { kind: 'tooOld', server: v };
    return { kind: 'shared', outdated: v < PROTOCOL_VERSION ? v : null };
  }
  // Not connected (yet, or any more). A server once seen keeps the plaza shared while it reconnects.
  if (v !== null && v >= HUB_SINCE) return { kind: 'shared', outdated: v < PROTOCOL_VERSION ? v : null };
  return waitedMs < UNREACHABLE_AFTER ? { kind: 'connecting' } : { kind: 'unreachable' };
}
