import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';

export function useMediaQuery(query: string): boolean {
  const mq = useMemo(() => matchMedia(query), [query]);
  return useSyncExternalStore(cb => { mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); }, () => mq.matches);
}

type Slots = Map<string, [number, number]>;

/** Layout slot of every child that opts in with data-flip (offsets ignore transforms and scrolling). */
const slots = (el: HTMLElement): Slots => {
  const out: Slots = new Map();
  for (const item of Array.from(el.children) as HTMLElement[]) if (item.dataset.flip) out.set(item.dataset.flip, [item.offsetLeft, item.offsetTop]);
  return out;
};

/**
 * FLIP for the card grid: when sorting, filtering or the detail panel reflows the grid, cards glide
 * from their previous slot instead of jumping. `grid` must be positioned so offsets are relative to it.
 */
export function useFlip(grid: RefObject<HTMLElement>, layoutKey: string, animate: boolean) {
  const last = useRef<Slots>(new Map());

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const now = slots(el);
    if (animate) {
      for (const item of Array.from(el.children) as HTMLElement[]) {
        const from = last.current.get(item.dataset.flip ?? ''), to = now.get(item.dataset.flip ?? '');
        if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
        item.animate([{ transform: `translate(${from[0] - to[0]}px, ${from[1] - to[1]}px)` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    }
    last.current = now;
  }, [grid, layoutKey, animate]);

  // A window resize reflows the grid without a render: re-record so the next change starts from the truth.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { last.current = slots(el); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid]);
}
