import type { PublicRoom } from '@shared';
import { seriesArchive } from '../../../showdown/handoff.js';
import { CopyButton, Icon } from '../../primitives.js';
import { PokemonChip } from '../../pokemon.js';
import { sideKey, type MatchModel } from './model.js';
import { useT } from '../../../i18n/index.js';

/** Round history plus the full Showdown archive of every game in the series. */
export function HistoryDrawer({ room, m, open, onClose }: { room: PublicRoom; m: MatchModel; open: boolean; onClose: () => void }) {
  const t = useT();
  // Finished games only: during a game the rival's sets are hidden.
  const archive = seriesArchive(room.history, m.names);
  return (
    <aside className={`drawer ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label={t('history.title')}>
      <header className="drawer__head">
        <h2>{t('history.title')}</h2>
        <button className="iconbtn" onClick={onClose} aria-label={t('history.close')} tabIndex={open ? 0 : -1}><Icon name="close" /></button>
      </header>
      {room.history.length === 0 && <p className="drawer__empty">{t('history.empty')}</p>}
      <ol className="history">
        {room.history.map(h => (
          <li key={h.game} className="history__item">
            <header><strong>{t('match.game', { n: h.game })}</strong><span>{t('history.won', { name: m.names[h.winner] })}</span>{h.toss && <em><Icon name={h.toss === 'heads' ? 'sun' : 'moon'} size={14} />{t(sideKey(h.toss))}</em>}</header>
            {[0, 1].map(s => (
              <div key={s} className={`history__team ${h.winner === s ? 'is-win' : ''}`}>
                <small>{m.names[s]}</small>
                <div>{h.teams[s].map(p => <PokemonChip key={p.name} p={p} />)}</div>
              </div>
            ))}
          </li>
        ))}
      </ol>
      <div className="drawer__foot">
        <label className="field"><span>{t('history.archive')}</span><textarea readOnly value={archive} placeholder={t('history.archivePlaceholder')} tabIndex={open ? 0 : -1} /></label>
        <CopyButton className="btn" label={t('history.copyArchive')} getText={() => archive} />
      </div>
    </aside>
  );
}
