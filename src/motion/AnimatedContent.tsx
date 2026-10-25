/*
 * Angepasst aus React Bits „AnimatedContent“ (https://github.com/DavidHDev/react-bits)
 * Copyright (c) 2026 David Haz – MIT + Commons Clause License Condition v1.0.
 * Änderungen: auf Mount-Trigger reduziert, ohne ScrollTrigger, respektiert reduzierte Bewegung,
 * Inhalt bleibt ohne JavaScript bzw. bei reduzierter Bewegung sofort sichtbar.
 */
import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { usePreferences } from '../state/preferences';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  distance?: number;
  duration?: number;
  delay?: number;
  /** Kinder nacheinander einblenden (Sekunden zwischen den Elementen). */
  stagger?: number;
  ease?: string;
  scale?: number;
}

export function AnimatedContent({ children, distance = 18, duration = 0.55, delay = 0, stagger = 0, ease = 'power3.out', scale = 1, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { reducedMotion } = usePreferences();

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reducedMotion) return;
      const targets = stagger > 0 && el.children.length ? Array.from(el.children) : [el];
      gsap.fromTo(
        targets,
        { y: distance, opacity: 0, scale },
        { y: 0, opacity: 1, scale: 1, duration, delay, ease, stagger: stagger || 0, clearProps: 'transform,opacity' },
      );
    },
    { scope: ref, dependencies: [reducedMotion] },
  );

  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
}
