import { createRequire } from 'node:module';
import type * as PS from 'pokemon-showdown';
// pokemon-showdown is CommonJS; require() keeps named exports reliable from this ES module.
const { BattleStream, getPlayerStreams, Teams } = createRequire(import.meta.url)('pokemon-showdown') as typeof PS;
import { teamImport, type Pair, type Pokemon, type Seat } from '../../shared/src/index.js';

/** Format used for every in-app battle: no tier bans, Team Preview on, Level 100 (see README). */
/**
 * No tier bans or clauses (like Custom Game), but not a debug format: Custom Game's `debug` flag makes the
 * simulator report exact HP to both players, which leaks the rival's HP stat. HP Percentage Mod applies here.
 */
export const BATTLE_FORMAT = 'gen9purehackmons';

export type BattleHooks = {
  /** Lines for one seat. `reset` = this is the complete log so far (used on reconnect). */
  send(seat: Seat, lines: string[], reset: boolean, deadline: number | null): void;
  status(status: 'preview' | 'active' | 'ended', turn: number): void;
  end(winner: Seat | null, turns: number): void;
  /** Lines of the public stream (what a spectator may see: HP as percentages, no requests). */
  watch?(lines: string[]): void;
};

export type BattleTiming = { decisionMs: number; previewMs: number };
const DEFAULT_TIMING: BattleTiming = { decisionMs: 150_000, previewMs: 90_000 };

/**
 * One server-authoritative battle on Pokémon Showdown's simulator (MIT).
 * Each player receives only their own stream (the simulator splits secret information such as exact HP
 * and the |request| JSON per side), so a client can never see the opponent's hidden state.
 * A decision timer plays `default` for a player who does not choose in time, so a battle cannot stall.
 */
export class BattleSession {
  private streams: ReturnType<typeof getPlayerStreams>;
  private logs: Pair<string[]> = [[], []];
  private publicLog: string[] = [];
  private deadlines: Pair<number | null> = [null, null];
  private timers: Pair<ReturnType<typeof setTimeout> | null> = [null, null];
  private turn = 0;
  private ended = false;
  private waiting: Pair<boolean> = [false, false];

  constructor(readonly id: number, teams: Pair<Pokemon[]>, names: Pair<string>, private hooks: BattleHooks, private timing: BattleTiming = DEFAULT_TIMING) {
    this.streams = getPlayerStreams(new BattleStream());
    // Identical display names would make |win| ambiguous; the simulator only needs them distinct.
    const n: Pair<string> = [names[0], names[1] === names[0] ? `${names[1]} (2)` : names[1]];
    const pack = (t: Pokemon[]) => Teams.pack(Teams.import(teamImport(t)));
    void this.pump(0); void this.pump(1); void this.watch(n); void this.pumpPublic();
    void this.streams.omniscient.write(
      `>start ${JSON.stringify({ formatid: BATTLE_FORMAT })}\n` +
      `>player p1 ${JSON.stringify({ name: n[0], team: pack(teams[0]) })}\n` +
      `>player p2 ${JSON.stringify({ name: n[1], team: pack(teams[1]) })}`,
    );
  }

  private async pump(seat: Seat) {
    const stream = seat === 0 ? this.streams.p1 : this.streams.p2;
    for await (const chunk of stream) {
      if (this.ended && !chunk.includes('|win|') && !chunk.includes('|tie')) continue;
      const lines = chunk.split('\n').filter(l => l && !l.startsWith('|debug|') && !l.startsWith('|t:|'));
      for (const l of lines) {
        if (l.startsWith('|request|')) {
          let req: { wait?: boolean; teamPreview?: boolean } = {};
          try { req = JSON.parse(l.slice(9)); } catch { /* ignore */ }
          this.waiting[seat] = !!req.wait;
          if (req.wait) this.clearTimer(seat); else this.armTimer(seat, req.teamPreview ? this.timing.previewMs : this.timing.decisionMs);
        } else if (l.startsWith('|error|')) {
          // Invalid choice: the same request stays open, so the clock keeps running from a fresh window.
          this.armTimer(seat, this.timing.decisionMs);
        }
      }
      this.logs[seat].push(...lines);
      this.hooks.send(seat, lines, false, this.deadlines[seat]);
    }
  }

  /** The spectator channel: kept whole for late arrivals and passed on as it comes. */
  private async pumpPublic() {
    for await (const chunk of this.streams.spectator) {
      const lines = chunk.split('\n').filter(l => l && !l.startsWith('|debug|') && !l.startsWith('|t:|'));
      if (!lines.length) continue;
      this.publicLog.push(...lines);
      this.hooks.watch?.(lines);
    }
  }
  /** The public stream so far, for a spectator who just arrived. */
  spectatorLog() { return this.publicLog.slice(); }

  private async watch(names: Pair<string>) {
    for await (const chunk of this.streams.omniscient) {
      for (const l of chunk.split('\n')) {
        if (l === '|teampreview' || l.startsWith('|teampreview|')) this.hooks.status('preview', 0);
        else if (l.startsWith('|turn|')) { this.turn = Number(l.slice(6)) || this.turn; this.hooks.status('active', this.turn); }
        else if (l.startsWith('|win|') || l === '|tie') {
          if (this.ended) continue;
          this.ended = true; this.clearTimer(0); this.clearTimer(1);
          const name = l.startsWith('|win|') ? l.slice(5) : null;
          const winner = name === null ? null : name === names[0] ? 0 : name === names[1] ? 1 : null;
          this.hooks.status('ended', this.turn);
          this.hooks.end(winner, this.turn);
        }
      }
    }
  }

  private armTimer(seat: Seat, ms: number) {
    this.clearTimer(seat);
    if (this.ended) return;
    this.deadlines[seat] = Date.now() + ms;
    this.timers[seat] = setTimeout(() => { this.timers[seat] = null; this.choose(seat, 'default', true); }, ms);
    this.timers[seat]!.unref?.();
  }
  private clearTimer(seat: Seat) {
    if (this.timers[seat]) clearTimeout(this.timers[seat]!);
    this.timers[seat] = null; this.deadlines[seat] = null;
  }

  /** Forward a validated choice to the simulator. Invalid choices come back as |error| lines to that player. */
  choose(seat: Seat, choice: string, auto = false) {
    if (this.ended) return;
    if (!auto) this.clearTimer(seat);
    void (seat === 0 ? this.streams.p1 : this.streams.p2).write(choice);
  }

  forfeit(seat: Seat) {
    if (this.ended) return;
    void this.streams.omniscient.write(`>forcelose p${seat + 1}`);
  }

  /** Full log for a (re)connecting player, so their client can rebuild the battle state exactly. */
  replay(seat: Seat) { this.hooks.send(seat, this.logs[seat].slice(), true, this.deadlines[seat]); }

  get isEnded() { return this.ended; }

  destroy() {
    this.ended = true; this.clearTimer(0); this.clearTimer(1);
    void this.streams.omniscient.writeEnd();
  }
}
