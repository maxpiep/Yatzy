import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';
import { IconLock } from '../../ui/Icons';
import { browserPinLock, PIN_PATTERN, type PinLock } from './pin';

/** Nach so langer Zeit im Hintergrund sperrt sich die App automatisch. */
const AUTO_LOCK_MS = 10 * 60_000;

interface LockCtx {
  lockNow: () => void;
  lock: PinLock;
}
const Ctx = createContext<LockCtx | null>(null);
export const usePinLock = () => useContext(Ctx);

function PinField({ id, label, value, onChange, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <input
        id={id}
        className="input input--money pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={8}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="boot" id="main">
      <div className="boot__card">
        <div className="brand" style={{ margin: 0 }}>
          <LogoMark />
          <span className="brand__name">Kniffel Club</span>
        </div>
        <div className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }}>
          {children}
        </div>
      </div>
    </main>
  );
}

function SetupPin({ lock, onDone }: { lock: PinLock; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) return setError('Die PIN muss aus 4 bis 8 Ziffern bestehen.');
    if (pin !== repeat) return setError('Die beiden Eingaben stimmen nicht überein.');
    setBusy(true);
    await lock.setPin(pin);
    onDone();
  };
  return (
    <Frame>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <h1 style={{ fontSize: 'var(--fs-2xl)' }}>PIN festlegen</h1>
        <p className="muted">Nur wer die PIN kennt, kann Kniffel Club auf diesem Gerät öffnen. Merkt euch die PIN gut – sie lässt sich nicht wiederherstellen.</p>
        <PinField id="pin-new" label="Neue PIN (4–8 Ziffern)" value={pin} onChange={setPin} autoFocus />
        <PinField id="pin-repeat" label="PIN wiederholen" value={repeat} onChange={setRepeat} />
        {error && (
          <div className="notice notice--danger" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="pin-save">
          PIN speichern
        </Button>
      </form>
    </Frame>
  );
}

function ResetAll({ lock, onCancel }: { lock: PinLock; onCancel: () => void }) {
  const [word, setWord] = useState('');
  const reset = () => {
    try {
      for (const k of Object.keys(window.localStorage)) if (k.startsWith('kniffel-club')) window.localStorage.removeItem(k);
    } catch {
      /* ignorieren */
    }
    lock.clear();
    window.location.assign(import.meta.env.BASE_URL);
  };
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-2xl)' }}>PIN vergessen?</h1>
      <p className="muted">
        Ohne PIN lässt sich die App nur zurücksetzen. Dabei werden <strong>alle Partien, die Bestenliste und die Kasse auf diesem Gerät gelöscht</strong>. Habt ihr eine
        Datensicherung, könnt ihr sie danach in den Einstellungen wiederherstellen.
      </p>
      <label className="field">
        <span className="field__label">Zum Bestätigen LÖSCHEN eintippen</span>
        <input className="input" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
      </label>
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={onCancel}>
          Zurück
        </Button>
        <Button variant="danger" disabled={word.trim().toUpperCase() !== 'LÖSCHEN'} onClick={reset}>
          Alles löschen und neu beginnen
        </Button>
      </div>
    </>
  );
}

function Unlock({ lock, onDone }: { lock: PinLock; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => lock.waitMs());
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setInterval(() => setWait(lock.waitMs()), 500);
    return () => window.clearInterval(t);
  }, [wait, lock]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0) return;
    setBusy(true);
    const res = await lock.unlock(pin);
    setBusy(false);
    if (res === 'ok') return onDone();
    setPin('');
    setWait(lock.waitMs());
    setError(res === 'wait' ? 'Bitte kurz warten.' : 'Falsche PIN.');
  };

  if (forgot) {
    return (
      <Frame>
        <ResetAll lock={lock} onCancel={() => setForgot(false)} />
      </Frame>
    );
  }

  return (
    <Frame>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <h1 style={{ fontSize: 'var(--fs-2xl)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconLock width={22} height={22} /> Gesperrt
        </h1>
        <PinField id="pin-unlock" label="PIN eingeben" value={pin} onChange={setPin} autoFocus />
        {error && (
          <div className="notice notice--danger" role="alert">
            {error}
            {wait > 0 && ` Nächster Versuch in ${Math.ceil(wait / 1000)} s.`}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={wait > 0 || pin.length < 4} data-testid="pin-unlock">
          Entsperren
        </Button>
        <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => setForgot(true)}>
          PIN vergessen?
        </button>
      </form>
    </Frame>
  );
}

/** Sperrt die gesamte App hinter einer PIN (nur im Ein-Gerät-Modus eingesetzt). */
export function PinGate({ children, lock: injected }: { children: ReactNode; lock?: PinLock }) {
  const lock = useMemo(() => injected ?? browserPinLock(), [injected]);
  const [state, setState] = useState<'setup' | 'locked' | 'open'>(() => (!lock.hasPin() ? 'setup' : lock.isUnlocked() ? 'open' : 'locked'));
  const hiddenAt = useRef<number | null>(null);

  const lockNow = useCallback(() => {
    lock.lock();
    setState('locked');
  }, [lock]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) lockNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [lockNow]);

  const value = useMemo(() => ({ lockNow, lock }), [lockNow, lock]);
  if (state === 'setup') return <SetupPin lock={lock} onDone={() => setState('open')} />;
  if (state === 'locked') return <Unlock lock={lock} onDone={() => setState('open')} />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Einstellungen: PIN ändern und sofort sperren. */
export function PinSettings() {
  const ctx = usePinLock();
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!ctx) return null;
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_PATTERN.test(newPin)) return setMsg({ ok: false, text: 'Die neue PIN muss aus 4 bis 8 Ziffern bestehen.' });
    const res = await ctx.lock.changePin(oldPin, newPin);
    setOldPin('');
    setNewPin('');
    setMsg(res === 'ok' ? { ok: true, text: 'PIN geändert.' } : { ok: false, text: res === 'wait' ? 'Zu viele Fehlversuche – bitte warten.' : 'Die bisherige PIN ist falsch.' });
  };
  return (
    <section className="panel">
      <h2>PIN-Sperre</h2>
      <p className="muted">Die App sperrt sich beim Schließen des Browsers und nach 10 Minuten im Hintergrund.</p>
      <Button icon={<IconLock />} onClick={ctx.lockNow}>
        Jetzt sperren
      </Button>
      <form onSubmit={change} style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <PinField id="pin-old" label="Bisherige PIN" value={oldPin} onChange={setOldPin} />
        <PinField id="pin-change" label="Neue PIN (4–8 Ziffern)" value={newPin} onChange={setNewPin} />
        {msg && (
          <div className={`notice ${msg.ok ? 'notice--success' : 'notice--danger'}`} role="status">
            {msg.text}
          </div>
        )}
        <Button type="submit" disabled={oldPin.length < 4 || newPin.length < 4}>
          PIN ändern
        </Button>
      </form>
    </section>
  );
}
