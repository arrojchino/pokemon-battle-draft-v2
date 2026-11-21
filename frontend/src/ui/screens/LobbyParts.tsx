import type { CSSProperties } from 'react';
import type { BattleMode, CharacterId, Visibility } from '@shared';
import { characterById } from '../../characters/roster.js';
import { Icon } from '../primitives.js';

export const MODE_LABEL: Record<BattleMode, string> = { app: 'Battle here', showdown: 'On Showdown' };

/** Lobby settings remembered for this visit: the create form starts from them and Quick join opens lobbies with them. */
export const lobbyPrefs: { bestOf: 3 | 5; visibility: Visibility } = { bestOf: 3, visibility: 'private' };

/** A partner's paint is player identity: it only ever feeds `--partner`, never the UI accent. */
export const partnerStyle = (id: CharacterId | null | undefined) => ({ '--partner': characterById(id)?.accent ?? 'var(--border-3)' }) as CSSProperties;

/** The partner bot's badge inside a ring of its paint. */
export function PartnerAvatar({ id, size = 'md' }: { id: CharacterId | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const c = characterById(id);
  return (
    <span className={`mp-avatar mp-avatar--${size}`} style={partnerStyle(id)} title={c?.name}>
      {c ? <img src={c.portrait} alt="" /> : <Icon name="user" />}
    </span>
  );
}
