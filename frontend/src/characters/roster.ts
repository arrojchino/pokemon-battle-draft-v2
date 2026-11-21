import type { CharacterId } from '@shared';
import { assetUrl } from '../assets.js';

export type Emote = 'idle' | 'greet' | 'excited' | 'surprised' | 'victory' | 'sad' | 'thinking' | 'bow' | 'twirl' | 'nod' | 'punch' | 'thumbs' | 'faceplant';

export type Character = {
  id: CharacterId;
  /** Paint job name. */
  name: string;
  /** One short line of attitude. */
  quip: string;
  /** Body paint (model colour) and the UI accent derived from it. */
  paint: string;
  accent: string;
  accent2: string;
  /** Small generated badge (SVG data URI) used wherever a portrait is shown. */
  portrait: string;
  /** Which reaction each game moment triggers. */
  personality: { on: { select: Emote; hover: Emote; tossWin: Emote; tossLose: Emote; gameWin: Emote; gameLose: Emote; seriesWin: Emote; attack: Emote } };
};

/** The one partner model everybody gets (see docs/ASSETS.md). */
export const BOT = {
  model: assetUrl('models/bot.glb'),
  credit: { model: 'RobotExpressive', author: 'Tomás Laulhé (Quaternius), modified by Don McCurdy', license: 'CC0 1.0', url: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive' },
};

/** A tiny head-and-visor badge in the bot's paint, drawn as SVG so it costs no download. */
function badge(paint: string, eye: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" fill="#0b0a0d"/>
<rect x="40" y="70" width="16" height="16" fill="#4a4740"/>
<rect x="12" y="34" width="8" height="22" rx="3" fill="#4a4740"/><rect x="76" y="34" width="8" height="22" rx="3" fill="#4a4740"/>
<rect x="18" y="16" width="60" height="58" rx="16" fill="${paint}"/>
<path d="M22 60 q8 6 18 2 M56 24 l10 4 M30 66 l6 -3" stroke="#000" stroke-opacity=".28" stroke-width="3" fill="none"/>
<rect x="26" y="30" width="44" height="28" rx="10" fill="#0c0c0e"/>
<circle cx="38" cy="44" r="5" fill="${eye}"/><circle cx="58" cy="44" r="5" fill="${eye}"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const paint = (id: CharacterId, name: string, quip: string, p: string, accent: string, accent2: string, on: Partial<Character['personality']['on']> = {}): Character => ({
  id, name, quip, paint: p, accent, accent2, portrait: badge(p, accent),
  personality: { on: { select: 'greet', hover: 'nod', tossWin: 'excited', tossLose: 'surprised', gameWin: 'victory', gameLose: 'sad', seriesWin: 'victory', attack: 'punch', ...on } },
});

/** Eight paint jobs. Same bot, different attitude. */
export const ROSTER: Character[] = [
  paint('rust', 'Rust Bucket', 'Held together by spite and duct tape.', '#b4521f', '#ff7a3d', '#7a2a10'),
  paint('toxic', 'Toxic Waste', 'Do not lick. Seriously.', '#7fae1c', '#b6ff3a', '#3d5a08', { tossWin: 'thumbs', gameLose: 'faceplant' }),
  paint('caution', 'Caution Tape', 'Wet floor. Dry humor.', '#d9a90c', '#ffd23a', '#6e5203', { select: 'thumbs', tossWin: 'twirl' }),
  paint('hotrod', 'Hot Rod', 'Zero to KO in six turns.', '#a3142a', '#ff3355', '#4f0712', { tossWin: 'punch', gameWin: 'punch' }),
  paint('bruiser', 'Bruiser', 'Has never once read the manual.', '#5b3394', '#a46bff', '#2a1347', { select: 'punch', tossLose: 'faceplant' }),
  paint('coolant', 'Coolant Leak', 'Chill. Mostly leaking.', '#1f86a8', '#3fd8ff', '#0b3e50', { gameWin: 'thumbs' }),
  paint('oilslick', 'Oil Slick', 'Slippery when losing.', '#2a2c33', '#8f9bb8', '#121318', { tossLose: 'thinking', gameLose: 'faceplant' }),
  paint('bonedry', 'Bone Dry', 'Retired from a scrapyard. Unretired for this.', '#cfc3a1', '#fff0c8', '#6f6650', { select: 'bow', gameWin: 'bow' }),
];

export const characterById = (id: CharacterId | null | undefined) => ROSTER.find(c => c.id === id) ?? null;
export const DEFAULT_CHARACTER: CharacterId = 'rust';
