import { useEffect } from 'react';
import { useSettings } from './settings.js';

/**
 * Applies interface and accessibility settings to <html>: `--ui-scale` (read by the zoom rule in
 * styles/settings.css), `data-contrast` and `data-calm`. Reduced motion is resolved by WorldProvider
 * into `data-motion`.
 */
export function useApplySettings(): void {
  const { uiScale, highContrast, calm } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(uiScale));
    root.dataset.contrast = highContrast ? 'high' : 'normal';
    root.dataset.calm = calm ? 'on' : 'off';
  }, [uiScale, highContrast, calm]);
}
