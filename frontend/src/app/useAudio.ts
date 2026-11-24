import { useEffect } from 'react';
import { useSettings } from './settings.js';
import { useWorld } from './WorldProvider.js';
import { useSession } from '../net/session.js';
import { sound, type Cue } from '../audio/sound.js';
import { mixFromSettings } from '../audio/mix.js';

/**
 * Audio wiring: unlock on the first gesture, follow the volume settings (master, five categories, mute),
 * route stage noises and cries to the AudioManager, and give interface controls a light touch of sound.
 *
 * Interface sounds are deliberately sparse: the hover tick is only for main-menu items (and anything marked
 * `data-sfx-hover`), clicks sound only on real buttons, by kind (confirm, back, toggle, plain), and stay
 * silent on links, icon-only buttons and anything marked `data-sfx="none"` (`data-sfx="<cue>"` picks a cue).
 * When a screen plays its own cue for the same click, the generic one steps aside. The soundscape profile
 * (menu, plaza, battle, watch) is set by the game screens with `sound.setProfile`.
 */
export function useAudio() {
  const s = useSettings();
  const { world } = useWorld();
  useEffect(() => { sound.setMix(mixFromSettings(s)); }, [s.volume, s.musicVolume, s.criesVolume, s.uiVolume, s.battleVolume, s.muted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => world?.events.on('sound', e => {
    const { cue, pan, gain, pitch } = e as { cue: Cue; pan: number; gain?: number; pitch?: number };
    sound.play(cue, { pan, gain, pitch });
  }), [world]);
  useEffect(() => world?.events.on('cry', ({ dex, pan, gain, rate }) => sound.cry(dex, { pan, gain, rate })), [world]);
  // The soundscape follows the place: the town square has its own bed; in the stadium a battle has the battle bed
  // (quieter for a spectator) and the room, draft and results the stadium's theme; the intro uses that theme too.
  const watching = !!useSession().watching;
  useEffect(() => {
    if (!world) return;
    const follow = () => {
      const m = world.stage, env = world.environment;
      sound.setProfile(env === 'town' ? 'plaza' : m === 'arena' ? (watching ? 'watch' : 'battle') : 'menu');
    };
    follow();
    const t = window.setInterval(follow, 400);
    return () => window.clearInterval(t);
  }, [world, watching]);
  useEffect(() => {
    const unlock = () => sound.unlock();
    let hovered: Element | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const b = (e.target as Element).closest?.('.menu__item:not(:disabled), [data-sfx-hover]') ?? null;
      if (b && b !== hovered) sound.play('hover');
      hovered = b;
    };
    const click = (e: MouseEvent) => {
      const b = (e.target as Element).closest?.('button, [role=button], input[type=checkbox], [data-sfx]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const cue = clickCue(b);
      // The screen's own handler runs after this capture listener; if it plays an interface cue, stay quiet.
      if (cue) window.setTimeout(() => { if (!sound.uiPlayedWithin(80)) sound.play(cue); }, 0);
    };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    window.addEventListener('pointerover', over); window.addEventListener('click', click, true);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); window.removeEventListener('pointerover', over); window.removeEventListener('click', click, true); };
  }, []);
}

/** Which interface cue a click on this element deserves, or null for silence. */
export function clickCue(b: Element): Cue | null {
  const tag = b.getAttribute('data-sfx');
  if (tag) return tag === 'none' ? null : (tag as Cue);
  if (b.matches('.btn--primary, .btn--gold, .menu__item.is-primary')) return 'confirm';
  const label = (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
  if (b.matches('.screen-head__back') || /^(back|close|cancel|leave)\b/.test(label)) return 'back';
  if (b.matches('.seg button, input[type=checkbox], [role=switch], [role=tab], .swatch')) return 'toggle';
  if (b.matches('.btn, .menu__item')) return 'click';
  return null;
}
