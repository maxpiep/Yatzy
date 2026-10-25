import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { usePreferences } from './preferences';

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface Ctx {
  notify: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<Ctx | null>(null);

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { reducedMotion } = usePreferences();
  useGSAP(
    () => {
      if (reducedMotion) return;
      gsap.from(ref.current, { y: 16, opacity: 0, duration: 0.32, ease: 'power3.out' });
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={`toast ${toast.kind === 'error' ? 'toast--error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : '•'}</span>
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Meldung schließen">
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++seq.current;
      setToasts((t) => [...t.filter((x) => x.message !== message).slice(-2), { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 4200);
    },
    [remove],
  );
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider fehlt');
  return ctx;
}
