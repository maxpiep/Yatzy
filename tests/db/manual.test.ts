import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectKcError, type TestDb } from './harness';
import { CATEGORIES } from '../../src/domain/types';
import { SCHMIDT_RULESET } from '../../src/domain/rules/ruleset';
import { manualOptions } from '../../src/domain/rules/manual';

interface G { id: string; version: number; current_turn: number; starting_player_id: string; status: string; winner_player_id: string | null }

let db: TestDb;
const owner = randomUUID();
let roomId: string;

beforeAll(async () => {
  db = await createTestDb();
  roomId = (await db.rpc<{ room_id: string }>(owner, 'create_room', ['Club', 'Maxi', 'Franzi'])).room_id;
});
afterAll(async () => {
  await db?.close();
});

const score = (g: G, category: string, points: number, extra = false) =>
  db.rpc<G>(owner, 'score_manual', [g.id, g.version, g.current_turn, category, points, extra]);

describe('Direkteingabe (Supabase-Funktionen)', () => {
  it('SQL und TypeScript erlauben exakt dieselben Werte je Feld', async () => {
    for (const c of CATEGORIES) {
      const ts = new Set([0, ...manualOptions(c, SCHMIDT_RULESET).map((o) => o.points)]);
      const rows = await db.admin<{ p: number; ok: boolean }>(`select p, private.kc_manual_valid($1, p) as ok from generate_series(-1, 55) p`, [c]);
      for (const r of rows) expect(r.ok, `${c} ${r.p}`).toBe(ts.has(r.p));
    }
  });

  it('trägt Werte ein, lehnt unmögliche ab, Zusatz-Kniffel nur bei Kniffel = 50', async () => {
    let g = await db.rpc<G>(owner, 'create_game', [roomId, 200, randomUUID()]);
    await expectKcError(score(g, 'ones', 6), 'invalid_dice');
    await expectKcError(score(g, 'ones', 3, true), 'invalid_dice');
    g = await score(g, 'kniffel', 50); // A
    g = await score(g, 'ones', 0); // B streicht
    await expectKcError(db.rpc(owner, 'score_manual', [g.id, g.version, g.current_turn, 'kniffel', 50, false]), 'category_taken');
    g = await score(g, 'large_straight', 40, true); // A: weiterer Kniffel als Joker
    const rows = await db.admin('select category, kind, points, dice, joker, kniffel_bonus, strike_requested from public.game_scores where game_id = $1 order by turn_no', [g.id]);
    expect(rows).toEqual([
      { category: 'kniffel', kind: 'scored', points: 50, dice: [], joker: false, kniffel_bonus: 0, strike_requested: false },
      { category: 'ones', kind: 'struck', points: 0, dice: [], joker: false, kniffel_bonus: 0, strike_requested: true },
      { category: 'large_straight', kind: 'scored', points: 40, dice: [], joker: true, kniffel_bonus: 50, strike_requested: false },
    ]);
  });

  it('Korrekturen: mit Grund, Konflikt beim Kniffel-Feld mit abhängigen Zusatz-Kniffeln', async () => {
    const g = (await db.admin<G>(`select * from public.games where status = 'active'`))[0]!;
    const a = g.starting_player_id;
    await expectKcError(db.rpc(owner, 'correct_manual', [g.id, g.version, a, 'kniffel', 0, false, 'Tippfehler']), 'correction_conflict');
    await expectKcError(db.rpc(owner, 'correct_manual', [g.id, g.version, a, 'large_straight', 40, true, '']), 'reason_required');
    const g2 = await db.rpc<G>(owner, 'correct_manual', [g.id, g.version, a, 'large_straight', 0, false, 'War kein Kniffel']);
    expect(g2.version).toBe(g.version + 1);
    const corr = await db.admin('select reason, old_value, new_value from public.score_corrections where game_id = $1', [g.id]);
    expect(corr[0]).toMatchObject({ reason: 'War kein Kniffel', old_value: { points: 40, kniffel_bonus: 50 }, new_value: { points: 0 } });
    await db.rpc(owner, 'cancel_game', [g.id, 'Testende']);
  });

  it('komplette Partie per Direkteingabe wird korrekt abgerechnet', async () => {
    let g = await db.rpc<G>(owner, 'create_game', [roomId, 500, randomUUID()]);
    const best: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, Math.max(...manualOptions(c, SCHMIDT_RULESET).map((o) => o.points))]));
    for (let turn = 1; turn <= 26; turn++) {
      const c = CATEGORIES[Math.floor((turn - 1) / 2)]!;
      g = await score(g, c, turn % 2 === 1 ? best[c]! : 0);
    }
    g = await db.rpc<G>(owner, 'finish_game', [g.id]);
    expect(g).toMatchObject({ status: 'finished', winner_player_id: g.starting_player_id });
    const ledger = await db.admin('select amount_cents, player_id from public.cash_ledger where game_id = $1', [g.id]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount_cents).toBe(500);
    // Endstand: 105 oben + 35 Bonus + 30+30+25+30+40+50+30 = 375
    const final = (await db.admin<{ final_scores: Record<string, number> }>('select final_scores from public.games where id = $1', [g.id]))[0]!;
    expect(final.final_scores[g.starting_player_id]).toBe(375);
  });

  it('nur angemeldete Mitglieder dürfen eintragen', async () => {
    const g = await db.rpc<G>(owner, 'create_game', [roomId, 100, randomUUID()]);
    await expectKcError(db.rpc(randomUUID(), 'score_manual', [g.id, g.version, 1, 'chance', 20, false]), 'forbidden');
  });
});
