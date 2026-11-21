import { useSyncExternalStore } from 'react';
import { WsTransport } from './wsTransport.js';
import { PeerTransport } from './peerTransport.js';
import type { Transport } from './types.js';

/** Backend URL precedence: build-time env, then `?ws=`, then the value remembered from a previous `?ws=`. */
export function backendUrl(): string {
  const q = new URLSearchParams(location.search).get('ws');
  if (q && /^wss?:\/\//.test(q)) { try { localStorage.setItem('pc-backend', q); } catch { /* ignore */ } }
  let stored = '';
  try { stored = localStorage.getItem('pc-backend') || ''; } catch { /* ignore */ }
  const v = (import.meta.env.VITE_BACKEND_URL || '').trim() || q || stored;
  return /^wss?:\/\//.test(v) ? v : '';
}

/** Shareable link into a room. It carries `?ws=` unless the backend is baked into the build, so the rival reaches the same server. */
export function inviteLink(code: string): string {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('room', code);
  const ws = backendUrl();
  if (ws && !(import.meta.env.VITE_BACKEND_URL || '').trim()) u.searchParams.set('ws', ws);
  return u.toString();
}

let transport: Transport | null = null;
/** Exactly one transport per page. v1 started both the WebSocket and the PeerJS client unconditionally. */
export function getTransport(): Transport {
  if (!transport) {
    const url = backendUrl();
    transport = url ? new WsTransport(url) : new PeerTransport();
  }
  return transport;
}

export function useSession() {
  const t = getTransport();
  const snap = useSyncExternalStore(t.subscribe, t.getSnapshot);
  return { ...snap, transport: t };
}
