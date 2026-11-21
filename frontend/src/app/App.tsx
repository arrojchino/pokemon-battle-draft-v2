import { useEffect, useRef, useState } from 'react';
import { isRoomCode } from '@shared';
import { useSession } from '../net/session.js';
import { useSettings } from './settings.js';
import { WorldProvider, useWorld } from './WorldProvider.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { TitleScreen } from '../ui/screens/TitleScreen.js';
import { PartnerSelect } from '../ui/screens/PartnerSelect.js';
import { SetupScreen } from '../ui/screens/SetupScreen.js';
import { MatchScreen } from '../ui/screens/MatchScreen.js';
import { CreditsDialog, FallbackBackdrop, LoadingVeil, PerfOverlay, SettingsDialog } from '../ui/Overlays.js';
import { Toasts, toast } from '../ui/primitives.js';
import { sound } from '../audio/sound.js';

type Screen = 'title' | 'partners' | 'setup';
const inviteFromUrl = () => { const c = new URLSearchParams(location.search).get('room')?.trim() ?? ''; return isRoomCode(c) ? c : ''; };

/**
 * Audio wiring: unlock on the first gesture, follow the volume settings, route stage noises, and give
 * every button a hover tick and a clunk. Battle music is chosen by the match screen.
 */
function useAudio(inMatch: boolean) {
  const s = useSettings();
  const { world } = useWorld();
  useEffect(() => { sound.setVolumes({ master: s.volume, music: s.music }, s.muted); }, [s.volume, s.music, s.muted]);
  useEffect(() => { if (!inMatch) sound.setMusic('alley'); }, [inMatch]);
  useEffect(() => world?.events.on('sound', ({ cue, pan, gain }) => sound.play(cue, { pan, gain })), [world]);
  useEffect(() => {
    const unlock = () => sound.unlock();
    let hovered: Element | null = null;
    const over = (e: PointerEvent) => {
      const b = (e.target as Element).closest?.('button:not(:disabled), .menu__item, a');
      if (b && b !== hovered && e.pointerType === 'mouse') sound.play('hover');
      hovered = b;
    };
    const click = (e: MouseEvent) => {
      const b = (e.target as Element).closest?.('button, a, input[type=checkbox]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const label = b.textContent?.trim().toLowerCase() ?? '';
      sound.play(b.matches('.btn--primary, .menu__item.is-primary') ? 'confirm' : label.startsWith('back') || b.matches('[aria-label^="Close"]') ? 'back' : b.matches('.seg button, input[type=checkbox], .swatch') ? 'toggle' : 'click');
    };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    window.addEventListener('pointerover', over); window.addEventListener('click', click, true);
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); window.removeEventListener('pointerover', over); window.removeEventListener('click', click, true); };
  }, []);
}

function Shell() {
  const session = useSession();
  const s = useSettings();
  const [screen, setScreen] = useState<Screen>('title');
  const [mode, setMode] = useState<'create' | 'join'>(inviteFromUrl() ? 'join' : 'create');
  const [afterPartner, setAfterPartner] = useState<Screen>('title');
  const [returnTo, setReturnTo] = useState<Screen>('title');
  const [dialog, setDialog] = useState<'settings' | 'credits' | null>(null);
  const invite = inviteFromUrl();

  useEffect(() => { if (session.error) toast(session.error, 'error'); }, [session.errorId, session.error]);
  // Once seated, drop ?room= from the URL so a refresh resumes the session instead of re-joining.
  useEffect(() => {
    if (!session.room) return;
    const u = new URL(location.href);
    if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u); }
  }, [session.room]);
  // Leaving a room lands on the title screen.
  const hadRoom = useRef(false);
  useEffect(() => { if (hadRoom.current && !session.room) setScreen('title'); hadRoom.current = !!session.room; }, [session.room]);

  const inMatch = !!session.room && session.seat !== null;
  const goPartners = (next: Screen) => { setReturnTo(screen); setAfterPartner(next); setScreen('partners'); };

  let body;
  if (inMatch) body = <MatchScreen room={session.room!} seat={session.seat!} transport={session.transport} link={session.link} />;
  else if (screen === 'partners') body = <PartnerSelect onBack={() => setScreen(returnTo)} onConfirm={() => setScreen(afterPartner)} confirmLabel={afterPartner === 'setup' ? 'Roll out as {name}' : 'Paint it {name}'} />;
  else if (screen === 'setup') body = <SetupScreen mode={mode} setMode={setMode} inviteCode={invite} onBack={() => setScreen('title')} onChangePartner={() => goPartners('setup')} />;
  else body = <TitleScreen inviteCode={invite} onPlay={() => { setMode('create'); goPartners('setup'); }} onJoin={() => { setMode('join'); goPartners('setup'); }} onPartners={() => goPartners('title')} onSettings={() => setDialog('settings')} onCredits={() => setDialog('credits')} />;

  const featured = [s.partner];
  useAudio(inMatch);
  return (
    <>
      <FallbackBackdrop featured={featured} />
      <div className="ui">
        <ErrorBoundary label="screen">{body}</ErrorBoundary>
      </div>
      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <CreditsDialog open={dialog === 'credits'} onClose={() => setDialog(null)} />
      {s.perf && <PerfOverlay />}
      <Toasts />
      <LoadingVeil />
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary label="app">
      <WorldProvider>
        <Shell />
      </WorldProvider>
    </ErrorBoundary>
  );
}
