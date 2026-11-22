import { useState } from 'react';
import { teamImport, type GameAction, type PublicRoom } from '@shared';
import { characterById } from '../../../characters/roster.js';
import { settings, useSettings } from '../../../app/settings.js';
import { FORMATS, SHOWDOWN_URL, TEAMBUILDER_URL, challengeCommand, cleanShowdownName, copyText, openPokePaste, ouProblems } from '../../../showdown/handoff.js';
import { CopyButton, Icon, Modal, toast } from '../../primitives.js';
import { PokemonCard } from '../../pokemon.js';
import { ResultReport, RivalStrip, TeamStrip } from './Panels.js';
import type { MatchModel } from './model.js';
import { useT } from '../../../i18n/index.js';

/**
 * Showdown battle phase: your six and the rival's species, then the most reliable path from this page
 * to a real Showdown battle. Each step is something the browser can actually do; nothing pretends to
 * drive the cross-origin Showdown client.
 */
export function BattlePanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: (a: GameAction) => void }) {
  const t = useT();
  const s = useSettings();
  const [sets, setSets] = useState(false);
  const format = FORMATS.find(f => f.id === s.format) ?? FORMATS[0];
  const problems = format.id === 'gen9ou' ? ouProblems(m.myTeam) : [];

  return (
    <section className="battle">
      <div className="battle__teams panel">
        <TeamStrip label={t('battle.youSuffix', { name: m.myName })} team={m.myTeam} partner={characterById(m.mine)?.accent} />
        <RivalStrip label={m.oppName} rival={m.rival} partner={characterById(m.theirs)?.accent} />
        <button className="btn btn--ghost btn--sm" onClick={() => setSets(true)}>{t('battle.viewSets')}</button>
      </div>

      <div className="battle__handoff panel">
        <p className="eyebrow">{t('battle.takeToShowdown')}</p>
        <ol className="steps">
          <li>
            <div><strong>{t('battle.copyTeamStep')}</strong><span>{t('battle.copyTeamHint')}</span></div>
            <button className="btn btn--primary" onClick={async () => {
              const ok = await copyText(teamImport(m.myTeam));
              toast(ok ? t('battle.teamCopied') : t('battle.copyBlockedUseBelow'), ok ? 'ok' : 'error');
              window.open(TEAMBUILDER_URL, 'pab-showdown', 'noopener');
            }}><Icon name="external" />{t('battle.copyOpenTeambuilder')}</button>
          </li>
          <li>
            <div><strong>{t('battle.pickFormat')}</strong><span>{t(format.note)}</span></div>
            <select className="select" value={format.id} onChange={e => settings.set({ format: e.target.value })} aria-label={t('battle.formatAria')}>
              {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </li>
          {problems.length > 0 && <li className="steps__warn"><Icon name="spark" /><span>{t('battle.ouReject', { list: problems.join(', ') })}</span></li>}
          <li>
            <div><strong>{t('battle.challengeRival')}</strong><span>{t('battle.challengeHint')}</span></div>
            <div className="challenge">
              <input value={s.showdownName} maxLength={18} placeholder={t('battle.rivalNamePlaceholder')} onChange={e => settings.set({ showdownName: cleanShowdownName(e.target.value) })} aria-label={t('battle.rivalNameAria')} />
              <code>{challengeCommand(s.showdownName, format.id)}</code>
              <CopyButton className="btn btn--sm" label={t('battle.copy')} getText={() => challengeCommand(s.showdownName, format.id)} />
            </div>
          </li>
        </ol>
        <div className="dock__row dock__row--wrap">
          <CopyButton className="btn" label={t('battle.copyMyTeam')} getText={() => teamImport(m.myTeam)} />
          <a className="btn" href={SHOWDOWN_URL} target="_blank" rel="noopener noreferrer"><Icon name="external" />{t('battle.openShowdown')}</a>
          <button className="btn" onClick={() => openPokePaste(m.myTeam, t('battle.pasteTitle', { n: m.gameNo, name: m.myName }), m.myName, format.id)} title={t('battle.pokePasteTitle')}><Icon name="link" />{t('battle.openTeamSheet')}</button>
        </div>
        <ResultReport room={room} m={m} act={act} />
      </div>

      <Modal open={sets} onClose={() => setSets(false)} title={t('battle.setsTitle', { n: m.gameNo })} wide>
        <div className="sets"><div className="sets__grid">{m.myTeam.map((p, i) => <PokemonCard key={p.name} p={p} index={i} />)}</div></div>
      </Modal>
    </section>
  );
}
