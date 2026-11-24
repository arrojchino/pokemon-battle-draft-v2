import { useSyncExternalStore } from 'react';
import { WsTransport } from './wsTransport.js';
import { PeerTransport } from './peerTransport.js';
import type { Transport } from './types.js';

const isWs = (v: string | null | undefined): v is string => !!v && /^wss?:\/\//.test(v);
let discovered = '';
/**
 * The battle server the site currently advertises (`backend.json`, written at deploy with the live tunnel).
 * Read once before the app starts, so a plain link or a remembered dead host still reaches today's server.
 * Gives up after `ms` and keeps whatever else is configured.
 */
export async function discoverBackend(ms = 2500): Promise<string> {
  try {
    const ctl = new AbortController();
    const tm = window.setTimeout(() => ctl.abort(), ms);
    const r = await fetch(`${import.meta.env.BASE_URL}backend.json`, { cache: 'no-store', signal: ctl.signal });
    window.clearTimeout(tm);
    const j = r.ok ? await r.json() as { ws?: unknown } : null;
    discovered = typeof j?.ws === 'string' && isWs(j.ws) ? j.ws : '';
  } catch { discovered = ''; }
  return discovered;
}
/** The server the site advertises, or '' (none, or not read yet). */
export const advertisedBackend = () => discovered;

/**
 * Backend URL precedence: build-time env, then `?ws=`, then the server the site advertises (`backend.json`), then
 * the value remembered from a previous visit. The advertised one beats the remembered one because quick tunnels
 * change hostname on every restart: a remembered host goes dead and used to leave the plaza silently empty.
 */
export function backendUrl(): string {
  const q = new URLSearchParams(location.search).get('ws');
  let stored = '';
  try { stored = localStorage.getItem('pc-backend') || ''; } catch { /* ignore */ }
  const v = (import.meta.env.VITE_BACKEND_URL || '').trim() || (isWs(q) ? q : '') || discovered || stored;
  if (isWs(v) && v !== stored) { try { localStorage.setItem('pc-backend', v); } catch { /* ignore */ } }
  return isWs(v) ? v : '';
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
