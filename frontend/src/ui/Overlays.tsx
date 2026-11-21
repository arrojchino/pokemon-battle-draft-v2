import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BOT, characterById } from '../characters/roster.js';
import { settings, useReducedMotion, useSettings } from '../app/settings.js';
import { useWorld } from '../app/WorldProvider.js';
import { Modal, Segmented } from './primitives.js';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const reduced = useReducedMotion();
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="form">
        <div className="field"><span>Graphics quality</span>
          <Segmented label="Graphics quality" value={s.quality} onChange={v => settings.set({ quality: v })}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
          <small>Auto measures real frame times and lowers resolution, then effects, to stay smooth.</small>
        </div>
        <div className="field"><span>Motion</span>
          <Segmented label="Motion" value={s.motion} onChange={v => settings.set({ motion: v })}
            options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }, { value: 'full', label: 'Full' }]} />
          <small>Currently {reduced ? 'reduced: camera cuts, calmer idles, no coin spin' : 'full motion'}.</small>
        </div>
        <label className="field range"><span>Volume <output>{Math.round(s.volume * 100)}</output></span>
          <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={e => settings.set({ volume: Number(e.target.value) })} /></label>
        <label className="field range"><span>Music <output>{Math.round(s.music * 100)}</output></span>
          <input type="range" min={0} max={1} step={0.05} value={s.music} onChange={e => settings.set({ music: Number(e.target.value) })} /></label>
        <label className="toggle"><input type="checkbox" checked={s.muted} onChange={e => settings.set({ muted: e.target.checked })} /><span>Mute all sound</span></label>
        <label className="toggle"><input type="checkbox" checked={s.perf} onChange={e => settings.set({ perf: e.target.checked })} /><span>Show performance diagnostics</span></label>
      </div>
    </Modal>
  );
}

export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Credits & licenses" wide>
      <div className="credits">
        <section>
          <h3>Battle bot</h3>
          <ul><li><a href={BOT.credit.url} target="_blank" rel="noopener noreferrer">{BOT.credit.model}</a> by {BOT.credit.author}. License: {BOT.credit.license}. Paint jobs, names and grime are original to this project.</li></ul>
        </section>
        <section>
          <h3>Software</h3>
          <ul>
            <li>three.js (MIT), React (MIT), PeerJS (MIT).</li>
            <li>Fonts: Chakra Petch, Manrope, Zen Kaku Gothic New (SIL Open Font License 1.1).</li>
            <li>Pokémon artwork is loaded from the PokeAPI sprites repository. Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project.</li>
            <li>Battles run on Pokémon Showdown (AGPL-3.0), opened in its own tab; this app does not bundle or modify it.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}

/** Diagnostics: measured frame times (not guesses), draw calls and GPU resource counts. */
export function PerfOverlay() {
  const { world } = useWorld();
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!world) return;
    let mem = 0;
    const id = window.setInterval(() => {
      const st = world.stats();
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (heap) mem = heap / 1048576;
      if (ref.current) ref.current.textContent =
        `fps ${st.fps.toFixed(0)}  p50 ${st.p50.toFixed(1)}ms  p95 ${st.p95.toFixed(1)}ms  cpu ${st.cpuMs.toFixed(1)}ms\n` +
        `tier ${st.tier}${st.pref === 'auto' ? ' (auto)' : ''}  scale ${st.scale.toFixed(2)}  dpr ${st.dpr.toFixed(2)}\n` +
        `calls ${st.calls}  tris ${(st.triangles / 1000).toFixed(0)}k  chars ${st.characters}\n` +
        `geo ${st.geometries}  tex ${st.textures}  prog ${st.programs}${mem ? `  heap ${mem.toFixed(0)}MB` : ''}`;
    }, 500);
    return () => clearInterval(id);
  }, [world]);
  return <pre className="perf" ref={ref} aria-hidden="true">measuring…</pre>;
}

/** First-load veil with real byte progress for the opening partner. */
export function LoadingVeil() {
  const { status, firstCharacter } = useWorld();
  const s = useSettings();
  const [gone, setGone] = useState(false);
  const done = firstCharacter || status.kind !== 'loading';
  useEffect(() => { if (done) { const t = setTimeout(() => setGone(true), 900); return () => clearTimeout(t); } }, [done]);
  if (gone) return null;
  const c = characterById(s.partner)!;
  const p = status.kind === 'loading' ? status.progress : 1;
  return (
    <div className={`veil ${done ? 'is-done' : ''}`} style={{ '--accent': c.accent, '--p': p } as CSSProperties} aria-live="polite">
      <div className="veil__inner">
        <span className="jp veil__jp">路地裏リーグ</span>
        <strong className="veil__title">Battle Draft</strong>
        <div className="veil__bar"><i /></div>
        <small>{status.kind === 'loading' ? `${status.label || 'Preparing the stage'} · ${Math.round(p * 100)}%` : 'Ready'}</small>
      </div>
    </div>
  );
}

/** Without WebGL: a still composition using the pre-rendered portraits, so the game stays fully playable. */
export function FallbackBackdrop({ featured }: { featured: string[] }) {
  const { status } = useWorld();
  if (status.kind !== 'fallback') return null;
  return (
    <div className="fallback" aria-hidden="true">
      {featured.map((id, i) => { const c = characterById(id as never); return c ? <img key={id + i} className={`fallback__img fallback__img--${i}`} src={c.portrait} alt="" style={{ '--accent': c.accent } as CSSProperties} /> : null; })}
      <p className="fallback__note">{status.reason}. Showing still portraits.</p>
    </div>
  );
}
