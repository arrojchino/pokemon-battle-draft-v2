import { useEffect, useRef } from 'react';
import { characterById } from '../../characters/roster.js';
import { useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { Icon } from '../primitives.js';

type Props = { inviteCode: string; onPlay: () => void; onJoin: () => void; onPartners: () => void; onSettings: () => void; onCredits: () => void };

/** The first frame people see: the partner is the hero, the menu stays out of her way. */
export function TitleScreen({ inviteCode, onPlay, onJoin, onPartners, onSettings, onCredits }: Props) {
  const s = useSettings();
  const c = characterById(s.partner)!;
  const { world } = useWorld();
  const lastNod = useRef(0);
  useEffect(() => { world?.setLayout({ mode: 'title', featured: s.partner }); }, [world, s.partner]);
  // Greet once the partner is on stage (immediately if already loaded, otherwise when she arrives).
  useEffect(() => {
    if (!world) return;
    let t = 0;
    const greet = () => { t = window.setTimeout(() => world.emote(s.partner, c.personality.on.select === 'nod' ? 'greet' : c.personality.on.select), 800); };
    if (world.isLoaded(s.partner)) greet();
    const off = world.events.on('characterReady', ({ id }) => { if (id === s.partner) greet(); });
    return () => { off(); clearTimeout(t); };
  }, [world, s.partner, c]);
  const nod = () => { const now = performance.now(); if (now - lastNod.current > 2500) { lastNod.current = now; world?.emote(s.partner, 'nod'); } };

  const items: { label: string; jp: string; desc: string; on: () => void; primary?: boolean }[] = [
    ...(inviteCode ? [{ label: 'Join invite', jp: '招待', desc: `Room ${inviteCode.slice(0, 12)}`, on: onJoin, primary: true }] : []),
    { label: 'Play online', jp: '対戦', desc: 'Create a room and invite a rival', on: onPlay, primary: !inviteCode },
    ...(!inviteCode ? [{ label: 'Join a room', jp: '参加', desc: 'Enter a room code', on: onJoin }] : []),
    { label: 'Partners', jp: 'パートナー', desc: 'Meet and choose your partner', on: onPartners },
  ];

  return (
    <main className="screen title">
      <section className="title__brand">
        <p className="eyebrow"><span className="jp">夜桜リーグ</span> Yozakura League</p>
        <h1 className="wordmark">
          <span className="wordmark__top">Pokémon</span>
          <span className="wordmark__main">Battle Draft</span>
        </h1>
        <p className="title__lede">Two rivals, one coin, twelve random sets. Draft under the night blossoms, then settle it on Pokémon Showdown.</p>
        <nav className="menu" aria-label="Main menu">
          {items.map((it, i) => (
            <button key={it.label} className={`menu__item ${it.primary ? 'is-primary' : ''}`} style={{ '--i': i } as React.CSSProperties} onClick={it.on} onMouseEnter={nod}>
              <span className="menu__jp jp">{it.jp}</span>
              <span className="menu__label">{it.label}</span>
              <span className="menu__desc">{it.desc}</span>
              <Icon name="arrow" />
            </button>
          ))}
        </nav>
        <div className="title__util">
          <button className="btn btn--ghost" onClick={onSettings}><Icon name="gear" />Settings</button>
          <button className="btn btn--ghost" onClick={onCredits}>Credits &amp; licenses</button>
        </div>
      </section>
      <aside className="nameplate" aria-label="Current partner">
        <span className="nameplate__jp jp">{c.nameJp}</span>
        <strong className="nameplate__name">{c.name}</strong>
        <span className="nameplate__title">{c.title} · {c.age}</span>
        <q className="nameplate__line">{c.tagline}</q>
      </aside>
    </main>
  );
}
