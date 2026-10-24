import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export interface TestDb {
  name: string;
  pool: pg.Pool;
  /** Führt SQL als angemeldeter Supabase-Nutzer (`authenticated`, auth.uid() = userId) in einer Transaktion aus. */
  as<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Ruft eine RPC-Funktion als Nutzer auf und gibt die erste Spalte der ersten Zeile zurück. */
  rpc<T = unknown>(userId: string | null, fn: string, args: unknown[]): Promise<T>;
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `kc_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6 });

  const setup = await pool.connect();
  try {
    await setup.query(readFileSync(join(ROOT, 'tests/db/supabase-stub.sql'), 'utf8'));
    const dir = join(ROOT, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await setup.query(readFileSync(join(dir, file), 'utf8'));
    }
  } finally {
    setup.release();
  }

  const as = async <T,>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'authenticated' }),
      ]);
      const res = await client.query(sql, params);
      await client.query('commit');
      return res.rows as T[];
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  return {
    name,
    pool,
    as,
    async rpc<T>(userId: string | null, fn: string, args: unknown[]): Promise<T> {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await as<Record<string, unknown>>(userId, `select to_jsonb(public.${fn}(${placeholders})) as r`, args);
      return rows[0]?.r as T;
    },
    async admin<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async close() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

export function kcCode(error: unknown): string | null {
  const message = (error as { message?: string })?.message ?? '';
  const m = /kc_error:([a-z_]+)/.exec(message);
  return m ? m[1]! : null;
}

export async function expectKcError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const actual = kcCode(e);
    if (actual !== code) throw new Error(`Erwartet kc_error:${code}, erhalten: ${(e as Error).message}`);
    return;
  }
  throw new Error(`Erwartet kc_error:${code}, aber der Aufruf war erfolgreich.`);
}
