import { HUB_SINCE, PLAZA_SINCE, cleanHubSpot, cleanSpot, parseServerMessage, type BattleMode, type CharacterId, type ClientMessage, type GameAction, type PlazaEmote, type Spot, type Visibility } from '@shared';
import { PresenceRelay, SnapshotStore, sessionStore, type BattleListener, type HubListener, type LobbyList, type PresenceListener, type Transport } from './types.js';
import { t as tr } from '../i18n/index.js';

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
  private presence: PresenceRelay;
  private hubListeners = new Set<HubListener>();
  /** In the main plaza as this (re-sent after a reconnect), or not. */
  private hubAs: { name: string; avatar: CharacterId | null; at: Spot | null } | null = null;
  /** The room followed as a spectator (re-sent after a reconnect). */
  private watchCode: string | null = null;
  /** Everything received for the current battle, so a screen mounted later can rebuild it. */
  private battleLog: { id: number; lines: string[]; deadline: number | null } | null = null;
  private store = new SnapshotStore({ kind: 'backend', link: 'connecting', room: null, seat: null, serverProtocol: null, watching: null, error: '', errorId: 0 });
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private retry = 0;
  private retryTimer = 0;
  private disposed = false;
  /** The automatic resume sent on connect is unanswered; if its room is gone, that is not the player's error. */
  private resuming = false;
  /** Pending `listLobbies` calls; the next listing answers all of them. */
  private lobbyWaiters: Array<{ resolve: (l: LobbyList) => void; reject: (e: Error) => void }> = [];

  constructor(private url: string) { this.presence = new PresenceRelay(this.store); this.open(); }

  getSnapshot = () => this.store.get();
  subscribe = (l: () => void) => this.store.subscribe(l);

  private open() {
    if (this.disposed) return;
    this.store.set({ link: 'connecting' });
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.store.fail(tr('srv.invalidUrl')); this.store.set({ link: 'offline' }); return; }
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
      if (msg.type === 'hello') {
        this.store.set({ serverProtocol: msg.protocol });
        // Back after a drop: follow the same room again, or walk back into the plaza.
        if (msg.protocol >= HUB_SINCE && this.watchCode) this.raw({ type: 'watch', code: this.watchCode });
        else if (msg.protocol >= HUB_SINCE && this.hubAs) this.raw({ type: 'hub', on: true, ...this.hubAs });
      }
      else if (msg.type === 'state') this.store.set({ room: msg.room });
      else if (msg.type === 'joined') { this.resuming = false; sessionStore.save({ kind: 'backend', code: msg.code, token: msg.token }); this.store.set({ seat: msg.seat }); }
      else if (msg.type === 'move' || msg.type === 'emote') this.presence.hear(msg);
      else if (msg.type === 'hub' || msg.type === 'hubJoin' || msg.type === 'hubLeave' || msg.type === 'hubMove' || msg.type === 'hubEmote' || msg.type === 'hubChat') this.hubListeners.forEach(l => l(msg));
      else if (msg.type === 'watching') {
        if (msg.code !== this.store.get().watching) this.battleLog = null;
        this.watchCode = msg.code;
        this.store.set(msg.code ? { watching: msg.code } : { watching: null, room: this.store.get().seat === null ? null : this.store.get().room });
      }
      else if (msg.type === 'lobbies') { const w = this.lobbyWaiters; this.lobbyWaiters = []; w.forEach(x => x.resolve({ lobbies: msg.lobbies, now: msg.now, live: msg.live })); }
      else if (msg.type === 'battle') {
        if (msg.reset || this.battleLog?.id !== msg.id) this.battleLog = { id: msg.id, lines: [], deadline: null };
        this.battleLog.lines.push(...msg.lines); this.battleLog.deadline = msg.deadline;
        this.battleListeners.forEach(l => l(msg.id, msg.lines, msg.reset, msg.deadline));
      }
      else if (msg.type === 'error') {
        if (msg.message === 'That room is gone') { this.watchCode = null; this.battleLog = null; if (this.store.get().watching) this.store.set({ watching: null, room: null }); }
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
      this.rejectLobbies(tr('srv.connectionLost'));
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
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(tr('srv.notConnected')));
    return new Promise<LobbyList>((resolve, reject) => {
      const waiter = {
        resolve: (l: LobbyList) => { clearTimeout(timer); resolve(l); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      const timer = window.setTimeout(() => { this.lobbyWaiters = this.lobbyWaiters.filter(x => x !== waiter); reject(new Error(tr('srv.noAnswer'))); }, LIST_TIMEOUT_MS);
      this.lobbyWaiters.push(waiter);
      this.raw({ type: 'lobbies' });
    });
  }
  act(action: GameAction) {
    if (this.store.get().link !== 'online') { this.store.fail(tr('srv.reconnecting')); return; }
    this.raw(action);
  }
  choose(choice: string) { this.raw({ type: 'choose', choice }); }
  /** Presence is fire-and-forget: a spot from before a reconnect is stale, so it is never queued. */
  private live(m: ClientMessage) { if (this.ws?.readyState === WebSocket.OPEN && (this.store.get().serverProtocol ?? 0) >= PLAZA_SINCE) this.ws.send(JSON.stringify(m)); }
  move(x: number, z: number, face: number) { this.live({ type: 'move', ...cleanSpot(x, z, face) }); }
  emote(emote: PlazaEmote) { this.live({ type: 'emote', emote }); }
  onPresence(l: PresenceListener) { return this.presence.subscribe(l); }
  /** The plaza and spectating are fire-and-forget too: after a reconnect `hello` sends the current wish again. */
  private v6(m: ClientMessage) { if (this.ws?.readyState === WebSocket.OPEN && (this.store.get().serverProtocol ?? 0) >= HUB_SINCE) this.ws.send(JSON.stringify(m)); }
  hub(on: boolean, name = '', avatar: CharacterId | null = null, at: Spot | null = null) {
    if (!on && !this.hubAs) return;
    this.hubAs = on ? { name, avatar, at } : null;
    this.v6(on ? { type: 'hub', on: true, name, avatar, at } : { type: 'hub', on: false, name: '', avatar: null, at: null });
  }
  hubMove(x: number, z: number, face: number) {
    const s = cleanHubSpot(x, z, face);
    // Walking back in after a drop starts from here, not from the first spawn.
    if (this.hubAs) this.hubAs.at = s;
    if (this.hubAs) this.v6({ type: 'hubMove', ...s });
  }
  hubEmote(emote: PlazaEmote) { if (this.hubAs) this.v6({ type: 'hubEmote', emote }); }
  hubChat(text: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) { this.store.fail(tr('srv.reconnecting')); return; }
    this.v6({ type: 'hubChat', text });
  }
  onHub(l: HubListener) { this.hubListeners.add(l); return () => { this.hubListeners.delete(l); }; }
  watch(code: string) { this.watchCode = code.trim().toUpperCase(); this.v6({ type: 'watch', code: this.watchCode }); }
  unwatch() {
    this.watchCode = null; this.battleLog = null;
    this.v6({ type: 'unwatch' });
    if (this.store.get().watching) this.store.set({ watching: null, room: null });
  }
  forfeit() { this.raw({ type: 'forfeit' }); }
  onBattle(listener: BattleListener) {
    this.battleListeners.add(listener);
    if (this.battleLog) listener(this.battleLog.id, this.battleLog.lines.slice(), true, this.battleLog.deadline);
    return () => { this.battleListeners.delete(listener); };
  }
  leave() {
    this.battleLog = null; this.watchCode = null; this.hubAs = null; this.presence.reset();
    sessionStore.clear();
    this.store.set({ room: null, seat: null, watching: null });
    // A fresh socket drops the seat binding server-side without affecting the opponent's room.
    this.ws?.close(); this.ws = null; window.clearTimeout(this.retryTimer); this.retry = 0; this.rejectLobbies(tr('srv.connectionReset')); this.open();
  }
  clearError() { this.store.set({ error: '' }); }
  dispose() { this.disposed = true; window.clearTimeout(this.retryTimer); this.ws?.close(); this.ws = null; this.rejectLobbies(tr('srv.closed')); }
}
