import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_CHAT, type ChatLine, type PlazaEmote, type PublicRoom } from '@shared';
import type { Anchor, World } from '../../../engine/World.js';
import type { Transport } from '../../../net/types.js';
import { sound } from '../../../audio/sound.js';
import { Icon, type IconName } from '../../primitives.js';
import type { MatchModel } from './model.js';

export const EMOTES: { emote: PlazaEmote; label: string; icon: IconName }[] = [
  { emote: 'greet', label: 'Wave', icon: 'users' },
  { emote: 'excited', label: 'Cheer', icon: 'star' },
  { emote: 'twirl', label: 'Spin', icon: 'refresh' },
  { emote: 'bow', label: 'Bow', icon: 'crown' },
  { emote: 'thumbs', label: 'Nice', icon: 'check' },
  { emote: 'punch', label: 'Spar', icon: 'swords' },
];
const NO_LINES: ChatLine[] = [];
/** A line stays over its speaker's partner for a few seconds, longer for longer lines. */
export const bubbleMs = (text: string) => Math.min(9000, 3500 + text.length * 55);
export const media = (q: string) => typeof window !== 'undefined' && window.matchMedia(q).matches;
/** Wide enough for the chat to stay open beside the dock without covering it. */
export const ROOMY = '(min-width: 1280px)';

type Bubble = { id: number; text: string; until: number };
type Bubbles = [Bubble | null, Bubble | null];

/**
 * The plaza HUD: name tags and chat bubbles over the partners, the room chat with emotes, and the walking
 * hint. It also relays presence: the World's moves and emotes go to the rival, the rival's come back.
 * `walking` is true while the stage is the plaza; elsewhere the chat stays and the bubbles follow the partners.
 */
export function PlazaHud({ world, room, m, transport, walking }: { world: World | null; room: PublicRoom; m: MatchModel; transport: Transport; walking: boolean }) {
  const chat = room.chat ?? NO_LINES;
  const lastId = chat.length ? chat[chat.length - 1].id : 0;
  const [open, setOpen] = useState(() => walking && media(ROOMY));
  const [text, setText] = useState('');
  const [muted, setMuted] = useState(false);
  const [bubbles, setBubbles] = useState<Bubbles>([null, null]);
  const [unread, setUnread] = useState(0);
  const seen = useRef(lastId);
  const lastEmote = useRef(0);
  const tagMine = useRef<HTMLDivElement>(null);
  const tagTheirs = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Presence both ways.
  useEffect(() => {
    if (!world) return;
    const offs = [
      world.events.on('plazaMove', s => transport.move(s.x, s.z, s.face)),
      world.events.on('plazaEmote', ({ emote }) => transport.emote(emote)),
      transport.onPresence(p => { if (p.seat === m.opp) world.plazaPresence(p); }),
    ];
    return () => offs.forEach(off => off());
  }, [world, transport, m.opp]);

  // A rival who arrives or comes back learns where this player's partner stands.
  const oppHere = walking && m.oppConnected;
  useEffect(() => { if (world && oppHere) world.plazaResend(); }, [world, oppHere]);

  // Open in the plaza when there is room; folded away once the match moves on (the toggle brings it back).
  useEffect(() => { setOpen(walking && media(ROOMY)); }, [walking]);
  useEffect(() => { if (open) setUnread(0); }, [open]);

  // New lines: a bubble over the speaker's partner, a soft tick for the rival's, a count while the chat is closed.
  useEffect(() => {
    const fresh = chat.filter(l => l.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const shown = fresh.filter(l => !muted || l.seat === m.me);
    if (!shown.length) return;
    const now = Date.now();
    setBubbles(b => {
      const n: Bubbles = [b[0], b[1]];
      for (const l of shown) n[l.seat === m.me ? 0 : 1] = { id: l.id, text: l.text, until: now + bubbleMs(l.text) };
      return n;
    });
    const theirs = shown.filter(l => l.seat !== m.me).length;
    if (theirs) { sound.play('tick', { gain: 0.5 }); if (!open) setUnread(u => u + theirs); }
  }, [chat, muted, m.me, open]);

  // Each bubble clears itself when its time is up.
  useEffect(() => {
    const live = bubbles.filter((b): b is Bubble => !!b);
    if (!live.length) return;
    const t = window.setTimeout(() => setBubbles(cur => cur.map(b => (b && b.until <= Date.now() + 30 ? null : b)) as Bubbles), Math.max(0, Math.min(...live.map(b => b.until)) - Date.now()));
    return () => window.clearTimeout(t);
  }, [bubbles]);

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lastId, open, muted]);

  // Enter opens the chat and focuses the field (when nothing else has the keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as Element | null;
      if (t && t !== document.body && t.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tags ride the partners: positions are written straight to the DOM every frame, never through React.
  // They stay on screen and below the scoreboard, even over a big partner standing close to the camera.
  useEffect(() => {
    if (!world) return;
    let raf = 0, top = 0;
    const a: Anchor = { x: 0, y: 0, on: false };
    const place = (who: 'mine' | 'theirs', el: HTMLDivElement | null) => {
      if (!el) return;
      world.anchor(who, a);
      el.style.opacity = a.on ? '1' : '0';
      if (!a.on) return;
      const box = el.firstElementChild as HTMLElement | null;
      const w = box?.offsetWidth ?? 0, h = box?.offsetHeight ?? 0;
      const x = Math.min(Math.max(a.x, w / 2 + 8), window.innerWidth - w / 2 - 8);
      const y = Math.max(a.y, top + h);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };
    const tick = () => {
      top = (document.querySelector('.scoreboard')?.getBoundingClientRect().bottom ?? 0) + 8;
      place('mine', tagMine.current); place('theirs', tagTheirs.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    transport.act({ type: 'chat', text: t });
    setText('');
  };
  const emote = (e: PlazaEmote) => {
    // The server passes about one emote a second; a faster local one would never reach the rival.
    const now = performance.now();
    if (now - lastEmote.current < 650) return;
    lastEmote.current = now;
    world?.plazaEmote(e);
  };

  const tag = (i: 0 | 1) => {
    const b = bubbles[i];
    if ((i === 1 && !m.hasOpponent) || (!walking && !b)) return null;
    return (
      <div ref={i ? tagTheirs : tagMine} className={`ptag ${i ? 'ptag--theirs' : 'ptag--mine'}`} style={{ opacity: 0 }}>
        <div className="ptag__in">
          {b && <p className="ptag__bubble" key={b.id}>{b.text}</p>}
          {walking && <span className="ptag__name">{i ? m.oppName : m.myName}</span>}
        </div>
      </div>
    );
  };
  const lines = muted ? chat.filter(l => l.seat === m.me) : chat;
  const touch = media('(pointer: coarse)');

  return (
    <>
      <div className="ptags" aria-hidden="true">{tag(0)}{tag(1)}</div>
      {open ? (
        <section className="chat panel" aria-label="Room chat">
          <header className="chat__head">
            <p className="eyebrow"><span className="jp">チャット</span> {walking ? 'Plaza chat' : 'Room chat'}</p>
            {m.hasOpponent && (
              <button type="button" className={`iconbtn ${muted ? 'is-on' : ''}`} aria-pressed={muted} onClick={() => setMuted(v => !v)}
                title={muted ? `Show ${m.oppName}'s messages` : `Hide ${m.oppName}'s messages`} aria-label={muted ? `Show ${m.oppName}'s messages` : `Hide ${m.oppName}'s messages`}>
                <Icon name={muted ? 'mute' : 'volume'} size={16} />
              </button>
            )}
            <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="Close chat"><Icon name="close" size={16} /></button>
          </header>
          <ol className="chat__log scroller" ref={logRef} role="log" aria-live="polite">
            {lines.map(l => (
              <li key={l.id} className={`chat__line ${l.seat === m.me ? 'is-mine' : ''}`}><strong>{m.names[l.seat]}</strong><span>{l.text}</span></li>
            ))}
            {!lines.length && <li className="chat__empty">{m.hasOpponent ? `Say hi to ${m.oppName}. Lines also pop up over your partner.` : 'Waiting for a rival. They can read this when they join.'}</li>}
          </ol>
          {walking && (
            <div className="chat__emotes" role="group" aria-label="Emotes">
              {EMOTES.map(x => (
                <button key={x.emote} type="button" className="emote" onClick={() => emote(x.emote)}><Icon name={x.icon} size={15} /><span>{x.label}</span></button>
              ))}
            </div>
          )}
          <form className="chat__form" onSubmit={send}>
            <input ref={inputRef} className="chat__input" value={text} onChange={e => setText(e.target.value)} maxLength={MAX_CHAT}
              placeholder={m.hasOpponent ? `Message ${m.oppName}` : 'Leave a message'} aria-label="Chat message" enterKeyHint="send" autoComplete="off"
              onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }} />
            <button className="btn btn--primary chat__send" disabled={!text.trim()}>Send</button>
          </form>
          {walking && (
            <p className="chat__hint">
              {touch
                ? <>Tap the floor to walk there. Tap your rival's partner to go say hello.</>
                : <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk, <kbd>Shift</kbd> to run. Click the floor to go there, or your rival's partner to say hello. <kbd>Enter</kbd> chats.</>}
            </p>
          )}
        </section>
      ) : (
        <button type="button" className="chat-toggle iconbtn iconbtn--text" onClick={() => setOpen(true)} aria-label={unread ? `Open chat, ${unread} new` : 'Open chat'}>
          <Icon name="text" size={16} />Chat{unread > 0 && <span className="chat-toggle__count">{unread}</span>}
        </button>
      )}
    </>
  );
}
