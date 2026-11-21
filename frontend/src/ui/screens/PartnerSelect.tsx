import { useEffect, useState, type CSSProperties } from 'react';
import type { CharacterId } from '@shared';
import { ROSTER, characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { Icon } from '../primitives.js';

/**
 * The paint shop. Everyone gets the same scrappy battle bot; you pick the paint. One name, one
 * line of attitude, eight swatches. The bot pops into each new coat and shows it off.
 */
export function PartnerSelect({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: () => void; confirmLabel: string }) {
  const s = useSettings();
  const { world, status } = useWorld();
  const [focus, setFocus] = useState<CharacterId>(s.partner);
  const [confirming, setConfirming] = useState(false);
  const c = characterById(focus) ?? ROSTER[0];

  useEffect(() => { world?.setLayout({ mode: 'select', focus }); }, [world, focus]);
  useEffect(() => {
    if (!world) return;
    const off = world.events.on('characterReady', ({ id }) => { if (id === focus) world.emote(id, characterById(id)!.personality.on.select); });
    return off;
  }, [world, focus]);

  const pick = (id: CharacterId) => {
    if (id === focus) return;
    setFocus(id);
    world?.pulse();
    window.setTimeout(() => world?.emote(id, characterById(id)!.personality.on.select), 350);
  };
  const confirm = () => {
    if (confirming) return;
    setConfirming(true);
    settings.set({ partner: focus });
    world?.emote(focus, 'thumbs');
    world?.pulse();
    window.setTimeout(onConfirm, status.kind === 'fallback' ? 0 : 900);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,dialog')) return;
      const i = ROSTER.findIndex(r => r.id === focus);
      if (e.key === 'ArrowRight') pick(ROSTER[(i + 1) % ROSTER.length].id);
      if (e.key === 'ArrowLeft') pick(ROSTER[(i + ROSTER.length - 1) % ROSTER.length].id);
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="screen select shop" style={{ '--accent': c.accent, '--accent2': c.accent2 } as CSSProperties}>
      <header className="screen__head">
        <button className="btn btn--ghost" onClick={onBack}><Icon name="back" />Back</button>
        <p className="eyebrow">Paint shop</p>
      </header>
      <section className="shop__tag" key={c.id} aria-live="polite">
        <h2 className="shop__name">{c.name}</h2>
        <q className="shop__quip">{c.quip}</q>
      </section>
      <nav className="roster shop__swatches" aria-label="Paint">
        {ROSTER.map((r, i) => (
          <button
            key={r.id}
            className={`roster__card swatch ${r.id === focus ? 'is-on' : ''}`}
            style={{ '--paint': r.paint, '--accent': r.accent, '--i': i } as CSSProperties}
            aria-pressed={r.id === focus}
            aria-label={r.name}
            title={r.name}
            onClick={() => pick(r.id)}
          ><i /></button>
        ))}
      </nav>
      <footer className="select__cta">
        <button className="btn btn--primary btn--xl" onClick={confirm} disabled={confirming}>
          <Icon name="spark" />{confirmLabel.replace('{name}', c.name)}
        </button>
        <small>← → to repaint · Enter to roll out</small>
      </footer>
    </main>
  );
}
