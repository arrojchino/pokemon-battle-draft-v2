import type { ReactNode } from 'react';
import { UI_SCALES, displayOf, settings, useReducedMotion, useSettings } from '../../app/settings.js';
import { Icon, ScreenHeader, Segmented, Slider, Toggle, toast, type IconName } from '../primitives.js';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <section className="set-sec">
      <h2 className="set-sec__title"><Icon name={icon} />{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text"><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  );
}

/** Every control here changes the running game; shared by the settings screen and the in-match sheet. */
export function SettingsPanel() {
  const s = useSettings();
  const reduced = useReducedMotion();
  const d = displayOf(s);
  const locked = s.performance ? 'Set by performance mode.' : undefined;
  return (
    <div className="settings">
      <Section icon="volume" title="Audio">
        <Slider label="Sound effects" value={s.volume} disabled={s.muted} onChange={v => settings.set({ volume: v })} />
        <Toggle label="Mute all sound" hint="The game has sound effects only, no background music." checked={s.muted} onChange={v => settings.set({ muted: v })} />
      </Section>

      <Section icon="monitor" title="Graphics">
        <Toggle label="Performance mode" hint="Low quality, 75% resolution and reduced effects in one switch." checked={s.performance} onChange={v => settings.set({ performance: v })} />
        <Row label="Quality" hint={locked ?? 'Auto measures real frame times and steps down to stay smooth.'}>
          <Segmented label="Quality" value={d.quality} disabled={s.performance} onChange={v => settings.set({ quality: v })}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
        </Row>
        <Row label="Render scale" hint={locked ?? 'Share of full resolution the 3D stage draws at. Auto lowers it only when frames run long.'}>
          <Segmented label="Render scale" value={d.renderScale} disabled={s.performance} onChange={v => settings.set({ renderScale: v })}
            options={[{ value: 'auto', label: 'Auto' }, { value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }]} />
        </Row>
        <Row label="Visual effects" hint={locked ?? 'Particles, light flashes, bloom and film grain. Attacks stay readable on Minimal.'}>
          <Segmented label="Visual effects" value={d.effects} disabled={s.performance} onChange={v => settings.set({ effects: v })}
            options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'minimal', label: 'Minimal' }]} />
        </Row>
        <Toggle label="Performance diagnostics" hint="Frame times, render scale, draw calls and GPU memory in a corner overlay." checked={s.perf} onChange={v => settings.set({ perf: v })} />
      </Section>

      <Section icon="camera" title="Camera and motion">
        <Row label="Motion" hint={`Currently ${reduced ? 'reduced: camera cuts instead of sweeps, calmer idles, no coin spin.' : 'full motion.'}`}>
          <Segmented label="Motion" value={s.motion} onChange={v => settings.set({ motion: v })}
            options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }, { value: 'full', label: 'Full' }]} />
        </Row>
        <Row label="Battle camera" hint="Steady holds a fixed framing: no shake and no sweeping moves.">
          <Segmented label="Battle camera" value={s.camera} onChange={v => settings.set({ camera: v })}
            options={[{ value: 'cinematic', label: 'Cinematic' }, { value: 'steady', label: 'Steady' }]} />
        </Row>
      </Section>

      <Section icon="access" title="Interface and accessibility">
        <Row label="Interface size" hint="Scales menus, panels and the battle HUD.">
          <Segmented label="Interface size" value={s.uiScale} onChange={v => settings.set({ uiScale: v })}
            options={UI_SCALES.map(v => ({ value: v, label: pct(v) }))} />
        </Row>
        <Toggle label="High contrast" hint="Brighter text, stronger borders and solid panels." checked={s.highContrast} onChange={v => settings.set({ highContrast: v })} />
        <Toggle label="Reduce flashing" hint="No lightning, screen flashes or flickering lights." checked={s.calm} onChange={v => settings.set({ calm: v })} />
      </Section>

      <footer className="settings__foot">
        <span>Saved on this device automatically.</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { settings.reset(); toast('Settings restored to defaults', 'ok'); }}><Icon name="refresh" />Reset to defaults</button>
      </footer>
    </div>
  );
}

/** Full-screen settings, reached from the main menu. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen settings-screen">
      <div className="settings-screen__inner">
        <ScreenHeader title="Settings" eyebrow="Options" jp="設定" onBack={onBack} />
        <SettingsPanel />
      </div>
    </main>
  );
}
