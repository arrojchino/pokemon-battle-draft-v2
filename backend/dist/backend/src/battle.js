import { createRequire } from 'node:module';
// pokemon-showdown is CommonJS; require() keeps named exports reliable from this ES module.
const { BattleStream, getPlayerStreams, Teams } = createRequire(import.meta.url)('pokemon-showdown');
import { teamImport } from '../../shared/src/index.js';
/** Format used for every in-app battle: no tier bans, Team Preview on, Level 100 (see README). */
export const BATTLE_FORMAT = 'gen9customgame';
const DEFAULT_TIMING = { decisionMs: 150_000, previewMs: 90_000 };
/**
 * One server-authoritative battle on Pokémon Showdown's simulator (MIT).
 * Each player receives only their own stream (the simulator splits secret information such as exact HP
 * and the |request| JSON per side), so a client can never see the opponent's hidden state.
 * A decision timer plays `default` for a player who does not choose in time, so a battle cannot stall.
 */
export class BattleSession {
    id;
    hooks;
    timing;
    streams;
    logs = [[], []];
    deadlines = [null, null];
    timers = [null, null];
    turn = 0;
    ended = false;
    waiting = [false, false];
    constructor(id, teams, names, hooks, timing = DEFAULT_TIMING) {
        this.id = id;
        this.hooks = hooks;
        this.timing = timing;
        this.streams = getPlayerStreams(new BattleStream());
        // Identical display names would make |win| ambiguous; the simulator only needs them distinct.
        const n = [names[0], names[1] === names[0] ? `${names[1]} (2)` : names[1]];
        const pack = (t) => Teams.pack(Teams.import(teamImport(t)));
        void this.pump(0);
        void this.pump(1);
        void this.watch(n);
        void this.streams.omniscient.write(`>start ${JSON.stringify({ formatid: BATTLE_FORMAT })}\n` +
            `>player p1 ${JSON.stringify({ name: n[0], team: pack(teams[0]) })}\n` +
            `>player p2 ${JSON.stringify({ name: n[1], team: pack(teams[1]) })}`);
    }
    async pump(seat) {
        const stream = seat === 0 ? this.streams.p1 : this.streams.p2;
        for await (const chunk of stream) {
            if (this.ended && !chunk.includes('|win|') && !chunk.includes('|tie'))
                continue;
            const lines = chunk.split('\n').filter(l => l && !l.startsWith('|debug|') && !l.startsWith('|t:|'));
            for (const l of lines) {
                if (l.startsWith('|request|')) {
                    let req = {};
                    try {
                        req = JSON.parse(l.slice(9));
                    }
                    catch { /* ignore */ }
                    this.waiting[seat] = !!req.wait;
                    if (req.wait)
                        this.clearTimer(seat);
                    else
                        this.armTimer(seat, req.teamPreview ? this.timing.previewMs : this.timing.decisionMs);
                }
                else if (l.startsWith('|error|')) {
                    // Invalid choice: the same request stays open, so the clock keeps running from a fresh window.
                    this.armTimer(seat, this.timing.decisionMs);
                }
            }
            this.logs[seat].push(...lines);
            this.hooks.send(seat, lines, false, this.deadlines[seat]);
        }
    }
    async watch(names) {
        for await (const chunk of this.streams.omniscient) {
            for (const l of chunk.split('\n')) {
                if (l === '|teampreview' || l.startsWith('|teampreview|'))
                    this.hooks.status('preview', 0);
                else if (l.startsWith('|turn|')) {
                    this.turn = Number(l.slice(6)) || this.turn;
                    this.hooks.status('active', this.turn);
                }
                else if (l.startsWith('|win|') || l === '|tie') {
                    if (this.ended)
                        continue;
                    this.ended = true;
                    this.clearTimer(0);
                    this.clearTimer(1);
                    const name = l.startsWith('|win|') ? l.slice(5) : null;
                    const winner = name === null ? null : name === names[0] ? 0 : name === names[1] ? 1 : null;
                    this.hooks.status('ended', this.turn);
                    this.hooks.end(winner, this.turn);
                }
            }
        }
    }
    armTimer(seat, ms) {
        this.clearTimer(seat);
        if (this.ended)
            return;
        this.deadlines[seat] = Date.now() + ms;
        this.timers[seat] = setTimeout(() => { this.timers[seat] = null; this.choose(seat, 'default', true); }, ms);
        this.timers[seat].unref?.();
    }
    clearTimer(seat) {
        if (this.timers[seat])
            clearTimeout(this.timers[seat]);
        this.timers[seat] = null;
        this.deadlines[seat] = null;
    }
    /** Forward a validated choice to the simulator. Invalid choices come back as |error| lines to that player. */
    choose(seat, choice, auto = false) {
        if (this.ended)
            return;
        if (!auto)
            this.clearTimer(seat);
        void (seat === 0 ? this.streams.p1 : this.streams.p2).write(choice);
    }
    forfeit(seat) {
        if (this.ended)
            return;
        void this.streams.omniscient.write(`>forcelose p${seat + 1}`);
    }
    /** Full log for a (re)connecting player, so their client can rebuild the battle state exactly. */
    replay(seat) { this.hooks.send(seat, this.logs[seat].slice(), true, this.deadlines[seat]); }
    get isEnded() { return this.ended; }
    destroy() {
        this.ended = true;
        this.clearTimer(0);
        this.clearTimer(1);
        void this.streams.omniscient.writeEnd();
    }
}
