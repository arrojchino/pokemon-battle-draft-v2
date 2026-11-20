import type { CharacterId } from '@shared';
import type { QualityTier } from './quality.js';

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
