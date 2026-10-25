import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe('Migrationen', () => {
  it('lassen sich auf eine leere Datenbank anwenden', async () => {
    const rows = await db.admin<{ count: string }>(
      `select count(*) from information_schema.tables where table_schema = 'public'`,
    );
    expect(Number(rows[0]!.count)).toBe(10);
  });

  it('aktivieren RLS auf allen Tabellen', async () => {
    const rows = await db.admin<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
