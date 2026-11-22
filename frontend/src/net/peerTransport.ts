import type { DataConnection, default as PeerType } from 'peerjs';
import {
  PLAZA_SINCE, PROTOCOL_VERSION, cleanSpot, createRoom, isRoomCode, parseClientMessage, parseServerMessage, publicView, reduce, seatForToken, seatGuest,
  type BattleMode, type CharacterId, type ClientMessage, type GameAction, type PlazaEmote, type RoomState, type Rng, type ServerMessage, type Visibility,
} from '@shared';
import { SnapshotStore, sessionStore, type BattleListener, type HubListener, type LobbyList, type PresenceListener, type PresenceMessage, type Transport } from './types.js';

const HOST_KEY = 'pab-peer-host';
type HostSave = { id: string; room: RoomState; savedAt: number };

const cryptoRng: Rng = {
  coin: () => ((crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0 ? 'heads' : 'tails'),
  float: () => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000,
};
const token = () => crypto.randomUUID();

/**
 * Serverless mode over the public PeerJS relay. The room creator is the authority and runs the same
 * shared reducer as the backend. Fixes from v1: any extra peer could act as player 2, equal coin calls
 * soft-locked the room, the host lost the room on refresh, and the library loaded even when unused.
 */
export class PeerTransport implements Transport {
  readonly kind = 'peer' as const;
  /** The simulator runs on the dedicated server only; peer rooms use the Showdown handoff. */
  readonly supportsBattles = false;
  private store = new SnapshotStore({ kind: 'peer', link: 'connecting', room: null, seat: null, serverProtocol: null, watching: null, error: '', errorId: 0 });
  private peer: PeerType | null = null;
  private PeerCtor: typeof PeerType | null = null;
  private host: RoomState | null = null;        // set when we are the authority
  private guestConn: DataConnection | null = null; // host side: the one connection bound to seat 1
  private hostConn: DataConnection | null = null;  // guest side: our link to the host
  private pending: (() => void) | null = null;
  private presence = new Set<PresenceListener>();
  private disposed = false;

  constructor() { void this.boot(); }

  getSnapshot = () => this.store.get();
  subscribe = (l: () => void) => this.store.subscribe(l);

  private async boot(requestedId?: string, attempt = 0) {
    try {
      if (!this.PeerCtor) this.PeerCtor = (await import('peerjs')).default;
      if (this.disposed) return;
      const saved = this.loadHost();
      const id = requestedId ?? saved?.id;
      const peer = id ? new this.PeerCtor(id, { debug: 0 }) : new this.PeerCtor({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => {
        this.store.set({ link: 'online' });
        if (saved && peer.id === saved.id && !this.host) this.becomeHost(saved.room); // host refresh: room survives
        else this.resumeGuest();
        const p = this.pending; this.pending = null; p?.();
      });
      peer.on('connection', conn => this.acceptGuest(conn));
      peer.on('disconnected', () => { this.store.set({ link: 'offline' }); if (!this.disposed) setTimeout(() => { try { peer.reconnect(); } catch { /* destroyed */ } }, 1000); });
      peer.on('error', (e: Error & { type?: string }) => {
        if (e.type === 'unavailable-id' && attempt < 6) { peer.destroy(); setTimeout(() => void this.boot(id, attempt + 1), 1500); return; }
        if (e.type === 'unavailable-id') { this.dropHost(); peer.destroy(); void this.boot(undefined, 0); this.store.fail('Previous room expired. Create a new one.'); return; }
        if (e.type === 'peer-unavailable') { this.store.fail('Room not found. Check the code or ask the host to keep the page open.'); sessionStore.clear(); return; }
        this.store.fail('Relay: ' + (e.message || e.type || 'error'));
      });
    } catch (e) {
      this.store.set({ link: 'offline' });
      this.store.fail('Peer relay unavailable: ' + String((e as Error).message ?? e));
    }
  }

  private whenOpen(fn: () => void) { if (this.peer?.open) fn(); else this.pending = fn; }

  // ---------- host ----------
  private becomeHost(room: RoomState) {
    this.host = room;
    sessionStore.save({ kind: 'peer', code: room.code, token: room.players[0]!.token, host: true });
    this.store.set({ seat: 0 });
    this.publish();
  }
  private loadHost(): HostSave | null {
    try {
      const s = JSON.parse(localStorage.getItem(HOST_KEY) || 'null') as HostSave | null;
      return s && Date.now() - s.savedAt < 45 * 60_000 && typeof s.id === 'string' ? s : null;
    } catch { return null; }
  }
  private saveHost() { if (this.host && this.peer) try { localStorage.setItem(HOST_KEY, JSON.stringify({ id: this.peer.id, room: this.host, savedAt: Date.now() } satisfies HostSave)); } catch { /* ignore */ } }
  private dropHost() { try { localStorage.removeItem(HOST_KEY); } catch { /* ignore */ } }

  private publish() {
    if (!this.host) return;
    // The host plays seat 0 and sees only seat 0's view; the guest gets seat 1's (see publicView).
    const conn: [boolean, boolean] = [true, !!this.guestConn?.open];
    this.store.set({ room: publicView(this.host, conn, PROTOCOL_VERSION, 0) });
    if (this.guestConn?.open) this.guestConn.send({ type: 'state', room: publicView(this.host, conn, PROTOCOL_VERSION, 1) } satisfies ServerMessage);
    this.saveHost();
  }

  private acceptGuest(conn: DataConnection) {
    const reply = (m: ServerMessage) => { if (conn.open) conn.send(m); };
    conn.on('data', data => {
      if (!this.host) { reply({ type: 'error', message: 'Not a host' }); return; }
      const msg = parseClientMessage(data);
      if (!msg) { reply({ type: 'error', message: 'Malformed message' }); return; }
      if (msg.type === 'join' || msg.type === 'resume') {
        if (msg.type === 'resume') {
          if (seatForToken(this.host, msg.token) !== 1) { reply({ type: 'error', message: 'Invalid session' }); return; }
          this.bindGuest(conn); reply({ type: 'joined', code: this.host.code, token: msg.token, seat: 1 });
        } else {
          const t = token();
          const r = seatGuest(this.host, { name: msg.name, token: t, avatar: msg.avatar }, cryptoRng);
          if (!r.ok) { reply({ type: 'error', message: r.error }); setTimeout(() => conn.close(), 200); return; }
          this.host = r.room; this.bindGuest(conn); reply({ type: 'joined', code: this.host.code, token: t, seat: 1 });
        }
        this.publish(); return;
      }
      if (msg.type === 'create' || msg.type === 'lobbies' || msg.type === 'quick') return;
      // The main plaza and spectating need the dedicated server; a peer host has neither.
      if (msg.type === 'hub' || msg.type === 'hubMove' || msg.type === 'hubEmote' || msg.type === 'hubChat' || msg.type === 'watch' || msg.type === 'unwatch') return;
      if (msg.type === 'choose' || msg.type === 'forfeit') { reply({ type: 'error', message: 'In-app battles need the dedicated server' }); return; }
      if (conn !== this.guestConn) { reply({ type: 'error', message: 'Not seated' }); return; }
      if (msg.type === 'move') { this.hear({ type: 'move', seat: 1, x: msg.x, z: msg.z, face: msg.face }); return; }
      if (msg.type === 'emote') { this.hear({ type: 'emote', seat: 1, emote: msg.emote }); return; }
      this.apply(msg, 1, reply);
    });
    conn.on('close', () => { if (conn === this.guestConn) { this.guestConn = null; this.publish(); } });
  }
  private bindGuest(conn: DataConnection) {
    if (this.guestConn && this.guestConn !== conn) this.guestConn.close();
    this.guestConn = conn;
  }
  private apply(action: GameAction, seat: 0 | 1, reply: (m: ServerMessage) => void) {
    if (!this.host) return;
    const r = reduce(this.host, seat, action, cryptoRng);
    if (!r.ok) { reply({ type: 'error', message: r.error }); return; }
    this.host = r.room; this.publish();
  }

  // ---------- guest ----------
  private connectTo(code: string, hello: object) {
    if (!this.peer) return;
    this.hostConn?.close();
    const conn = this.peer.connect(code, { reliable: true });
    this.hostConn = conn;
    this.store.set({ link: 'connecting' });
    conn.on('open', () => { this.store.set({ link: 'online' }); conn.send(hello); });
    conn.on('data', data => {
      const msg = parseServerMessage(data);
      if (!msg) return;
      if (msg.type === 'state') this.store.set({ room: msg.room });
      else if (msg.type === 'move' || msg.type === 'emote') this.hear(msg);
      else if (msg.type === 'joined') { sessionStore.save({ kind: 'peer', code: msg.code, token: msg.token }); this.store.set({ seat: msg.seat }); }
      else if (msg.type === 'error') { if (msg.message === 'Invalid session' || msg.message === 'Room is full') sessionStore.clear(); this.store.fail(msg.message); }
    });
    conn.on('close', () => { if (this.hostConn === conn) { this.store.set({ link: 'offline' }); this.store.fail('Host disconnected'); } });
    conn.on('error', () => this.store.fail('Peer connection failed'));
  }
  private resumeGuest() {
    const s = sessionStore.load('peer');
    if (s && !s.host) this.connectTo(s.code, { type: 'resume', code: s.code, token: s.token });
  }

  // ---------- plaza presence: straight to the other peer, never stored ----------
  private hear(m: PresenceMessage) { this.presence.forEach(l => l(m)); }
  /** The host speaks as seat 0; a guest talks only to a host new enough to understand presence. */
  private live(asHost: ServerMessage, asGuest: ClientMessage) {
    if (this.host) { if (this.guestConn?.open) this.guestConn.send(asHost); }
    else if (this.hostConn?.open && (this.store.get().room?.protocol ?? 0) >= PLAZA_SINCE) this.hostConn.send(asGuest);
  }
  move(x: number, z: number, face: number) { const s = cleanSpot(x, z, face); this.live({ type: 'move', seat: 0, ...s }, { type: 'move', ...s }); }
  emote(emote: PlazaEmote) { this.live({ type: 'emote', seat: 0, emote }, { type: 'emote', emote }); }
  onPresence(l: PresenceListener) { this.presence.add(l); return () => { this.presence.delete(l); }; }

  // ---------- Transport ----------
  choose() { this.store.fail('In-app battles need the dedicated server'); }
  forfeit() { this.store.fail('In-app battles need the dedicated server'); }
  onBattle(_listener: BattleListener) { return () => {}; }
  /** Peer rooms are invite-only: there is no server to list them, so `visibility` does not apply. */
  create(name: string, bestOf: 3 | 5, avatar: CharacterId | null, _mode: BattleMode, _visibility: Visibility) {
    this.whenOpen(() => {
      if (!this.peer) return;
      this.hostConn?.close(); this.hostConn = null;
      this.becomeHost(createRoom(this.peer.id, { name, token: token(), avatar }, bestOf));
    });
  }
  join(code: string, name: string, avatar: CharacterId | null) {
    const c = code.trim();
    if (!isRoomCode(c)) { this.store.fail('That room code does not look right'); return; }
    sessionStore.clear();
    this.whenOpen(() => this.connectTo(c, { type: 'join', code: c, name, avatar }));
  }
  quickJoin() { this.store.fail('Quick join needs the dedicated server'); }
  /** The main plaza and spectators live on the dedicated server; peer mode has neither (the UI hides them). */
  hub() {}
  hubMove() {}
  hubEmote() {}
  hubChat() { this.store.fail('The plaza needs the dedicated server'); }
  onHub(_listener: HubListener) { return () => {}; }
  watch() { this.store.fail('Watching battles needs the dedicated server'); }
  unwatch() {}
  listLobbies(): Promise<LobbyList> { return Promise.reject(new Error('Public lobbies need the dedicated server')); }
  act(action: GameAction) {
    if (this.host) this.apply(action, 0, m => { if (m.type === 'error') this.store.fail(m.message); });
    else if (this.hostConn?.open) this.hostConn.send(action);
    else this.store.fail('Not connected to the host');
  }
  leave() {
    sessionStore.clear(); this.dropHost();
    this.guestConn?.close(); this.hostConn?.close();
    this.guestConn = null; this.hostConn = null; this.host = null;
    this.store.set({ room: null, seat: null });
  }
  clearError() { this.store.set({ error: '' }); }
  dispose() {
    this.disposed = true;
    this.guestConn?.close(); this.hostConn?.close(); this.peer?.destroy(); this.peer = null;
  }
}
