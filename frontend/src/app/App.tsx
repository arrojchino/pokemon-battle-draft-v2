import { useEffect, useRef, useState } from 'react';
import { isRoomCode } from '@shared';
import { useSession } from '../net/session.js';
import { useSettings } from './settings.js';
import { WorldProvider } from './WorldProvider.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { TitleScreen } from '../ui/screens/TitleScreen.js';
import { PartnerSelect } from '../ui/screens/PartnerSelect.js';
import { SetupScreen } from '../ui/screens/SetupScreen.js';
import { MatchScreen } from '../ui/screens/MatchScreen.js';
import { CreditsDialog, FallbackBackdrop, LoadingVeil, PerfOverlay, SettingsDialog } from '../ui/Overlays.js';
import { Toasts, toast } from '../ui/primitives.js';
import { ROSTER } from '../characters/roster.js';

type Screen = 'title' | 'partners' | 'setup';
const inviteFromUrl = () => { const c = new URLSearchParams(location.search).get('room')?.trim() ?? ''; return isRoomCode(c) ? c : ''; };

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
  else if (screen === 'partners') body = <PartnerSelect onBack={() => setScreen(returnTo)} onConfirm={() => setScreen(afterPartner)} confirmLabel={afterPartner === 'setup' ? 'Battle with {name}' : 'Partner with {name}'} />;
  else if (screen === 'setup') body = <SetupScreen mode={mode} setMode={setMode} inviteCode={invite} onBack={() => setScreen('title')} onChangePartner={() => goPartners('setup')} />;
  else body = <TitleScreen inviteCode={invite} onPlay={() => { setMode('create'); goPartners('setup'); }} onJoin={() => { setMode('join'); goPartners('setup'); }} onPartners={() => goPartners('title')} onSettings={() => setDialog('settings')} onCredits={() => setDialog('credits')} />;

  const featured = inMatch ? [s.partner] : screen === 'partners' ? ROSTER.map(r => r.id) : [s.partner];
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
