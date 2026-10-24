import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { CATEGORIES, type Dice, type Scorecard } from '../../src/domain/types';
import { SCHMIDT_RULESET } from '../../src/domain/rules/ruleset';
import { calculateScore, strikeScore } from '../../src/domain/rules/scoring';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

/** Alle 6^5 = 7776 Würfelkombinationen. */
function allDice(): number[][] {
  const out: number[][] = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++)
        for (let d = 1; d <= 6; d++) for (let e = 1; e <= 6; e++) out.push([a, b, c, d, e]);
  return out;
}

describe('Regel-Parität SQL ↔ TypeScript', () => {
  it('liefert für alle Würfe, Kategorien und Kniffel-Zustände identische Wertungen', async () => {
    const dice = allDice();
    // Kniffel-Feld: offen (null), gestrichen (0), belegt (50)
    for (const kniffel of [null, 0, 50] as const) {
      const rows = await db.admin<{ i: number; category: string; strike: boolean; points: number; joker: boolean; kniffel_bonus: number }>(
        `select x.i::int as i, c.category, s.strike, e.points, e.joker, e.kniffel_bonus
         from unnest($1::text[]) with ordinality as x(txt, i)
         cross join unnest($2::text[]) as c(category)
         cross join (values (false), (true)) as s(strike)
         cross join lateral private.kc_evaluate(string_to_array(x.txt, ',')::smallint[], c.category, $3::int, s.strike) as e
         where not (c.category = 'kniffel' and $3::int is not null)`,
        [dice.map((d) => d.join(',')), [...CATEGORIES], kniffel],
      );
      expect(rows.length).toBe(dice.length * (kniffel === null ? 13 : 12) * 2);
      const card: Scorecard =
        kniffel === null
          ? {}
          : { kniffel: { category: 'kniffel', kind: kniffel ? 'scored' : 'struck', points: kniffel, dice: [1, 1, 1, 1, 1], joker: false, kniffelBonus: 0, turnNo: 1 } };
      let mismatches = 0;
      for (const r of rows) {
        const d = dice[r.i - 1] as unknown as Dice;
        const ts = r.strike
          ? strikeScore(d, r.category as never, card, SCHMIDT_RULESET)
          : calculateScore(d, r.category as never, card, SCHMIDT_RULESET);
        if (ts.points !== r.points || ts.joker !== r.joker || ts.kniffelBonus !== r.kniffel_bonus) mismatches++;
      }
      expect(mismatches).toBe(0);
    }
  });
});
