import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { usePreferences } from '../state/preferences';

interface Props {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
}

const defaultFormat = (v: number) => String(Math.round(v));

/**
 * Zählt von der letzten Anzeige zum neuen Wert hoch. Der sichtbare Text wird ausschließlich
 * von GSAP gesetzt; Screenreader erhalten immer sofort den Endwert.
 */
export function CountUp({ value, format = defaultFormat, duration = 0.8, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const { reducedMotion } = usePreferences();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current ?? 0;
    if (reducedMotion || from === value) {
      el.textContent = format(value);
      shown.current = value;
      return;
    }
    const state = { v: from };
    el.textContent = format(from);
    const tween = gsap.to(state, {
      v: value,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        shown.current = state.v;
        el.textContent = format(state.v);
      },
      onComplete: () => {
        shown.current = value;
      },
    });
    return () => {
      tween.kill();
    };
  }, [value, duration, format, reducedMotion]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" />
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
