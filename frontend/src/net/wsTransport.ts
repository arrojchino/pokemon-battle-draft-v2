import { parseServerMessage, type BattleMode, type CharacterId, type ClientMessage, type GameAction, type Visibility } from '@shared';
import { SnapshotStore, sessionStore, type BattleListener, type LobbyList, type Transport } from './types.js';

/** A lobby listing that takes longer than this is reported as failed. */
const LIST_TIMEOUT_MS = 6000;

/**
 * Dedicated WebSocket backend (server-authoritative). One socket for the whole session; reconnects
 * with exponential backoff and resumes the seat with the stored token.
 * v1 opened a new socket on every create/join and never closed the old one.
 */
export class WsTransport implements Transport {
  readonly kind = 'backend' as const;
  readonly supportsBattles = true;
  private battleListeners = new Set<BattleListener>();
  /** Everything received for the current battle, so a screen mounted later can rebuild it. */
  private battleLog: { id: number; lines: string[]; deadline: number | null } | null = null;
  private store = new SnapshotStore({ kind: 'backend', link: 'connecting', room: null, seat: null, serverProtocol: null, error: '', errorId: 0 });
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private retry = 0;
  private retryTimer = 0;
  private disposed = false;
  /** The automatic resume sent on connect is unanswered; if its room is gone, that is not the player's error. */
  private resuming = false;
  /** Pending `listLobbies` calls; the next listing answers all of them. */
  private lobbyWaiters: Array<{ resolve: (l: LobbyList) => void; reject: (e: Error) => void }> = [];

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
      if (saved && !this.queue.some(m => m.type === 'create' || m.type === 'join' || m.type === 'quick')) { this.resuming = true; this.raw({ type: 'resume', code: saved.code, token: saved.token }); }
      const q = this.queue; this.queue = [];
      q.forEach(m => this.raw(m));
    };
    ws.onmessage = e => {
      const msg = parseServerMessage(String(e.data));
      if (!msg) return;
      if (msg.type === 'hello') this.store.set({ serverProtocol: msg.protocol });
      else if (msg.type === 'state') this.store.set({ room: msg.room });
      else if (msg.type === 'joined') { this.resuming = false; sessionStore.save({ kind: 'backend', code: msg.code, token: msg.token }); this.store.set({ seat: msg.seat }); }
      else if (msg.type === 'lobbies') { const w = this.lobbyWaiters; this.lobbyWaiters = []; w.forEach(x => x.resolve({ lobbies: msg.lobbies, now: msg.now })); }
      else if (msg.type === 'battle') {
        if (msg.reset || this.battleLog?.id !== msg.id) this.battleLog = { id: msg.id, lines: [], deadline: null };
        this.battleLog.lines.push(...msg.lines); this.battleLog.deadline = msg.deadline;
        this.battleListeners.forEach(l => l(msg.id, msg.lines, msg.reset, msg.deadline));
      }
      else if (msg.type === 'error') {
        if (msg.message === 'Invalid session' || msg.message === 'Unknown room') {
          sessionStore.clear();
          const resumed = this.resuming; this.resuming = false;
          if (this.store.get().room) this.store.set({ room: null, seat: null });
          else if (resumed) return;
        }
        this.store.fail(msg.message);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.store.set({ link: 'offline' });
      this.rejectLobbies('Connection lost');
      if (this.disposed) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private raw(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }
  private rejectLobbies(reason: string) { const w = this.lobbyWaiters; this.lobbyWaiters = []; w.forEach(x => x.reject(new Error(reason))); }

  create(name: string, bestOf: 3 | 5, avatar: CharacterId | null, mode: BattleMode, visibility: Visibility) { sessionStore.clear(); this.raw({ type: 'create', name, bestOf, avatar, mode, visibility }); }
  join(code: string, name: string, avatar: CharacterId | null) { sessionStore.clear(); this.raw({ type: 'join', code: code.trim().toUpperCase(), name, avatar }); }
  quickJoin(name: string, avatar: CharacterId | null, bestOf: 3 | 5, mode: BattleMode) { sessionStore.clear(); this.raw({ type: 'quick', name, avatar, bestOf, mode }); }
  listLobbies() {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the server'));
    return new Promise<LobbyList>((resolve, reject) => {
      const waiter = {
        resolve: (l: LobbyList) => { clearTimeout(timer); resolve(l); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      const timer = window.setTimeout(() => { this.lobbyWaiters = this.lobbyWaiters.filter(x => x !== waiter); reject(new Error('The server did not answer')); }, LIST_TIMEOUT_MS);
      this.lobbyWaiters.push(waiter);
      this.raw({ type: 'lobbies' });
    });
  }
  act(action: GameAction) {
    if (this.store.get().link !== 'online') { this.store.fail('Connection lost, reconnecting…'); return; }
    this.raw(action);
  }
  choose(choice: string) { this.raw({ type: 'choose', choice }); }
  forfeit() { this.raw({ type: 'forfeit' }); }
  onBattle(listener: BattleListener) {
    this.battleListeners.add(listener);
    if (this.battleLog) listener(this.battleLog.id, this.battleLog.lines.slice(), true, this.battleLog.deadline);
    return () => { this.battleListeners.delete(listener); };
  }
  leave() {
    this.battleLog = null;
    sessionStore.clear();
    this.store.set({ room: null, seat: null });
    // A fresh socket drops the seat binding server-side without affecting the opponent's room.
    this.ws?.close(); this.ws = null; window.clearTimeout(this.retryTimer); this.retry = 0; this.rejectLobbies('Connection reset'); this.open();
  }
  clearError() { this.store.set({ error: '' }); }
  dispose() { this.disposed = true; window.clearTimeout(this.retryTimer); this.ws?.close(); this.ws = null; this.rejectLobbies('Closed'); }
}
