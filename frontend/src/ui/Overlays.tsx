import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { POOL } from '@shared';
import { characterById } from '../characters/roster.js';
import { useWorld } from '../app/WorldProvider.js';
import { Modal } from './primitives.js';

/** True once the stage can be shown: the first partner is ready, or the world settled on ready or fallback. */
export function useStageReady(): boolean {
  const { status, firstCharacter } = useWorld();
  return firstCharacter || status.kind !== 'loading';
}

const FONTS = [
  { name: 'Outfit', by: 'The Outfit Project Authors' },
  { name: 'Manrope', by: 'The Manrope Project Authors' },
  { name: 'Zen Kaku Gothic New', by: 'The Zen Kaku Gothic Project Authors' },
];
const SOFTWARE = [
  { name: 'React', by: 'Facebook, Inc. and its affiliates' },
  { name: 'three.js', by: 'three.js authors' },
  { name: 'PeerJS', by: 'Michelle Bu and Eric Zhang' },
  { name: 'Pokémon Showdown', by: 'Guangcong Luo and contributors · battle simulator on the game server' },
  { name: 'ws', by: 'Einar Otto Stangvik, Arnout Kazemier and contributors' },
];

export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Credits & licenses">
      <div className="credits">
        <section>
          <h3>Pokémon models and media</h3>
          <ul className="credits__list">
            <li><strong><a href="https://github.com/Pokemon-3D-api/assets" target="_blank" rel="noopener noreferrer">Pokémon 3D API</a></strong><span>3D models, loaded at runtime</span><span className="badge">Fan resource</span></li>
            <li><strong><a href="https://github.com/PokeAPI/sprites" target="_blank" rel="noopener noreferrer">PokeAPI sprites</a></strong><span>Official artwork, loaded at runtime</span><span className="badge">Fan resource</span></li>
            <li><strong><a href="https://github.com/PokeAPI/cries" target="_blank" rel="noopener noreferrer">PokeAPI cries</a></strong><span>Partner cries, loaded at runtime</span><span className="badge">Fan resource</span></li>
          </ul>
          <p className="credits__note">Models, artwork and cries are fetched from those repositories when needed and are not bundled. Partner quips are original to this project.</p>
        </section>
        <section>
          <h3>Typefaces</h3>
          <ul className="credits__list">
            {FONTS.map(f => <li key={f.name}><strong>{f.name}</strong><span>{f.by}</span><span className="badge">SIL OFL 1.1</span></li>)}
          </ul>
        </section>
        <section>
          <h3>Software</h3>
          <ul className="credits__list">
            {SOFTWARE.map(s => <li key={s.name}><strong>{s.name}</strong><span>{s.by}</span><span className="badge">MIT</span></li>)}
          </ul>
        </section>
        <section>
          <h3>Pokémon</h3>
          <p className="credits__note">Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial, non-commercial fan project.</p>
          <p className="credits__note">Battles played on Showdown open play.pokemonshowdown.com in its own tab; this app does not bundle or modify the Showdown client.</p>
        </section>
        <p className="credits__note">Sound effects are synthesized in the browser; the stadium, its field and its lights are generated in code.</p>
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

/** True facts about how a match runs, one shown per load. */
const TIPS = [
  'Call heads or tails. The toss winner picks one of the two dealt teams; the rival gets the other.',
  `Every game deals twelve of the ${POOL.length} sets in the draft pool: two teams of six.`,
  'Best of 3 or best of 5: the first to 2 or 3 wins takes the series.',
  'A drawn battle is replayed from a fresh coin toss.',
  'Battle right here in the stadium, or take both teams to Pokémon Showdown.',
  'Your partner Pokémon cheers you on from the field between battles. Pick one from the title menu.',
];

/**
 * First-load veil: the capsule rolls inside a ring that fills with the real byte progress of the opening
 * partner's model. When the stage is ready the ring closes, the capsule pops and the veil dissolves over the menu.
 */
export function LoadingVeil() {
  const { status } = useWorld();
  const done = useStageReady();
  const [gone, setGone] = useState(false);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  useEffect(() => { if (done) { const t = setTimeout(() => setGone(true), 1100); return () => clearTimeout(t); } }, [done]);
  if (gone) return null;
  const p = done || status.kind !== 'loading' ? 1 : status.progress;
  const label = done ? 'Ready' : status.kind === 'loading' && status.label ? status.label : 'Preparing the stage';
  return (
    <div className={`veil ${done ? 'is-done' : ''}`} style={{ '--p': p } as CSSProperties} role="status" aria-live="polite" aria-busy={!done}>
      <div className="veil__inner">
        <div className="veil__ball" aria-hidden="true">
          <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="37" pathLength={100} /><circle className="veil__ring" cx="40" cy="40" r="37" pathLength={100} /></svg>
          <span className="spinner" />
        </div>
        <p className="veil__brand"><span className="veil__pre">Pokémon</span><strong className="veil__title">Battle Draft</strong><span className="jp veil__jp">ドラフトバトル</span></p>
        <div className="veil__bar"><i /></div>
        <small className="num">{label} · {Math.round(p * 100)}%</small>
        <p className="veil__tip"><span className="eyebrow">Tip</span>{tip}</p>
      </div>
    </div>
  );
}

/** Without WebGL: a still composition of partner artwork, so the game stays fully playable. */
export function FallbackBackdrop({ featured }: { featured: string[] }) {
  const { status } = useWorld();
  if (status.kind !== 'fallback') return null;
  return (
    <div className="fallback" aria-hidden="true">
      {featured.map((id, i) => { const c = characterById(id as never); return c ? <img key={id + i} className={`fallback__img fallback__img--${i}`} src={c.portrait} alt="" /> : null; })}
      <p className="fallback__note">{status.reason}. Showing still portraits.</p>
    </div>
  );
}
