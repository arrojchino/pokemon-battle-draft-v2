import type { PublicRoom } from '@shared';
import { seriesArchive } from '../../../showdown/handoff.js';
import { CopyButton, Icon } from '../../primitives.js';
import { PokemonChip } from '../../pokemon.js';
import type { MatchModel } from './model.js';

/** Round history plus the full Showdown archive of every game in the series. */
export function HistoryDrawer({ room, m, open, onClose }: { room: PublicRoom; m: MatchModel; open: boolean; onClose: () => void }) {
  const archive = seriesArchive(room.history, m.names, room.teams[0].length === 6 && room.phase === 'battle' ? room.teams : undefined);
  return (
    <aside className={`drawer ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="Series history">
      <header className="drawer__head">
        <h2><span className="jp">記録</span> Series history</h2>
        <button className="iconbtn" onClick={onClose} aria-label="Close history" tabIndex={open ? 0 : -1}><Icon name="close" /></button>
      </header>
      {room.history.length === 0 && <p className="drawer__empty">No games recorded yet.</p>}
      <ol className="history">
        {room.history.map(h => (
          <li key={h.game} className="history__item">
            <header><strong>Game {h.game}</strong><span>{m.names[h.winner]} won</span>{h.toss && <em><Icon name={h.toss === 'heads' ? 'sun' : 'moon'} size={14} />{h.toss}</em>}</header>
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
        <label className="field"><span>Showdown archive</span><textarea readOnly value={archive} placeholder="Every game's teams appear here" tabIndex={open ? 0 : -1} /></label>
        <CopyButton className="btn" label="Copy archive" getText={() => archive} />
      </div>
    </aside>
  );
}
