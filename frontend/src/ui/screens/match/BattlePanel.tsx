import { useState } from 'react';
import { teamImport, type GameAction, type PublicRoom } from '@shared';
import { characterById } from '../../../characters/roster.js';
import { settings, useSettings } from '../../../app/settings.js';
import { FORMATS, SHOWDOWN_URL, TEAMBUILDER_URL, challengeCommand, cleanShowdownName, copyText, openPokePaste, ouProblems } from '../../../showdown/handoff.js';
import { CopyButton, Icon, Modal, toast } from '../../primitives.js';
import { PokemonCard } from '../../pokemon.js';
import { ResultReport, TeamStrip } from './Panels.js';
import type { MatchModel } from './model.js';

/**
 * Battle phase: both teams at a glance, then the most reliable path from this page to a real
 * Showdown battle. Each step is something the browser can actually do; nothing pretends to drive
 * the cross-origin Showdown client.
 */
export function BattlePanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: (a: GameAction) => void }) {
  const s = useSettings();
  const [sets, setSets] = useState(false);
  const format = FORMATS.find(f => f.id === s.format) ?? FORMATS[0];
  const problems = format.id === 'gen9ou' ? ouProblems([...m.myTeam, ...m.oppTeam]) : [];
  const mineC = characterById(m.mine); const theirsC = characterById(m.theirs);

  return (
    <section className="battle">
      <div className="battle__teams panel">
        <TeamStrip label={`${m.myName} · You`} team={m.myTeam} accent={mineC?.accent} />
        <TeamStrip label={m.oppName} team={m.oppTeam} accent={theirsC?.accent} />
        <button className="btn btn--ghost btn--sm" onClick={() => setSets(true)}>View full sets</button>
      </div>

      <div className="battle__handoff panel">
        <p className="eyebrow"><span className="jp">ショーダウン</span> Take it to Showdown</p>
        <ol className="steps">
          <li>
            <div><strong>Copy your team</strong><span>Opens Showdown's Teambuilder with your team on the clipboard: New Team → Import from text → paste → Save.</span></div>
            <button className="btn btn--primary" onClick={async () => {
              const ok = await copyText(teamImport(m.myTeam));
              toast(ok ? 'Team copied. Paste it into Import from text.' : 'Copy was blocked; use Copy my team below.', ok ? 'ok' : 'error');
              window.open(TEAMBUILDER_URL, 'pab-showdown', 'noopener');
            }}><Icon name="external" />Copy &amp; open Teambuilder</button>
          </li>
          <li>
            <div><strong>Pick the format</strong><span>{format.note}</span></div>
            <select className="select" value={format.id} onChange={e => settings.set({ format: e.target.value })} aria-label="Showdown format">
              {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </li>
          {problems.length > 0 && <li className="steps__warn"><Icon name="spark" /><span>OU will reject: {problems.join(', ')}. Use Custom Game.</span></li>}
          <li>
            <div><strong>Challenge your rival</strong><span>Paste this into any Showdown chat once you know their Showdown name.</span></div>
            <div className="challenge">
              <input value={s.showdownName} maxLength={18} placeholder="Rival's Showdown name" onChange={e => settings.set({ showdownName: cleanShowdownName(e.target.value) })} aria-label="Opponent Showdown username" />
              <code>{challengeCommand(s.showdownName, format.id)}</code>
              <CopyButton className="btn btn--sm" label="Copy" getText={() => challengeCommand(s.showdownName, format.id)} />
            </div>
          </li>
        </ol>
        <div className="dock__row dock__row--wrap">
          <CopyButton className="btn" label="Copy my team" getText={() => teamImport(m.myTeam)} />
          <a className="btn" href={SHOWDOWN_URL} target="_blank" rel="noopener noreferrer"><Icon name="external" />Open Showdown</a>
          <button className="btn" onClick={() => openPokePaste(m.myTeam, `Game ${m.gameNo} · ${m.myName}`, m.myName, format.id)} title="Publishes an open team sheet on pokepast.es in a new tab"><Icon name="link" />Open team sheet (PokePaste)</button>
          <CopyButton className="btn btn--ghost" label="Copy rival's team" getText={() => teamImport(m.oppTeam)} />
        </div>
        <ResultReport room={room} m={m} act={act} />
      </div>

      <Modal open={sets} onClose={() => setSets(false)} title={`Game ${m.gameNo} · full sets`} wide>
        <div className="sets">
          <h3>{m.myName}</h3><div className="sets__grid">{m.myTeam.map((p, i) => <PokemonCard key={p.name} p={p} index={i} />)}</div>
          <h3>{m.oppName}</h3><div className="sets__grid">{m.oppTeam.map((p, i) => <PokemonCard key={p.name} p={p} index={i + 6} />)}</div>
        </div>
      </Modal>
    </section>
  );
}
