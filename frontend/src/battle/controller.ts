import { BattleModel, lineDuration, type BattleFx, type BattleState, type LogEntry, type MonView, type SideId } from './model.js';

export type BattleSnapshot = {
  id: number;
  state: BattleState;
  /** Events are still playing; choices are hidden until the stage catches up. */
  busy: boolean;
  canChoose: boolean;
  choiceSent: string | null;
  deadline: number | null;
  active: [MonView | null, MonView | null];
  /** The messages on screen right now: everything said since the last pause that cleared the box (oldest first). */
  caption: LogEntry[];
  version: number;
};

/** A damage line that only states the HP lost (the bar shows it). */
const HP_ONLY = / lost \d+(\.\d+)?% of its health\.$/;
/** Whether a log entry belongs in the message box (turn markers and bare HP figures do not). */
export const inBox = (e: LogEntry) => e.kind !== 'turn' && !HP_ONLY.test(e.text);
/** Messages that are asides (ability tags, items shown, hit counts): read quickly. */
const MINOR = /^\[.*\]$|^Hit \d+ times?!$| has .+\.$| ate its | was used up\.$|'s .+ ended\.$/;
/**
 * How long a set of messages needs on screen to be read: a base plus a per-character allowance, with a floor
 * and a ceiling. Asides get a shorter floor so they do not drag the pace.
 */
export function readTime(entries: readonly LogEntry[]): number {
  if (!entries.length) return 0;
  const chars = entries.reduce((n, e) => n + e.text.length, 0);
  const minor = entries.every(e => MINOR.test(e.text));
  return minor ? Math.min(1100, Math.max(650, 420 + 30 * chars)) : Math.min(2300, Math.max(900, 420 + 30 * chars));
}

type Opts = {
  mySide: SideId;
  /** Watching someone else's battle: no requests, and the log names both trainers. */
  spectator?: boolean;
  send: (choice: string) => void;
  onFx?: (fx: BattleFx, instant: boolean) => void;
  /** Multiplier on line durations (reduced motion and `?fast` shorten it). */
  speed?: () => number;
};

/**
 * Plays a player's simulator stream at a readable pace. Lines are queued and applied one at a time,
 * each holding the stage for its duration, so HP bars, text and 3D effects stay in step. A reconnect
 * (`reset`) rebuilds the whole state instantly without replaying animations.
 */
export class BattleController {
  private model: BattleModel;
  private queue: string[] = [];
  private timer = 0;
  private playing = false;
  private listeners = new Set<() => void>();
  private snap: BattleSnapshot;
  private id = 0;
  private choiceSent: string | null = null;
  private deadline: number | null = null;
  private version = 0;
  /** First log id of the messages on screen, how long they have been up, and whether the next pause clears them. */
  private batchFrom = 0;
  private shownMs = 0;
  private clearNext = false;
  private lastPauseId = 0;

  constructor(private opts: Opts) {
    this.model = new BattleModel(opts.mySide, opts.spectator);
    this.snap = this.build();
  }

  getSnapshot = () => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private notify() { this.snap = this.build(); this.listeners.forEach(l => l()); }
  private build(): BattleSnapshot {
    const st = this.model.state;
    const req = st.request;
    const busy = this.playing || this.queue.length > 0;
    return {
      id: this.id, state: st, busy, choiceSent: this.choiceSent, deadline: this.deadline, version: ++this.version,
      canChoose: !busy && !!req && !req.wait && this.choiceSent === null && st.phase !== 'ended',
      active: [this.model.activeMon(0), this.model.activeMon(1)],
      caption: this.batch(),
    };
  }

  ingest(id: number, lines: string[], reset: boolean, deadline: number | null) {
    this.deadline = deadline;
    if (reset || id !== this.id) {
      // Fresh battle or reconnect: rebuild synchronously, then show the final situation on stage.
      window.clearTimeout(this.timer); this.playing = false; this.queue = [];
      this.batchFrom = 0; this.shownMs = 0; this.clearNext = false; this.lastPauseId = 0;
      this.id = id; this.model = new BattleModel(this.opts.mySide, this.opts.spectator); this.choiceSent = null;
      if (reset) {
        for (const l of lines) this.model.apply(l);
        // What happened before the reconnect is history: the box starts empty.
        this.batchFrom = this.lastId() + 1;
        this.afterRequestChange();
        this.resync();
        this.notify();
        return;
      }
    }
    this.queue.push(...lines);
    if (!this.playing) this.step();
    else this.notify();
  }

  /** The simulator sends no rqid on player streams: every |request| line opens a new decision. */
  private afterRequestChange() { this.choiceSent = null; }

  /**
   * The messages since the box was last cleared, at most the last three. Turn markers and plain damage
   * figures stay in the log only: the HP bar and the floating number already tell that part.
   */
  private batch(): LogEntry[] {
    const log = this.model.state.log, out: LogEntry[] = [];
    for (let i = log.length - 1; i >= 0 && log[i].id >= this.batchFrom && out.length < 3; i--) {
      const e = log[i];
      if (inBox(e)) out.unshift(e);
    }
    return out;
  }
  private lastId() { const log = this.model.state.log; return log.length ? log[log.length - 1].id : 0; }

  /**
   * Apply instant lines in one go; pause (and notify React once) on each line that holds the stage.
   * Messages pile up in one box until a pause has given them time to be read: a move keeps its own timing
   * (its damage must land on the animation's impact), and whatever reading time is still owed is added to the
   * next pause (the damage, the status, the faint). Then the box clears for the next messages.
   */
  private step = () => {
    for (;;) {
      if (this.clearNext && this.lastId() > this.lastPauseId) { this.batchFrom = this.lastPauseId + 1; this.shownMs = 0; this.clearNext = false; }
      const line = this.queue.shift();
      if (line === undefined) { this.playing = false; this.notify(); return; }
      this.playing = true;
      const fx = this.model.apply(line);
      if (line.startsWith('|request|')) this.afterRequestChange();
      if (line.startsWith('|error|')) this.choiceSent = null; // let the player choose again
      for (const f of fx) this.opts.onFx?.(f, false);
      // A new message after a cleared box starts the next batch.
      if (this.clearNext && this.lastId() > this.lastPauseId) { this.batchFrom = this.lastPauseId + 1; this.shownMs = 0; this.clearNext = false; }
      const speed = this.opts.speed?.() ?? 1;
      const base = lineDuration(line) * speed;
      if (base <= 0) continue;
      const isMove = line.startsWith('|move|');
      const d = isMove ? base : Math.max(base, readTime(this.batch()) * speed - this.shownMs);
      this.shownMs += d;
      if (!isMove) { this.clearNext = true; this.lastPauseId = this.lastId(); }
      this.notify(); this.timer = window.setTimeout(this.step, d); return;
    }
  };

  /** Put the current active Pokémon on stage instantly (after a reconnect or when the stage arrives late). */
  resync() {
    for (const side of [0, 1] as const) { const m = this.model.activeMon(side); if (m && !m.fainted) this.opts.onFx?.({ kind: 'switch', side, mon: m }, true); }
  }

  choose(choice: string) {
    if (!this.snap.canChoose && !choice.startsWith('team ')) return;
    this.choiceSent = choice;
    this.opts.send(choice);
    this.notify();
  }

  dispose() { window.clearTimeout(this.timer); this.listeners.clear(); }
}
