import type { World } from '../engine/World.js';
import { TYPE_HEX } from '../engine/battle/BattleStage.js';
import { DITTO_PURPLE } from '../engine/battle/transform.js';
import type { Character, Emote } from '../characters/roster.js';
import type { BattleFx, MonView, SideId } from './model.js';

/**
 * Maps battle events onto the stage: holograms and impacts, plus partner reactions. Stage side 0 is
 * always the local player (left), side 1 the opponent, whichever simulator side they are.
 * Reactions are throttled per partner so they punctuate big moments instead of twitching every line.
 */
export function createStageBridge(world: World, mySide: SideId, mine: Character, theirs: Character | null) {
  const last: [number, number] = [0, 0];
  const react = (who: 0 | 1, e: Emote, force = false) => {
    const now = performance.now();
    if (!force && now - last[who] < 1800) return;
    last[who] = now;
    world.emote(who === 0 ? 'mine' : 'theirs', e);
  };
  const charOf = (who: 0 | 1) => (who === 0 ? mine : theirs);
  const stageSide = (s: SideId): 0 | 1 => (s === mySide ? 0 : 1);
  const showMon = (s: 0 | 1, mon: MonView, instant: boolean) => {
    const set = mon.set;
    const tint = mon.tera ? TYPE_HEX[mon.tera] : set ? TYPE_HEX[set.types[0]] : '#7fe9ff';
    world.battle.switchIn(s, set?.artId ?? set?.id ?? 0, mon.species, tint, instant);
    if (mon.tera) world.battle.tera(s, mon.tera, true);
    world.battle.status(s, mon.status);
  };

  const artOf = (set: MonView['set']) => set?.artId ?? set?.id ?? 0;
  /** Who is on the field per stage side (live views: the model keeps them current). */
  const onField: [MonView | null, MonView | null] = [null, null];
  /** Imposter copies whoever stands opposite as it enters: get that model ready (download and shaders) first. */
  const prepareMirror = () => {
    for (const s of [0, 1] as const) { const m = onField[s], foe = onField[1 - s]; if (m?.species === 'Ditto' && !m.transformed && foe) world.prepareMons([artOf(foe.set)]); }
  };
  let lastMoveColor = '#ffffff';
  return (fx: BattleFx, instant: boolean) => {
    if (fx.kind === 'switch') { onField[stageSide(fx.side)] = fx.mon; showMon(stageSide(fx.side), fx.mon, instant); prepareMirror(); if (!instant && fx.side === mySide) react(0, 'nod'); return; }
    // Transform and Imposter: morph into the copied species (at once on a reconnect or a replayed log).
    if (fx.kind === 'transform') {
      const s = stageSide(fx.side), art = artOf(fx.set);
      world.prepareMons([art]);
      world.battle.transform(s, art, fx.species, DITTO_PURPLE, instant, { status: fx.mon.status, tera: fx.mon.tera });
      return;
    }
    // Leaving the field reverts here; a faint reverts on stage when the collapse plays (BattleStage.faint).
    if (fx.kind === 'untransform') { if (fx.reason === 'switch') world.battle.untransform(stageSide(fx.side)); return; }
    // Lasting conditions are state, not animation: applied at once on a reconnect or a replayed log.
    if (fx.kind === 'sideField') { world.battle.setSideField(stageSide(fx.side), fx.layers, instant); return; }
    if (fx.kind === 'weather') { world.battle.setWeather(fx.weather); return; }
    if (instant) return;
    switch (fx.kind) {
      case 'move': {
        const s = stageSide(fx.side);
        lastMoveColor = TYPE_HEX[fx.type];
        world.battle.move(s, fx.move, fx.type, fx.category, fx.target === null ? null : stageSide(fx.target));
        // Partners lunge along with their side's attacks and cheer their own side's boosts.
        if (fx.category !== 'Status') { if (Math.random() < 0.55) react(s, charOf(s)?.personality.on.attack ?? 'punch'); } else if (Math.random() < 0.5) react(s, 'thumbs');
        break;
      }
      case 'hit': {
        const s = stageSide(fx.side);
        world.battle.hit(s, fx.lost, fx.crit, fx.effect, fx.indirect ? '#ffffff' : lastMoveColor);
        const big = fx.crit || fx.effect === 'super' || fx.lost >= 0.45;
        if (big && !fx.indirect) {
          react(s, 'surprised');
          if (fx.effect === 'super' || fx.crit) react((1 - s) as 0 | 1, 'excited');
        }
        break;
      }
      case 'heal': world.battle.heal(stageSide(fx.side)); break;
      case 'miss': world.battle.miss(stageSide(fx.side)); break;
      case 'status': world.battle.status(stageSide(fx.side), fx.status); break;
      case 'boost': { const s = stageSide(fx.side); world.battle.boost(s, fx.up); if (fx.up) react(s, 'nod'); break; }
      case 'tera': { const s = stageSide(fx.side); world.battle.tera(s, fx.type); react(s, charOf(s)?.personality.on.tossWin ?? 'excited', true); break; }
      case 'faint': {
        const s = stageSide(fx.side);
        world.battle.faint(s);
        react(s, 'sad', true);
        react((1 - s) as 0 | 1, 'excited', true);
        break;
      }
      case 'end': if (fx.winner !== null) world.battle.victory(stageSide(fx.winner)); break;
      default: break; // turn: the match screen handles results and series reactions
    }
  };
}
