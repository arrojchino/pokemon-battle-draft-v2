import { HUB_SINCE, LOBBIES_SINCE, type BattleMode, type CharacterId, type GameAction, type LiveBattle, type LobbySummary, type PlazaEmote, type PublicRoom, type Seat, type ServerMessage, type Spot, type Visibility } from '@shared';

export type TransportKind = 'backend' | 'peer';
export type BattleListener = (id: number, lines: string[], reset: boolean, deadline: number | null) => void;
export type LinkStatus = 'connecting' | 'online' | 'offline';
/** Open public lobbies plus the server clock they were read at (`createdAt` is on that clock), and live battles. */
export type LobbyList = { lobbies: LobbySummary[]; now: number; live: LiveBattle[] };
/** What the server says about the main plaza (protocol v6): who is there, then each change. */
export type HubEvent = Extract<ServerMessage, { type: 'hub' | 'hubJoin' | 'hubLeave' | 'hubMove' | 'hubEmote' | 'hubChat' }>;
export type HubListener = (m: HubEvent) => void;
/** Plaza presence from the rival's seat (protocol v5). */
export type PresenceMessage = Extract<ServerMessage, { type: 'move' | 'emote' }>;
export type PresenceListener = (m: PresenceMessage) => void;

export type SessionSnapshot = {
  kind: TransportKind;
  link: LinkStatus;
  room: PublicRoom | null;
  seat: Seat | null;
  /** Protocol announced by the dedicated server's `hello`; null before it arrives and in peer mode. */
  serverProtocol: number | null;
  /** The room followed as a spectator (its state is `room`, with `seat` null), or null. */
  watching: string | null;
  /** Last error from the authority or the link. Cleared by `clearError`. */
  error: string;
  /** Monotonic counter so UI effects can react to each new error, even repeated ones. */
  errorId: number;
};

/** Public lobbies (listing, quick join, public rooms) need a dedicated server that speaks protocol v4+. */
export const hasLobbies = (s: SessionSnapshot) => s.kind === 'backend' && (s.serverProtocol ?? 0) >= LOBBIES_SINCE;
/** The main plaza and spectating need a dedicated server that speaks protocol v6+. */
export const hasHub = (s: SessionSnapshot) => s.kind === 'backend' && (s.serverProtocol ?? 0) >= HUB_SINCE;

/** One interface for both transports so the UI never branches on networking details. */
export interface Transport {
  readonly kind: TransportKind;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Whether this transport can host in-app battles (needs the dedicated server). */
  readonly supportsBattles: boolean;
  create(name: string, bestOf: 3 | 5, avatar: CharacterId | null, mode: BattleMode, visibility: Visibility): void;
  join(code: string, name: string, avatar: CharacterId | null): void;
  /** Take the longest-waiting public lobby, or open a public one with these settings (needs `hasLobbies`). */
  quickJoin(name: string, avatar: CharacterId | null, bestOf: 3 | 5, mode: BattleMode): void;
  /** Open public lobbies waiting for a rival (needs `hasLobbies`). Rejects when offline or unanswered. */
  listLobbies(): Promise<LobbyList>;
  act(action: GameAction): void;
  choose(choice: string): void;
  forfeit(): void;
  /** This player's simulator stream. Listeners added late get the full log replayed. */
  onBattle(listener: BattleListener): () => void;
  /** Plaza presence: where this player's partner stands, and its emotes. Relayed to the rival; never stored or queued. */
  move(x: number, z: number, face: number): void;
  emote(emote: PlazaEmote): void;
  onPresence(listener: PresenceListener): () => void;
  /** The main plaza (needs `hasHub`): walk in at `at` with a name and partner (again to change them), or leave.
   *  The transport walks back in by itself after a reconnect. */
  hub(on: boolean, name?: string, avatar?: CharacterId | null, at?: Spot | null): void;
  hubMove(x: number, z: number, face: number): void;
  hubEmote(emote: PlazaEmote): void;
  hubChat(text: string): void;
  onHub(listener: HubListener): () => void;
  /** Follow a room without a seat (needs `hasHub`): its state arrives as `room`, its battle through `onBattle`. */
  watch(code: string): void;
  unwatch(): void;
  leave(): void;
  clearError(): void;
  dispose(): void;
}

/** Small observable store used by both transports. */
export class SnapshotStore {
  private listeners = new Set<() => void>();
  constructor(private snap: SessionSnapshot) {}
  get = () => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  set(patch: Partial<SessionSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach(l => l());
  }
  fail(error: string) { this.set({ error, errorId: this.snap.errorId + 1 }); }
}

const SESSION_KEY = 'pab-session';
export type SavedSession = { kind: TransportKind; code: string; token: string; host?: boolean };

export const sessionStore = {
  load(kind: TransportKind): SavedSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY) ?? (kind === 'backend' ? localStorage.getItem('pc-session') : null);
      const s = raw ? JSON.parse(raw) as Partial<SavedSession> : null;
      if (!s || typeof s.code !== 'string' || typeof s.token !== 'string') return null;
      if ((s.kind ?? 'backend') !== kind) return null;
      return { kind, code: s.code, token: s.token, host: s.host === true };
    } catch { return null; }
  },
  save(s: SavedSession) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable */ } },
  clear() { try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('pc-session'); } catch { /* ignore */ } },
};
