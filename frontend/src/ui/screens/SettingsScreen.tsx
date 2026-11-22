import type { ReactNode } from 'react';
import { UI_SCALES, displayOf, settings, useReducedMotion, useSettings, type Settings } from '../../app/settings.js';
import { sound, type Category } from '../../audio/sound.js';
import { characterById } from '../../characters/roster.js';
import { Icon, ScreenHeader, Segmented, Slider, Toggle, toast, type IconName } from '../primitives.js';
import { LANG_CODES, languageName, t as tr, useT, type MessageKey } from '../../i18n/index.js';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One volume per sound category, below the master. */
const AUDIO_SLIDERS = [
  { key: 'musicVolume', label: 'settings.music', cat: 'music' },
  { key: 'criesVolume', label: 'settings.cries', cat: 'cries' },
  { key: 'uiVolume', label: 'settings.interface', cat: 'ui' },
  { key: 'battleVolume', label: 'settings.effects', cat: 'battle' },
] as const satisfies readonly { key: keyof Settings; label: MessageKey; cat: Category }[];

/** A sample of the category at its new level once the slider rests (cries use your partner's). */
let previewTimer = 0;
const previewSoon = (cat: Category, dex?: number) => { window.clearTimeout(previewTimer); previewTimer = window.setTimeout(() => sound.preview(cat, dex), 160); };

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
  const t = useT();
  const s = useSettings();
  const reduced = useReducedMotion();
  const d = displayOf(s);
  const locked = s.performance ? t('settings.locked') : undefined;
  return (
    <div className="settings">
      <Section icon="globe" title={t('settings.language')}>
        <Row label={t('settings.language')} hint={t('settings.languageHint')}>
          <Segmented label={t('settings.language')} value={s.lang} onChange={v => settings.set({ lang: v })}
            options={LANG_CODES.map(l => ({ value: l, label: languageName(l) }))} />
        </Row>
      </Section>

      <Section icon="volume" title={t('settings.audio')}>
        <Slider label={t('settings.master')} value={s.volume} disabled={s.muted} format={pct} onChange={v => { settings.set({ volume: v }); previewSoon('ui'); }} />
        {AUDIO_SLIDERS.map(a => (
          <Slider key={a.key} label={t(a.label)} value={s[a.key]} disabled={s.muted} format={pct}
            onChange={v => { settings.set({ [a.key]: v } as Partial<Settings>); previewSoon(a.cat, characterById(s.partner)?.dex); }} />
        ))}
        <Toggle label={t('settings.mute')} hint={t('settings.muteHint')} checked={s.muted} onChange={v => settings.set({ muted: v })} />
      </Section>

      <Section icon="monitor" title={t('settings.graphics')}>
        <Toggle label={t('settings.performance')} hint={t('settings.performanceHint')} checked={s.performance} onChange={v => settings.set({ performance: v })} />
        <Row label={t('settings.quality')} hint={locked ?? t('settings.qualityHint')}>
          <Segmented label={t('settings.quality')} value={d.quality} disabled={s.performance} onChange={v => settings.set({ quality: v })}
            options={[{ value: 'auto', label: t('settings.auto') }, { value: 'low', label: t('settings.low') }, { value: 'medium', label: t('settings.medium') }, { value: 'high', label: t('settings.high') }]} />
        </Row>
        <Row label={t('settings.renderScale')} hint={locked ?? t('settings.renderScaleHint')}>
          <Segmented label={t('settings.renderScale')} value={d.renderScale} disabled={s.performance} onChange={v => settings.set({ renderScale: v })}
            options={[{ value: 'auto', label: t('settings.auto') }, { value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }]} />
        </Row>
        <Row label={t('settings.visualEffects')} hint={locked ?? t('settings.visualEffectsHint')}>
          <Segmented label={t('settings.visualEffects')} value={d.effects} disabled={s.performance} onChange={v => settings.set({ effects: v })}
            options={[{ value: 'full', label: t('settings.full') }, { value: 'reduced', label: t('settings.reduced') }, { value: 'minimal', label: t('settings.minimal') }]} />
        </Row>
        <Toggle label={t('settings.diagnostics')} hint={t('settings.diagnosticsHint')} checked={s.perf} onChange={v => settings.set({ perf: v })} />
      </Section>

      <Section icon="camera" title={t('settings.cameraMotion')}>
        <Row label={t('settings.motion')} hint={reduced ? t('settings.motionReduced') : t('settings.motionFull')}>
          <Segmented label={t('settings.motion')} value={s.motion} onChange={v => settings.set({ motion: v })}
            options={[{ value: 'system', label: t('settings.system') }, { value: 'reduced', label: t('settings.motionReducedOpt') }, { value: 'full', label: t('settings.motionFullOpt') }]} />
        </Row>
        <Row label={t('settings.battleCamera')} hint={t('settings.battleCameraHint')}>
          <Segmented label={t('settings.battleCamera')} value={s.camera} onChange={v => settings.set({ camera: v })}
            options={[{ value: 'cinematic', label: t('settings.cinematic') }, { value: 'steady', label: t('settings.steady') }]} />
        </Row>
      </Section>

      <Section icon="access" title={t('settings.access')}>
        <Row label={t('settings.uiSize')} hint={t('settings.uiSizeHint')}>
          <Segmented label={t('settings.uiSize')} value={s.uiScale} onChange={v => settings.set({ uiScale: v })}
            options={UI_SCALES.map(v => ({ value: v, label: pct(v) }))} />
        </Row>
        <Toggle label={t('settings.highContrast')} hint={t('settings.highContrastHint')} checked={s.highContrast} onChange={v => settings.set({ highContrast: v })} />
        <Toggle label={t('settings.calm')} hint={t('settings.calmHint')} checked={s.calm} onChange={v => settings.set({ calm: v })} />
      </Section>

      <footer className="settings__foot">
        <span>{t('settings.saved')}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { settings.reset(); toast(tr('settings.restored'), 'ok'); }}><Icon name="refresh" />{t('settings.reset')}</button>
      </footer>
    </div>
  );
}

/** Full-screen settings, reached from the main menu. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <main className="screen settings-screen scroller">
      <div className="settings-screen__inner">
        <ScreenHeader title={t('settings.title')} eyebrow={t('settings.eyebrow')} onBack={onBack} />
        <SettingsPanel />
      </div>
    </main>
  );
}
