import { useEffect, useState, type CSSProperties } from 'react';
import { characterById } from '../../characters/roster.js';
import { settings, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import { useSession } from '../../net/session.js';
import { Icon, Segmented } from '../primitives.js';

/** Create or join a room. The partner stays on stage beside the form. */
export function SetupScreen({ mode, setMode, inviteCode, onBack, onChangePartner }: {
  mode: 'create' | 'join'; setMode: (m: 'create' | 'join') => void; inviteCode: string; onBack: () => void; onChangePartner: () => void;
}) {
  const s = useSettings();
  const c = characterById(s.partner)!;
  const { world } = useWorld();
  const session = useSession();
  const [bestOf, setBestOf] = useState<3 | 5>(3);
  const [code, setCode] = useState(inviteCode);
  const [busy, setBusy] = useState(false);
  useEffect(() => { world?.setLayout({ mode: 'title', featured: s.partner }); }, [world, s.partner]);
  useEffect(() => { if (session.error) setBusy(false); }, [session.errorId, session.error]);

  const name = s.name || '';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || (mode === 'create' ? 'Player 1' : 'Player 2');
    setBusy(true); session.transport.clearError();
    world?.emote(s.partner, 'nod');
    if (mode === 'create') session.transport.create(n, bestOf, s.partner, session.transport.supportsBattles ? s.battleMode : 'showdown');
    else session.transport.join(code, n, s.partner);
  };
  const online = session.link === 'online';

  return (
    <main className="screen setup" style={{ '--accent': c.accent, '--accent2': c.accent2 } as CSSProperties}>
      <header className="screen__head">
        <button className="btn btn--ghost" onClick={onBack}><Icon name="back" />Back</button>
        <p className="eyebrow"><span className="jp">ルーム</span> Online match</p>
      </header>
      <form className="setup__panel panel" onSubmit={submit}>
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'create', label: 'Create room' }, { value: 'join', label: 'Join room' }]} />
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} autoComplete="nickname" placeholder={mode === 'create' ? 'Player 1' : 'Player 2'} onChange={e => settings.set({ name: e.target.value })} />
        </label>
        {mode === 'create' ? (
          <div className="field">
            <span>Series length</span>
            <Segmented label="Series length" value={bestOf} onChange={setBestOf} options={[{ value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }]} />
          </div>
        ) : null}
        {mode === 'create' ? (
          <div className="field">
            <span>Battles</span>
            {session.transport.supportsBattles ? (
              <Segmented label="Where battles happen" value={s.battleMode} onChange={v => settings.set({ battleMode: v })}
                options={[{ value: 'app', label: 'Battle here' }, { value: 'showdown', label: 'On Showdown' }]} />
            ) : <small>Peer rooms battle on Pokémon Showdown. Connect a server (?ws=) to battle here.</small>}
            {session.transport.supportsBattles && <small>{s.battleMode === 'app' ? 'Instant: the drafted teams fight right here, no import.' : 'Copy teams into Pokémon Showdown and report the winner.'}</small>}
          </div>
        ) : (
          <label className="field">
            <span>Room code</span>
            <input className="mono" value={code} maxLength={64} autoComplete="off" spellCheck={false} placeholder="e.g. 4F2A9C" onChange={e => setCode(e.target.value.trim())} />
          </label>
        )}
        <div className="setup__partner">
          <img src={c.portrait} alt="" />
          <div><small>Partner</small><strong>{c.name}</strong></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onChangePartner}>Change</button>
        </div>
        <button className="btn btn--primary btn--xl" type="submit" disabled={busy || (mode === 'join' && !code) || session.link === 'offline' && session.kind === 'peer'}>
          <Icon name={mode === 'create' ? 'spark' : 'arrow'} />{busy ? 'Connecting…' : mode === 'create' ? 'Create room' : 'Join room'}
        </button>
        <p className="setup__status">
          <span className={`dot ${online ? 'dot--on' : session.link === 'connecting' ? 'dot--wait' : ''}`} />
          {session.kind === 'backend' ? 'Dedicated server' : 'Peer relay (the room creator hosts)'} · {online ? 'connected' : session.link}
        </p>
        {session.error && <p className="error" role="alert">{session.error}</p>}
      </form>
    </main>
  );
}
