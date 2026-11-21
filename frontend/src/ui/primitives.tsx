import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type IconName =
  | 'copy' | 'link' | 'gear' | 'close' | 'back' | 'arrow' | 'sun' | 'moon' | 'swords' | 'history' | 'external' | 'check' | 'leave' | 'spark' | 'user'
  | 'users' | 'globe' | 'lock' | 'refresh' | 'search' | 'filter' | 'plus' | 'bolt' | 'shield' | 'heart' | 'star' | 'crown' | 'volume' | 'mute'
  | 'sliders' | 'monitor' | 'eye' | 'info' | 'play' | 'book' | 'grid' | 'hash' | 'chevron' | 'chevronDown' | 'trophy' | 'clock' | 'target'
  | 'palette' | 'ball' | 'wifi' | 'dice' | 'camera' | 'access' | 'gauge' | 'text' | 'contrast' | 'flag' | 'swap';
const PATHS: Record<IconName, string> = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  swords: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5L21 18v3h-3l-1-1M5 14l-2 2 4 4 2-2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'M5 12l5 5 9-10',
  leave: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  spark: 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.87M15.5 4.13a3.5 3.5 0 0 1 0 6.74',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2',
  filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  heart: 'M12 20s-7.5-4.6-9.3-9C1.4 7.9 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.6 3.4 4.3 6.5-1.8 4.4-9.3 9-9.3 9z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
  crown: 'M3 7.5l4.5 4L12 5l4.5 6.5L21 7.5 19 18H5zM5 21h14',
  volume: 'M4 9.5h4l5-4.5v14l-5-4.5H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5h4l5-4.5v14l-5-4.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  monitor: 'M3 4.5h18v11.5H3zM8 20h8M12 16v4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.4',
  play: 'M7 4.5l12 7.5-12 7.5z',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  hash: 'M5 9h14M5 15h14M10.5 4L8.5 20M15.5 4l-2 16',
  chevron: 'M9 5.5l6.5 6.5L9 18.5',
  chevronDown: 'M5.5 9l6.5 6.5L18.5 9',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 5.5H5a3 3 0 0 0 3 4.5M16 5.5h3a3 3 0 0 1-3 4.5M12 13v3.5M8.5 20.5h7M10 16.5h4v4h-4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5v-1',
  palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3zM7.5 12v.1M9.5 7.6v.1M14.5 7.6v.1',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h6M15 12h6M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0M12 19.5v.1',
  dice: 'M4 4h16v16H4zM8.5 8.5v.1M15.5 8.5v.1M12 12v.1M8.5 15.5v.1M15.5 15.5v.1',
  camera: 'M4 7.5h3.5L9.5 5h5l2 2.5H20V19H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  access: 'M12 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 9l7 1 7-1M12 10v5M9 21l3-6 3 6',
  gauge: 'M4 17a8.5 8.5 0 1 1 16 0M12 13l4-4.5',
  text: 'M5 7V5h14v2M9.5 19h5M12 5v14',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 7h4.5M12 11h6.5M12 15h5.5',
  flag: 'M5 21V4M5 4.5h11.5l-2 4 2 4H5',
  swap: 'M7 7.5h13M16.5 4l3.5 3.5-3.5 3.5M17 16.5H4M7.5 13L4 16.5 7.5 20',
};
export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

export function Segmented<T extends string | number>({ value, options, onChange, label, disabled }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className={`seg ${disabled ? 'is-disabled' : ''}`} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** On/off switch with a label and an optional one-line explanation. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <span className="switch__text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

/** Range input whose filled track follows the value (`--pct`), with the value printed beside the label. */
export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05, format = v => String(Math.round(v * 100)), disabled }: {
  value: number; onChange: (v: number) => void; label: ReactNode; min?: number; max?: number; step?: number; format?: (v: number) => string; disabled?: boolean;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="slider">
      <span className="slider__head"><span>{label}</span><output>{format(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--pct': `${pct}%` } as CSSProperties} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Capsule spinner for waits that have no measurable progress. */
export const Spinner = ({ size = 28, label = 'Loading' }: { size?: number; label?: string }) => (
  <span className="spinner" role="img" aria-label={label} style={{ '--size': `${size}px` } as CSSProperties} />
);

/** Shared screen header: optional back button, eyebrow (with Japanese accent) and title, right-hand actions. */
export function ScreenHeader({ title, eyebrow, jp, onBack, backLabel = 'Back', children }: { title: ReactNode; eyebrow?: ReactNode; jp?: string; onBack?: () => void; backLabel?: string; children?: ReactNode }) {
  return (
    <header className="screen-head">
      {onBack && <button type="button" className="btn btn--ghost btn--sm screen-head__back" onClick={onBack}><Icon name="back" />{backLabel}</button>}
      <div className="screen-head__titles">
        {(eyebrow || jp) && <p className="eyebrow">{jp && <span className="jp">{jp}</span>}{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {children && <div className="screen-head__extra">{children}</div>}
    </header>
  );
}

/** Accessible modal built on <dialog>: focus trap, Escape and backdrop close come from the platform. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal--wide' : ''}`} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      {open && <div className="modal__body">
        <header className="modal__head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
        {children}
      </div>}
    </dialog>
  );
}

/** Copy button with inline confirmation state. */
export function CopyButton({ getText, label, className = 'btn' }: { getText: () => string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => { if (state === 'idle') return; const t = setTimeout(() => setState('idle'), 1800); return () => clearTimeout(t); }, [state]);
  return (
    <button type="button" className={`${className} ${state === 'ok' ? 'is-ok' : ''}`} onClick={async () => {
      const { copyText } = await import('../showdown/handoff.js');
      setState((await copyText(getText())) ? 'ok' : 'fail');
    }}>
      <Icon name={state === 'ok' ? 'check' : 'copy'} />{state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy blocked, select manually' : label}
    </button>
  );
}

export type Toast = { id: number; text: string; tone: 'info' | 'error' | 'ok' };
let toastSeq = 0;
const toastListeners = new Set<(t: Toast) => void>();
export const toast = (text: string, tone: Toast['tone'] = 'info') => { const t = { id: ++toastSeq, text, tone }; toastListeners.forEach(l => l(t)); };

const TOAST_ICON: Record<Toast['tone'], IconName> = { info: 'info', ok: 'check', error: 'flag' };

/**
 * Notifications sit in a corner away from the HUD (scoreboard on top, commands at the bottom). A repeated
 * message replaces its earlier copy instead of stacking; errors stay a little longer; click to dismiss.
 */
export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setItems(v => [...v.filter(x => x.text !== t.text).slice(-2), t]);
      setTimeout(() => setItems(v => v.filter(x => x.id !== t.id)), t.tone === 'error' ? 6000 : 3600);
    };
    toastListeners.add(on); return () => { toastListeners.delete(on); };
  }, []);
  const dismiss = (id: number) => setItems(v => v.filter(x => x.id !== id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => (
        <button type="button" key={t.id} className={`toast toast--${t.tone}`} onClick={() => dismiss(t.id)} title="Dismiss">
          <Icon name={TOAST_ICON[t.tone]} size={16} /><span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

/** Any screen can open the settings sheet (for example from the room menu mid-match); the shell listens. */
const settingsOpeners = new Set<() => void>();
export const openSettings = () => settingsOpeners.forEach(f => f());
export function useSettingsOpener(open: () => void) {
  useEffect(() => { settingsOpeners.add(open); return () => { settingsOpeners.delete(open); }; }, [open]);
}
