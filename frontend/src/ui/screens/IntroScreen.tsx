import { useCallback, useEffect, useRef, useState } from 'react';
import { characterById } from '../../characters/roster.js';
import { useReducedMotion, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { Icon } from '../primitives.js';
import { useT } from '../../i18n/index.js';

type Beat = 'wait' | 'start' | 'reveal' | 'title' | 'end';

/**
 * The opening cinematic, drawn by the World in its own scene (`scenes/intro`): a flight along a lantern path that
 * ends on the partner's entrance and the game's title. Letterbox bars, the title card and a Skip control are the
 * only interface. Esc, Enter, Space or the button skips it; without WebGL or with reduced motion it is skipped.
 */
export function IntroScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const s = useSettings();
  const { world, status } = useWorld();
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState<Beat>('wait');
  // The partner is fixed for the whole intro (a change elsewhere must not restart it).
  const [partner] = useState(s.partner);
  const done = useRef(false);
  const finish = useCallback(() => { if (done.current) return; done.current = true; setBeat('end'); onDone(); }, [onDone]);

  useEffect(() => { world?.setLayout({ mode: 'intro', partner }); }, [world, partner]);
  useEffect(() => {
    if (!world) return;
    const offs = [world.events.on('introBeat', ({ kind }) => setBeat(kind)), world.events.on('introEnd', finish)];
    return () => offs.forEach(off => off());
  }, [world, finish]);
  useEffect(() => { if (status.kind === 'fallback' || reduced) finish(); }, [status.kind, reduced, finish]);
  // Never stuck: whatever happens to the intro's assets, the game moves on.
  useEffect(() => { const tm = window.setTimeout(finish, 30000); return () => window.clearTimeout(tm); }, [finish]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const c = characterById(partner);
  const titled = beat === 'title' || beat === 'end';
  return (
    <main className={`screen intro is-${beat}`} aria-label={t('intro.label')}>
      <div className="intro__bar intro__bar--top" aria-hidden="true" />
      <div className="intro__bar intro__bar--bottom" aria-hidden="true" />
      <div className={`intro__title ${titled ? 'is-on' : ''}`} aria-hidden={!titled}>
        <h1 className="wordmark">
          <span className="wordmark__pre">Pokémon</span>
          <span className="wordmark__main"><span>Battle</span> <span>Draft</span></span>
        </h1>
        <p className="eyebrow intro__tag"><Icon name="trophy" size={14} />{t('intro.tagline')}</p>
      </div>
      {(beat === 'reveal' || titled) && c && <p className={`intro__partner ${titled ? 'is-dim' : ''}`} key="p">{t('intro.partner', { name: c.name })}</p>}
      <button type="button" className="intro__skip" onClick={finish} data-sfx="back">{t('intro.skip')}<kbd>Esc</kbd></button>
    </main>
  );
}
