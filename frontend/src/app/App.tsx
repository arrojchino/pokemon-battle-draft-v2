import { useCallback, useEffect, useRef, useState } from 'react';
import { isRoomCode } from '@shared';
import { useSession } from '../net/session.js';
import { firstVisit, useSettings } from './settings.js';
import { WorldProvider, useWorld } from './WorldProvider.js';
import { hasHub } from '../net/types.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useAudio } from './useAudio.js';
import { useApplySettings } from './applySettings.js';
import { TitleScreen } from '../ui/screens/TitleScreen.js';
import { PartnerSelect } from '../ui/screens/PartnerSelect.js';
import { MultiplayerScreen } from '../ui/screens/MultiplayerScreen.js';
import { PokedexScreen } from '../ui/screens/PokedexScreen.js';
import { SettingsPanel, SettingsScreen } from '../ui/screens/SettingsScreen.js';
import { MatchScreen } from '../ui/screens/MatchScreen.js';
import { HubScreen } from '../ui/screens/HubScreen.js';
import { WatchScreen } from '../ui/screens/WatchScreen.js';
import { CreditsDialog, FallbackBackdrop, LoadingVeil, PerfOverlay } from '../ui/Overlays.js';
import { Modal, Toasts, toast, useSettingsOpener } from '../ui/primitives.js';
import { useT } from '../i18n/index.js';
import { localizeServerError } from '../i18n/serverErrors.js';

type Screen = 'title' | 'partners' | 'multiplayer' | 'pokedex' | 'settings' | 'plaza';
const inviteFromUrl = () => { const c = new URLSearchParams(location.search).get('room')?.trim() ?? ''; return isRoomCode(c) ? c : ''; };

function Shell() {
  const session = useSession();
  const s = useSettings();
  const t = useT();
  // The tab title follows the language (index.html ships the English one).
  useEffect(() => { document.title = t('app.title'); }, [t.lang]);
  // A first visit opens on the partner choice; backing out keeps the random partner it was dealt.
  const [screen, setScreen] = useState<Screen>(firstVisit ? 'partners' : 'title');
  const [mode, setMode] = useState<'create' | 'join'>(inviteFromUrl() ? 'join' : 'create');
  const [partnerReturn, setPartnerReturn] = useState<Screen>('title');
  const [dialog, setDialog] = useState<'settings' | 'credits' | null>(null);
  const invite = inviteFromUrl();
  // With a plaza on the server, get its host ready while the player idles on the title screen.
  const { world } = useWorld();
  const hub = hasHub(session);
  useEffect(() => { if (world && hub && screen === 'title') world.prefetchHub(); }, [world, hub, screen]);
  useSettingsOpener(useCallback(() => setDialog('settings'), []));

  useEffect(() => { if (session.error) toast(localizeServerError(session.error), 'error'); }, [session.errorId, session.error]);
  // Once seated, drop ?room= from the URL so a refresh resumes the session instead of re-joining.
  useEffect(() => {
    if (!session.room) return;
    const u = new URL(location.href);
    if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u); }
  }, [session.room]);
  // Leaving a room lands on the title screen (a spectator who stops watching goes back where they were).
  const inMatch = !!session.room && session.seat !== null;
  const hadRoom = useRef(false);
  useEffect(() => { if (hadRoom.current && !inMatch) setScreen('title'); hadRoom.current = inMatch; }, [inMatch]);
  const watching = !inMatch && !!session.watching && !!session.room;
  const plaza = session.kind === 'backend' ? () => setScreen('plaza') : undefined;
  const goPartners = (back: Screen) => { setPartnerReturn(back); setScreen('partners'); };
  const toMultiplayer = (m: 'create' | 'join') => { setMode(m); setScreen('multiplayer'); };

  let body;
  let key: string = screen;
  if (inMatch) { key = 'match'; body = <MatchScreen room={session.room!} seat={session.seat!} transport={session.transport} link={session.link} />; }
  else if (watching) { key = `watch-${session.watching}`; body = <WatchScreen room={session.room!} transport={session.transport} link={session.link} onLeave={() => session.transport.unwatch()} />; }
  else if (screen === 'plaza') body = <HubScreen onBack={() => setScreen('title')} onPlay={() => toMultiplayer('create')} onPartner={() => goPartners('plaza')} />;
  else if (screen === 'partners') body = <PartnerSelect onBack={() => setScreen(partnerReturn)} onConfirm={() => setScreen(partnerReturn)} confirmLabel={partnerReturn === 'title' ? t('app.partnerUp') : t('app.iChooseYou')} />;
  else if (screen === 'multiplayer') body = <MultiplayerScreen mode={mode} inviteCode={invite} onBack={() => setScreen('title')} onChangePartner={() => goPartners('multiplayer')} onPlaza={plaza} />;
  else if (screen === 'pokedex') body = <PokedexScreen onBack={() => setScreen('title')} />;
  else if (screen === 'settings') body = <SettingsScreen onBack={() => setScreen('title')} />;
  else body = <TitleScreen inviteCode={invite} onPlay={() => toMultiplayer('create')} onJoin={() => toMultiplayer('join')} onPokedex={() => setScreen('pokedex')} onPartners={() => goPartners('title')} onSettings={() => setScreen('settings')} onCredits={() => setDialog('credits')} onPlaza={plaza} />;

  useAudio();
  useApplySettings();
  return (
    <>
      <FallbackBackdrop featured={[s.partner]} />
      <div className="ui">
        <ErrorBoundary label="screen"><div className="screen-wrap" key={key}>{body}</div></ErrorBoundary>
      </div>
      <Modal open={dialog === 'settings'} onClose={() => setDialog(null)} title={t('settings.title')} wide><SettingsPanel /></Modal>
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
