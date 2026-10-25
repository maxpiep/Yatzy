import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Liest die öffentliche Konfiguration. Der service_role-Key gehört niemals ins Frontend. */
export function readSupabaseConfig(env: Record<string, string | undefined> = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || url.includes('your-project-ref') || anonKey === 'your-anon-public-key') return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return { url, anonKey };
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(config: SupabaseConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'kniffel-club-auth' },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}
