import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CharacterId } from '@shared';
import { ROSTER, characterById, quipKey } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { sound } from '../../audio/sound.js';
import { Icon, ScreenHeader, Spinner } from '../primitives.js';
import { Sprite, TypeBadge } from '../pokemon.js';
import { useT } from '../../i18n/index.js';

/**
 * Choose your partner: the Pokémon that stands beside you on the title screen, in lobbies, on the
 * scoreboard and on the field. Pick from the grid (or with the arrow keys); it is sent out on stage
 * and cries when it arrives.
 */
export function PartnerSelect({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: () => void; confirmLabel: string }) {
  const t = useT();
  const s = useSettings();
  const { world, status } = useWorld();
  const [focus, setFocus] = useState<CharacterId>(s.partner);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const c = characterById(focus) ?? ROSTER[0];
  const index = ROSTER.indexOf(c);

  useEffect(() => { world?.setLayout({ mode: 'select', focus }); }, [world, focus]);
  // The preview follows the pick at once: until the chosen model is on stage, its artwork and the download stand in.
  const [loaded, setLoaded] = useState(() => !world || world.isLoaded(focus));
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setLoaded(!world || world.isLoaded(focus)); setProgress(0);
    if (!world) return;
    const offs = [
      world.events.on('characterReady', ({ id }) => { if (id === focus) { setLoaded(true); world.emote(id, characterById(id)!.personality.on.select); } }),
      world.events.on('progress', p => setProgress(p.total ? p.loaded / p.total : 0)),
    ];
    return () => offs.forEach(off => off());
  }, [world, focus]);
  // Roving radio group: when a tile has keyboard focus, focus follows the selected partner.
  useEffect(() => {
    const g = grid.current;
    if (g?.contains(document.activeElement)) g.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [focus]);

  const pick = (id: CharacterId) => {
    if (id === focus || confirmed.current) return;
    setFocus(id);
    world?.pulse();
    if (world?.isLoaded(id)) window.setTimeout(() => world.emote(id, characterById(id)!.personality.on.select), 350);
  };
  /** Any partner but the one on show. */
  const surprise = () => {
    const others = ROSTER.filter(r => r.id !== focus);
    sound.play('toggle');
    pick(others[Math.floor(Math.random() * others.length)].id);
  };
  const confirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    setConfirming(true);
    settings.set({ partner: focus });
    world?.emote(focus, 'victory');
    world?.pulse();
    window.setTimeout(onConfirm, status.kind === 'fallback' ? 0 : 1100);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,dialog') || document.querySelector('dialog[open]')) return;
      const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 } as Record<string, number>)[e.key];
      if (step) {
        e.preventDefault();
        if (confirmed.current) return;
        sound.play('toggle');
        pick(ROSTER[(index + step + ROSTER.length) % ROSTER.length].id);
      }
      // Enter sends the partner out from anywhere but the other buttons, which keep their own meaning.
      if (e.key === 'Enter' && !t.closest('button:not(.ptile)')) { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="screen shop" style={{ '--partner': c.accent } as CSSProperties}>
      <ScreenHeader title={t('partner.title')} eyebrow={t('partner.eyebrow')} onBack={onBack} />
      {!loaded && status.kind !== 'fallback' && (
        <div className="shop__loading" key={c.id} role="status" aria-live="polite">
          <Sprite artId={c.dex} name={c.name} eager className="shop__loadart" />
          <span className="shop__loadline"><Spinner size={16} label="" />{t('partner.loadingModel', { name: c.name })}{progress > 0 && progress < 1 ? ` · ${Math.round(progress * 100)}%` : ''}</span>
        </div>
      )}
      <section className="panel shop__panel" aria-label={t('partner.eyebrow')}>
        <div className="shop__tag" key={c.id} aria-live="polite">
          <p className="eyebrow">{t('partner.no')} <span className="num">{String(c.dex).padStart(4, '0')}</span><span className="shop__count num">{index + 1} / {ROSTER.length}</span></p>
          <h2 className="shop__name">{c.name}</h2>
          <div className="shop__types">{c.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</div>
          <q className="shop__quip">{t(quipKey(c.id))}</q>
        </div>
        <div className="shop__grid" ref={grid} role="radiogroup" aria-label={t('partner.grid')}>
          {ROSTER.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={r.id === focus}
              tabIndex={r.id === focus ? 0 : -1}
              className={`ptile ${r.id === focus ? 'is-on' : ''}`}
              style={{ '--partner': r.accent, '--i': i } as CSSProperties}
              aria-label={r.name}
              title={r.name}
              onClick={() => pick(r.id)}
            ><Sprite artId={r.dex} name={r.name} eager className="ptile__art" /></button>
          ))}
        </div>
        <div className="shop__actions">
          <button type="button" className="btn btn--ghost btn--xl" onClick={surprise} disabled={confirming} title={t('partner.randomTitle')}><Icon name="dice" />{t('partner.surprise')}</button>
          <button type="button" className="btn btn--primary btn--xl" onClick={confirm} disabled={confirming}>
            <Icon name="check" />{confirmLabel.replace('{name}', c.name)}
          </button>
        </div>
        <p className="shop__keys" aria-hidden="true">{t.rich('partner.keys', { arrows: <><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></>, enter: <kbd>Enter</kbd>, esc: <kbd>Esc</kbd> })}</p>
      </section>
    </main>
  );
}
