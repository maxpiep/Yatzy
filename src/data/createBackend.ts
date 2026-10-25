import type { Backend } from './backend';
import { readLocal } from '../lib/storage';
import { LocalBackend } from './localBackend';
import { SupabaseBackend } from './supabaseBackend';
import { getSupabaseClient, readSupabaseConfig } from './supabaseClient';

export const LOCAL_MODE_KEY = 'kniffel-club:local-mode-accepted';

export type BackendChoice =
  | { kind: 'ready'; backend: Backend }
  | { kind: 'unconfigured' };

/** Wählt das Backend: Supabase, wenn konfiguriert; lokal nur bei ausdrücklicher Wahl. */
export function chooseBackend(env: Record<string, string | undefined> = import.meta.env): BackendChoice {
  const forcedLocal = env.VITE_BACKEND_MODE === 'local';
  const config = readSupabaseConfig(env);
  if (!forcedLocal && config) return { kind: 'ready', backend: new SupabaseBackend(getSupabaseClient(config)) };
  const accepted = readLocal(LOCAL_MODE_KEY) === '1';
  if (forcedLocal || accepted) return { kind: 'ready', backend: new LocalBackend() };
  return { kind: 'unconfigured' };
}
