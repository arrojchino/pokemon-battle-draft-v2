import { BattleModel, lineDuration, type BattleFx, type BattleState, type MonView, type SideId } from './model.js';

export type BattleSnapshot = {
  id: number;
  state: BattleState;
  /** Events are still playing; choices are hidden until the stage catches up. */
  busy: boolean;
  canChoose: boolean;
  choiceSent: string | null;
  deadline: number | null;
  active: [MonView | null, MonView | null];
  version: number;
};

type Opts = {
  mySide: SideId;
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

  constructor(private opts: Opts) {
    this.model = new BattleModel(opts.mySide);
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
    };
  }

  ingest(id: number, lines: string[], reset: boolean, deadline: number | null) {
    this.deadline = deadline;
    if (reset || id !== this.id) {
      // Fresh battle or reconnect: rebuild synchronously, then show the final situation on stage.
      window.clearTimeout(this.timer); this.playing = false; this.queue = [];
      this.id = id; this.model = new BattleModel(this.opts.mySide); this.choiceSent = null;
      if (reset) {
        for (const l of lines) this.model.apply(l);
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

  /** Apply instant lines in one go; pause (and notify React once) on each line that holds the stage. */
  private step = () => {
    for (;;) {
      const line = this.queue.shift();
      if (line === undefined) { this.playing = false; this.notify(); return; }
      this.playing = true;
      const fx = this.model.apply(line);
      if (line.startsWith('|request|')) this.afterRequestChange();
      if (line.startsWith('|error|')) this.choiceSent = null; // let the player choose again
      for (const f of fx) this.opts.onFx?.(f, false);
      const d = lineDuration(line) * (this.opts.speed?.() ?? 1);
      if (d > 0) { this.notify(); this.timer = window.setTimeout(this.step, d); return; }
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
