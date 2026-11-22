import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { MAX_CHAT, MAX_HUB, type HubLine, type HubMember, type LiveBattle, type LobbySummary, type PlazaEmote, type Spot } from '@shared';
import { DEFAULT_CHARACTER, characterById } from '../../characters/roster.js';
import { useReducedMotion, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { useSession } from '../../net/session.js';
import { hasHub } from '../../net/types.js';
import type { Anchor, HubPeer } from '../../engine/World.js';
import { sound } from '../../audio/sound.js';
import { Icon, Spinner } from '../primitives.js';
import { EMOTE_GAP, GestureBar, ROOMY, bubbleMs, media } from './match/Plaza.js';
import { PartnerAvatar, lobbyPrefs, partnerStyle } from './LobbyParts.js';
import { useLobbies } from './MultiplayerScreen.js';
import { HOST_NAME, HostDialog } from './HostDialog.js';
import { useT } from '../../i18n/index.js';

type Props = { onBack: () => void; onPlay: () => void; onPartner: () => void };
type Bubble = { id: number; text: string; until: number };

/** Where a visit starts: a random spot on a ring around the field's centre, facing it. */
function spawnSpot(): Spot {
  const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 2.4;
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  return { x, z, face: Math.atan2(-x, -z) };
}
/** Name tags fade out with distance; a chat bubble always shows. */
const tagOpacity = (d: number) => Math.max(0, Math.min(1, (15 - d) / 5));

/**
 * The main plaza: every trainer in the menus walks their partner on the same stadium floor. Chat lines
 * float over the speaker's partner, emotes play for everyone, and a side panel lists battles to watch and
 * lobbies to join. Presence goes through the transport; the World does the walking.
 */
export function HubScreen({ onBack, onPlay, onPartner }: Props) {
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
  const [side, setSide] = useState(() => media(ROOMY));
  const youRef = useRef<string | null>(null); youRef.current = you;
  const seen = useRef(0);
  // The plaza host: a prompt over her while this player's partner stands close, and the conversation.
  const [hostNear, setHostNear] = useState(false);
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!world) return;
    const offs = [world.events.on('hostNear', ({ near }) => setHostNear(near)), world.events.on('hostTalk', () => setTalking(true))];
    return () => offs.forEach(off => off());
  }, [world]);
  useEffect(() => { if (!ok) setTalking(false); }, [ok]);
  const hostTag = useRef<HTMLDivElement>(null);

  // Hear the plaza while on this screen.
  useEffect(() => {
    if (!ok) return;
    return t.onHub(m => {
      if (m.type === 'hub') {
        // A (re)entry: the lines already said are history, not bubbles; others learn where this partner stands.
        seen.current = m.chat.length ? m.chat[m.chat.length - 1].id : 0;
        setYou(m.you); setMembers(m.members); setChat(m.chat); setBubbles({});
        // Whoever already sits or naps keeps doing so on this screen too (v9 servers send the pose).
        for (const x of m.members) if (x.id !== m.you) world?.plazaPose(x.id, x.pose);
        world?.plazaResend();
      } else if (m.type === 'hubJoin') { setMembers(list => [...list.filter(x => x.id !== m.member.id), m.member]); world?.plazaPose(m.member.id, m.member.pose); }
      else if (m.type === 'hubLeave') { setMembers(list => list.filter(x => x.id !== m.id)); world?.plazaForget(m.id); }
      else if (m.type === 'hubChat') setChat(c => [...c.slice(-59), m.line]);
      else if (m.type === 'hubMove') world?.plazaPresence({ type: 'move', x: m.x, z: m.z, face: m.face }, m.id);
      else world?.plazaPresence({ type: 'emote', emote: m.emote }, m.id);
    });
  }, [ok, t, world]);
  // Walk in (again when name or partner change); walk out when leaving the screen.
  useEffect(() => { if (ok) return () => t.hub(false); }, [ok, t]);
  useEffect(() => { if (ok) t.hub(true, name, s.partner, spawn); }, [ok, t, name, s.partner, spawn]);
  // This player's spot and emotes go to everyone else in the plaza.
  useEffect(() => {
    if (!world || !ok) return;
    const offs = [world.events.on('plazaMove', p => t.hubMove(p.x, p.z, p.face)), world.events.on('plazaEmote', ({ emote }) => t.hubEmote(emote))];
    return () => offs.forEach(off => off());
  }, [world, ok, t]);

  const others = useMemo<HubPeer[]>(() => members.filter(m => m.id !== you).map(m => ({ id: m.id, partner: m.avatar ?? DEFAULT_CHARACTER, at: { x: m.x, z: m.z, face: m.face } })), [members, you]);
  // The entry veil covers the cut into the plaza until everything in it is ready (World.prepareHub): the host,
  // the partners of whoever is already here, the stands. It waits for the roster (or 1.2 s), and the whole
  // entry is capped at about 4 s from here.
  const mountedAt = useRef(performance.now());
  const [entry, setEntry] = useState<{ p: number; label: string; done: boolean; quick: boolean; gone: boolean }>(() => ({ p: 0, label: tr('hub.entering'), done: false, quick: false, gone: false }));
  const [waited, setWaited] = useState(false);
  useEffect(() => { if (!ok) return; const tm = window.setTimeout(() => setWaited(true), 1200); return () => window.clearTimeout(tm); }, [ok]);
  const othersRef = useRef(others); othersRef.current = others;
  const entering = useRef(false);
  useEffect(() => {
    if (!world || !ok || entering.current || (you === null && !waited)) return;
    entering.current = true;
    const t0 = performance.now();
    const off = world.events.on('hubProgress', e => setEntry(v => (v.done ? v : { ...v, p: e.progress, label: e.label })));
    const budget = Math.max(1500, 4000 - (t0 - mountedAt.current));
    void world.prepareHub(othersRef.current.map(o => o.partner), budget).then(() => {
      off(); world.hubShown();
      setEntry(v => ({ ...v, p: 1, done: true, quick: performance.now() - t0 < 350 }));
    });
    return () => off();
  }, [world, ok, you, waited]);
  useEffect(() => { if (!entry.done || entry.gone) return; const tm = window.setTimeout(() => setEntry(v => ({ ...v, gone: true })), entry.quick ? 300 : 700); return () => window.clearTimeout(tm); }, [entry.done, entry.gone, entry.quick]);
  useEffect(() => {
    if (!world) return;
    world.setLayout(ok ? { mode: 'hub', mine: s.partner, spawn, others } : { mode: 'title', featured: s.partner });
  }, [world, ok, s.partner, spawn, others]);

  useEffect(() => { if (session.error) setBusy(false); }, [session.errorId, session.error]);

  // New lines: a bubble over the speaker's partner, a soft tick for other people's.
  const [open, setOpen] = useState(() => media(ROOMY));
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const fresh = chat.filter(l => l.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const now = Date.now();
    setBubbles(b => { const n = { ...b }; for (const l of fresh) n[l.from] = { id: l.id, text: l.text, until: now + bubbleMs(l.text) }; return n; });
    const theirs = fresh.filter(l => l.from !== youRef.current).length;
    if (theirs) { sound.play('tick', { gain: 0.4 }); if (!open) setUnread(u => u + theirs); }
  }, [chat, open]);
  useEffect(() => {
    const live = Object.values(bubbles);
    if (!live.length) return;
    const tm = window.setTimeout(() => setBubbles(cur => Object.fromEntries(Object.entries(cur).filter(([, b]) => b.until > Date.now() + 30))), Math.max(0, Math.min(...live.map(b => b.until)) - Date.now()));
    return () => window.clearTimeout(tm);
  }, [bubbles]);
  useEffect(() => { if (open) setUnread(0); }, [open]);

  // Tags ride the partners: positions go straight to the DOM every frame, never through React.
  const tags = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!world) return;
    let raf = 0;
    const a: Anchor = { x: 0, y: 0, on: false, d: 0 };
    const tick = () => {
      const top = (document.querySelector('.hub__bar')?.getBoundingClientRect().bottom ?? 0) + 8;
      for (const [id, el] of tags.current) {
        const mine = id === youRef.current;
        world.anchor(mine ? 'mine' : id, a);
        const fade = mine || el.dataset.bubble ? 1 : tagOpacity(a.d ?? 0);
        el.style.opacity = a.on ? String(fade) : '0';
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
        const fade = a.on ? tagOpacity(a.d ?? 0) : 0;
        ht.style.opacity = String(ht.dataset.near ? 1 : fade);
        if (a.on) ht.style.transform = `translate3d(${a.x.toFixed(1)}px, ${Math.max(a.y, top + 30).toFixed(1)}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world]);

  const start = (run: () => void) => { setBusy(true); t.clearError(); run(); };
  const quick = () => start(() => t.quickJoin(s.name.trim(), s.partner, lobbyPrefs.bestOf, t.supportsBattles ? s.battleMode : 'showdown'));
  const join = (code: string) => start(() => t.join(code, s.name.trim() || tr('hub.player2'), s.partner));
  const watch = (code: string) => { t.clearError(); t.watch(code); };

  if (!ok) {
    const connecting = session.kind === 'backend' && (session.serverProtocol === null || !online);
    return (
      <main className="screen hub">
        <header className="hub__bar"><button type="button" className="iconbtn iconbtn--text" onClick={onBack}><Icon name="back" />{tr('hub.menu')}</button></header>
        <section className="hub__off panel" aria-live="polite">
          <p className="eyebrow">{tr('hub.plaza')}</p>
          {connecting ? <><Spinner size={22} label={tr('hub.connecting')} /><p>{tr('hub.connectingPlaza')}</p></> : <>
            <h3 className="dock__title">{tr('hub.needsServer')}</h3>
            <p className="dock__hint">{session.kind === 'peer' ? tr('hub.needsLink') : tr('hub.oldServer')}</p>
            <button type="button" className="btn btn--primary" onClick={onPlay}><Icon name="swords" />{tr('hub.playOnline')}</button>
          </>}
        </section>
      </main>
    );
  }

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
  const count = Math.max(1, members.length);

  return (
    <main className="screen hub is-plaza">
      {!entry.gone && (
        <div className={`veil hubveil ${entry.done ? 'is-done' : ''} ${entry.quick ? 'is-quick' : ''}`} style={{ '--p': entry.p } as CSSProperties} role="status" aria-live="polite" aria-busy={!entry.done}>
          <div className="veil__inner">
            <div className="veil__ball" aria-hidden="true">
              <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="37" pathLength={100} /><circle className="veil__ring" cx="40" cy="40" r="37" pathLength={100} /></svg>
              <span className="spinner" />
            </div>
            <p className="veil__brand"><span className="veil__pre">Pokémon</span><strong className="veil__title">{tr('hub.plaza')}</strong></p>
            <div className="veil__bar"><i /></div>
            <small className="num">{entry.done ? tr('hub.welcome') : entry.label} · {Math.round(entry.p * 100)}%</small>
          </div>
        </div>
      )}
      <div className="ptags" aria-hidden="true">
        {you && tagFor(you, name, true)}
        {members.filter(m => m.id !== you).map(m => tagFor(m.id, m.name, false))}
      </div>
      <header className="hub__bar">
        <button type="button" className="iconbtn iconbtn--text" onClick={onBack}><Icon name="back" />{tr('hub.menu')}</button>
        <div className="hub__title">
          <p className="eyebrow">{tr('hub.plaza')}</p>
          <strong>{tr.rich(count === 1 ? 'hub.here.one' : 'hub.here.other', { count, cap: <small>{tr('hub.cap', { max: MAX_HUB })}</small> })}</strong>
        </div>
        <span className={`dot ${online ? 'dot--on' : 'dot--wait'}`} title={online ? tr('hub.connected') : tr('hub.reconnecting')} />
        <span className="hub__spacer" />
        <button type="button" className="iconbtn iconbtn--text hub__partner" onClick={onPartner} style={partnerStyle(s.partner)}>
          <PartnerAvatar id={s.partner} size="sm" />{characterById(s.partner)?.name ?? tr('hub.partner')}
        </button>
        <button type="button" className={`iconbtn iconbtn--text ${side ? 'is-on' : ''}`} aria-expanded={side} onClick={() => setSide(v => !v)}><Icon name="swords" />{tr('hub.battles')}</button>
      </header>

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
      <HubChat open={open} setOpen={setOpen} unread={unread} chat={chat} you={you} names={names} world={world} onSend={text => t.hubChat(text)} />
      {talking && (
        <HostDialog world={world} trainer={name} trainers={count} online={online} busy={busy} reducedMotion={reduced}
          onClose={() => setTalking(false)} onFind={() => setSide(true)} onCreate={onPlay} onWatch={watch} onJoin={join} />
      )}
      {side && <BattlesPanel online={online} busy={busy} onJoin={join} onWatch={watch} onQuick={quick} onCreate={onPlay} onClose={() => setSide(false)} />}
    </main>
  );
}

function HubChat({ open, setOpen, unread, chat, you, names, world, onSend }: {
  open: boolean; setOpen: (v: boolean) => void; unread: number; chat: HubLine[]; you: string | null; names: Map<string, string>;
  world: ReturnType<typeof useWorld>['world']; onSend: (text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmote = useRef(0);
  const { transport } = useSession();
  const lastId = chat.length ? chat[chat.length - 1].id : 0;
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lastId, open]);
  // Enter opens the chat and focuses the field (when nothing else has the keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as Element | null;
      if (el && el !== document.body && el.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
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
  const touch = media('(pointer: coarse)');
  if (!open) {
    return (
      <button type="button" className="chat-toggle iconbtn iconbtn--text" onClick={() => setOpen(true)} aria-label={unread ? t(unread === 1 ? 'hub.openChatNew.one' : 'hub.openChatNew.other', { n: unread }) : t('hub.openChat')}>
        <Icon name="text" size={16} />{t('hub.chat')}{unread > 0 && <span className="chat-toggle__count">{unread}</span>}
      </button>
    );
  }
  return (
    <section className="chat panel" aria-label={t('hub.plazaChat')}>
      <header className="chat__head">
        <p className="eyebrow">{t('hub.plazaChat')}</p>
        <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label={t('hub.closeChat')}><Icon name="close" size={16} /></button>
      </header>
      <ol className="chat__log scroller" ref={logRef} role="log" aria-live="polite">
        {chat.map(l => (
          <li key={l.id} className={`chat__line ${l.from === you ? 'is-mine' : ''}`}><strong>{names.get(l.from) ?? l.name}</strong><span>{l.text}</span></li>
        ))}
        {!chat.length && <li className="chat__empty">{t('hub.chatEmpty')}</li>}
      </ol>
      <GestureBar world={world} transport={transport} onGesture={emote} />
      <form className="chat__form" onSubmit={send}>
        <input ref={inputRef} className="chat__input" value={text} onChange={e => setText(e.target.value)} maxLength={MAX_CHAT} placeholder={t('hub.messagePlaceholder')}
          aria-label={t('hub.chatMessage')} enterKeyHint="send" autoComplete="off" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }} />
        <button className="btn btn--primary chat__send" disabled={!text.trim()}>{t('hub.send')}</button>
      </form>
      <p className="chat__hint">
        {touch
          ? t('hub.hintTouch')
          : t.rich('hub.hintKeys', { wasd: <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></>, enter: <kbd>Enter</kbd> })}
      </p>
    </section>
  );
}

function BattlesPanel({ online, busy, onJoin, onWatch, onQuick, onCreate, onClose }: {
  online: boolean; busy: boolean; onJoin: (code: string) => void; onWatch: (code: string) => void; onQuick: () => void; onCreate: () => void; onClose: () => void;
}) {
  const t = useT();
  const { data, error } = useLobbies(online);
  const live = data?.live ?? [], lobbies = data?.lobbies ?? [];
  return (
    <aside className="hub__side panel" aria-label={t('hub.battles')}>
      <header className="hub__sidehead">
        <p className="eyebrow">{t('hub.liveBattles')}</p>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('hub.closeBattles')}><Icon name="close" size={16} /></button>
      </header>
      <div className="hub__scroll scroller">
        {!data ? <p className="hub__empty">{error || t('hub.looking')}</p>
          : live.length ? <ul className="hub__list">{live.map(b => <LiveRow key={b.code} b={b} onWatch={() => onWatch(b.code)} />)}</ul>
          : <p className="hub__empty">{t('hub.noBattles')}</p>}
        <p className="eyebrow hub__subhead">{t('hub.openLobbies')}</p>
        {data && (lobbies.length ? <ul className="hub__list">{lobbies.map(l => <LobbyRow key={l.code} l={l} busy={busy} onJoin={() => onJoin(l.code)} />)}</ul>
          : <p className="hub__empty">{t('hub.noLobbies')}</p>)}
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
