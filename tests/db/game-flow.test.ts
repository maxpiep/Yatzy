import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectKcError, kcCode, type TestDb } from './harness';
import { CATEGORIES, type Category, type Dice } from '../../src/domain/types';
import { SCHMIDT_RULESET } from '../../src/domain/rules/ruleset';
import { calculateScore, computeTotals } from '../../src/domain/rules/scoring';

type Row = Record<string, unknown>;
interface GameRow {
  id: string;
  room_id: string;
  status: string;
  version: number;
  current_turn: number;
  stake_amount_cents: number;
  starting_player_id: string;
  winner_player_id: string | null;
  is_draw: boolean | null;
  final_scores: Record<string, number> | null;
  settlement_status: string;
}

let db: TestDb;
const owner = randomUUID();
const member = randomUUID();
const stranger = randomUUID();
let roomId: string;
let memberToken: string;
let ownerToken: string;
let maxiId: string;
let franziId: string;

beforeAll(async () => {
  db = await createTestDb();
  const res = await db.rpc<{ room_id: string; member_token: string; owner_token: string }>(owner, 'create_room', [
    'Kniffel Club',
    'Maxi',
    'Franzi',
  ]);
  roomId = res.room_id;
  memberToken = res.member_token;
  ownerToken = res.owner_token;
  const players = await db.as<{ id: string; slug: string }>(owner, 'select id, slug from public.players where room_id = $1', [roomId]);
  maxiId = players.find((p) => p.slug === 'maxi')!.id;
  franziId = players.find((p) => p.slug === 'franzi')!.id;
});

afterAll(async () => {
  await db?.close();
});

const D = (...v: number[]) => v;
const NONE = [false, false, false, false, false];

async function getGame(id: string): Promise<GameRow> {
  return (await db.admin<GameRow>('select * from public.games where id = $1', [id]))[0]!;
}

async function startGame(stake = 200, user = owner): Promise<GameRow> {
  return db.rpc<GameRow>(user, 'create_game', [roomId, stake, randomUUID()]);
}

async function rollAndScore(game: GameRow, dice: number[], category: Category, strike = false, user = owner): Promise<GameRow> {
  const g1 = await db.rpc<GameRow>(user, 'confirm_roll', [game.id, game.version, game.current_turn, dice, NONE]);
  return db.rpc<GameRow>(user, 'score_turn', [g1.id, g1.version, g1.current_turn, category, strike]);
}

/** Spielt eine komplette Partie: beide Spieler werten jede Kategorie mit denselben Würfeln, außer `override`. */
async function playFullGame(stake: number, plan: (playerId: string, category: Category) => number[]): Promise<GameRow> {
  let g = await startGame(stake);
  const order = [...CATEGORIES];
  for (let turn = 1; turn <= 26; turn++) {
    const playerId = turn % 2 === 1 ? g.starting_player_id : g.starting_player_id === maxiId ? franziId : maxiId;
    const category = order[Math.floor((turn - 1) / 2)]!;
    g = await rollAndScore(g, plan(playerId, category), category);
  }
  return g;
}

const goodDice: Record<Category, number[]> = {
  ones: D(1, 1, 1, 2, 3),
  twos: D(2, 2, 2, 1, 3),
  threes: D(3, 3, 3, 1, 2),
  fours: D(4, 4, 4, 1, 2),
  fives: D(5, 5, 5, 1, 2),
  sixes: D(6, 6, 6, 1, 2),
  three_kind: D(6, 6, 6, 5, 5),
  four_kind: D(6, 6, 6, 6, 5),
  full_house: D(2, 2, 3, 3, 3),
  small_straight: D(1, 2, 3, 4, 6),
  large_straight: D(2, 3, 4, 5, 6),
  kniffel: D(4, 4, 4, 4, 4),
  chance: D(6, 6, 5, 5, 4),
};

async function ledgerFor(gameId: string): Promise<Row[]> {
  return db.admin('select * from public.cash_ledger where game_id = $1', [gameId]);
}

async function finishCurrentIfAny(): Promise<void> {
  const active = await db.admin<{ id: string }>(`select id from public.games where room_id = $1 and status = 'active'`, [roomId]);
  for (const a of active) await db.rpc(owner, 'cancel_game', [a.id, 'Testaufräumen']);
}

describe('Raum, Einladung und Zugriffsschutz', () => {
  it('Maxi und Franzi werden genau einmal angelegt', async () => {
    const rows = await db.admin('select slug from public.players where room_id = $1 order by slug', [roomId]);
    expect(rows.map((r) => r.slug)).toEqual(['franzi', 'maxi']);
  });

  it('ungültige Einladungen werden abgewiesen', async () => {
    await expectKcError(db.rpc(member, 'join_room', ['nope']), 'invalid_invite');
    await expectKcError(db.rpc(member, 'join_room', ['0'.repeat(48)]), 'invalid_invite');
  });

  it('nicht angemeldete Aufrufe werden abgewiesen', async () => {
    await expectKcError(db.rpc(null, 'join_room', [memberToken]), 'not_authenticated');
  });

  it('gültige Einladung macht zum Mitglied ohne Admin-Rechte', async () => {
    const res = await db.rpc<{ role: string }>(member, 'join_room', [memberToken]);
    expect(res.role).toBe('member');
    await expectKcError(db.rpc(member, 'rotate_invite', [roomId, 'member']), 'owner_required');
  });

  it('Fremde sehen über RLS keine Daten und können nichts auslösen', async () => {
    expect(await db.as(stranger, 'select * from public.rooms')).toHaveLength(0);
    expect(await db.as(stranger, 'select * from public.players')).toHaveLength(0);
    expect(await db.as(stranger, 'select * from public.cash_ledger')).toHaveLength(0);
    await expectKcError(db.rpc(stranger, 'create_game', [roomId, 200, randomUUID()]), 'forbidden');
    await expectKcError(db.rpc(stranger, 'record_payment', [roomId, maxiId, 100, null, randomUUID()]), 'forbidden');
  });

  it('direkte Schreibzugriffe sind für Clients verboten', async () => {
    await expect(
      db.as(owner, `insert into public.cash_ledger (room_id, player_id, amount_cents, entry_type, description, created_by, idempotency_key)
                    values ($1, $2, 100, 'adjustment', 'hack', $3, 'hack-key-1')`, [roomId, maxiId, owner]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.as(owner, `update public.games set stake_amount_cents = 500`)).rejects.toThrow(/permission denied/);
    await expect(db.as(owner, `delete from public.cash_ledger`)).rejects.toThrow(/permission denied/);
    await expect(db.as(owner, `select * from public.room_invites`)).rejects.toThrow(/permission denied/);
  });

  it('interne Hilfsfunktionen sind nicht direkt aufrufbar', async () => {
    await expect(db.as(owner, `select private.kc_create_invite($1, 'owner', $2)`, [roomId, owner])).rejects.toThrow(/permission denied/);
  });

  it('rotierte Einladung macht die alte ungültig; Owner-Link stellt Admin-Rechte wieder her', async () => {
    const newToken = await db.rpc<string>(owner, 'rotate_invite', [roomId, 'member']);
    await expectKcError(db.rpc(randomUUID(), 'join_room', [memberToken]), 'invalid_invite');
    const other = randomUUID();
    expect((await db.rpc<{ role: string }>(other, 'join_room', [newToken])).role).toBe('member');
    expect((await db.rpc<{ role: string }>(other, 'join_room', [ownerToken])).role).toBe('owner');
    // Admin-Links sind nur einmal verwendbar.
    await expectKcError(db.rpc(randomUUID(), 'join_room', [ownerToken]), 'invalid_invite');
  });

  it('Owner kann einem Gerät den Zugriff entziehen, Mitglieder nicht', async () => {
    const token = await db.rpc<string>(owner, 'rotate_invite', [roomId, 'member']);
    const device = randomUUID();
    await db.rpc(device, 'join_room', [token]);
    await expectKcError(db.rpc(device, 'remove_member', [roomId, member]), 'owner_required');
    await expectKcError(db.rpc(owner, 'remove_member', [roomId, owner]), 'cannot_remove_self');
    await db.as(owner, 'select public.remove_member($1, $2)', [roomId, device]);
    expect(await db.as(device, 'select * from public.games')).toHaveLength(0);
    await expectKcError(db.rpc(device, 'create_game', [roomId, 200, randomUUID()]), 'forbidden');
  });

  it('neue Funktionen in public sind nicht automatisch für authenticated ausführbar', async () => {
    await db.admin(`create function public.kc_probe() returns int language sql security definer as 'select 1'`);
    await expect(db.as(owner, 'select public.kc_probe()')).rejects.toThrow(/permission denied/);
    await db.admin('drop function public.kc_probe()');
  });
});

describe('Partiestart mit Einsatz', () => {
  it('weist ungültige Einsätze serverseitig zurück', async () => {
    for (const stake of [0, 1, 99, 150, 300, 1000, -100]) {
      await expectKcError(db.rpc(owner, 'create_game', [roomId, stake, randomUUID()]), 'invalid_stake');
    }
    await expectKcError(db.rpc(owner, 'create_game', [roomId, null, randomUUID()]), 'invalid_stake');
    expect(await db.admin('select * from public.games')).toHaveLength(0);
  });

  it('speichert den Einsatz als Cent-Betrag und ist idempotent (Doppelklick)', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      db.rpc<GameRow>(owner, 'create_game', [roomId, 500, key]),
      db.rpc<GameRow>(owner, 'create_game', [roomId, 500, key]),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.stake_amount_cents).toBe(500);
    expect(await db.admin(`select * from public.games where status = 'active'`)).toHaveLength(1);
    await expectKcError(db.rpc(owner, 'create_game', [roomId, 200, key]), 'idempotency_conflict');
    await expectKcError(db.rpc(member, 'create_game', [roomId, 200, randomUUID()]), 'active_game_exists');
    await finishCurrentIfAny();
  });

  it('der Einsatz einer Partie ist unveränderlich – auch für Datenbank-Admins', async () => {
    const g = await startGame(100);
    await expect(db.admin('update public.games set stake_amount_cents = 500 where id = $1', [g.id])).rejects.toThrow(/stake_immutable/);
    expect((await getGame(g.id)).stake_amount_cents).toBe(100);
    await finishCurrentIfAny();
  });
});

describe('Würfe und Wertungen', () => {
  it('erzwingt Zugreihenfolge, Versionen und maximal drei Würfe', async () => {
    let g = await startGame(200);
    await expectKcError(db.rpc(owner, 'score_turn', [g.id, g.version, 1, 'chance', false]), 'no_roll');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 2, D(1, 2, 3, 4, 5), NONE]), 'wrong_turn');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(1, 2, 3, 4, 7), NONE]), 'invalid_dice');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(1, 2, 3, 4), NONE]), 'invalid_dice');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(1, 2, 3, 4, 5), [true, false, false, false, false]]), 'invalid_hold');

    g = await db.rpc<GameRow>(owner, 'confirm_roll', [g.id, g.version, 1, D(6, 6, 1, 2, 3), NONE]);
    // Veraltete Version (zweites Gerät) wird abgelehnt.
    await expectKcError(db.rpc(member, 'confirm_roll', [g.id, g.version - 1, 1, D(6, 6, 6, 2, 3), [true, true, false, false, false]]), 'stale_version');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(5, 6, 6, 2, 3), [true, true, false, false, false]]), 'invalid_hold');
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(6, 6, 1, 2, 3), [true, true, true, true, true]]), 'invalid_hold');
    g = await db.rpc<GameRow>(member, 'confirm_roll', [g.id, g.version, 1, D(6, 6, 6, 2, 3), [true, true, false, false, false]]);
    g = await db.rpc<GameRow>(owner, 'confirm_roll', [g.id, g.version, 1, D(6, 6, 6, 6, 3), [true, true, true, false, false]]);
    await expectKcError(db.rpc(owner, 'confirm_roll', [g.id, g.version, 1, D(6, 6, 6, 6, 6), [true, true, true, true, false]]), 'max_rolls_reached');

    g = await db.rpc<GameRow>(owner, 'score_turn', [g.id, g.version, 1, 'four_kind', false]);
    const scores = await db.admin('select * from public.game_scores where game_id = $1', [g.id]);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ category: 'four_kind', points: 27, kind: 'scored', player_id: g.starting_player_id });
    expect(g.current_turn).toBe(2);

    // Gleicher Zug kann nicht erneut gewertet werden.
    await expectKcError(db.rpc(owner, 'score_turn', [g.id, g.version, 1, 'chance', false]), 'wrong_turn');
    await finishCurrentIfAny();
  });

  it('verhindert doppelte Wertung derselben Kategorie und unterscheidet gestrichene Felder', async () => {
    let g = await startGame(200);
    g = await rollAndScore(g, D(1, 2, 3, 4, 6), 'large_straight'); // Spieler A: 0 → gestrichen
    g = await rollAndScore(g, D(1, 2, 3, 4, 5), 'large_straight', true); // Spieler B: bewusst gestrichen
    g = await db.rpc<GameRow>(owner, 'confirm_roll', [g.id, g.version, 3, D(2, 3, 4, 5, 6), NONE]);
    await expectKcError(db.rpc(owner, 'score_turn', [g.id, g.version, 3, 'large_straight', false]), 'category_taken');
    const rows = await db.admin('select kind, points from public.game_scores where game_id = $1 order by turn_no', [g.id]);
    expect(rows).toEqual([{ kind: 'struck', points: 0 }, { kind: 'struck', points: 0 }]);
    await finishCurrentIfAny();
  });

  it('wertet weitere Kniffel serverseitig mit Joker und 50 Zusatzpunkten', async () => {
    let g = await startGame(200);
    g = await rollAndScore(g, D(3, 3, 3, 3, 3), 'kniffel'); // A: Kniffel 50
    g = await rollAndScore(g, D(1, 1, 2, 2, 3), 'chance'); // B
    g = await rollAndScore(g, D(4, 4, 4, 4, 4), 'fives'); // A: Joker → 25 + 50
    g = await rollAndScore(g, D(5, 5, 5, 5, 5), 'large_straight'); // B: Kniffel-Feld offen → 0
    g = await rollAndScore(g, D(2, 2, 2, 2, 2), 'large_straight'); // A: Joker → 40 + 50
    const rows = await db.admin<Row>(
      'select category, points, joker, kniffel_bonus from public.game_scores where game_id = $1 order by turn_no',
      [g.id],
    );
    expect(rows).toEqual([
      { category: 'kniffel', points: 50, joker: false, kniffel_bonus: 0 },
      { category: 'chance', points: 9, joker: false, kniffel_bonus: 0 },
      { category: 'fives', points: 25, joker: true, kniffel_bonus: 50 },
      { category: 'large_straight', points: 0, joker: false, kniffel_bonus: 0 },
      { category: 'large_straight', points: 40, joker: true, kniffel_bonus: 50 },
    ]);
    await finishCurrentIfAny();
  });

  it('Korrekturen sind nur mit Grund möglich und werden protokolliert', async () => {
    let g = await startGame(200);
    g = await rollAndScore(g, D(1, 2, 3, 4, 6), 'chance');
    const pid = g.starting_player_id;
    await expectKcError(db.rpc(owner, 'correct_score', [g.id, g.version, pid, 'chance', D(6, 6, 6, 6, 5), false, '']), 'reason_required');
    await expectKcError(db.rpc(owner, 'correct_score', [g.id, g.version - 1, pid, 'chance', D(6, 6, 6, 6, 5), false, 'Tippfehler']), 'stale_version');
    g = await db.rpc<GameRow>(owner, 'correct_score', [g.id, g.version, pid, 'chance', D(6, 6, 6, 6, 5), false, 'Tippfehler']);
    const score = (await db.admin('select points, correction_count from public.game_scores where game_id = $1', [g.id]))[0];
    expect(score).toEqual({ points: 29, correction_count: 1 });
    const corr = await db.admin('select reason, old_value, new_value from public.score_corrections where game_id = $1', [g.id]);
    expect(corr[0]).toMatchObject({ reason: 'Tippfehler', old_value: { points: 16 }, new_value: { points: 29 } });
    const events = await db.admin(`select event_type from public.game_events where game_id = $1 order by id`, [g.id]);
    expect(events.map((e) => e.event_type)).toEqual(['game_created', 'roll_confirmed', 'category_scored', 'score_corrected']);
    await finishCurrentIfAny();
  });
});

describe('Korrektur des Kniffel-Felds', () => {
  it('berechnet spätere Kniffel-Wertungen (Zusatzpunkte, Joker) nach', async () => {
    let g = await startGame(200);
    const a = g.starting_player_id;
    g = await rollAndScore(g, D(3, 3, 3, 3, 3), 'kniffel', true); // A streicht Kniffel versehentlich
    g = await rollAndScore(g, D(1, 1, 2, 2, 3), 'chance'); // B
    g = await rollAndScore(g, D(4, 4, 4, 4, 4), 'large_straight'); // A: kein Joker → 0
    g = await rollAndScore(g, D(1, 1, 2, 2, 3), 'ones'); // B
    g = await rollAndScore(g, D(6, 6, 6, 6, 6), 'sixes', true); // A: gestrichen
    const before = await db.admin('select category, points, joker, kniffel_bonus from public.game_scores where game_id = $1 and player_id = $2 order by turn_no', [g.id, a]);
    expect(before).toEqual([
      { category: 'kniffel', points: 0, joker: false, kniffel_bonus: 0 },
      { category: 'large_straight', points: 0, joker: false, kniffel_bonus: 0 },
      { category: 'sixes', points: 0, joker: false, kniffel_bonus: 0 },
    ]);
    g = await db.rpc<GameRow>(owner, 'correct_score', [g.id, g.version, a, 'kniffel', D(3, 3, 3, 3, 3), false, 'Versehentlich gestrichen']);
    const after = await db.admin('select category, kind, points, joker, kniffel_bonus from public.game_scores where game_id = $1 and player_id = $2 order by turn_no', [g.id, a]);
    expect(after).toEqual([
      { category: 'kniffel', kind: 'scored', points: 50, joker: false, kniffel_bonus: 0 },
      { category: 'large_straight', kind: 'scored', points: 40, joker: true, kniffel_bonus: 50 },
      { category: 'sixes', kind: 'struck', points: 0, joker: false, kniffel_bonus: 50 },
    ]);
    const corr = await db.admin<{ reason: string }>('select reason from public.score_corrections where game_id = $1 order by id', [g.id]);
    expect(corr).toHaveLength(3);
    expect(corr[1]!.reason).toMatch(/^Folgekorrektur/);
    await finishCurrentIfAny();
  });
});

describe('Abschluss und Kniffelkasse', () => {
  it('eine unvollständige Partie kann nicht abgeschlossen werden', async () => {
    let g = await startGame(200);
    g = await rollAndScore(g, D(1, 2, 3, 4, 6), 'chance');
    await expectKcError(db.rpc(owner, 'finish_game', [g.id]), 'game_incomplete');
    expect((await getGame(g.id)).status).toBe('active');
    await finishCurrentIfAny();
  });

  for (const stake of [100, 200, 500]) {
    it(`Verlust bei ${stake / 100} € erzeugt genau einen Einsatz über ${stake} Cent für den Verlierer`, async () => {
      // Maxi würfelt immer die guten Würfel, Franzi streicht durch schlechte Würfel → Franzi verliert.
      let g = await playFullGame(stake, (pid, cat) => (pid === maxiId ? goodDice[cat] : D(1, 1, 2, 2, 3)));
      expect(g.current_turn).toBe(27);
      g = await db.rpc<GameRow>(member, 'finish_game', [g.id]);
      expect(g.status).toBe('finished');
      expect(g.winner_player_id).toBe(maxiId);
      expect(g.settlement_status).toBe('settled');
      const ledger = await ledgerFor(g.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ player_id: franziId, amount_cents: stake, entry_type: 'game_loss' });

      // Endstand entspricht exakt der TypeScript-Regelengine.
      const card = Object.fromEntries(
        CATEGORIES.map((c, i) => {
          const r = calculateScore(goodDice[c] as unknown as Dice, c, {}, SCHMIDT_RULESET);
          return [c, { category: c, kind: 'scored', points: r.points, dice: goodDice[c], joker: false, kniffelBonus: 0, turnNo: i }];
        }),
      );
      expect(g.final_scores![maxiId]).toBe(computeTotals(card as never, SCHMIDT_RULESET).total);

      // Wiederholter Abschluss bucht nicht erneut.
      await db.rpc(owner, 'finish_game', [g.id]);
      await db.rpc(member, 'finish_game', [g.id]);
      expect(await ledgerFor(g.id)).toHaveLength(1);
    });
  }

  it('Unentschieden erzeugt keinen Einsatz', async () => {
    let g = await playFullGame(500, (_pid, cat) => goodDice[cat]);
    g = await db.rpc<GameRow>(owner, 'finish_game', [g.id]);
    expect(g).toMatchObject({ status: 'finished', is_draw: true, winner_player_id: null, settlement_status: 'no_charge' });
    expect(await ledgerFor(g.id)).toHaveLength(0);
  });

  it('gleichzeitige Abschlussanfragen erzeugen keine doppelte Abrechnung', async () => {
    const g = await playFullGame(200, (pid, cat) => (pid === franziId ? goodDice[cat] : D(1, 1, 2, 2, 3)));
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => db.rpc<GameRow>(i % 2 ? owner : member, 'finish_game', [g.id])));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set(['finished']));
    const ledger = await ledgerFor(g.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ player_id: maxiId, amount_cents: 200 });
    const events = await db.admin(`select count(*)::int as n from public.game_events where game_id = $1 and event_type = 'cash_settled'`, [g.id]);
    expect(events[0]!.n).toBe(1);
  });

  it('ein vollständiger Block kann nicht mehr abgebrochen werden (Einsatz bleibt fällig)', async () => {
    const g = await playFullGame(200, (pid, cat) => (pid === maxiId ? goodDice[cat] : D(1, 1, 2, 2, 3)));
    await expectKcError(db.rpc(owner, 'cancel_game', [g.id, 'Keine Lust zu zahlen']), 'game_complete');
    await db.rpc(owner, 'finish_game', [g.id]);
    expect(await ledgerFor(g.id)).toHaveLength(1);
  });

  it('eine fehlgeschlagene Transaktion hinterlässt keine Teilbuchung', async () => {
    const g = await playFullGame(500, (pid, cat) => (pid === maxiId ? goodDice[cat] : D(1, 1, 2, 2, 3)));
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner })]);
      await client.query('select public.finish_game($1)', [g.id]);
      await expect(client.query('select 1 / 0')).rejects.toThrow();
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect((await getGame(g.id)).status).toBe('active');
    expect(await ledgerFor(g.id)).toHaveLength(0);
    await db.rpc(owner, 'finish_game', [g.id]);
    expect(await ledgerFor(g.id)).toHaveLength(1);
  });

  it('abgeschlossene Partien und Wertungen sind unveränderlich', async () => {
    const finished = (await db.admin<{ id: string }>(`select id from public.games where status = 'finished' limit 1`))[0]!;
    await expect(db.admin(`update public.games set final_scores = '{}' where id = $1`, [finished.id])).rejects.toThrow(/game_closed/);
    await expect(db.admin(`update public.game_scores set points = 50 where game_id = $1`, [finished.id])).rejects.toThrow(/game_closed/);
    await expect(db.admin(`delete from public.games where id = $1`, [finished.id])).rejects.toThrow(/immutable_record/);
    await expect(db.admin(`update public.cash_ledger set amount_cents = 1`)).rejects.toThrow(/immutable_record/);
    await expect(db.admin(`delete from public.cash_ledger`)).rejects.toThrow(/immutable_record/);
    await expectKcError(db.rpc(owner, 'confirm_roll', [finished.id, 999, 27, D(1, 1, 1, 1, 1), NONE]), 'game_not_active');
  });

  it('ein späterer Einsatz verändert keine historische Partie', async () => {
    const before = await db.admin<{ id: string; stake_amount_cents: number }>(
      `select id, stake_amount_cents from public.games where status = 'finished' order by started_at`,
    );
    const ledgerBefore = await db.admin('select id, amount_cents from public.cash_ledger order by created_at, id');
    const g = await startGame(100);
    await db.rpc(owner, 'cancel_game', [g.id, 'Test']);
    const after = await db.admin<{ id: string; stake_amount_cents: number }>(
      `select id, stake_amount_cents from public.games where status = 'finished' order by started_at`,
    );
    expect(after).toEqual(before);
    expect(await db.admin('select id, amount_cents from public.cash_ledger order by created_at, id')).toEqual(ledgerBefore);
    expect((await getGame(g.id)).settlement_status).toBe('void');
  });

  it('Zahlungen reduzieren den offenen Betrag, sind idempotent und Überzahlungen bleiben sichtbar', async () => {
    const sum = async (pid: string) =>
      Number((await db.admin<{ s: string }>('select coalesce(sum(amount_cents), 0) as s from public.cash_ledger where player_id = $1', [pid]))[0]!.s);
    const open = await sum(franziId);
    expect(open).toBeGreaterThan(0);
    const key = randomUUID();
    await db.rpc(member, 'record_payment', [roomId, franziId, 150, 'bar', key]);
    await db.rpc(member, 'record_payment', [roomId, franziId, 150, 'bar', key]);
    expect(await sum(franziId)).toBe(open - 150);
    await expectKcError(db.rpc(member, 'record_payment', [roomId, franziId, 999, 'bar', key]), 'idempotency_conflict');
    for (const bad of [0, -5, 1000001]) {
      await expectKcError(db.rpc(member, 'record_payment', [roomId, franziId, bad, null, randomUUID()]), 'invalid_amount');
    }
    await db.rpc(member, 'record_payment', [roomId, franziId, open + 1000, 'Vorauszahlung', randomUUID()]);
    expect(await sum(franziId)).toBe(-1150);
  });

  it('Korrekturbuchungen nur für Owner, mit Grund, sichtbar im Kassenbuch', async () => {
    const loss = (await db.admin<{ id: string }>(`select id from public.cash_ledger where entry_type = 'game_loss' limit 1`))[0]!;
    await expectKcError(db.rpc(member, 'record_adjustment', [roomId, maxiId, -100, 'Kulanz', loss.id, randomUUID()]), 'owner_required');
    await expectKcError(db.rpc(owner, 'record_adjustment', [roomId, maxiId, -100, '', loss.id, randomUUID()]), 'reason_required');
    await expectKcError(db.rpc(owner, 'record_adjustment', [roomId, maxiId, 0, 'Kulanz', null, randomUUID()]), 'invalid_amount');
    const e = await db.rpc<Row>(owner, 'record_adjustment', [roomId, maxiId, -100, 'Kulanz', loss.id, randomUUID()]);
    expect(e).toMatchObject({ entry_type: 'adjustment', amount_cents: -100, corrects_entry_id: loss.id });
    // Der ursprüngliche Einsatz bleibt unverändert erhalten.
    expect((await db.admin('select amount_cents from public.cash_ledger where id = $1', [loss.id]))[0]).toBeTruthy();
  });

  it('beide Clients sehen denselben Spielstand', async () => {
    const a = await db.as(owner, 'select id, status, final_scores from public.games where room_id = $1 order by started_at', [roomId]);
    const b = await db.as(member, 'select id, status, final_scores from public.games where room_id = $1 order by started_at', [roomId]);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('Startspieler wechselt zwischen Partien', async () => {
    const rows = await db.admin<{ starting_player_id: string }>('select starting_player_id from public.games order by started_at, id');
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.starting_player_id).not.toBe(rows[i - 1]!.starting_player_id);
  });
});

describe('Fehlercodes', () => {
  it('sind maschinenlesbar', async () => {
    const error = await db.rpc(owner, 'create_game', [roomId, 3, randomUUID()]).catch((e: unknown) => e);
    expect(kcCode(error)).toBe('invalid_stake');
  });
});
