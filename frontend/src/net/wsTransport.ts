import { parseServerMessage, type CharacterId, type ClientMessage, type GameAction } from '@shared';
import { SnapshotStore, sessionStore, type Transport } from './types.js';

/**
 * Dedicated WebSocket backend (server-authoritative). One socket for the whole session; reconnects
 * with exponential backoff and resumes the seat with the stored token.
 * v1 opened a new socket on every create/join and never closed the old one.
 */
export class WsTransport implements Transport {
  readonly kind = 'backend' as const;
  private store = new SnapshotStore({ kind: 'backend', link: 'connecting', room: null, seat: null, error: '', errorId: 0 });
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private retry = 0;
  private retryTimer = 0;
  private disposed = false;

  constructor(private url: string) { this.open(); }

  getSnapshot = () => this.store.get();
  subscribe = (l: () => void) => this.store.subscribe(l);

  private open() {
    if (this.disposed) return;
    this.store.set({ link: 'connecting' });
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.store.fail('Invalid backend URL'); this.store.set({ link: 'offline' }); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.store.set({ link: 'online' });
      const saved = sessionStore.load('backend');
      if (saved && !this.queue.some(m => m.type === 'create' || m.type === 'join')) this.raw({ type: 'resume', code: saved.code, token: saved.token });
      const q = this.queue; this.queue = [];
      q.forEach(m => this.raw(m));
    };
    ws.onmessage = e => {
      const msg = parseServerMessage(String(e.data));
      if (!msg) return;
      if (msg.type === 'state') this.store.set({ room: msg.room });
      else if (msg.type === 'joined') { sessionStore.save({ kind: 'backend', code: msg.code, token: msg.token }); this.store.set({ seat: msg.seat }); }
      else if (msg.type === 'error') {
        if (msg.message === 'Invalid session' || msg.message === 'Unknown room') { sessionStore.clear(); if (!this.store.get().room) return; this.store.set({ room: null, seat: null }); }
        this.store.fail(msg.message);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.store.set({ link: 'offline' });
      if (this.disposed) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private raw(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  create(name: string, bestOf: 3 | 5, avatar: CharacterId | null) { sessionStore.clear(); this.raw({ type: 'create', name, bestOf, avatar }); }
  join(code: string, name: string, avatar: CharacterId | null) { sessionStore.clear(); this.raw({ type: 'join', code: code.trim().toUpperCase(), name, avatar }); }
  act(action: GameAction) {
    if (this.store.get().link !== 'online') { this.store.fail('Connection lost, reconnecting…'); return; }
    this.raw(action);
  }
  leave() {
    sessionStore.clear();
    this.store.set({ room: null, seat: null });
    // A fresh socket drops the seat binding server-side without affecting the opponent's room.
    this.ws?.close(); this.ws = null; window.clearTimeout(this.retryTimer); this.retry = 0; this.open();
  }
  clearError() { this.store.set({ error: '' }); }
  dispose() { this.disposed = true; window.clearTimeout(this.retryTimer); this.ws?.close(); this.ws = null; }
}
