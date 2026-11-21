import type { TypeName } from '@shared';
import { moveInfo } from '@shared';

/**
 * Choreography for every move: which primitive plays, with what flavour. Each of the pool's moves
 * has a hand-picked recipe; anything else (a future pool change) falls back by type and category.
 */
export type Aura = 'none' | 'water' | 'fire' | 'electric' | 'wind' | 'ghost' | 'stars' | 'ice';
export type Recipe =
  | { kind: 'dash'; impact: 'slash' | 'punch' | 'burst' | 'quake' | 'flurry' | 'spin' | 'bite'; aura?: Aura; fast?: boolean; big?: boolean; drain?: boolean; vanish?: boolean; uturn?: boolean }
  | { kind: 'orb'; size?: number; count?: number; arc?: number; star?: boolean; shards?: boolean; splash?: boolean; seeds?: boolean; drain?: boolean }
  | { kind: 'stream'; shape?: 'fire' | 'water' | 'leaf' | 'goo'; reverse?: boolean; big?: boolean; arc?: number; swirlSelf?: boolean; rings?: boolean }
  | { kind: 'beam'; width?: number; shards?: boolean }
  | { kind: 'bolt'; sky?: boolean; small?: boolean; uturn?: boolean }
  | { kind: 'rings'; travel?: boolean; distort?: boolean; both?: boolean; uturn?: boolean }
  | { kind: 'swirl'; shape: 'leaf' | 'wind' | 'petal' | 'spore' | 'wisp' | 'fire'; tornado?: boolean; travel?: boolean }
  | { kind: 'rain'; debris: 'meteor' | 'rock' | 'coin' | 'salt' | 'hammer' | 'shard'; count?: number }
  | { kind: 'quake' }
  | { kind: 'self'; effect: 'buff' | 'blades' | 'dragon' | 'heal' | 'protect' | 'screen' | 'sleep' | 'sub' | 'transform' | 'revive' | 'curse' | 'drum' }
  | { kind: 'hazard'; debris: 'rock' | 'spike' | 'toxic' }
  | { kind: 'field'; color?: string };

export const RECIPES: Record<string, Recipe> = {
  acrobatics: { kind: 'dash', impact: 'slash', aura: 'wind', fast: true },
  aquajet: { kind: 'dash', impact: 'burst', aura: 'water', fast: true },
  aquastep: { kind: 'dash', impact: 'burst', aura: 'water' },
  banefulbunker: { kind: 'self', effect: 'protect' },
  bellydrum: { kind: 'self', effect: 'drum' },
  bodypress: { kind: 'dash', impact: 'quake', big: true },
  bravebird: { kind: 'dash', impact: 'burst', aura: 'fire', big: true },
  bugbuzz: { kind: 'rings', travel: true },
  bulkup: { kind: 'self', effect: 'buff' },
  bulletpunch: { kind: 'dash', impact: 'punch', fast: true },
  bulletseed: { kind: 'orb', count: 5, size: 0.5, arc: 0.4, seeds: true },
  calmmind: { kind: 'self', effect: 'buff' },
  closecombat: { kind: 'dash', impact: 'flurry', big: true },
  darkpulse: { kind: 'rings', travel: true },
  defog: { kind: 'field', color: '#dfe8ff' },
  destinybond: { kind: 'self', effect: 'curse' },
  direclaw: { kind: 'dash', impact: 'slash' },
  doubleshock: { kind: 'dash', impact: 'burst', aura: 'electric', big: true },
  dracometeor: { kind: 'rain', debris: 'meteor', count: 5 },
  dragonclaw: { kind: 'dash', impact: 'slash' },
  dragondance: { kind: 'self', effect: 'dragon' },
  dragondarts: { kind: 'orb', count: 2, size: 0.8, arc: 0.1 },
  drainpunch: { kind: 'dash', impact: 'punch', drain: true },
  drainingkiss: { kind: 'orb', size: 0.7, star: true, drain: true },
  earthquake: { kind: 'quake' },
  encore: { kind: 'rings' },
  fierydance: { kind: 'stream', shape: 'fire', swirlSelf: true },
  firefang: { kind: 'dash', impact: 'bite', aura: 'fire' },
  flamethrower: { kind: 'stream', shape: 'fire' },
  flowertrick: { kind: 'swirl', shape: 'petal' },
  focusblast: { kind: 'orb', size: 1.8, arc: 0.15 },
  gigadrain: { kind: 'stream', shape: 'leaf', reverse: true },
  gigatonhammer: { kind: 'rain', debris: 'hammer', count: 1 },
  glaiverush: { kind: 'dash', impact: 'slash', big: true },
  glare: { kind: 'rings', distort: true },
  haze: { kind: 'field', color: '#6b7a99' },
  headlongrush: { kind: 'dash', impact: 'quake', big: true },
  hurricane: { kind: 'swirl', shape: 'wind', tornado: true },
  hydropump: { kind: 'stream', shape: 'water', big: true },
  icebeam: { kind: 'beam', width: 0.13, shards: true },
  icepunch: { kind: 'dash', impact: 'punch', aura: 'ice' },
  icespinner: { kind: 'dash', impact: 'spin', aura: 'ice' },
  iciclespear: { kind: 'orb', count: 4, size: 0.6, shards: true },
  ironhead: { kind: 'dash', impact: 'punch', big: true },
  knockoff: { kind: 'dash', impact: 'slash' },
  kowtowcleave: { kind: 'dash', impact: 'slash', big: true },
  leafstorm: { kind: 'swirl', shape: 'leaf', travel: true },
  leechseed: { kind: 'orb', count: 3, size: 0.5, arc: 0.7, seeds: true },
  lightscreen: { kind: 'self', effect: 'screen' },
  liquidation: { kind: 'dash', impact: 'burst', aura: 'water' },
  lowkick: { kind: 'dash', impact: 'punch' },
  machpunch: { kind: 'dash', impact: 'punch', fast: true },
  makeitrain: { kind: 'rain', debris: 'coin', count: 60 },
  matchagotcha: { kind: 'stream', shape: 'goo', arc: 0.5, rings: true },
  moonblast: { kind: 'orb', size: 2, star: true, arc: 0.25 },
  mysticalfire: { kind: 'orb', size: 1.2, star: true, arc: 0.1 },
  nastyplot: { kind: 'self', effect: 'buff' },
  painsplit: { kind: 'rings', both: true },
  partingshot: { kind: 'rings', uturn: true },
  phantomforce: { kind: 'dash', impact: 'slash', vanish: true, aura: 'ghost' },
  playrough: { kind: 'dash', impact: 'flurry', aura: 'stars' },
  populationbomb: { kind: 'dash', impact: 'flurry' },
  protect: { kind: 'self', effect: 'protect' },
  psychic: { kind: 'rings', distort: true },
  quiverdance: { kind: 'self', effect: 'buff' },
  ragefist: { kind: 'dash', impact: 'punch', aura: 'ghost', big: true },
  rapidspin: { kind: 'dash', impact: 'spin' },
  recover: { kind: 'self', effect: 'heal' },
  reflect: { kind: 'self', effect: 'screen' },
  rest: { kind: 'self', effect: 'sleep' },
  revivalblessing: { kind: 'self', effect: 'revive' },
  roost: { kind: 'self', effect: 'heal' },
  saltcure: { kind: 'rain', debris: 'salt', count: 10 },
  shadowball: { kind: 'orb', size: 1.7, arc: 0.1 },
  shadowsneak: { kind: 'dash', impact: 'burst', aura: 'ghost', fast: true },
  slackoff: { kind: 'self', effect: 'heal' },
  sleeptalk: { kind: 'self', effect: 'sleep' },
  sludgebomb: { kind: 'orb', size: 1.5, arc: 0.8, splash: true },
  softboiled: { kind: 'self', effect: 'heal' },
  spikes: { kind: 'hazard', debris: 'spike' },
  spiritbreak: { kind: 'dash', impact: 'punch', aura: 'stars' },
  spore: { kind: 'swirl', shape: 'spore' },
  stealthrock: { kind: 'hazard', debris: 'rock' },
  strengthsap: { kind: 'stream', shape: 'leaf', reverse: true },
  struggle: { kind: 'dash', impact: 'burst' },
  substitute: { kind: 'self', effect: 'sub' },
  suckerpunch: { kind: 'dash', impact: 'punch', fast: true, aura: 'ghost' },
  swordsdance: { kind: 'self', effect: 'blades' },
  taunt: { kind: 'rings' },
  thunderwave: { kind: 'bolt', small: true },
  thunderbolt: { kind: 'bolt' },
  tidyup: { kind: 'self', effect: 'buff' },
  torchsong: { kind: 'stream', shape: 'fire', rings: true },
  toxic: { kind: 'orb', size: 1.1, arc: 0.6, splash: true },
  toxicspikes: { kind: 'hazard', debris: 'toxic' },
  transform: { kind: 'self', effect: 'transform' },
  uturn: { kind: 'dash', impact: 'slash', fast: true, uturn: true },
  voltswitch: { kind: 'bolt', uturn: true },
  wavecrash: { kind: 'dash', impact: 'burst', aura: 'water', big: true },
  wildcharge: { kind: 'dash', impact: 'burst', aura: 'electric', big: true },
  willowisp: { kind: 'swirl', shape: 'wisp', travel: true },
  // Added with the expanded pool.
  armorcannon: { kind: 'orb', size: 1.7, arc: 0.12 },
  aurasphere: { kind: 'orb', size: 1.4, arc: 0.08 },
  bodyslam: { kind: 'dash', impact: 'burst', big: true },
  chillyreception: { kind: 'field', color: '#dff6ff' },
  courtchange: { kind: 'field', color: '#ffd38a' },
  crunch: { kind: 'dash', impact: 'bite' },
  dazzlinggleam: { kind: 'rings', travel: true },
  dragonpulse: { kind: 'beam', width: 0.15 },
  dualwingbeat: { kind: 'dash', impact: 'flurry', aura: 'wind', fast: true },
  earthpower: { kind: 'quake' },
  energyball: { kind: 'orb', size: 1.3, arc: 0.2 },
  extremespeed: { kind: 'dash', impact: 'burst', fast: true, big: true },
  facade: { kind: 'dash', impact: 'punch', big: true },
  ficklebeam: { kind: 'beam', width: 0.2 },
  fireblast: { kind: 'stream', shape: 'fire', big: true, rings: true },
  firepunch: { kind: 'dash', impact: 'punch', aura: 'fire' },
  firstimpression: { kind: 'dash', impact: 'burst', fast: true, big: true },
  flareblitz: { kind: 'dash', impact: 'burst', aura: 'fire', big: true },
  flashcannon: { kind: 'beam', width: 0.14 },
  flipturn: { kind: 'dash', impact: 'burst', aura: 'water', fast: true, uturn: true },
  foulplay: { kind: 'dash', impact: 'slash' },
  futuresight: { kind: 'rings', distort: true },
  grassknot: { kind: 'swirl', shape: 'leaf' },
  grassyglide: { kind: 'dash', impact: 'slash', fast: true },
  gunkshot: { kind: 'orb', size: 1.6, arc: 0.6, splash: true },
  healingwish: { kind: 'self', effect: 'revive' },
  heavyslam: { kind: 'dash', impact: 'quake', big: true },
  hex: { kind: 'rings', travel: true, distort: true },
  highhorsepower: { kind: 'dash', impact: 'quake' },
  hypervoice: { kind: 'rings', travel: true },
  iceshard: { kind: 'orb', count: 2, size: 0.6, shards: true },
  iciclecrash: { kind: 'rain', debris: 'shard', count: 5 },
  irondefense: { kind: 'self', effect: 'buff' },
  ivycudgel: { kind: 'dash', impact: 'punch', big: true },
  leechlife: { kind: 'dash', impact: 'bite', drain: true },
  lusterpurge: { kind: 'beam', width: 0.16 },
  magmastorm: { kind: 'swirl', shape: 'fire', tornado: true },
  malignantchain: { kind: 'stream', shape: 'goo' },
  morningsun: { kind: 'self', effect: 'heal' },
  outrage: { kind: 'dash', impact: 'flurry', big: true },
  psychicfangs: { kind: 'dash', impact: 'bite' },
  psychicnoise: { kind: 'rings', travel: true, distort: true },
  psyshock: { kind: 'orb', count: 3, size: 0.8, arc: 0.2 },
  pyroball: { kind: 'orb', size: 1.6, arc: 0.35 },
  quickattack: { kind: 'dash', impact: 'burst', fast: true },
  roar: { kind: 'rings', travel: true },
  ruination: { kind: 'quake' },
  scald: { kind: 'stream', shape: 'water' },
  scaleshot: { kind: 'orb', count: 4, size: 0.55, arc: 0.15 },
  shiftgear: { kind: 'self', effect: 'buff' },
  sludgewave: { kind: 'stream', shape: 'goo', big: true },
  stoneedge: { kind: 'rain', debris: 'rock', count: 6 },
  stunspore: { kind: 'swirl', shape: 'spore' },
  superfang: { kind: 'dash', impact: 'bite', big: true },
  surf: { kind: 'stream', shape: 'water', big: true, arc: 0.2 },
  switcheroo: { kind: 'rings', both: true },
  tachyoncutter: { kind: 'orb', count: 2, size: 0.7, arc: 0.05 },
  temperflare: { kind: 'dash', impact: 'burst', aura: 'fire' },
  terablast: { kind: 'beam', width: 0.18, shards: true },
  thunderclap: { kind: 'bolt' },
  trailblaze: { kind: 'dash', impact: 'slash', fast: true },
  triattack: { kind: 'orb', count: 3, size: 0.9, arc: 0.25 },
  trick: { kind: 'rings', both: true },
  tripleaxel: { kind: 'dash', impact: 'flurry', aura: 'ice' },
  vacuumwave: { kind: 'rings', travel: true },
  waterfall: { kind: 'dash', impact: 'burst', aura: 'water' },
  whirlwind: { kind: 'swirl', shape: 'wind', tornado: true },
  wish: { kind: 'self', effect: 'heal' },
  woodhammer: { kind: 'dash', impact: 'punch', big: true },
};

const SPECIAL_BY_TYPE: Partial<Record<TypeName, Recipe>> = {
  Fire: { kind: 'stream', shape: 'fire' }, Water: { kind: 'stream', shape: 'water' }, Electric: { kind: 'bolt' },
  Grass: { kind: 'swirl', shape: 'leaf', travel: true }, Ice: { kind: 'beam', shards: true }, Psychic: { kind: 'rings', distort: true },
  Ground: { kind: 'quake' }, Rock: { kind: 'rain', debris: 'rock', count: 6 }, Flying: { kind: 'swirl', shape: 'wind', tornado: true },
  Bug: { kind: 'rings', travel: true }, Dark: { kind: 'rings', travel: true }, Steel: { kind: 'beam' }, Dragon: { kind: 'beam', width: 0.16 },
};

export function recipeFor(move: string, type: TypeName, category: 'Physical' | 'Special' | 'Status'): Recipe {
  const id = move.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = RECIPES[id];
  if (r) return r;
  const info = moveInfo(move);
  if (category === 'Status') return info?.self ? { kind: 'self', effect: 'buff' } : { kind: 'rings' };
  if (category === 'Physical') {
    if (info && !info.contact) return type === 'Ground' ? { kind: 'quake' } : type === 'Rock' ? { kind: 'rain', debris: 'rock', count: 6 } : { kind: 'orb', size: 1, arc: 0.3 };
    return { kind: 'dash', impact: type === 'Fighting' ? 'punch' : 'slash' };
  }
  return SPECIAL_BY_TYPE[type] ?? { kind: 'orb', size: 1.2, arc: 0.2 };
}

/**
 * Anticipation before a move's effect starts: the attacker winds up (crouch, rear back, the model's own
 * attack clip leading in) so every move reads as wind-up, strike and recovery. Self moves start at once.
 */
export function windup(r: Recipe): number {
  return r.kind === 'self' ? 0 : r.kind === 'dash' ? 0.3 : 0.42;
}
/** Seconds from the move line until its hit lands, wind-up included (the damage line waits for this). */
export const impactLead = (r: Recipe) => windup(r) + impactDelay(r);

/** Seconds from the start of the effect until its hit lands, per recipe. */
export function impactDelay(r: Recipe): number {
  switch (r.kind) {
    case 'dash': return r.fast ? 0.26 : 0.4;
    case 'orb': return 0.62 + ((r.count ?? 1) - 1) * 0.09;
    case 'stream': return 0.5;
    case 'beam': return 0.32;
    case 'bolt': return 0.22;
    case 'rings': return r.travel ? 0.5 : 0.25;
    case 'swirl': return r.travel ? 0.6 : 0.35;
    case 'rain': return r.debris === 'coin' ? 0.55 : 0.75;
    case 'quake': return 0.35;
    default: return 0.3;
  }
}
