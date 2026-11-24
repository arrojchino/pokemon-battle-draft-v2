import { useEffect, useRef } from 'react';
import type { MonAnchor, World } from '../../../engine/World.js';

/**
 * Health bars that sit next to their Pokemon. Every frame each plate goes above its Pokemon's head (or beside it
 * when there is no room above), kept inside the screen and clear of the command dock, and steps aside while a move
 * animation plays, returning as it lands so the HP drop is seen. Positions go straight to the DOM, never through
 * React. Without a 3D stage (fallback mode) the plates keep their fixed corner layout.
 *
 * Stage side 0 is always the local player (or the left player for spectators), side 1 the opponent.
 */
export function useMonPlates(world: World | null) {
  const plates = useRef<[HTMLElement | null, HTMLElement | null]>([null, null]);
  const arena = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!world) return;
    let raf = 0, last = performance.now();
    const a: MonAnchor = { x: 0, top: 0, bottom: 0, on: false, attacking: false };
    const pos: [{ x: number; y: number; set: boolean }, { x: number; y: number; set: boolean }] = [{ x: 0, y: 0, set: false }, { x: 0, y: 0, set: false }];
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const root = arena.current;
      if (root) {
        const vw = window.innerWidth;
        const rr = root.getBoundingClientRect();
        // Room for the plates: below the match header (the arena's top padding), above the turn bar and the dock.
        const padTop = parseFloat(getComputedStyle(root).paddingTop) || 0;
        const score = document.querySelector('.scoreboard')?.getBoundingClientRect();
        const safeTop = Math.max(rr.top + Math.max(8, padTop - 8), score && score.height > 0 ? score.bottom + 8 : 0);
        const bar = root.querySelector('.arena__bar')?.getBoundingClientRect();
        const dock = root.querySelector('.arena__dock')?.getBoundingClientRect();
        const safeBottom = Math.min(bar?.top ?? rr.bottom, dock?.top ?? rr.bottom, rr.bottom) - 8;
        const rects: ({ x: number; y: number; w: number; h: number } | null)[] = [null, null];
        let floating = 0;
        // A short window (a phone on its side): no room between the header and the dock for a plate by its Pokemon.
        // Then both go compact, side by side at the top (the local player left), and never cover the commands.
        const tight = safeBottom - safeTop < 96;
        for (const side of [0, 1] as const) {
          const el = plates.current[side];
          if (!el) continue;
          world.monAnchor(side, a);
          if (!a.on) { el.classList.remove('plate2--float', 'plate2--tight', 'is-away'); pos[side].set = false; continue; }
          floating++;
          el.classList.add('plate2--float');
          el.classList.toggle('plate2--tight', tight);
          el.classList.toggle('is-away', a.attacking);
          const w = el.offsetWidth, h = el.offsetHeight, body = Math.max(40, a.bottom - a.top), half = body * 0.38;
          if (tight) { rects[side] = { x: side === 0 ? 8 : vw - w - 8, y: rr.top + 4, w, h }; continue; }
          // Above the head, centred; beside the body (outer side) when the head is too close to the top.
          let x = a.x - w / 2, y = a.top - h - 10;
          if (y < safeTop) {
            y = Math.max(safeTop, a.top + body * 0.1);
            x = side === 1 ? a.x - half - w - 12 : a.x + half + 12;
            if (x < 8 || x + w > vw - 8) x = side === 1 ? a.x + half + 12 : a.x - half - w - 12;
          }
          x = Math.min(Math.max(x, 8), vw - w - 8);
          y = Math.min(Math.max(y, safeTop), Math.max(safeTop, safeBottom - h));
          rects[side] = { x, y, w, h };
        }
        // Never stack one plate on the other: the local player's moves below the opponent's.
        const [m, o] = rects;
        if (!tight && m && o && m.x < o.x + o.w && o.x < m.x + m.w && m.y < o.y + o.h && o.y < m.y + m.h) {
          m.y = Math.min(o.y + o.h + 6, Math.max(safeTop, safeBottom - m.h));
          if (m.y < o.y + o.h) o.y = Math.max(safeTop, m.y - o.h - 6);
        }
        const k = reduced() ? 1 : Math.min(1, dt * 14);
        for (const side of [0, 1] as const) {
          const r = rects[side], el = plates.current[side], p = pos[side];
          if (!r || !el) continue;
          if (!p.set) { p.x = r.x; p.y = r.y; p.set = true; } else { p.x += (r.x - p.x) * k; p.y += (r.y - p.y) * k; }
          el.style.translate = `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`;
        }
        root.classList.toggle('arena--float', floating > 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of plates.current) if (el) { el.classList.remove('plate2--float', 'plate2--tight', 'is-away'); el.style.translate = ''; }
      arena.current?.classList.remove('arena--float');
    };
  }, [world]);
  return {
    arena: (el: HTMLElement | null) => { arena.current = el; },
    mine: (el: HTMLElement | null) => { plates.current[0] = el; },
    theirs: (el: HTMLElement | null) => { plates.current[1] = el; },
  };
}
