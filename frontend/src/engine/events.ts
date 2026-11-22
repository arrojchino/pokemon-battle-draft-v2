import type { CharacterId, PlazaEmote, Spot } from '@shared';
import type { QualityTier } from './quality.js';
import type { Cue } from '../audio/sound.js';

/** Every event the engine can emit, with its payload type. */
export type WorldEvents = {
  progress: { loaded: number; total: number; label: string };
  ready: void;
  characterReady: { id: CharacterId };
  characterHover: { id: CharacterId | null };
  characterClick: { id: CharacterId };
  quality: { tier: QualityTier; scale: number };
  contextLost: void;
  contextRestored: void;
  error: { message: string };
  /** Something on stage made a noise; the app routes it to the sound engine. pan is -1..1. */
  sound: { cue: Cue; pan: number; gain?: number };
  /** A Pokémon on stage cried (National Dex number); rate below 1 sounds lower, for sad moments. */
  cry: { dex: number; pan: number; gain?: number; rate?: number };
  /** Plaza: this player's partner moved (at most ten times a second) or played an emote. The app relays both to the rival. */
  plazaMove: Spot;
  plazaEmote: { emote: PlazaEmote };
  /** Main plaza: this player's partner came within talking range of the plaza host, or left it. */
  hostNear: { near: boolean };
  /** Main plaza: this player asked to talk to the host (E nearby, a click on her, or arriving after one). */
  hostTalk: void;
};

type Handler<T> = (payload: T) => void;

export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<Handler<never>>>();
  on<K extends keyof E>(k: K, h: Handler<E[K]>): () => void {
    let s = this.map.get(k); if (!s) this.map.set(k, s = new Set());
    s.add(h as Handler<never>);
    return () => { s!.delete(h as Handler<never>); };
  }
  emit<K extends keyof E>(k: K, ...payload: E[K] extends void ? [] : [E[K]]) {
    this.map.get(k)?.forEach(h => (h as Handler<E[K]>)(payload[0] as E[K]));
  }
  clear() { this.map.clear(); }
}
