import { useEffect } from 'react';
import Lenis from 'lenis';
import { usePreferences } from '../state/preferences';

/**
 * Optionales sanftes Scrollen (Lenis) – nur mit feinem Zeiger (Maus/Trackpad), nie bei reduzierter
 * Bewegung. Touch bleibt nativ. Dialoge und Tabellen sind über `data-lenis-prevent` ausgenommen.
 */
export function SmoothScroll() {
  const { prefs, reducedMotion } = usePreferences();
  useEffect(() => {
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? false;
    if (!prefs.smoothScroll || reducedMotion || !finePointer) return;
    const lenis = new Lenis({
      autoRaf: true,
      duration: 0.9,
      syncTouch: false,
      prevent: (node) => Boolean(node.closest?.('[data-lenis-prevent], .dialog-backdrop, textarea, select')),
    });
    return () => lenis.destroy();
  }, [prefs.smoothScroll, reducedMotion]);
  return null;
}
