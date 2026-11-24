import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { characterById } from '../characters/roster.js';
import { settings, useSettings } from '../app/settings.js';
import { useWorld } from '../app/WorldProvider.js';
import { useSession } from '../net/session.js';
import { Icon } from './primitives.js';
import { PartnerAvatar, partnerStyle } from './screens/LobbyParts.js';
import { useT } from '../i18n/index.js';

/**
 * A sheet that slides in from the top-left under the main menu, over the plaza: battle setup, settings, the
 * draft pool and the trainer card open here, so the world stays in view behind them. Esc closes it.
 */
export function WorldPanel({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]') && !document.querySelector('.nav.is-open')) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <section ref={ref} className={`wpanel ${wide ? 'wpanel--wide' : ''}`} aria-label={label}>
      <button type="button" className="iconbtn wpanel__close" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
      <div className="wpanel__body scroller">{children}</div>
    </section>
  );
}

/**
 * The card shown while the game travels between places (plaza to stadium and back): where you are going, over the
 * dark of the transition.
 */
export function TravelCard() {
  const t = useT();
  const { world } = useWorld();
  const [card, setCard] = useState<{ to: 'town' | 'stadium'; n: number } | null>(null);
  useEffect(() => world?.events.on('travel', ({ to }) => { if (to !== 'intro') setCard(c => ({ to, n: (c?.n ?? 0) + 1 })); }), [world]);
  useEffect(() => { if (!card) return; const tm = window.setTimeout(() => setCard(null), 2300); return () => window.clearTimeout(tm); }, [card]);
  if (!card) return null;
  const stadium = card.to === 'stadium';
  return (
    <div className={`travel travel--${card.to}`} key={card.n} role="status" aria-live="polite">
      <span className="travel__line" aria-hidden="true" />
      <p className="eyebrow travel__eyebrow"><Icon name={stadium ? 'swords' : 'globe'} size={14} />{t(stadium ? 'travel.stadiumEyebrow' : 'travel.plazaEyebrow')}</p>
      <strong className="travel__title">{t(stadium ? 'travel.stadium' : 'travel.plaza')}</strong>
      <span className="travel__line" aria-hidden="true" />
    </div>
  );
}

/** My Profile: the trainer's name, partner and connection, editable in place. */
export function ProfilePanel({ onPartner }: { onPartner: () => void }) {
  const t = useT();
  const s = useSettings();
  const session = useSession();
  const c = characterById(s.partner)!;
  const online = session.link === 'online';
  return (
    <div className="profile" style={partnerStyle(s.partner) as CSSProperties}>
      <p className="eyebrow">{t('profile.eyebrow')}</p>
      <h2 className="profile__title">{t('profile.title')}</h2>
      <div className="profile__card">
        <PartnerAvatar id={s.partner} size="lg" />
        <div className="profile__id">
          <small>{t('multi.partner')}</small>
          <strong>{c.name}</strong>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onPartner}><Icon name="ball" size={14} />{t('profile.change')}</button>
        </div>
      </div>
      <label className="field">
        <span>{t('multi.yourName')}</span>
        <input value={s.name} maxLength={24} autoComplete="nickname" placeholder={t('multi.trainer')} onChange={e => settings.set({ name: e.target.value })} />
      </label>
      <p className="profile__status">
        <span className={`dot ${online ? 'dot--on' : session.link === 'connecting' ? 'dot--wait' : ''}`} />
        {t(session.kind === 'backend' ? 'multi.dedicated' : 'multi.peerRelay')} · {t(online ? 'multi.link.online' : session.link === 'connecting' ? 'multi.link.connecting' : 'multi.link.offline')}
      </p>
      <p className="hint">{t('profile.hint')}</p>
    </div>
  );
}
