import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { MAX_CHAT, MAX_HUB, type HubLine, type HubMember, type LiveBattle, type LobbySummary, type PlazaEmote, type Spot } from '@shared';
import { DEFAULT_CHARACTER, characterById } from '../../characters/roster.js';
import { useReducedMotion, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { advertisedBackend, backendUrl, useSession } from '../../net/session.js';
import { plazaLink } from '../../net/plazaLink.js';
import { hasHub } from '../../net/types.js';
import type { Anchor, HubPeer } from '../../engine/World.js';
import { sound } from '../../audio/sound.js';
import { Icon } from '../primitives.js';
import { EMOTE_GAP, GestureBar, bubbleMs, media } from './match/Plaza.js';
import { PartnerAvatar, lobbyPrefs, partnerStyle } from './LobbyParts.js';
import { useLobbies } from './MultiplayerScreen.js';
import { HOST_NAME, HostDialog } from './HostDialog.js';
import { useT } from '../../i18n/index.js';

/** Side panels the plaza itself draws (they need its live state): trainers here, chat and gestures, battles. */
export type PlazaPanel = 'players' | 'social' | 'lobbies' | 'watch';
type Props = {
  /** A plaza panel to show (from the main menu), or null. */
  panel: PlazaPanel | null;
  onPanel: (p: PlazaPanel | null) => void;
  /** Open battle setup (create or join) over the plaza. */
  onBattle: (tab: 'create' | 'join') => void;
  /** Another layout owns the stage for now (the partner showcase): keep the plaza's state, do not stage it. */
  suspended: boolean;
};
type Bubble = { id: number; text: string; until: number };

/** Where a visit starts: near the town's entrance, spread a little so arrivals do not stack, facing the square. */
function spawnSpot(): Spot {
  const x = (Math.random() - 0.5) * 2.4, z = 7.2 + Math.random() * 1.2;
  return { x, z, face: Math.PI };
}
/** Name tags fade out with distance; a chat bubble always shows. */
const tagOpacity = (d: number) => Math.max(0, Math.min(1, (14 - d) / 5));

/**
 * The main plaza: the town square every trainer walks around with their partner following. With the dedicated
 * server it is shared (everyone in it, live chat, gestures, the battle list); without one it is the player's own
 * town, with the host and gestures still there. Presence goes through the transport; the World does the walking.
 */
export function PlazaScreen({ panel, onPanel, onBattle, suspended }: Props) {
  const tr = useT();
  const s = useSettings();
  const { world } = useWorld();
  const session = useSession();
  const t = session.transport;
  const reduced = useReducedMotion();
  const ok = hasHub(session);
  const online = session.link === 'online';
  const name = s.name.trim() || tr('hub.defaultName');
  const spawn = useMemo(spawnSpot, []);
  const [you, setYou] = useState<string | null>(null);
  const [members, setMembers] = useState<HubMember[]>([]);
  const [chat, setChat] = useState<HubLine[]>([]);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [busy, setBusy] = useState(false);
  const youRef = useRef<string | null>(null); youRef.current = you;
  const seen = useRef(0);
  // The plaza host: a prompt over her while this player's trainer stands close, and the conversation.
  const [hostNear, setHostNear] = useState(false);
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!world) return;
    const offs = [world.events.on('hostNear', ({ near }) => setHostNear(near)), world.events.on('hostTalk', () => setTalking(true))];
    return () => offs.forEach(off => off());
  }, [world]);
  useEffect(() => { if (suspended) setTalking(false); }, [suspended]);
  const hostTag = useRef<HTMLDivElement>(null);

  // Hear the plaza while on this screen (shared plaza only).
  useEffect(() => {
    if (!ok) { setYou(null); setMembers([]); setChat([]); return; }
    return t.onHub(m => {
      if (m.type === 'hub') {
        // A (re)entry: the lines already said are history, not bubbles; others learn where this trainer stands.
        seen.current = m.chat.length ? m.chat[m.chat.length - 1].id : 0;
        setYou(m.you); setMembers(m.members); setChat(m.chat); setBubbles({});
        for (const x of m.members) if (x.id !== m.you) world?.plazaPose(x.id, x.pose);
        world?.plazaResend();
      } else if (m.type === 'hubJoin') { setMembers(list => [...list.filter(x => x.id !== m.member.id), m.member]); world?.plazaPose(m.member.id, m.member.pose); }
      else if (m.type === 'hubLeave') { setMembers(list => list.filter(x => x.id !== m.id)); world?.plazaForget(m.id); }
      else if (m.type === 'hubChat') setChat(c => [...c.slice(-59), m.line]);
      else if (m.type === 'hubMove') world?.plazaPresence({ type: 'move', x: m.x, z: m.z, face: m.face }, m.id);
      else world?.plazaPresence({ type: 'emote', emote: m.emote }, m.id);
    });
  }, [ok, t, world]);
  // Walk in (again when name or partner change, so everyone sees the new partner); walk out when leaving.
  useEffect(() => { if (ok) return () => t.hub(false); }, [ok, t]);
  useEffect(() => { if (ok) t.hub(true, name, s.partner, spawn, s.trainer); }, [ok, t, name, s.partner, spawn, s.trainer]);
  // This player's spot and gestures go to everyone else in the plaza.
  useEffect(() => {
    if (!world || !ok) return;
    const offs = [world.events.on('plazaMove', p => t.hubMove(p.x, p.z, p.face)), world.events.on('plazaEmote', ({ emote }) => t.hubEmote(emote))];
    return () => offs.forEach(off => off());
  }, [world, ok, t]);

  const others = useMemo<HubPeer[]>(() => members.filter(m => m.id !== you).map(m => ({ id: m.id, partner: m.avatar ?? DEFAULT_CHARACTER, trainer: m.trainer, at: { x: m.x, z: m.z, face: m.face } })), [members, you]);
  // Get the host and whoever is already here ready while the travel into the town plays (no extra veil).
  const othersRef = useRef(others); othersRef.current = others;
  const prepared = useRef(false);
  useEffect(() => {
    if (!world || prepared.current || (ok && you === null)) return;
    prepared.current = true;
    void world.prepareHub(othersRef.current.map(o => o.partner), 6000).then(() => world.hubShown());
  }, [world, ok, you]);
  useEffect(() => {
    if (!world || suspended) return;
    world.setLayout({ mode: 'hub', mine: s.partner, spawn, others, trainer: s.trainer });
  }, [world, suspended, s.partner, spawn, others, s.trainer]);

  useEffect(() => { if (session.error) setBusy(false); }, [session.errorId, session.error]);

  // New lines: a bubble over the speaker, a soft tick for other people's, a count while the chat is closed.
  const chatOpen = panel === 'social';
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const fresh = chat.filter(l => l.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const now = Date.now();
    setBubbles(b => { const n = { ...b }; for (const l of fresh) n[l.from] = { id: l.id, text: l.text, until: now + bubbleMs(l.text) }; return n; });
    const theirs = fresh.filter(l => l.from !== youRef.current).length;
    if (theirs) { sound.play('tick', { gain: 0.4 }); if (!chatOpen) setUnread(u => u + theirs); }
  }, [chat, chatOpen]);
  useEffect(() => {
    const live = Object.values(bubbles);
    if (!live.length) return;
    const tm = window.setTimeout(() => setBubbles(cur => Object.fromEntries(Object.entries(cur).filter(([, b]) => b.until > Date.now() + 30))), Math.max(0, Math.min(...live.map(b => b.until)) - Date.now()));
    return () => window.clearTimeout(tm);
  }, [bubbles]);
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen]);

  // Tags ride the trainers: positions go straight to the DOM every frame, never through React.
  const tags = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!world) return;
    let raf = 0;
    const a: Anchor = { x: 0, y: 0, on: false, d: 0 };
    const tick = () => {
      const top = 64;
      for (const [id, el] of tags.current) {
        const mine = id === youRef.current || id === 'me';
        world.anchor(mine ? 'mine' : id, a);
        const fade = mine || el.dataset.bubble ? 1 : tagOpacity(a.d ?? 0);
        el.style.opacity = a.on && !suspended ? String(fade) : '0';
        if (!a.on || !fade) continue;
        const box = el.firstElementChild as HTMLElement | null;
        const w = box?.offsetWidth ?? 0, h = box?.offsetHeight ?? 0;
        const x = Math.min(Math.max(a.x, w / 2 + 8), window.innerWidth - w / 2 - 8);
        const y = Math.max(a.y, top + h);
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      const ht = hostTag.current;
      if (ht) {
        world.anchor('host', a);
        const fade = a.on && !suspended ? tagOpacity(a.d ?? 0) : 0;
        ht.style.opacity = String(ht.dataset.near && !suspended ? 1 : fade);
        if (a.on) ht.style.transform = `translate3d(${a.x.toFixed(1)}px, ${Math.max(a.y, top + 30).toFixed(1)}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, suspended]);

  const start = (run: () => void) => { setBusy(true); t.clearError(); run(); };
  const quick = () => start(() => t.quickJoin(s.name.trim(), s.partner, lobbyPrefs.bestOf, t.supportsBattles ? s.battleMode : 'showdown'));
  const join = (code: string) => start(() => t.join(code, s.name.trim() || tr('hub.player2'), s.partner));
  const watch = (code: string) => { t.clearError(); t.watch(code); };

  const names = new Map(members.map(m => [m.id, m.name]));
  const tagFor = (id: string, label: string, mine: boolean) => {
    const b = bubbles[id];
    return (
      <div key={id} ref={el => { if (el) tags.current.set(id, el); else tags.current.delete(id); }} data-bubble={b ? '1' : undefined}
        className={`ptag ${mine ? 'ptag--mine' : 'ptag--theirs'}`} style={{ opacity: 0 }}>
        <div className="ptag__in">
          {b && <p className="ptag__bubble" key={b.id}>{b.text}</p>}
          <span className="ptag__name">{label}</span>
        </div>
      </div>
    );
  };
  const count = ok ? Math.max(1, members.length) : 1;
  // Why nobody else may be here: unreachable or outdated server, said out loud instead of a silent solo plaza.
  const [waited, setWaited] = useState(0);
  useEffect(() => { const t0 = Date.now(); const tm = window.setInterval(() => setWaited(Date.now() - t0), 1000); return () => window.clearInterval(tm); }, []);
  const link = plazaLink(session, waited);
  useEffect(() => { if (link.kind === 'unreachable' || link.kind === 'tooOld') console.warn('[plaza]', link, backendUrl()); }, [link.kind]);
  const advertised = advertisedBackend();
  const switchTo = advertised && advertised !== backendUrl() ? advertised : '';
  const useAdvertised = () => { const u = new URL(location.href); u.searchParams.set('ws', switchTo); location.href = u.toString(); };
  if (suspended) return null;

  return (
    <main className="screen hub is-plaza is-town">
      <div className="ptags" aria-hidden="true">
        {tagFor(you ?? 'me', name, true)}
        {members.filter(m => m.id !== you).map(m => tagFor(m.id, m.name, false))}
      </div>
      <aside className="plaza-status" aria-live="polite">
        <span className={`dot ${link.kind === 'shared' && online ? 'dot--on' : link.kind === 'shared' || link.kind === 'connecting' ? 'dot--wait' : link.kind === 'solo' ? '' : 'dot--bad'}`} />
        <span className="plaza-status__text">
          {link.kind === 'shared' && <>
            <strong>{tr.rich(count === 1 ? 'hub.here.one' : 'hub.here.other', { count, cap: <small>{tr('hub.cap', { max: MAX_HUB })}</small> })}</strong>
            <small>{!online ? tr('plaza.reconnecting') : link.outdated !== null ? tr('plaza.outdated', { server: link.outdated }) : tr('plaza.shared')}</small>
          </>}
          {link.kind === 'connecting' && <><strong>{tr('plaza.connecting')}</strong><small>{tr('plaza.connectingHint')}</small></>}
          {link.kind === 'unreachable' && <><strong>{tr('plaza.unreachable')}</strong><small>{tr('plaza.unreachableHint')}</small></>}
          {link.kind === 'tooOld' && <><strong>{tr('plaza.tooOld')}</strong><small>{tr('plaza.tooOldHint', { server: link.server })}</small></>}
          {link.kind === 'solo' && <><strong>{tr('plaza.solo')}</strong><small>{tr('plaza.soloHint')}</small></>}
        </span>
        {switchTo && (link.kind === 'unreachable' || link.kind === 'tooOld' || link.kind === 'solo') && (
          <button type="button" className="btn btn--sm btn--primary" onClick={useAdvertised}>{tr('plaza.useCurrent')}</button>
        )}
        {ok && !chatOpen && (
          <button type="button" className="iconbtn iconbtn--text plaza-status__chat" onClick={() => onPanel('social')} aria-label={unread ? tr(unread === 1 ? 'hub.openChatNew.one' : 'hub.openChatNew.other', { n: unread }) : tr('hub.openChat')}>
            <Icon name="text" size={15} />{unread > 0 && <span className="chat-toggle__count">{unread}</span>}
          </button>
        )}
      </aside>
      <p className="plaza-keys" aria-hidden="true">{media('(pointer: coarse)') ? tr('plaza.keysTouch') : tr.rich('plaza.keys', { wasd: <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></>, m: <kbd>M</kbd> })}</p>

      <div ref={hostTag} className="host-tag" data-near={hostNear && !talking ? '1' : undefined} style={{ opacity: 0 }}>
        <div className="host-tag__in">
          {hostNear && !talking && (
            <button type="button" className="host-tag__talk" data-sfx="none" onClick={() => setTalking(true)}>
              {media('(pointer: coarse)') ? tr('hub.tapTalk') : tr.rich('hub.keyTalk', { key: <kbd>E</kbd> })}
            </button>
          )}
          <span className="host-tag__name">{HOST_NAME} <small>{tr('host.role')}</small></span>
        </div>
      </div>
      {panel === 'social' && <SocialPanel shared={ok} chat={chat} you={you} names={names} world={world} onSend={text => t.hubChat(text)} onClose={() => onPanel(null)} />}
      {panel === 'players' && <PlayersPanel members={members} you={you} onApproach={id => { world?.plazaApproach(id); onPanel(null); }} onClose={() => onPanel(null)} />}
      {talking && (
        <HostDialog world={world} trainer={name} trainers={count} online={online && ok} busy={busy} reducedMotion={reduced}
          onClose={() => setTalking(false)} onFind={() => onPanel('lobbies')} onCreate={() => onBattle('create')} onWatch={watch} onJoin={join} />
      )}
      {(panel === 'lobbies' || panel === 'watch') && <BattlesPanel focus={panel} online={online && ok} busy={busy} onJoin={join} onWatch={watch} onQuick={quick} onCreate={() => onBattle('create')} onClose={() => onPanel(null)} />}
    </main>
  );
}

/** Social: the plaza chat (shared plaza) and the partner's gestures, with the walking keys as a reminder. */
function SocialPanel({ shared, chat, you, names, world, onSend, onClose }: {
  shared: boolean; chat: HubLine[]; you: string | null; names: Map<string, string>;
  world: ReturnType<typeof useWorld>['world']; onSend: (text: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmote = useRef(0);
  const { transport } = useSession();
  const lastId = chat.length ? chat[chat.length - 1].id : 0;
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lastId]);
  useEffect(() => { if (shared) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }, [shared]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    onSend(v); setText('');
  };
  const emote = (x: PlazaEmote) => {
    // At most one gesture every EMOTE_GAP ms, below the server's emote rate, so none is cut on the way.
    const now = performance.now();
    if (now - lastEmote.current < EMOTE_GAP) return;
    lastEmote.current = now;
    world?.plazaEmote(x);
  };
  return (
    <section className="chat panel plaza-social" aria-label={t('nav.social')}>
      <header className="chat__head">
        <p className="eyebrow">{shared ? t('hub.plazaChat') : t('nav.social')}</p>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('hub.closeChat')}><Icon name="close" size={16} /></button>
      </header>
      {shared ? (
        <ol className="chat__log scroller" ref={logRef} role="log" aria-live="polite">
          {chat.map(l => (
            <li key={l.id} className={`chat__line ${l.from === you ? 'is-mine' : ''}`}><strong>{names.get(l.from) ?? l.name}</strong><span>{l.text}</span></li>
          ))}
          {!chat.length && <li className="chat__empty">{t('hub.chatEmpty')}</li>}
        </ol>
      ) : <p className="chat__empty plaza-social__solo">{t('plaza.chatNeedsServer')}</p>}
      <GestureBar world={world} transport={transport} onGesture={emote} />
      {shared && (
        <form className="chat__form" onSubmit={send}>
          <input ref={inputRef} className="chat__input" value={text} onChange={e => setText(e.target.value)} maxLength={MAX_CHAT} placeholder={t('hub.messagePlaceholder')}
            aria-label={t('hub.chatMessage')} enterKeyHint="send" autoComplete="off" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.blur(); onClose(); } }} />
          <button className="btn btn--primary chat__send" disabled={!text.trim()}>{t('hub.send')}</button>
        </form>
      )}
    </section>
  );
}

/** Find Players: everyone in the plaza with their partner; a click walks your trainer over to them. */
function PlayersPanel({ members, you, onApproach, onClose }: { members: HubMember[]; you: string | null; onApproach: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const others = members.filter(m => m.id !== you);
  return (
    <aside className="hub__side panel" aria-label={t('nav.players')}>
      <header className="hub__sidehead">
        <p className="eyebrow">{t('plaza.playersTitle', { n: others.length })}</p>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={16} /></button>
      </header>
      <div className="hub__scroll scroller">
        {others.length ? (
          <ul className="hub__list">{others.map(m => {
            const c = characterById(m.avatar ?? DEFAULT_CHARACTER);
            return (
              <li key={m.id} className="hub__row" style={partnerStyle(m.avatar ?? DEFAULT_CHARACTER)}>
                <PartnerAvatar id={m.avatar ?? DEFAULT_CHARACTER} size="sm" />
                <div className="hub__rowtext"><strong>{m.name}</strong><small>{c ? t('hub.withPartner', { name: c.name }) : ''}{m.pose ? ` · ${t(m.pose === 'nap' ? 'plaza.napping' : 'plaza.sitting')}` : ''}</small></div>
                <button type="button" className="btn btn--sm" onClick={() => onApproach(m.id)}><Icon name="target" size={14} />{t('plaza.walkTo')}</button>
              </li>
            );
          })}</ul>
        ) : <p className="hub__empty">{t('plaza.nobody')}</p>}
      </div>
    </aside>
  );
}

function BattlesPanel({ focus, online, busy, onJoin, onWatch, onQuick, onCreate, onClose }: {
  focus: 'lobbies' | 'watch'; online: boolean; busy: boolean; onJoin: (code: string) => void; onWatch: (code: string) => void; onQuick: () => void; onCreate: () => void; onClose: () => void;
}) {
  const t = useT();
  const { data, error } = useLobbies(online);
  const live = data?.live ?? [], lobbies = data?.lobbies ?? [];
  const liveList = (
    <>
      <p className="eyebrow hub__subhead">{t('hub.liveBattles')}</p>
      {!data ? <p className="hub__empty">{error || t('hub.looking')}</p>
        : live.length ? <ul className="hub__list">{live.map(b => <LiveRow key={b.code} b={b} onWatch={() => onWatch(b.code)} />)}</ul>
        : <p className="hub__empty">{t('hub.noBattles')}</p>}
    </>
  );
  const lobbyList = (
    <>
      <p className="eyebrow hub__subhead">{t('hub.openLobbies')}</p>
      {!data ? <p className="hub__empty">{error || t('hub.looking')}</p>
        : lobbies.length ? <ul className="hub__list">{lobbies.map(l => <LobbyRow key={l.code} l={l} busy={busy} onJoin={() => onJoin(l.code)} />)}</ul>
        : <p className="hub__empty">{t('hub.noLobbies')}</p>}
    </>
  );
  return (
    <aside className="hub__side panel" aria-label={t(focus === 'watch' ? 'nav.watch' : 'nav.lobbies')}>
      <header className="hub__sidehead">
        <p className="eyebrow">{t(focus === 'watch' ? 'nav.watch' : 'nav.lobbies')}</p>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('hub.closeBattles')}><Icon name="close" size={16} /></button>
      </header>
      <div className="hub__scroll scroller">
        {focus === 'watch' ? <>{liveList}{lobbyList}</> : <>{lobbyList}{liveList}</>}
      </div>
      <div className="hub__actions">
        <button type="button" className="btn btn--gold" disabled={busy || !online} onClick={onQuick}><Icon name="bolt" />{t('hub.quickMatch')}</button>
        <button type="button" className="btn btn--ghost" onClick={onCreate}><Icon name="plus" />{t('hub.create')}</button>
      </div>
    </aside>
  );
}

function LiveRow({ b, onWatch }: { b: LiveBattle; onWatch: () => void }) {
  const t = useT();
  return (
    <li className="hub__row" style={partnerStyle(b.avatars[0])}>
      <span className="hub__vs"><PartnerAvatar id={b.avatars[0]} size="sm" /><PartnerAvatar id={b.avatars[1]} size="sm" /></span>
      <div className="hub__rowtext">
        <strong>{b.names[0]} <i>vs</i> {b.names[1]}</strong>
        <small>{b.wins[0]}–{b.wins[1]} · {t('hub.bestOf', { n: b.bestOf })} · {t('hub.turn', { n: Math.max(1, b.turn) })}{b.watchers ? ` · ${t('hub.watching', { n: b.watchers })}` : ''}</small>
      </div>
      <button type="button" className="btn btn--primary btn--sm" onClick={onWatch}><Icon name="eye" size={14} />{t('hub.watch')}</button>
    </li>
  );
}

function LobbyRow({ l, busy, onJoin }: { l: LobbySummary; busy: boolean; onJoin: () => void }) {
  const t = useT();
  const host = characterById(l.avatar);
  return (
    <li className="hub__row" style={{ ...partnerStyle(l.avatar) } as CSSProperties}>
      <PartnerAvatar id={l.avatar} size="sm" />
      <div className="hub__rowtext"><strong>{l.host}</strong><small>{host ? `${t('hub.withPartner', { name: host.name })} · ` : ''}{t('hub.bestOf', { n: l.bestOf })}</small></div>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={onJoin}>{t('hub.join')}</button>
    </li>
  );
}
