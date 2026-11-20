import { useEffect, useRef, useState, type ReactNode } from 'react';

type IconName = 'copy' | 'link' | 'gear' | 'close' | 'back' | 'arrow' | 'sun' | 'moon' | 'swords' | 'history' | 'external' | 'check' | 'leave' | 'spark' | 'user';
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
};
export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
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

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => { setItems(v => [...v.slice(-3), t]); setTimeout(() => setItems(v => v.filter(x => x.id !== t.id)), 4200); };
    toastListeners.add(on); return () => { toastListeners.delete(on); };
  }, []);
  return <div className="toasts" role="status" aria-live="polite">{items.map(t => <div key={t.id} className={`toast toast--${t.tone}`}>{t.text}</div>)}</div>;
}
