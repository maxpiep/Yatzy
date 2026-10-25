import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { usePreferences } from '../state/preferences';

interface Props {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
}

/** Zählt von der letzten Anzeige zum neuen Wert hoch. Der Endwert steht immer sofort im DOM-Text bereit (Screenreader). */
export function CountUp({ value, format = (v) => String(Math.round(v)), duration = 0.8, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const { reducedMotion } = usePreferences();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion) {
      el.textContent = format(value);
      shown.current = value;
      return;
    }
    const state = { v: shown.current };
    const tween = gsap.to(state, {
      v: value,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = format(state.v);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = format(value);
      },
    });
    return () => {
      tween.kill();
      shown.current = value;
    };
  }, [value, duration, format, reducedMotion]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true">
        {format(reducedMotion ? value : shown.current)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
