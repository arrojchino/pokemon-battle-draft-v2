import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { characterById } from '../characters/roster.js';
import { useSettings } from '../app/settings.js';
import { Icon, type IconName } from './primitives.js';
import { PartnerAvatar } from './screens/LobbyParts.js';
import { useT, type MessageKey } from '../i18n/index.js';

/** Every place the main menu leads. */
export type NavTarget =
  | 'plaza' | 'players' | 'social'
  | 'quick' | 'create' | 'join' | 'lobbies' | 'watch'
  | 'partner' | 'profile' | 'settings' | 'dex' | 'credits';

type Item = { id: NavTarget; label: MessageKey; hint: MessageKey; icon: IconName; needsServer?: boolean };
const GROUPS: { title: MessageKey; items: Item[] }[] = [
  { title: 'nav.world', items: [
    { id: 'plaza', label: 'nav.plaza', hint: 'nav.plazaHint', icon: 'globe' },
    { id: 'players', label: 'nav.players', hint: 'nav.playersHint', icon: 'users', needsServer: true },
    { id: 'social', label: 'nav.social', hint: 'nav.socialHint', icon: 'text' },
  ] },
  { title: 'nav.battle', items: [
    { id: 'quick', label: 'nav.quick', hint: 'nav.quickHint', icon: 'bolt', needsServer: true },
    { id: 'create', label: 'nav.create', hint: 'nav.createHint', icon: 'plus' },
    { id: 'join', label: 'nav.join', hint: 'nav.joinHint', icon: 'hash' },
    { id: 'lobbies', label: 'nav.lobbies', hint: 'nav.lobbiesHint', icon: 'grid', needsServer: true },
    { id: 'watch', label: 'nav.watch', hint: 'nav.watchHint', icon: 'eye', needsServer: true },
  ] },
  { title: 'nav.player', items: [
    { id: 'partner', label: 'nav.partner', hint: 'nav.partnerHint', icon: 'ball' },
    { id: 'profile', label: 'nav.profile', hint: 'nav.profileHint', icon: 'user' },
    { id: 'settings', label: 'nav.settings', hint: 'nav.settingsHint', icon: 'gear' },
  ] },
];
const MORE: Item[] = [
  { id: 'dex', label: 'nav.dex', hint: 'nav.dexHint', icon: 'book' },
  { id: 'credits', label: 'nav.credits', hint: 'nav.creditsHint', icon: 'info' },
];

/**
 * The main menu: a small trigger in the top-left corner that drops a panel down from it. Closed by default, so
 * the plaza is the first thing the player sees. M opens and closes it from anywhere (outside text fields), Esc or a
 * click outside closes it, and the arrow keys move between items.
 */
export function NavMenu({ onGo, active, server }: { onGo: (to: NavTarget) => void; active: NavTarget | null; server: boolean }) {
  const t = useT();
  const s = useSettings();
  const c = characterById(s.partner);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as Element | null;
      const typing = !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); (root.current?.querySelector('.nav__trigger') as HTMLButtonElement | null)?.focus(); return; }
      if ((e.key === 'm' || e.key === 'M') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]')) { e.preventDefault(); setOpen(v => !v); }
      if (!open || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('.nav__item:not(:disabled)') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    };
    const onDown = (e: PointerEvent) => { if (open && !root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  // Focus the first item when it opens from the keyboard or a click.
  useEffect(() => { if (open) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.nav__item:not(:disabled)')?.focus({ preventScroll: true })); }, [open]);

  const go = (id: NavTarget) => { setOpen(false); onGo(id); };
  const row = (it: Item, i: number) => {
    const off = !!it.needsServer && !server;
    return (
      <button key={it.id} type="button" role="menuitem" className={`nav__item ${active === it.id ? 'is-on' : ''}`} style={{ '--i': i } as CSSProperties}
        disabled={off} onClick={() => go(it.id)} title={off ? t('nav.needsServer') : undefined} data-sfx-hover="">
        <span className="nav__icon"><Icon name={it.icon} size={17} /></span>
        <span className="nav__text"><span className="nav__label">{t(it.label)}</span><span className="nav__hint">{off ? t('nav.needsServer') : t(it.hint)}</span></span>
      </button>
    );
  };
  let i = 0;
  return (
    <div className={`nav ${open ? 'is-open' : ''}`} ref={root} style={{ '--partner': c?.accent ?? '#3ee6ff' } as CSSProperties}>
      <button type="button" className="nav__trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
        <span className="nav__ball" aria-hidden="true"><i /></span>
        <span className="nav__brand"><span className="nav__pre">Pokémon</span><strong>{t('nav.menu')}</strong></span>
        <kbd className="nav__kbd" aria-hidden="true">M</kbd>
        <Icon name="chevronDown" size={14} />
      </button>
      <div className="nav__panel" id={panelId} role="menu" aria-label={t('nav.menu')} hidden={!open}>
        <div className="nav__card">
          <PartnerAvatar id={s.partner} size="sm" />
          <div className="nav__who"><strong>{s.name.trim() || t('hub.defaultName')}</strong><small>{c?.name}</small></div>
          <span className={`dot ${server ? 'dot--on' : ''}`} title={server ? t('nav.online') : t('nav.solo')} />
        </div>
        {GROUPS.map(g => (
          <section key={g.title} className="nav__group" aria-label={t(g.title)}>
            <p className="nav__title">{t(g.title)}</p>
            {g.items.map(it => row(it, i++))}
          </section>
        ))}
        <div className="nav__more">{MORE.map(it => (
          <button key={it.id} type="button" role="menuitem" className="nav__chip" onClick={() => go(it.id)}><Icon name={it.icon} size={14} />{t(it.label)}</button>
        ))}</div>
      </div>
    </div>
  );
}
