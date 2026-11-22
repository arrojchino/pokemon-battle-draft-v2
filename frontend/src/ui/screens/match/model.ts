import { winsNeeded, type CharacterId, type PublicRoom, type Seat } from '@shared';
import { ROSTER } from '../../../characters/roster.js';
import { t, type MessageKey } from '../../../i18n/index.js';

/** Everything the match UI needs, derived once from authoritative room state and the local seat. */
export function matchModel(room: PublicRoom, seat: Seat, localPartner: CharacterId) {
  const me = seat; const opp = (1 - seat) as Seat;
  const meP = room.players[me]; const oppP = room.players[opp];
  const mine = meP?.avatar ?? localPartner;
  // v1 peers send no avatar: give them a partner that differs from ours.
  const theirs = oppP ? (oppP.avatar ?? ROSTER.find(c => c.id !== mine)!.id) : null;
  const names: [string, string] = [room.players[0]?.name ?? t('match.player1'), room.players[1]?.name ?? t('match.player2')];
  return {
    me, opp, mine, theirs, names,
    myName: names[me], oppName: oppP ? names[opp] : t('match.waiting'),
    hasOpponent: !!oppP,
    oppConnected: !!oppP?.connected,
    target: winsNeeded(room.bestOf),
    gameNo: Math.min(room.games + (room.phase === 'between' || room.phase === 'complete' ? 0 : 1), room.bestOf),
    iWonToss: room.tossWinner === me,
    iCall: room.caller === me,
    /** Our six in full; the rival's six only as species and types while a game is on (see publicView). */
    myTeam: room.teams[me], rival: room.rival ?? room.teams[opp],
    seriesWinner: room.phase === 'complete' ? ((room.wins[0] > room.wins[1] ? 0 : 1) as Seat) : null,
  };
}
export type MatchModel = ReturnType<typeof matchModel>;

/** The tooltip for the connection dot. */
export const linkKey = (l: string): MessageKey => (l === 'online' ? 'match.link.online' : l === 'connecting' ? 'match.link.connecting' : 'match.link.offline');
/** A coin face as text, lower case ("heads"). */
export const sideKey = (s: 'heads' | 'tails'): MessageKey => (s === 'heads' ? 'match.heads' : 'match.tails');
