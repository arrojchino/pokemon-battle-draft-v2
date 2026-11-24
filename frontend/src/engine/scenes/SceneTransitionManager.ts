/**
 * Screen and scene changes for the World, as a small state machine with no three.js in it (unit tested).
 *
 * - A change of layout mode inside one environment is a short cut: dip to black (0.2 s), re-stage while dark,
 *   fade back in (0.55 s).
 * - A change of environment (intro, town, stadium) is a travel: a slower dip (0.45 s), the scene swap while
 *   dark, a hold until the new environment reports it is ready (built, compiled, models in), then a long fade
 *   in (0.9 s) so the new place is revealed, not popped.
 * - Requests coalesce. While a cut is under way the newest layout replaces the queued one, so a choice made
 *   during the dip is the one that lands (the old code applied it at once and then let the stale queued layout
 *   overwrite it: the stage showed the previous partner while the screen said the new one).
 * - Inside one mode (same environment) a request applies at once.
 */
export type EnvId = 'intro' | 'town' | 'stadium';

export type TransitionHooks<L> = {
  /** The layout's mode: a change of mode is a cut. */
  mode(l: L): string;
  /** The environment a layout belongs to: a change of environment is a travel. */
  env(l: L): EnvId;
  /** Re-stage for `l`; `modeChanged` when the mode changed, `envChanged` when the environment did. */
  apply(l: L, modeChanged: boolean, envChanged: boolean): void;
  /** Whether environment `id` is ready to be seen (the travel holds in the dark until it is, at most `holdMax`). */
  ready(id: EnvId): boolean;
  /** No fades at all (reduced motion): every change applies at once. */
  instant(): boolean;
  /** A travel to environment `to` has started (the screen is about to go dark). */
  travel?(to: EnvId): void;
};

export const CUT_OUT = 0.2, CUT_IN = 0.55, TRAVEL_OUT = 0.45, TRAVEL_IN = 0.9, HOLD_MAX = 8;

export class SceneTransitionManager<L> {
  /** 0 (clear) to 1 (black). */
  fade = 0;
  current: L | null = null;
  /** The layout waiting for the dark, or null. */
  pending: L | null = null;
  private dir: -1 | 0 | 1 = 0;
  private travel = false;
  private holding = 0;
  private holdEnv: EnvId | null = null;

  constructor(private h: TransitionHooks<L>) {}

  /** The environment on screen (of the applied layout). */
  get env(): EnvId | null { return this.applied ? this.h.env(this.applied) : null; }
  /** Whether a cut or travel is under way. */
  get busy() { return this.dir !== 0 || this.holdEnv !== null; }
  private applied: L | null = null;

  request(l: L) {
    const first = this.current === null;
    const prevMode = this.current ? this.h.mode(this.current) : null;
    this.current = l;
    // A cut is under way: whatever lands in the dark is the newest request.
    if (this.pending !== null) {
      this.pending = l;
      if (!this.travel && this.envChange(l)) { this.travel = true; this.h.travel?.(this.h.env(l)); }
      return;
    }
    const modeChanged = prevMode !== this.h.mode(l);
    if (first || !modeChanged || this.h.instant()) { this.applyNow(l); return; }
    this.pending = l;
    this.travel = this.envChange(l);
    if (this.travel) this.h.travel?.(this.h.env(l));
    this.dir = 1;
  }

  private envChange(l: L) { return !!this.applied && this.h.env(this.applied) !== this.h.env(l); }

  private applyNow(l: L) {
    const prev = this.applied;
    const envChanged = !prev || this.h.env(prev) !== this.h.env(l);
    const modeChanged = !prev || this.h.mode(prev) !== this.h.mode(l);
    this.applied = l;
    this.h.apply(l, modeChanged, envChanged);
  }

  /** Advance by `dt` seconds of wall-clock time. Returns the eased fade (0..1) for the grade pass. */
  step(dt: number): number {
    if (this.holdEnv !== null) {
      // In the dark: wait for the new place, but never forever.
      this.holding += dt;
      if (this.h.ready(this.holdEnv) || this.holding >= HOLD_MAX) { this.holdEnv = null; this.dir = -1; }
    } else if (this.dir !== 0) {
      const out = this.travel ? TRAVEL_OUT : CUT_OUT, inn = this.travel ? TRAVEL_IN : CUT_IN;
      this.fade = Math.min(1, Math.max(0, this.fade + this.dir * dt / (this.dir > 0 ? out : inn)));
      if (this.fade >= 1 && this.pending !== null) {
        const l = this.pending; this.pending = null;
        const id = this.h.env(l);
        this.applyNow(l);
        if (this.travel && !this.h.ready(id)) { this.holdEnv = id; this.holding = 0; this.dir = 0; }
        else this.dir = -1;
      } else if (this.fade <= 0 && this.dir < 0) { this.dir = 0; this.travel = false; }
    }
    const f = this.fade;
    return f * f * (3 - 2 * f);
  }
}
