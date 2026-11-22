import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { BattleMode, Visibility } from '@shared';
import { characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { useSession } from '../../net/session.js';
import { hasHub, hasLobbies, type LobbyList } from '../../net/types.js';
import { Icon, ScreenHeader, Segmented, Spinner } from '../primitives.js';
import { MODE_LABEL, PartnerAvatar, lobbyPrefs, partnerStyle } from './LobbyParts.js';
import { t as tr, useT, type MessageKey } from '../../i18n/index.js';

type Tab = 'browse' | 'create' | 'join';
type Props = { mode: 'create' | 'join'; inviteCode: string; onBack: () => void; onChangePartner: () => void; onPlaza?: () => void };

const waited = (ms: number) => { const m = Math.floor(ms / 60000); return m < 1 ? tr('multi.justOpened') : tr('multi.waitingMin', { n: m }); };

/** Open public lobbies and live battles, refreshed every few seconds while the list is on screen. */
export function useLobbies(enabled: boolean) {
  const { transport } = useSession();
  const [data, setData] = useState<LobbyList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setData(await transport.listLobbies()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : tr('multi.loadError')); }
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
export function MultiplayerScreen({ mode, inviteCode, onBack, onChangePartner, onPlaza }: Props) {
  const t = useT();
  const s = useSettings();
  const c = characterById(s.partner)!;
  const { world } = useWorld();
  const session = useSession();
  const lobbies = hasLobbies(session);
  const hub = hasHub(session);
  const [picked, setPicked] = useState<Tab | null>(mode === 'join' || inviteCode ? 'join' : null);
  const tab: Tab = picked ?? (lobbies ? 'browse' : 'create');
  const [busy, setBusy] = useState(false);
  useEffect(() => { world?.setLayout({ mode: 'title', featured: s.partner }); }, [world, s.partner]);
  useEffect(() => { if (session.error) setBusy(false); }, [session.errorId, session.error]);

  const name = (fallback: string) => s.name.trim() || fallback;
  const start = (run: () => void) => { setBusy(true); session.transport.clearError(); world?.emote(s.partner, 'nod'); run(); };
  const battleMode: BattleMode = session.transport.supportsBattles ? s.battleMode : 'showdown';
  const join = (code: string) => start(() => session.transport.join(code, name(t('match.player2')), s.partner));
  const quick = () => start(() => session.transport.quickJoin(s.name.trim(), s.partner, lobbyPrefs.bestOf, battleMode));
  const online = session.link === 'online';

  const tabs: { id: Tab; label: MessageKey; icon: 'globe' | 'plus' | 'hash' }[] = [
    ...(lobbies ? [{ id: 'browse' as const, label: 'multi.tabBrowse' as const, icon: 'globe' as const }] : []),
    { id: 'create', label: 'multi.tabCreate', icon: 'plus' },
    { id: 'join', label: 'multi.tabJoin', icon: 'hash' },
  ];

  return (
    <main className="screen mp scroller">
      <ScreenHeader title={t('multi.title')} eyebrow={t('multi.eyebrow')} onBack={onBack} />
      <div className="mp__grid">
        <aside className="mp__trainer panel" style={partnerStyle(s.partner)}>
          <p className="eyebrow">{t('multi.trainerCard')}</p>
          <div className="mp__id">
            <PartnerAvatar id={s.partner} size="lg" />
            <div className="mp__idtext"><small>{t('multi.partner')}</small><strong>{c.name}</strong></div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onChangePartner}>{t('multi.change')}</button>
          </div>
          <label className="field">
            <span>{t('multi.yourName')}</span>
            <input value={s.name} maxLength={24} autoComplete="nickname" placeholder={t('multi.trainer')} onChange={e => settings.set({ name: e.target.value })} />
          </label>
          {lobbies && <>
            <button type="button" className="btn btn--gold btn--xl" disabled={busy || !online} onClick={quick}><Icon name="bolt" />{t('multi.quickJoin')}</button>
            <small className="hint">{t('multi.quickHint')}</small>
          </>}
          {hub && onPlaza && <button type="button" className="btn btn--ghost" onClick={onPlaza}><Icon name="users" />{t('multi.toPlaza')}</button>}
          <p className="mp__status">
            <span className={`dot ${online ? 'dot--on' : session.link === 'connecting' ? 'dot--wait' : ''}`} />
            {t(session.kind === 'backend' ? 'multi.dedicated' : 'multi.peerRelay')} · {t(online ? 'multi.link.online' : session.link === 'connecting' ? 'multi.link.connecting' : 'multi.link.offline')}
          </p>
        </aside>

        <section className="mp__main panel" aria-label={t('multi.waysToPlay')}>
          <div className="mp__tabs" role="tablist" aria-label={t('multi.eyebrow')}>
            {tabs.map(tb => (
              <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={`mp__tab ${tab === tb.id ? 'is-on' : ''}`} onClick={() => setPicked(tb.id)}>
                <Icon name={tb.icon} size={16} />{t(tb.label)}
              </button>
            ))}
          </div>
          <div className="mp__body" key={tab}>
            {tab === 'browse' && <LobbyBrowser busy={busy} online={online} onJoin={join} onCreate={() => { lobbyPrefs.visibility = 'public'; setPicked('create'); }} onQuick={quick}
              onWatch={hub ? code => { session.transport.clearError(); session.transport.watch(code); } : undefined} />}
            {tab === 'create' && <CreateLobby busy={busy} lobbies={lobbies} battles={session.transport.supportsBattles} onCreate={(bestOf, visibility) => start(() => session.transport.create(name(t('match.player1')), bestOf, s.partner, battleMode, visibility))} />}
            {tab === 'join' && <JoinByCode busy={busy} initial={inviteCode} onJoin={join} />}
          </div>
        </section>
      </div>
    </main>
  );
}

function LobbyBrowser({ busy, online, onJoin, onCreate, onQuick, onWatch }: { busy: boolean; online: boolean; onJoin: (code: string) => void; onCreate: () => void; onQuick: () => void; onWatch?: (code: string) => void }) {
  const t = useT();
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
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('multi.search')} aria-label={t('multi.searchLabel')} spellCheck={false} />
        </label>
        <Segmented label={t('multi.seriesLength')} value={bestOf} onChange={setBestOf} options={[{ value: 0, label: t('multi.any') }, { value: 3, label: t('multi.bo3') }, { value: 5, label: t('multi.bo5') }]} />
        <Segmented label={t('multi.where')} value={mode} onChange={setMode} options={[{ value: 'any', label: t('multi.any') }, { value: 'app', label: t('multi.here') }, { value: 'showdown', label: 'Showdown' }]} />
        <button type="button" className={`btn btn--ghost btn--sm lobbies__refresh ${loading ? 'is-loading' : ''}`} onClick={() => void refresh()} aria-label={t('multi.refreshLabel')} title={t('multi.refresh')}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {!data && !error ? (
        <div className="lobbies__empty"><Spinner size={26} label={t('multi.loadingLobbies')} /><p>{t('multi.looking')}</p></div>
      ) : error && !data ? (
        <div className="lobbies__empty"><p className="error">{error}</p><button type="button" className="btn btn--sm" onClick={() => void refresh()}>{t('multi.tryAgain')}</button></div>
      ) : shown.length ? (
        <ul className="lobbies__list" aria-label={t(shown.length === 1 ? 'multi.openLobbies.one' : 'multi.openLobbies.other', { n: shown.length })}>
          {shown.map((l, i) => {
            const host = characterById(l.avatar);
            return (
              <li key={l.code} className="lobby" style={{ ...partnerStyle(l.avatar), '--i': i } as CSSProperties}>
                <PartnerAvatar id={l.avatar} />
                <div className="lobby__text">
                  <strong>{l.host}</strong>
                  <small>{host ? t('multi.withPartner', { name: host.name }) : t('multi.trainer')} · {waited(data!.now - l.createdAt)}</small>
                </div>
                <div className="lobby__tags">
                  <span className="badge">{t('match.bestOf', { n: l.bestOf })}</span>
                  <span className="badge">{t(MODE_LABEL[l.mode])}</span>
                  <span className="badge badge--ok"><Icon name="users" size={12} />{l.players}/2</span>
                </div>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onJoin(l.code)}>{t('multi.join')}</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="lobbies__empty">
          <span className="lobbies__ball" aria-hidden="true" />
          <p>{t(total ? 'multi.noMatch' : 'multi.noneOpen')}</p>
          <div className="dock__row">
            <button type="button" className="btn btn--primary btn--sm" onClick={onCreate}><Icon name="plus" />{t('multi.openPublic')}</button>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={onQuick}><Icon name="bolt" />{t('multi.quickJoin')}</button>
          </div>
        </div>
      )}
      {onWatch && !!data?.live.length && (
        <section className="lobbies__live" aria-label={t('multi.live')}>
          <p className="eyebrow">{t('multi.live')}</p>
          <ul className="lobbies__list">
            {data.live.map((b, i) => (
              <li key={b.code} className="lobby" style={{ ...partnerStyle(b.avatars[0]), '--i': i } as CSSProperties}>
                <PartnerAvatar id={b.avatars[0]} />
                <div className="lobby__text">
                  <strong>{b.names[0]} vs {b.names[1]}</strong>
                  <small>{b.wins[0]}–{b.wins[1]} · {t('multi.turn', { n: Math.max(1, b.turn) })}{b.watchers ? ` · ${t('multi.watchers', { n: b.watchers })}` : ''}</small>
                </div>
                <div className="lobby__tags"><span className="badge">{t('match.bestOf', { n: b.bestOf })}</span></div>
                <button type="button" className="btn btn--sm" onClick={() => onWatch(b.code)}><Icon name="eye" size={14} />{t('multi.watch')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="lobbies__foot hint">{t('multi.footOpen', { n: total })}{data?.live.length ? ` · ${t('multi.footLive', { n: data.live.length })}` : ''} · {t('multi.footRefresh')}</p>
    </div>
  );
}

function CreateLobby({ busy, lobbies, battles, onCreate }: { busy: boolean; lobbies: boolean; battles: boolean; onCreate: (bestOf: 3 | 5, visibility: Visibility) => void }) {
  const t = useT();
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
        <span>{t('multi.seriesLength')}</span>
        <Segmented label={t('multi.seriesLength')} value={bestOf} onChange={setBestOf} options={[{ value: 3, label: t('match.bestOf', { n: 3 }) }, { value: 5, label: t('match.bestOf', { n: 5 }) }]} />
      </div>
      <div className="field">
        <span>{t('multi.battles')}</span>
        {battles ? <>
          <Segmented label={t('multi.where')} value={s.battleMode} onChange={v => settings.set({ battleMode: v })} options={[{ value: 'app', label: t('lobby.modeApp') }, { value: 'showdown', label: t('lobby.modeShowdown') }]} />
          <small>{t(s.battleMode === 'app' ? 'multi.appHint' : 'multi.showdownHint')}</small>
        </> : <small>{t('multi.peerHint')}</small>}
      </div>
      {lobbies && (
        <div className="field">
          <span>{t('multi.visibility')}</span>
          <Segmented label={t('multi.visibility')} value={visibility} onChange={setVisibility} options={[{ value: 'private', label: <><Icon name="lock" size={14} />{t('multi.private')}</> }, { value: 'public', label: <><Icon name="globe" size={14} />{t('multi.public')}</> }]} />
          <small>{t(visibility === 'public' ? 'multi.publicHint' : 'multi.privateHint')}</small>
        </div>
      )}
      <button className="btn btn--primary btn--xl" type="submit" disabled={busy}>{busy ? <Spinner size={18} label={t('multi.connecting')} /> : <Icon name="spark" />}{busy ? t('multi.connectingDots') : t(lobbies && visibility === 'public' ? 'multi.createPublic' : 'multi.createPrivate')}</button>
    </form>
  );
}

function JoinByCode({ busy, initial, onJoin }: { busy: boolean; initial: string; onJoin: (code: string) => void }) {
  const t = useT();
  const [code, setCode] = useState(initial);
  return (
    <form className="mp__form" onSubmit={e => { e.preventDefault(); if (code) onJoin(code); }}>
      <label className="field">
        <span>{t('lobby.roomCode')}</span>
        <input className="mono mp__code" value={code} maxLength={64} autoComplete="off" spellCheck={false} placeholder="4F2A9C" onChange={e => setCode(e.target.value.trim())} autoFocus />
        <small>{t(initial ? 'multi.fromInvite' : 'multi.codeHint')}</small>
      </label>
      <button className="btn btn--primary btn--xl" type="submit" disabled={busy || !code}>{busy ? <Spinner size={18} label={t('multi.connecting')} /> : <Icon name="arrow" />}{busy ? t('multi.connectingDots') : t('multi.joinRoom')}</button>
    </form>
  );
}
