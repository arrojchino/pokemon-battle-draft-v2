/**
 * One-shot gestures heard from other partners that cannot play yet: the partner is still easing to a stop on this
 * screen, or its model is still loading. The latest gesture per partner waits up to `wait` seconds and plays the
 * first moment that partner is ready; anything older is dropped rather than played out of step.
 */
export class GestureQueue<G> {
  private q = new Map<string, { g: G; until: number }>();
  constructor(private wait = 1.5) {}
  push(id: string, g: G, now: number) { this.q.set(id, { g, until: now + this.wait }); }
  /** The gesture `id` should play now, if it is `ready`; null while it waits, and once it timed out. */
  take(id: string, now: number, ready: boolean): G | null {
    const e = this.q.get(id);
    if (!e) return null;
    if (now > e.until) { this.q.delete(id); return null; }
    if (!ready) return null;
    this.q.delete(id);
    return e.g;
  }
  has(id: string) { return this.q.has(id); }
  drop(id: string) { this.q.delete(id); }
  clear() { this.q.clear(); }
}
