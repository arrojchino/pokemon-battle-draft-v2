import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CharacterId } from '@shared';
import { ROSTER, characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { sound } from '../../audio/sound.js';
import { Icon, ScreenHeader } from '../primitives.js';

/**
 * The paint shop. Everyone gets the same scrappy battle bot; you pick the paint. One name, one
 * line of attitude, eight swatches. The bot pops into each new coat and shows it off.
 */
export function PartnerSelect({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: () => void; confirmLabel: string }) {
  const s = useSettings();
  const { world, status } = useWorld();
  const [focus, setFocus] = useState<CharacterId>(s.partner);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);
  const swatches = useRef<HTMLDivElement>(null);
  const c = characterById(focus) ?? ROSTER[0];
  const index = ROSTER.indexOf(c);

  useEffect(() => { world?.setLayout({ mode: 'select', focus }); }, [world, focus]);
  useEffect(() => {
    if (!world) return;
    const off = world.events.on('characterReady', ({ id }) => { if (id === focus) world.emote(id, characterById(id)!.personality.on.select); });
    return off;
  }, [world, focus]);
  // Roving radio group: when a swatch has keyboard focus, focus follows the selected coat.
  useEffect(() => {
    const g = swatches.current;
    if (g?.contains(document.activeElement)) g.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [focus]);

  const pick = (id: CharacterId) => {
    if (id === focus || confirmed.current) return;
    setFocus(id);
    world?.pulse();
    window.setTimeout(() => world?.emote(id, characterById(id)!.personality.on.select), 350);
  };
  const confirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    setConfirming(true);
    settings.set({ partner: focus });
    world?.emote(focus, 'thumbs');
    world?.pulse();
    window.setTimeout(onConfirm, status.kind === 'fallback' ? 0 : 900);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,dialog') || document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (confirmed.current) return;
        sound.play('toggle');
        pick(ROSTER[(index + (e.key === 'ArrowRight' ? 1 : ROSTER.length - 1)) % ROSTER.length].id);
      }
      // Enter rolls out from anywhere but the other buttons, which keep their own meaning (Back stays Back).
      if (e.key === 'Enter' && !t.closest('button:not(.swatch)')) { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="screen shop" style={{ '--partner': c.accent } as CSSProperties}>
      <ScreenHeader title="Paint shop" eyebrow="Battle bot" jp="塗装" onBack={onBack} />
      <section className="panel shop__panel" aria-label="Paint job">
        <div className="shop__tag" key={c.id} aria-live="polite">
          <p className="eyebrow">Coat <span className="num">{index + 1} / {ROSTER.length}</span></p>
          <h2 className="shop__name">{c.name}</h2>
          <q className="shop__quip">{c.quip}</q>
        </div>
        <div className="shop__swatches" ref={swatches} role="radiogroup" aria-label="Paint">
          {ROSTER.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={r.id === focus}
              tabIndex={r.id === focus ? 0 : -1}
              className={`swatch ${r.id === focus ? 'is-on' : ''}`}
              style={{ '--paint': r.paint, '--i': i } as CSSProperties}
              aria-label={r.name}
              title={r.name}
              onClick={() => pick(r.id)}
            ><i /></button>
          ))}
        </div>
        <button type="button" className="btn btn--primary btn--xl btn--block" onClick={confirm} disabled={confirming}>
          <Icon name="check" />{confirmLabel.replace('{name}', c.name)}
        </button>
        <p className="shop__keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> repaint <kbd>Enter</kbd> confirm <kbd>Esc</kbd> back</p>
      </section>
    </main>
  );
}
