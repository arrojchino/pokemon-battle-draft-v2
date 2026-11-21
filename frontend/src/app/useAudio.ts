import { useEffect } from 'react';
import { useSettings } from './settings.js';
import { useWorld } from './WorldProvider.js';
import { sound } from '../audio/sound.js';

/**
 * Sound effects wiring: unlock on the first gesture, follow volume and mute, route stage noises, and
 * give every button a hover tick and a click. There is no background music anywhere in the game.
 */
export function useAudio() {
  const s = useSettings();
  const { world } = useWorld();
  useEffect(() => { sound.setVolume(s.volume, s.muted); }, [s.volume, s.muted]);
  useEffect(() => world?.events.on('sound', ({ cue, pan, gain }) => sound.play(cue, { pan, gain })), [world]);
  useEffect(() => world?.events.on('cry', ({ dex, pan, gain, rate }) => sound.cry(dex, { pan, gain, rate })), [world]);
  useEffect(() => {
    const unlock = () => sound.unlock();
    let hovered: Element | null = null;
    const over = (e: PointerEvent) => {
      const b = (e.target as Element).closest?.('button:not(:disabled), .menu__item, a');
      if (b && b !== hovered && e.pointerType === 'mouse') sound.play('hover');
      hovered = b;
    };
    const click = (e: MouseEvent) => {
      const b = (e.target as Element).closest?.('button, a, input[type=checkbox]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const label = b.textContent?.trim().toLowerCase() ?? '';
      sound.play(b.matches('.btn--primary, .btn--gold, .menu__item.is-primary') ? 'confirm' : label.startsWith('back') || b.matches('[aria-label^="Close"]') ? 'back' : b.matches('.seg button, input[type=checkbox], .swatch') ? 'toggle' : 'click');
    };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    window.addEventListener('pointerover', over); window.addEventListener('click', click, true);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); window.removeEventListener('pointerover', over); window.removeEventListener('click', click, true); };
  }, []);
}
