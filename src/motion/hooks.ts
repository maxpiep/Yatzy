import { useRef, type RefObject } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { usePreferences } from '../state/preferences';

/** Kurzes Aufleuchten eines Elements, wenn sich `key` ändert (z. B. neue Punkte). */
export function useFlash<T extends HTMLElement>(key: unknown, color = 'var(--c-brass-soft)'): RefObject<T | null> {
  const ref = useRef<T>(null);
  const first = useRef(true);
  const { reducedMotion } = usePreferences();
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (reducedMotion || !ref.current) return;
      gsap.fromTo(
        ref.current,
        { backgroundColor: color, scale: 1.06 },
        { backgroundColor: 'rgba(0,0,0,0)', scale: 1, duration: 0.9, ease: 'power2.out', clearProps: 'backgroundColor,transform' },
      );
    },
    { dependencies: [key] },
  );
  return ref;
}

/** Dezenter Seitenübergang beim Routenwechsel. */
export function usePageTransition<T extends HTMLElement>(routeKey: string): RefObject<T | null> {
  const ref = useRef<T>(null);
  const { reducedMotion } = usePreferences();
  useGSAP(
    () => {
      if (reducedMotion || !ref.current) return;
      gsap.fromTo(ref.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'opacity,transform' });
    },
    { dependencies: [routeKey, reducedMotion], scope: ref },
  );
  return ref;
}
