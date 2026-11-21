import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CharacterId } from '@shared';
import { ROSTER, characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { sound } from '../../audio/sound.js';
import { Icon, ScreenHeader } from '../primitives.js';
import { Sprite, TypeBadge } from '../pokemon.js';

/**
 * Choose your partner: the Pokémon that stands beside you on the title screen, in lobbies, on the
 * scoreboard and on the field. Pick from the grid (or with the arrow keys); it is sent out on stage
 * and cries when it arrives.
 */
export function PartnerSelect({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: () => void; confirmLabel: string }) {
  const s = useSettings();
  const { world, status } = useWorld();
  const [focus, setFocus] = useState<CharacterId>(s.partner);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const c = characterById(focus) ?? ROSTER[0];
  const index = ROSTER.indexOf(c);

  useEffect(() => { world?.setLayout({ mode: 'select', focus }); }, [world, focus]);
  useEffect(() => {
    if (!world) return;
    const off = world.events.on('characterReady', ({ id }) => { if (id === focus) world.emote(id, characterById(id)!.personality.on.select); });
    return off;
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
      <ScreenHeader title="Choose your partner" eyebrow="Partner Pokémon" jp="相棒" onBack={onBack} />
      <section className="panel shop__panel" aria-label="Partner Pokémon">
        <div className="shop__tag" key={c.id} aria-live="polite">
          <p className="eyebrow">No. <span className="num">{String(c.dex).padStart(4, '0')}</span><span className="shop__count num">{index + 1} / {ROSTER.length}</span></p>
          <h2 className="shop__name">{c.name}</h2>
          <div className="shop__types">{c.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</div>
          <q className="shop__quip">{c.quip}</q>
        </div>
        <div className="shop__grid" ref={grid} role="radiogroup" aria-label="Partner">
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
        <button type="button" className="btn btn--primary btn--xl btn--block" onClick={confirm} disabled={confirming}>
          <Icon name="check" />{confirmLabel.replace('{name}', c.name)}
        </button>
        <p className="shop__keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>Enter</kbd> confirm <kbd>Esc</kbd> back</p>
      </section>
    </main>
  );
}
