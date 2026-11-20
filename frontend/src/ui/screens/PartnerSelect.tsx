import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CharacterId } from '@shared';
import { ROSTER, characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { Icon } from '../primitives.js';

/**
 * Partner selection. Hovering a card (or the 3D character) gets a small reaction; selecting moves the
 * camera to her and she introduces herself; confirming plays her signature move before continuing.
 */
export function PartnerSelect({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: () => void; confirmLabel: string }) {
  const s = useSettings();
  const { world, status } = useWorld();
  const [focus, setFocus] = useState<CharacterId>(s.partner);
  const [confirming, setConfirming] = useState(false);
  const c = characterById(focus)!;
  const lastHover = useRef(0);

  useEffect(() => { world?.setLayout({ mode: 'select', focus }); }, [world, focus]);
  useEffect(() => {
    if (!world) return;
    const offs = [
      world.events.on('characterClick', ({ id }) => setFocus(id)),
      world.events.on('characterHover', ({ id }) => { world.hover(id); }),
    ];
    return () => { offs.forEach(f => f()); world.hover(null); };
  }, [world]);

  const pick = (id: CharacterId) => {
    if (id === focus) return;
    setFocus(id);
    window.setTimeout(() => world?.emote(id, characterById(id)!.personality.on.select), 450);
  };
  const hover = (id: CharacterId | null) => {
    world?.hover(id);
    const now = performance.now();
    if (id && id !== focus && now - lastHover.current > 1200) { lastHover.current = now; world?.emote(id, 'nod'); }
  };
  const confirm = () => {
    if (confirming) return;
    setConfirming(true);
    settings.set({ partner: focus });
    world?.emote(focus, c.personality.on.select === 'nod' ? 'greet' : c.personality.on.select);
    world?.pulse();
    window.setTimeout(onConfirm, status.kind === 'fallback' ? 0 : 1100);
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
    <main className="screen select" style={{ '--accent': c.accent, '--accent2': c.accent2 } as CSSProperties}>
      <header className="screen__head">
        <button className="btn btn--ghost" onClick={onBack}><Icon name="back" />Back</button>
        <p className="eyebrow"><span className="jp">パートナー選択</span> Choose your partner</p>
      </header>
      <section className="profile panel" key={c.id} aria-live="polite">
        <span className="profile__jp jp">{c.nameJp}</span>
        <h2 className="profile__name">{c.name}</h2>
        <p className="profile__title">{c.title} <span>Age {c.age}</span></p>
        <q className="profile__line">{c.tagline}</q>
        <p className="profile__bio">{c.bio}</p>
        <ul className="profile__traits">{c.traits.map(t => <li key={t}>{t}</li>)}</ul>
        <div className="profile__stats">
          {c.draftStyle.map(d => (
            <div key={d.label} className="stat"><span>{d.label}</span><i style={{ '--v': d.value } as CSSProperties} /></div>
          ))}
        </div>
        <p className="profile__credit">Model: {c.credit.model} · {c.credit.license}</p>
      </section>
      <nav className="roster" aria-label="Partners">
        {ROSTER.map((r, i) => (
          <button
            key={r.id}
            className={`roster__card ${r.id === focus ? 'is-on' : ''}`}
            style={{ '--accent': r.accent, '--accent2': r.accent2, '--i': i } as CSSProperties}
            aria-pressed={r.id === focus}
            onClick={() => pick(r.id)}
            onMouseEnter={() => hover(r.id)}
            onMouseLeave={() => hover(null)}
            onFocus={() => hover(r.id)}
          >
            <img src={r.portrait} alt="" loading="lazy" />
            <span className="roster__jp jp">{r.nameJp}</span>
            <span className="roster__name">{r.name.split(' ')[0]}</span>
            <span className="roster__role">{r.title}</span>
          </button>
        ))}
      </nav>
      <footer className="select__cta">
        <button className="btn btn--primary btn--xl" onClick={confirm} disabled={confirming}>
          <Icon name="spark" />{confirmLabel.replace('{name}', c.name.split(' ')[0])}
        </button>
        <small>← → to browse · Enter to confirm</small>
      </footer>
    </main>
  );
}
