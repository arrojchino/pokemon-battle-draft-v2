import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { BattleMode, LobbySummary, Visibility } from '@shared';
import { characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { useSession } from '../../net/session.js';
import { hasLobbies } from '../../net/types.js';
import { Icon, ScreenHeader, Segmented, Spinner } from '../primitives.js';
import { MODE_LABEL, PartnerAvatar, lobbyPrefs, partnerStyle } from './LobbyParts.js';

type Tab = 'browse' | 'create' | 'join';
type Props = { mode: 'create' | 'join'; inviteCode: string; onBack: () => void; onChangePartner: () => void };

const waited = (ms: number) => { const m = Math.floor(ms / 60000); return m < 1 ? 'just opened' : `waiting ${m} min`; };

/** Open public lobbies, refreshed every few seconds while the list is on screen. */
function useLobbies(enabled: boolean) {
  const { transport } = useSession();
  const [data, setData] = useState<{ lobbies: LobbySummary[]; now: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setData(await transport.listLobbies()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load lobbies'); }
    finally { setLoading(false); }
  }, [transport]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, 6000);
    return () => clearInterval(id);
  }, [enabled, refresh]);
  return { data, loading, error, refresh };
}

/**
 * Multiplayer hub: a trainer card (name, partner, Quick join) beside three ways in. Public lobbies and
 * Quick join appear only when the dedicated server supports them; peer rooms are invite-only.
 */
export function MultiplayerScreen({ mode, inviteCode, onBack, onChangePartner }: Props) {
  const s = useSettings();
  const c = characterById(s.partner)!;
  const { world } = useWorld();
  const session = useSession();
  const lobbies = hasLobbies(session);
  const [picked, setPicked] = useState<Tab | null>(mode === 'join' || inviteCode ? 'join' : null);
  const tab: Tab = picked ?? (lobbies ? 'browse' : 'create');
  const [busy, setBusy] = useState(false);
  useEffect(() => { world?.setLayout({ mode: 'title', featured: s.partner }); }, [world, s.partner]);
  useEffect(() => { if (session.error) setBusy(false); }, [session.errorId, session.error]);

  const name = (fallback: string) => s.name.trim() || fallback;
  const start = (run: () => void) => { setBusy(true); session.transport.clearError(); world?.emote(s.partner, 'nod'); run(); };
  const battleMode: BattleMode = session.transport.supportsBattles ? s.battleMode : 'showdown';
  const join = (code: string) => start(() => session.transport.join(code, name('Player 2'), s.partner));
  const quick = () => start(() => session.transport.quickJoin(s.name.trim(), s.partner, lobbyPrefs.bestOf, battleMode));
  const online = session.link === 'online';

  const tabs: { id: Tab; label: string; icon: 'globe' | 'plus' | 'hash' }[] = [
    ...(lobbies ? [{ id: 'browse' as const, label: 'Public lobbies', icon: 'globe' as const }] : []),
    { id: 'create', label: 'Create lobby', icon: 'plus' },
    { id: 'join', label: 'Join with code', icon: 'hash' },
  ];

  return (
    <main className="screen mp">
      <ScreenHeader title="Online battle" eyebrow="Multiplayer" jp="通信対戦" onBack={onBack} />
      <div className="mp__grid">
        <aside className="mp__trainer panel" style={partnerStyle(s.partner)}>
          <p className="eyebrow"><span className="jp">トレーナー</span> Trainer card</p>
          <div className="mp__id">
            <PartnerAvatar id={s.partner} size="lg" />
            <div className="mp__idtext"><small>Partner</small><strong>{c.name}</strong></div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onChangePartner}>Change</button>
          </div>
          <label className="field">
            <span>Your name</span>
            <input value={s.name} maxLength={24} autoComplete="nickname" placeholder="Trainer" onChange={e => settings.set({ name: e.target.value })} />
          </label>
          {lobbies && <>
            <button type="button" className="btn btn--gold btn--xl" disabled={busy || !online} onClick={quick}><Icon name="bolt" />Quick join</button>
            <small className="hint">Takes the public lobby that has waited longest, or opens one for the next trainer.</small>
          </>}
          <p className="mp__status">
            <span className={`dot ${online ? 'dot--on' : session.link === 'connecting' ? 'dot--wait' : ''}`} />
            {session.kind === 'backend' ? 'Dedicated server' : 'Peer relay (the room creator hosts)'} · {online ? 'connected' : session.link}
          </p>
        </aside>

        <section className="mp__main panel" aria-label="Ways to play">
          <div className="mp__tabs" role="tablist" aria-label="Multiplayer">
            {tabs.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`mp__tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => setPicked(t.id)}>
                <Icon name={t.icon} size={16} />{t.label}
              </button>
            ))}
          </div>
          <div className="mp__body" key={tab}>
            {tab === 'browse' && <LobbyBrowser busy={busy} online={online} onJoin={join} onCreate={() => { lobbyPrefs.visibility = 'public'; setPicked('create'); }} onQuick={quick} />}
            {tab === 'create' && <CreateLobby busy={busy} lobbies={lobbies} battles={session.transport.supportsBattles} onCreate={(bestOf, visibility) => start(() => session.transport.create(name('Player 1'), bestOf, s.partner, battleMode, visibility))} />}
            {tab === 'join' && <JoinByCode busy={busy} initial={inviteCode} onJoin={join} />}
          </div>
        </section>
      </div>
    </main>
  );
}

function LobbyBrowser({ busy, online, onJoin, onCreate, onQuick }: { busy: boolean; online: boolean; onJoin: (code: string) => void; onCreate: () => void; onQuick: () => void }) {
  const { data, loading, error, refresh } = useLobbies(online);
  const [q, setQ] = useState('');
  const [bestOf, setBestOf] = useState<0 | 3 | 5>(0);
  const [mode, setMode] = useState<'any' | BattleMode>('any');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.lobbies ?? []).filter(l =>
      (!needle || l.host.toLowerCase().includes(needle) || l.code.toLowerCase().includes(needle)) &&
      (!bestOf || l.bestOf === bestOf) && (mode === 'any' || l.mode === mode));
  }, [data, q, bestOf, mode]);
  const total = data?.lobbies.length ?? 0;

  return (
    <div className="lobbies">
      <div className="lobbies__bar">
        <label className="lobbies__search">
          <Icon name="search" size={16} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search host or code" aria-label="Search lobbies" spellCheck={false} />
        </label>
        <Segmented label="Series length" value={bestOf} onChange={setBestOf} options={[{ value: 0, label: 'Any' }, { value: 3, label: 'Bo3' }, { value: 5, label: 'Bo5' }]} />
        <Segmented label="Where battles happen" value={mode} onChange={setMode} options={[{ value: 'any', label: 'Any' }, { value: 'app', label: 'Here' }, { value: 'showdown', label: 'Showdown' }]} />
        <button type="button" className={`btn btn--ghost btn--sm lobbies__refresh ${loading ? 'is-loading' : ''}`} onClick={() => void refresh()} aria-label="Refresh lobbies" title="Refresh">
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {!data && !error ? (
        <div className="lobbies__empty"><Spinner size={26} label="Loading lobbies" /><p>Looking for open lobbies…</p></div>
      ) : error && !data ? (
        <div className="lobbies__empty"><p className="error">{error}</p><button type="button" className="btn btn--sm" onClick={() => void refresh()}>Try again</button></div>
      ) : shown.length ? (
        <ul className="lobbies__list" aria-label={`${shown.length} open lobbies`}>
          {shown.map((l, i) => {
            const host = characterById(l.avatar);
            return (
              <li key={l.code} className="lobby" style={{ ...partnerStyle(l.avatar), '--i': i } as CSSProperties}>
                <PartnerAvatar id={l.avatar} />
                <div className="lobby__text">
                  <strong>{l.host}</strong>
                  <small>{host ? `with ${host.name}` : 'Trainer'} · {waited(data!.now - l.createdAt)}</small>
                </div>
                <div className="lobby__tags">
                  <span className="badge">Best of {l.bestOf}</span>
                  <span className="badge">{MODE_LABEL[l.mode]}</span>
                  <span className="badge badge--ok"><Icon name="users" size={12} />{l.players}/2</span>
                </div>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onJoin(l.code)}>Join</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="lobbies__empty">
          <span className="lobbies__ball" aria-hidden="true" />
          <p>{total ? 'No lobby matches these filters.' : 'No public lobbies are open right now.'}</p>
          <div className="dock__row">
            <button type="button" className="btn btn--primary btn--sm" onClick={onCreate}><Icon name="plus" />Open a public lobby</button>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={onQuick}><Icon name="bolt" />Quick join</button>
          </div>
        </div>
      )}
      <p className="lobbies__foot hint">{total} open · refreshes every few seconds</p>
    </div>
  );
}

function CreateLobby({ busy, lobbies, battles, onCreate }: { busy: boolean; lobbies: boolean; battles: boolean; onCreate: (bestOf: 3 | 5, visibility: Visibility) => void }) {
  const s = useSettings();
  const [bestOf, setBestOf] = useState<3 | 5>(lobbyPrefs.bestOf);
  const [visibility, setVisibility] = useState<Visibility>(lobbies ? lobbyPrefs.visibility : 'private');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    lobbyPrefs.bestOf = bestOf; lobbyPrefs.visibility = visibility;
    onCreate(bestOf, lobbies ? visibility : 'private');
  };
  return (
    <form className="mp__form" onSubmit={submit}>
      <div className="field">
        <span>Series length</span>
        <Segmented label="Series length" value={bestOf} onChange={setBestOf} options={[{ value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }]} />
      </div>
      <div className="field">
        <span>Battles</span>
        {battles ? <>
          <Segmented label="Where battles happen" value={s.battleMode} onChange={v => settings.set({ battleMode: v })} options={[{ value: 'app', label: 'Battle here' }, { value: 'showdown', label: 'On Showdown' }]} />
          <small>{s.battleMode === 'app' ? 'The drafted teams fight right here, no import.' : 'Copy teams into Pokémon Showdown and report the winner.'}</small>
        </> : <small>Peer rooms battle on Pokémon Showdown. Connect a server (?ws=) to battle here.</small>}
      </div>
      {lobbies && (
        <div className="field">
          <span>Visibility</span>
          <Segmented label="Visibility" value={visibility} onChange={setVisibility} options={[{ value: 'private', label: <><Icon name="lock" size={14} />Private</> }, { value: 'public', label: <><Icon name="globe" size={14} />Public</> }]} />
          <small>{visibility === 'public' ? 'Listed under Public lobbies until a rival joins.' : 'Only people with the code or the invite link can join.'}</small>
        </div>
      )}
      <button className="btn btn--primary btn--xl" type="submit" disabled={busy}>{busy ? <Spinner size={18} label="Connecting" /> : <Icon name="spark" />}{busy ? 'Connecting…' : `Create ${lobbies && visibility === 'public' ? 'public' : 'private'} lobby`}</button>
    </form>
  );
}

function JoinByCode({ busy, initial, onJoin }: { busy: boolean; initial: string; onJoin: (code: string) => void }) {
  const [code, setCode] = useState(initial);
  return (
    <form className="mp__form" onSubmit={e => { e.preventDefault(); if (code) onJoin(code); }}>
      <label className="field">
        <span>Room code</span>
        <input className="mono mp__code" value={code} maxLength={64} autoComplete="off" spellCheck={false} placeholder="4F2A9C" onChange={e => setCode(e.target.value.trim())} autoFocus />
        <small>{initial ? 'Filled in from your invite link.' : 'Six characters, shown in the host\u2019s waiting room.'}</small>
      </label>
      <button className="btn btn--primary btn--xl" type="submit" disabled={busy || !code}>{busy ? <Spinner size={18} label="Connecting" /> : <Icon name="arrow" />}{busy ? 'Connecting…' : 'Join room'}</button>
    </form>
  );
}
