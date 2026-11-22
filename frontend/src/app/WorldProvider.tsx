import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { World } from '../engine/World.js';
import { displayOf, settings, useReducedMotion, useSettings } from './settings.js';
import { t } from '../i18n/index.js';

export type WorldStatus = { kind: 'loading'; progress: number; label: string } | { kind: 'ready' } | { kind: 'fallback'; reason: string };
type Ctx = { world: World | null; status: WorldStatus; firstCharacter: boolean };
const WorldCtx = createContext<Ctx>({ world: null, status: { kind: 'loading', progress: 0, label: '' }, firstCharacter: false });

export const useWorld = () => useContext(WorldCtx);

/**
 * Owns the one WebGL canvas for the whole app. The engine chunk (three.js) is loaded
 * lazily so the UI paints immediately; without WebGL2 the app falls back to partner artwork.
 */
export function WorldProvider({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [status, setStatus] = useState<WorldStatus>({ kind: 'loading', progress: 0, label: t('app.preparingStage') });
  const [firstCharacter, setFirstCharacter] = useState(false);
  const reduced = useReducedMotion();
  const s = useSettings();

  useEffect(() => {
    let w: World | null = null; let cancelled = false;
    const offs: Array<() => void> = [];
    (async () => {
      if (new URLSearchParams(location.search).has('nowebgl')) { setStatus({ kind: 'fallback', reason: t('app.noWebglFlag') }); return; }
      try {
        const { World } = await import('../engine/World.js');
        if (cancelled) return;
        if (!World.supported()) { setStatus({ kind: 'fallback', reason: t('app.noWebgl2') }); return; }
        const st = settings.get(); const d = displayOf(st);
        w = new World(host.current!, canvas.current!, { ...d, calm: st.calm, steady: st.camera === 'steady', reducedMotion: reduced, preload: [st.partner] });
        offs.push(w.events.on('progress', p => setStatus(prev => prev.kind === 'loading' ? { kind: 'loading', progress: p.total ? p.loaded / p.total : 0, label: t('app.loadingWhat', { what: p.label }) } : prev)));
        offs.push(w.events.on('characterReady', () => { setFirstCharacter(true); setStatus(prev => prev.kind === 'loading' ? { kind: 'ready' } : prev); }));
        offs.push(w.events.on('contextLost', () => setStatus({ kind: 'fallback', reason: t('app.contextLost') })));
        offs.push(w.events.on('contextRestored', () => setStatus({ kind: 'ready' })));
        offs.push(w.events.on('error', e => console.warn('[world]', e.message)));
        setWorld(w);
        (window as unknown as { __WORLD__?: World }).__WORLD__ = w;
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus({ kind: 'fallback', reason: String((e as Error).message ?? e) });
      }
    })();
    return () => { cancelled = true; offs.forEach(f => f()); w?.dispose(); setWorld(null); };
    // The world is created once; settings changes are pushed imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { world?.setReducedMotion(reduced); document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'; }, [world, reduced]);
  const d = displayOf(s);
  useEffect(() => { world?.setQuality(d.quality); }, [world, d.quality]);
  useEffect(() => { world?.setRenderScale(d.renderScale); }, [world, d.renderScale]);
  useEffect(() => { world?.setEffects(d.effects, s.calm); }, [world, d.effects, s.calm]);
  useEffect(() => { world?.setCameraStyle(s.camera); }, [world, s.camera]);

  return (
    <WorldCtx.Provider value={{ world, status, firstCharacter }}>
      <div ref={host} className={`stage ${status.kind === 'fallback' ? 'stage--fallback' : ''}`} aria-hidden="true">
        <canvas ref={canvas} />
      </div>
      {children}
    </WorldCtx.Provider>
  );
}
