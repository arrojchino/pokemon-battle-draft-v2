import type { BattleMode, CharacterId, GameAction, PublicRoom, Seat } from '@shared';

export type TransportKind = 'backend' | 'peer';
export type BattleListener = (id: number, lines: string[], reset: boolean, deadline: number | null) => void;
export type LinkStatus = 'connecting' | 'online' | 'offline';

export type SessionSnapshot = {
  kind: TransportKind;
  link: LinkStatus;
  room: PublicRoom | null;
  seat: Seat | null;
  /** Last error from the authority or the link. Cleared by `clearError`. */
  error: string;
  /** Monotonic counter so UI effects can react to each new error, even repeated ones. */
  errorId: number;
};

/** One interface for both transports so the UI never branches on networking details. */
export interface Transport {
  readonly kind: TransportKind;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Whether this transport can host in-app battles (needs the dedicated server). */
  readonly supportsBattles: boolean;
  create(name: string, bestOf: 3 | 5, avatar: CharacterId | null, mode: BattleMode): void;
  join(code: string, name: string, avatar: CharacterId | null): void;
  act(action: GameAction): void;
  choose(choice: string): void;
  forfeit(): void;
  /** This player's simulator stream. Listeners added late get the full log replayed. */
  onBattle(listener: BattleListener): () => void;
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
