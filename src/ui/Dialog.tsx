import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { usePreferences } from '../state/preferences';
import { IconClose } from './Icons';

interface Props {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** Schließen sperren (z. B. während des Speicherns). */
  locked?: boolean;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Barrierefreier modaler Dialog: Fokusfalle, Escape, Fokus-Rückgabe, Scroll-Sperre. */
export function Dialog({ open, title, description, onClose, locked, wide, children, footer, initialFocus }: Props) {
  const titleId = useId();
  const descId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const { reducedMotion } = usePreferences();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = panel.current;
    const target = (initialFocus && node?.querySelector<HTMLElement>(initialFocus)) || node?.querySelector<HTMLElement>(FOCUSABLE) || node;
    target?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lockedRef.current) {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lastFocus.current?.focus?.();
    };
  }, [open, initialFocus]);

  useGSAP(
    () => {
      if (!open || reducedMotion) return;
      gsap.from(backdrop.current, { opacity: 0, duration: 0.2, ease: 'power1.out' });
      gsap.from(panel.current, { y: 28, opacity: 0, scale: 0.98, duration: 0.36, ease: 'power3.out' });
    },
    { dependencies: [open], scope: backdrop },
  );

  if (!open) return null;
  return createPortal(
    <div
      ref={backdrop}
      className="dialog-backdrop"
      data-lenis-prevent
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={panel}
        className={`dialog ${wide ? 'dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <button type="button" className="btn btn--ghost btn--icon dialog__close" onClick={onClose} disabled={locked} aria-label="Dialog schließen">
          <IconClose />
        </button>
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {description && (
          <p id={descId} className="muted">
            {description}
          </p>
        )}
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
