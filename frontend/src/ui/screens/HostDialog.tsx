import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LiveBattle } from '@shared';
import type { World } from '../../engine/World.js';
import { sound } from '../../audio/sound.js';
import { Icon, type IconName } from '../primitives.js';
import { PartnerAvatar, partnerStyle } from './LobbyParts.js';
import { useLobbies } from './MultiplayerScreen.js';

/** The plaza host's name. */
export const HOST_NAME = 'Mira';
const CPS = 42;
type View = 'menu' | 'watch' | 'code';
type Props = {
  world: World | null; trainer: string; trainers: number; online: boolean; busy: boolean; reducedMotion: boolean;
  onClose: () => void; onFind: () => void; onCreate: () => void; onWatch: (code: string) => void; onJoin: (code: string) => void;
};

/** A line typed out at a talking pace (instantly with reduced motion); `done` once it is all shown. */
function useTyped(line: string, reduced: boolean) {
  const [n, setN] = useState(reduced ? line.length : 0);
  useEffect(() => {
    if (reduced) { setN(line.length); return; }
    setN(0);
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(line.length, Math.floor(((performance.now() - t0) / 1000) * CPS));
      setN(k);
      if (k >= line.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [line, reduced]);
  return { text: line.slice(0, n), done: n >= line.length, skip: () => setN(line.length) };
}

/** What the plaza looks like right now, from the server's own lists. */
function newsLine(trainers: number, live: LiveBattle[], lobbies: number): string {
  const p = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let s = `Right now there ${trainers === 1 ? 'is' : 'are'} ${p(trainers, 'trainer', 'trainers')} in the plaza, ${p(live.length, 'live battle', 'live battles')} and ${p(lobbies, 'open lobby', 'open lobbies')}.`;
  const top = [...live].sort((a, b) => b.watchers - a.watchers)[0];
  if (top) s += top.watchers ? ` Most watched: ${top.names[0]} vs ${top.names[1]}, ${p(top.watchers, 'trainer', 'trainers')} watching.` : ` ${top.names[0]} and ${top.names[1]} are on turn ${Math.max(1, top.turn)}.`;
  else s += lobbies ? ' Someone is waiting for a rival: Find a battle to join them.' : ' A quiet moment: why not start a battle?';
  return s;
}

/**
 * Talking to the plaza host. She greets the trainer, then every option leads into the game's own systems:
 * the Battles panel, lobby creation, live battles to watch, joining by code, and a summary of what is on.
 * Arrow keys (or W and S) move between options, Enter picks, Escape leaves; walking waits while it is open.
 */
export function HostDialog({ world, trainer, trainers, online, busy, reducedMotion, onClose, onFind, onCreate, onWatch, onJoin }: Props) {
  const { data } = useLobbies(online);
  const live = data?.live ?? [], lobbies = data?.lobbies.length ?? 0;
  const [view, setView] = useState<View>('menu');
  const [line, setLine] = useState(`Welcome to the Pokémon Plaza, ${trainer}! Ready for a battle?`);
  const [code, setCode] = useState('');
  const typed = useTyped(line, reducedMotion);
  const box = useRef<HTMLElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // She talks while the line types; the dialogue opens and closes with its own sounds.
  useEffect(() => { world?.hostTalk(!typed.done); }, [world, typed.done]);
  useEffect(() => {
    world?.hostDialog(true); sound.play('dialogOpen');
    return () => { world?.hostDialog(false); sound.play('dialogClose'); };
  }, [world]);
  // Focus the first choice of each view (the code field on the code view).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (view === 'code') codeRef.current?.focus();
      else box.current?.querySelector<HTMLButtonElement>('.hostdlg__opt:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [view]);

  const say = (text: string, gesture: 'present' | 'nod' | 'point' = 'nod') => { setLine(text); world?.hostGesture(gesture); };
  const menu = () => { setView('menu'); say('Anything else I can help you with?', 'present'); };
  const watchView = () => {
    setView('watch');
    say(live.length ? `There ${live.length === 1 ? 'is one battle' : `are ${live.length} battles`} on right now. Pick one and I'll take you to the stands.` : "Nobody's battling right now. Start one and the whole plaza can watch!", 'point');
  };
  const codeView = () => { setView('code'); setCode(''); say("Got an invitation code? Type it in and I'll take you to that room.", 'present'); };
  const news = () => say(data ? newsLine(trainers, live, lobbies) : 'Let me check the board… ask me again in a moment.', 'present');
  const goodbye = () => { world?.hostGesture('nod'); onClose(); };
  const validCode = /^[A-Z0-9]{4,8}$/.test(code);

  const onKey = (e: ReactKeyboardEvent) => {
    // The plaza's walking and chat keys stay out of the dialogue.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (view === 'menu') onClose(); else menu(); return; }
    const dir = e.key === 'ArrowDown' || (e.code === 'KeyS' && view !== 'code') ? 1 : e.key === 'ArrowUp' || (e.code === 'KeyW' && view !== 'code') ? -1 : 0;
    if (!dir) return;
    const opts = [...(box.current?.querySelectorAll<HTMLButtonElement>('.hostdlg__opt:not(:disabled)') ?? [])];
    if (!opts.length) return;
    e.preventDefault();
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    opts[(at + dir + opts.length) % opts.length].focus();
    sound.play('dialogMove');
  };

  const opt = (label: string, icon: IconName, on: () => void, disabled = false, hint?: string) => (
    <button type="button" className="hostdlg__opt" data-sfx="dialogSelect" disabled={disabled} onClick={on}>
      <Icon name={icon} size={16} /><span>{label}</span>{hint && <small>{hint}</small>}
    </button>
  );

  return (
    <section ref={box} className="hostdlg panel" role="dialog" aria-label={`Talking to ${HOST_NAME}`} onKeyDown={onKey}>
      <header className="hostdlg__head">
        <p className="eyebrow"><span className="jp">案内</span> Plaza host</p>
        <strong className="hostdlg__name">{HOST_NAME}</strong>
        <button type="button" className="iconbtn" data-sfx="none" onClick={onClose} aria-label="Leave the conversation"><Icon name="close" size={16} /></button>
      </header>
      <p className="hostdlg__line" aria-live="polite" onClick={typed.skip}>
        {typed.text}{!typed.done && <span className="hostdlg__caret" aria-hidden="true" />}
        <span className="sr-only">{line}</span>
      </p>
      {view === 'menu' && (
        <div className="hostdlg__opts">
          {opt('Find a battle', 'swords', () => { onFind(); onClose(); }, !online, data ? `${live.length} live · ${lobbies} open` : undefined)}
          {opt('Create a battle', 'plus', () => { onCreate(); onClose(); })}
          {opt('Watch a battle', 'eye', watchView, !online)}
          {opt('Join with code', 'hash', codeView, !online)}
          {opt("What's happening?", 'info', news)}
          {opt('Goodbye', 'back', goodbye)}
        </div>
      )}
      {view === 'watch' && (
        <div className="hostdlg__opts hostdlg__opts--list">
          {live.slice(0, 4).map(b => (
            <button key={b.code} type="button" className="hostdlg__opt hostdlg__battle" data-sfx="dialogSelect" style={partnerStyle(b.avatars[0])} onClick={() => { onWatch(b.code); onClose(); }}>
              <span className="hub__vs"><PartnerAvatar id={b.avatars[0]} size="sm" /><PartnerAvatar id={b.avatars[1]} size="sm" /></span>
              <span>{b.names[0]} <i>vs</i> {b.names[1]}</span>
              <small>Turn {Math.max(1, b.turn)}{b.watchers ? ` · ${b.watchers} watching` : ''}</small>
            </button>
          ))}
          {!live.length && opt('Create a battle', 'plus', () => { onCreate(); onClose(); })}
          {opt('Back', 'back', menu)}
        </div>
      )}
      {view === 'code' && (
        <form className="hostdlg__code" onSubmit={e => { e.preventDefault(); if (validCode && !busy) { onJoin(code); onClose(); } }}>
          <input ref={codeRef} className="chat__input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            placeholder="Room code" aria-label="Room code" autoComplete="off" spellCheck={false} enterKeyHint="go" />
          <button className="btn btn--primary" data-sfx="dialogSelect" disabled={!validCode || busy}>Join</button>
          <button type="button" className="btn btn--ghost hostdlg__opt" data-sfx="back" onClick={menu}>Back</button>
        </form>
      )}
    </section>
  );
}
