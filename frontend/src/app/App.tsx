import { useCallback, useEffect, useRef, useState } from 'react';
import { isRoomCode } from '@shared';
import { useSession } from '../net/session.js';
import { firstVisit, useSettings } from './settings.js';
import { WorldProvider, useWorld } from './WorldProvider.js';
import { hasHub, hasLobbies } from '../net/types.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useAudio } from './useAudio.js';
import { useApplySettings } from './applySettings.js';
import { IntroScreen } from '../ui/screens/IntroScreen.js';
import { PlazaScreen, type PlazaPanel } from '../ui/screens/PlazaScreen.js';
import { PartnerSelect } from '../ui/screens/PartnerSelect.js';
import { MultiplayerScreen } from '../ui/screens/MultiplayerScreen.js';
import { PokedexScreen } from '../ui/screens/PokedexScreen.js';
import { SettingsPanel, SettingsScreen } from '../ui/screens/SettingsScreen.js';
import { MatchScreen } from '../ui/screens/MatchScreen.js';
import { WatchScreen } from '../ui/screens/WatchScreen.js';
import { NavMenu, type NavTarget } from '../ui/NavMenu.js';
import { ProfilePanel, TravelCard, WorldPanel } from '../ui/WorldPanels.js';
import { CreditsDialog, FallbackBackdrop, LoadingVeil, PerfOverlay } from '../ui/Overlays.js';
import { Modal, Toasts, toast, useSettingsOpener } from '../ui/primitives.js';
import { lobbyPrefs } from '../ui/screens/LobbyParts.js';
import { useT } from '../i18n/index.js';
import { localizeServerError } from '../i18n/serverErrors.js';

/** What opens over the plaza: the partner showcase, battle setup, the trainer card, settings, the draft pool. */
type Overlay = 'partner' | 'battle-create' | 'battle-join' | 'profile' | 'settings' | 'dex';
const inviteFromUrl = () => { const c = new URLSearchParams(location.search).get('room')?.trim() ?? ''; return isRoomCode(c) ? c : ''; };
/** `?nointro` (QA, links straight into the plaza) skips the opening cinematic. */
const skipIntro = new URLSearchParams(location.search).has('nointro');

/**
 * The game's flow: load, the opening cinematic, then the world. The plaza (a town square of its own) is home:
 * the main menu drops down from the top-left corner over it, panels open over it, and creating or joining a
 * battle travels to the separate stadium; leaving a room travels back. Spectating also happens in the stadium.
 */
function Shell() {
  const session = useSession();
  const s = useSettings();
  const t = useT();
  const { world, status } = useWorld();
  // The tab title follows the language (index.html ships the English one).
  useEffect(() => { document.title = t('app.title'); }, [t.lang]);
  const invite = inviteFromUrl();
  const [phase, setPhase] = useState<'intro' | 'world'>(skipIntro ? 'world' : 'intro');
  const [introStarted, setIntroStarted] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(invite ? 'battle-join' : firstVisit && skipIntro ? 'partner' : null);
  const [plazaPanel, setPlazaPanel] = useState<PlazaPanel | null>(null);
  const [credits, setCredits] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  useSettingsOpener(useCallback(() => setSettingsModal(true), []));
  useEffect(() => world?.events.on('introBeat', ({ kind }) => { if (kind === 'start') setIntroStarted(true); }), [world]);

  useEffect(() => { if (session.error) toast(localizeServerError(session.error), 'error'); }, [session.errorId, session.error]);
  // Once seated, drop ?room= from the URL so a refresh resumes the session instead of re-joining.
  useEffect(() => {
    if (!session.room) return;
    const u = new URL(location.href);
    if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u); }
  }, [session.room]);
  // Seated in a room: the stadium. Leaving it travels back to the plaza with nothing open over it.
  const inMatch = !!session.room && session.seat !== null;
  const hadRoom = useRef(false);
  useEffect(() => { if (inMatch) { setOverlay(null); setPlazaPanel(null); } else if (hadRoom.current) { setOverlay(null); setPlazaPanel(null); } hadRoom.current = inMatch; }, [inMatch]);
  const watching = !inMatch && !!session.watching && !!session.room;
  useEffect(() => { if (watching) setPlazaPanel(null); }, [watching]);

  const introDone = useCallback(() => {
    setPhase('world');
    // A first visit meets the partner it was dealt, on the showcase stage, and may pick another.
    if (firstVisit && !inviteFromUrl()) setOverlay('partner');
  }, []);

  const server = hasHub(session);
  const go = (to: NavTarget) => {
    setCredits(false);
    switch (to) {
      case 'plaza': setOverlay(null); setPlazaPanel(null); world?.resetCamera(); break;
      case 'players': case 'social': case 'lobbies': case 'watch': setOverlay(null); setPlazaPanel(p => (p === to ? null : to)); break;
      case 'quick':
        setOverlay(null); setPlazaPanel(null);
        if (hasLobbies(session)) { session.transport.clearError(); session.transport.quickJoin(s.name.trim(), s.partner, lobbyPrefs.bestOf, session.transport.supportsBattles ? s.battleMode : 'showdown'); toast(t('nav.searching'), 'info'); }
        else setOverlay('battle-create');
        break;
      case 'create': setPlazaPanel(null); setOverlay('battle-create'); break;
      case 'join': setPlazaPanel(null); setOverlay('battle-join'); break;
      case 'partner': setPlazaPanel(null); setOverlay('partner'); break;
      case 'profile': setPlazaPanel(null); setOverlay('profile'); break;
      case 'settings': setPlazaPanel(null); setOverlay('settings'); break;
      case 'dex': setPlazaPanel(null); setOverlay('dex'); break;
      case 'credits': setCredits(true); break;
    }
  };
  const close = () => setOverlay(null);
  const active: NavTarget | null = overlay === 'battle-create' ? 'create' : overlay === 'battle-join' ? 'join' : overlay ?? plazaPanel ?? 'plaza';

  let body;
  let key: string = phase;
  if (phase === 'intro') body = <IntroScreen onDone={introDone} />;
  else if (inMatch) { key = 'match'; body = <MatchScreen room={session.room!} seat={session.seat!} transport={session.transport} link={session.link} />; }
  else if (watching) { key = `watch-${session.watching}`; body = <WatchScreen room={session.room!} transport={session.transport} link={session.link} onLeave={() => session.transport.unwatch()} />; }
  else {
    key = 'world';
    body = (
      <>
        <PlazaScreen panel={plazaPanel} onPanel={setPlazaPanel} onBattle={tab => setOverlay(tab === 'join' ? 'battle-join' : 'battle-create')} suspended={overlay === 'partner'} />
        {overlay === 'partner' && (
          <PartnerSelect onBack={close} onConfirm={close} confirmLabel={t('app.iChooseYou')} />
        )}
        {(overlay === 'battle-create' || overlay === 'battle-join') && (
          <WorldPanel label={t('multi.title')} onClose={close} wide>
            <MultiplayerScreen key={overlay} mode={overlay === 'battle-join' ? 'join' : 'create'} inviteCode={invite} onBack={close} onChangePartner={() => setOverlay('partner')} />
          </WorldPanel>
        )}
        {overlay === 'profile' && <WorldPanel label={t('nav.profile')} onClose={close}><ProfilePanel onPartner={() => setOverlay('partner')} /></WorldPanel>}
        {overlay === 'settings' && <WorldPanel label={t('settings.title')} onClose={close} wide><SettingsScreen onBack={close} /></WorldPanel>}
        {overlay === 'dex' && <WorldPanel label={t('dex.title')} onClose={close} wide><PokedexScreen onBack={close} /></WorldPanel>}
      </>
    );
  }
  const navOn = phase === 'world' && !inMatch && !watching && overlay !== 'partner';

  useAudio();
  useApplySettings();
  return (
    <>
      <FallbackBackdrop featured={[s.partner]} />
      <div className="ui">
        <ErrorBoundary label="screen"><div className="screen-wrap" key={key}>{body}</div></ErrorBoundary>
        {navOn && <NavMenu onGo={go} active={active} server={server} />}
      </div>
      <TravelCard />
      <Modal open={settingsModal} onClose={() => setSettingsModal(false)} title={t('settings.title')} wide><SettingsPanel /></Modal>
      <CreditsDialog open={credits} onClose={() => setCredits(false)} />
      {s.perf && <PerfOverlay />}
      <Toasts />
      <LoadingVeil hold={phase === 'intro' && !introStarted && status.kind !== 'fallback'} />
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
