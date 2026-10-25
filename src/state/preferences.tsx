import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlayerSlug } from '../domain/types';
import { readLocal, writeLocal } from '../lib/storage';

export type ThemePref = 'system' | 'light' | 'dark';
export type MotionPref = 'system' | 'reduced' | 'full';

export interface Preferences {
  theme: ThemePref;
  motion: MotionPref;
  smoothScroll: boolean;
  /** Wem gehört dieses Gerät? Nur Anzeige, keine Berechtigung. */
  device: PlayerSlug | null;
  showHints: boolean;
}

const KEY = 'kniffel-club:prefs:v1';
const DEFAULTS: Preferences = { theme: 'system', motion: 'system', smoothScroll: true, device: null, showHints: true };

function load(): Preferences {
  const raw = readLocal(KEY);
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

interface Ctx {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reducedMotion: boolean;
}

const PreferencesContext = createContext<Ctx | null>(null);

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);
  const systemReduced = useSystemReducedMotion();

  const setPref = useCallback<Ctx['setPref']>((key, value) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      writeLocal(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    if (prefs.motion === 'system') root.removeAttribute('data-motion');
    else root.setAttribute('data-motion', prefs.motion);
  }, [prefs.theme, prefs.motion]);

  const reducedMotion = prefs.motion === 'reduced' || (prefs.motion === 'system' && systemReduced);
  const value = useMemo(() => ({ prefs, setPref, reducedMotion }), [prefs, setPref, reducedMotion]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Ctx {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('PreferencesProvider fehlt');
  return ctx;
}
