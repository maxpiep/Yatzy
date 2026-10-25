import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CreatedRoom } from '../data/backend';
import { BackendError } from '../data/errors';
import { roomNameSchema } from '../domain/validation';
import { useClub } from '../state/club';
import { Button } from '../ui/Button';
import { CopyField, inviteUrl } from '../ui/CopyField';
import { LogoMark } from '../ui/Logo';
import { IconAlert } from '../ui/Icons';

function BootFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="boot" id="main">
      <div className="boot__card">
        <div className="brand" style={{ margin: 0 }}>
          <LogoMark />
          <span className="brand__name">Kniffel Club</span>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoadingScreen() {
  return (
    <BootFrame>
      <p className="muted" role="status">
        Verbinde mit dem Club …
      </p>
    </BootFrame>
  );
}

export function UnconfiguredScreen() {
  const { acceptLocalMode } = useClub();
  return (
    <BootFrame>
      <div className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Backend nicht eingerichtet</h1>
        <p className="muted">
          Für gemeinsame Partien auf zwei Geräten braucht Kniffel Club eine Supabase-Datenbank. Es fehlen die Umgebungsvariablen <code>VITE_SUPABASE_URL</code> und{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. Die Einrichtung ist in <code>docs/deployment.md</code> beschrieben.
        </p>
        <div className="notice notice--warning">
          <IconAlert />
          <span>Im lokalen Modus wird nur in diesem Browser gespeichert. Es gibt keine Synchronisierung und kein zweites Gerät.</span>
        </div>
        <Button variant="primary" onClick={acceptLocalMode} data-testid="use-local">
          Lokal auf diesem Gerät spielen
        </Button>
      </div>
    </BootFrame>
  );
}

export function FatalScreen({ error }: { error: BackendError }) {
  return (
    <BootFrame>
      <div className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }} role="alert">
        <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Das hat nicht geklappt</h1>
        <p className="muted">{error.message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Neu laden
        </Button>
      </div>
    </BootFrame>
  );
}

export function SetupPage() {
  const { createRoom, selectRoom, backend } = useClub();
  const [name, setName] = useState('Kniffel Club');
  const [maxi, setMaxi] = useState('Maxi');
  const [franzi, setFranzi] = useState('Franzi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedRoom | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !roomNameSchema.safeParse(name).success || !maxi.trim() || !franzi.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createRoom(name, maxi, franzi);
      if (!res.memberToken) selectRoom(res.roomId);
      else setCreated(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <BootFrame>
        <div className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }}>
          <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Euer Club ist bereit</h1>
          <p className="muted">Schicke den Einladungslink an dein Gegenüber. Die Links werden nur jetzt angezeigt; neue lassen sich jederzeit in den Einstellungen erzeugen.</p>
          <div className="field">
            <span className="field__label">Einladungslink (Spielzugriff, 14 Tage gültig)</span>
            <CopyField value={inviteUrl(created.memberToken!)} label="Einladungslink" />
          </div>
          <div className="field">
            <span className="field__label">Admin-Link – sicher aufbewahren, nicht teilen</span>
            <CopyField value={inviteUrl(created.ownerToken!)} label="Admin-Link" />
            <span className="field__hint">Damit stellst du deine Admin-Rechte einmalig auf einem neuen Gerät wieder her.</span>
          </div>
          <Button variant="primary" onClick={() => selectRoom(created.roomId)}>
            Zum Club
          </Button>
        </div>
      </BootFrame>
    );
  }

  return (
    <BootFrame>
      <form className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }} onSubmit={submit}>
        <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Willkommen im Kniffel Club</h1>
        <p className="muted">
          Gründe euren Club. {backend?.mode === 'local' ? 'Lokaler Modus: Daten bleiben auf diesem Gerät.' : 'Danach erhältst du einen Einladungslink für das zweite Gerät.'}
        </p>
        <label className="field">
          <span className="field__label">Clubname</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="grid-2" style={{ gap: 'var(--s-3)' }}>
          <label className="field">
            <span className="field__label">Spieler 1</span>
            <input className="input" value={maxi} maxLength={30} onChange={(e) => setMaxi(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Spieler 2</span>
            <input className="input" value={franzi} maxLength={30} onChange={(e) => setFranzi(e.target.value)} required />
          </label>
        </div>
        {error && (
          <div className="notice notice--danger" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="Wird angelegt …" data-testid="create-club">
          Club gründen
        </Button>
        {backend?.mode !== 'local' && (
          <p className="subtle">
            Du hast einen Einladungslink? Öffne ihn einfach – du landest dann direkt im Club.
          </p>
        )}
      </form>
    </BootFrame>
  );
}

export function JoinPage() {
  const { joinRoom, backend } = useClub();
  const navigate = useNavigate();
  const [state, setState] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('');
  const [retryable, setRetryable] = useState(false);
  const started = useRef(false);
  const token = useRef('');

  const attempt = useCallback(() => {
    setState('working');
    joinRoom(token.current)
      .then((res) => navigate('/', { replace: true, state: { joined: res.role } }))
      .catch((e: BackendError) => {
        setMessage(e.message);
        setRetryable(e.code === 'network' || e.code === 'unknown');
        setState('error');
      });
  }, [joinRoom, navigate]);

  useEffect(() => {
    if (started.current || !backend) return;
    started.current = true;
    // Token nur im Speicher halten und sofort aus der Adresszeile entfernen (Verlauf, Screenshots, Teilen).
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
    window.history.replaceState(null, '', '/beitreten');
    attempt();
  }, [backend, attempt]);

  return (
    <BootFrame>
      <div className="panel" style={{ display: 'grid', gap: 'var(--s-4)' }}>
        {state === 'working' ? (
          <p role="status">Einladung wird geprüft …</p>
        ) : (
          <>
            <h1 style={{ fontSize: 'var(--fs-2xl)' }}>{retryable ? 'Beitritt fehlgeschlagen' : 'Einladung ungültig'}</h1>
            <p className="muted" role="alert">
              {message}
            </p>
            {retryable && (
              <Button variant="primary" onClick={attempt}>
                Erneut versuchen
              </Button>
            )}
            <Link className="btn" to="/">
              Zur Startseite
            </Link>
          </>
        )}
      </div>
    </BootFrame>
  );
}
