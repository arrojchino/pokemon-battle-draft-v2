import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { POOL } from '@shared';
import { characterById } from '../../characters/roster.js';
import { useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { sound } from '../../audio/sound.js';
import { useStageReady } from '../Overlays.js';
import { Icon, type IconName } from '../primitives.js';

type Props = { inviteCode: string; onPlay: () => void; onJoin: () => void; onPokedex: () => void; onPartners: () => void; onSettings: () => void; onCredits: () => void };
type Item = { id: string; label: string; icon: IconName; on: () => void; jp?: string; desc?: string; primary?: boolean; util?: boolean };

/**
 * The first frame people see: a classic start menu with a sliding ▶ cursor, the bot on stage beside it.
 * Arrow keys move the cursor (Settings and Credits share the last row), Enter picks, Escape is ignored.
 */
export function TitleScreen({ inviteCode, onPlay, onJoin, onPokedex, onPartners, onSettings, onCredits }: Props) {
  const s = useSettings();
  const c = characterById(s.partner)!;
  const { world } = useWorld();
  const live = useStageReady();
  const lastNod = useRef(0);
  const nav = useRef<HTMLElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => { world?.setLayout({ mode: 'title', featured: s.partner }); }, [world, s.partner]);
  // Greet once the bot is on stage (immediately if already loaded, otherwise when it arrives).
  useEffect(() => {
    if (!world) return;
    let t = 0;
    const greet = () => { t = window.setTimeout(() => world.emote(s.partner, c.personality.on.select === 'nod' ? 'greet' : c.personality.on.select), 800); };
    if (world.isLoaded(s.partner)) greet();
    const off = world.events.on('characterReady', ({ id }) => { if (id === s.partner) greet(); });
    return () => { off(); clearTimeout(t); };
  }, [world, s.partner, c]);
  const nod = () => { const now = performance.now(); if (now - lastNod.current > 2500) { lastNod.current = now; world?.emote(s.partner, 'nod'); } };

  const items: Item[] = [
    ...(inviteCode ? [{ id: 'invite', label: 'Join invite', jp: '招待', desc: `Room ${inviteCode.slice(0, 12)}`, icon: 'link' as const, on: onJoin, primary: true }] : []),
    { id: 'play', label: 'Play online', jp: '対戦', desc: 'Create a room and invite a rival', icon: 'swords', on: onPlay, primary: !inviteCode },
    ...(!inviteCode ? [{ id: 'join', label: 'Join with code', jp: '参加', desc: "Enter a rival's room code", icon: 'hash' as const, on: onJoin }] : []),
    { id: 'pool', label: 'Draft pool', jp: '図鑑', desc: `All ${POOL.length} sets the coin can deal`, icon: 'grid', on: onPokedex },
    { id: 'paint', label: 'Paint shop', jp: '塗装', desc: 'Repaint your battle bot', icon: 'palette', on: onPartners },
    { id: 'settings', label: 'Settings', icon: 'gear', on: onSettings, util: true },
    { id: 'credits', label: 'Credits', icon: 'info', on: onCredits, util: true },
  ];
  const main = items.filter(it => !it.util), util = items.filter(it => it.util);
  // Rows of item indices for 2D cursor movement: one item per row, then the utility pair side by side.
  const rows = [...main.map((_, i) => [i]), util.map((_, i) => main.length + i)];

  // The cursor is measured, not hard-coded, so it follows the real rows at every breakpoint.
  useLayoutEffect(() => {
    const el = nav.current; if (!el) return;
    const place = () => {
      const b = refs.current[cursor]; if (!b) return;
      el.style.setProperty('--cursor-x', `${b.offsetLeft}px`);
      el.style.setProperty('--cursor-y', `${b.offsetTop + b.offsetHeight / 2}px`);
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(el);
    return () => ro.disconnect();
  }, [cursor]);

  const select = (i: number, viaKeys: boolean) => {
    if (i === cursor) return;
    setCursor(i);
    // Focus follows the cursor whenever the keyboard is in play, so Enter and Space agree with what is shown.
    if (viaKeys || nav.current?.contains(document.activeElement)) refs.current[i]?.focus({ preventScroll: true });
    if (viaKeys) sound.play('hover');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!live || e.altKey || e.ctrlKey || e.metaKey || document.querySelector('dialog[open]')) return;
      if ((e.target as Element).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const r = rows.findIndex(row => row.includes(cursor)), col = rows[r].indexOf(cursor);
      const down = (dr: number) => { const row = rows[(r + dr + rows.length) % rows.length]; return row[Math.min(col, row.length - 1)]; };
      const across = (dc: number) => rows[r][(col + dc + rows[r].length) % rows[r].length];
      const moves: Record<string, number> = { ArrowDown: down(1), ArrowUp: down(-1), ArrowRight: across(1), ArrowLeft: across(-1), Home: 0, End: items.length - 1 };
      const next: number | undefined = moves[e.key];
      if (next !== undefined) { e.preventDefault(); select(next, true); return; }
      // Enter picks what the cursor shows; clicking keeps the sound and navigation paths identical to the mouse.
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); refs.current[cursor]?.click(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const row = (it: Item, i: number) => (
    <button
      key={it.id}
      ref={el => { refs.current[i] = el; }}
      type="button"
      className={`menu__item ${it.primary ? 'is-primary' : ''} ${it.util ? 'menu__item--util' : ''} ${i === cursor ? 'is-cursor' : ''}`}
      style={{ '--i': i } as CSSProperties}
      onClick={it.on}
      onFocus={() => setCursor(i)}
      onPointerEnter={() => { select(i, false); nod(); }}
    >
      <span className="menu__icon"><Icon name={it.icon} size={it.util ? 16 : 20} /></span>
      <span className="menu__text">
        <span className="menu__label">{it.label}</span>
        {it.desc && <span className="menu__desc">{it.desc}</span>}
      </span>
      {it.jp && <span className="menu__jp jp" aria-hidden="true">{it.jp}</span>}
    </button>
  );

  return (
    <main className={`screen title ${live ? 'is-live' : ''}`}>
      <div className="title__ball" aria-hidden="true" />
      <div className="title__col">
        <header className="title__brand">
          <h1 className="wordmark">
            <span className="wordmark__pre">Pokémon</span>
            <span className="wordmark__main"><span>Battle</span> <span>Draft</span></span>
          </h1>
          <p className="eyebrow title__league"><Icon name="trophy" size={14} />Back Alley League<span className="jp">路地裏リーグ</span></p>
          <p className="title__lede">Two rivals, one coin, twelve random sets. Draft in the back alley, then settle it in the pit.</p>
        </header>
        <nav className="menu" ref={nav} aria-label="Main menu">
          <span className="menu__cursor" aria-hidden="true" />
          {main.map((it, i) => row(it, i))}
          <div className="menu__util">{util.map((it, i) => row(it, main.length + i))}</div>
        </nav>
      </div>
      <aside className="nameplate" aria-label="Your partner" style={{ '--partner': c.accent } as CSSProperties}>
        <img className="nameplate__badge" src={c.portrait} alt="" />
        <span className="nameplate__text">
          <span className="eyebrow"><span className="jp">相棒</span>Partner</span>
          <strong className="nameplate__name">{c.name}</strong>
          <q className="nameplate__quip">{c.quip}</q>
        </span>
      </aside>
    </main>
  );
}
