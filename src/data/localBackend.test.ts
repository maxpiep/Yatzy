import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../domain/types';
import { LocalBackend, type KeyValueStorage } from './localBackend';
import { BackendError } from './errors';

const mem = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

async function setup() {
  const b = new LocalBackend(mem());
  await b.init();
  const { roomId } = await b.createRoom('Club', 'Maxi', 'Franzi');
  const snap = await b.getRoomSnapshot(roomId);
  return { b, roomId, maxi: snap.players.find((p) => p.slug === 'maxi')!, franzi: snap.players.find((p) => p.slug === 'franzi')! };
}

const NONE = [false, false, false, false, false];
const code = async (p: Promise<unknown>) => p.then(() => null, (e: BackendError) => e.code);

async function playAll(b: LocalBackend, gameId: string, dice: (playerId: string) => number[]) {
  let g = (await b.getGameDetail(gameId)).game;
  for (let turn = 1; turn <= 26; turn++) {
    const pid = turn % 2 === 1 ? g.startingPlayerId : g.players.find((p) => p.id !== g.startingPlayerId)!.id;
    g = await b.confirmRoll(g.id, g.version, turn, dice(pid), NONE);
    g = await b.scoreTurn(g.id, g.version, turn, CATEGORIES[Math.floor((turn - 1) / 2)]!, false);
  }
  return g;
}

describe('LocalBackend (gleiche Semantik wie der Server)', () => {
  it('lehnt ungültige Einsätze ab und erstellt keine Partie', async () => {
    const { b, roomId } = await setup();
    for (const stake of [0, 150, 300, 1000]) {
      expect(await code(b.createGame(roomId, stake as never, crypto.randomUUID()))).toBe('invalid_stake');
    }
    expect((await b.getRoomSnapshot(roomId)).games).toHaveLength(0);
  });

  it('Doppelklick mit gleichem Schlüssel erzeugt genau eine Partie', async () => {
    const { b, roomId } = await setup();
    const key = crypto.randomUUID();
    const [a, c] = await Promise.all([b.createGame(roomId, 200, key), b.createGame(roomId, 200, key)]);
    expect(a.id).toBe(c.id);
    expect((await b.getRoomSnapshot(roomId)).games).toHaveLength(1);
    expect(await code(b.createGame(roomId, 200, crypto.randomUUID()))).toBe('active_game_exists');
  });

  it('rechnet genau einmal ab und belastet den Verlierer mit dem gespeicherten Einsatz', async () => {
    const { b, roomId, maxi, franzi } = await setup();
    const g0 = await b.createGame(roomId, 500, crypto.randomUUID());
    await playAll(b, g0.id, (pid) => (pid === maxi.id ? [6, 6, 6, 6, 5] : [1, 1, 2, 2, 3]));
    const g = await b.finishGame(g0.id);
    await b.finishGame(g0.id);
    expect(g).toMatchObject({ status: 'finished', winnerPlayerId: maxi.id, stakeCents: 500 });
    const ledger = (await b.getRoomSnapshot(roomId)).ledger;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ playerId: franzi.id, amountCents: 500, type: 'game_loss' });
  });

  it('Unentschieden ohne Buchung; unvollständige Partie nicht abschließbar', async () => {
    const { b, roomId } = await setup();
    const g0 = await b.createGame(roomId, 100, crypto.randomUUID());
    expect(await code(b.finishGame(g0.id))).toBe('game_incomplete');
    await playAll(b, g0.id, () => [3, 3, 3, 4, 4]);
    const g = await b.finishGame(g0.id);
    expect(g).toMatchObject({ isDraw: true, settlementStatus: 'no_charge' });
    expect((await b.getRoomSnapshot(roomId)).ledger).toHaveLength(0);
  });

  it('veraltete Versionen werden abgelehnt (zweites Gerät)', async () => {
    const { b, roomId } = await setup();
    const g = await b.createGame(roomId, 200, crypto.randomUUID());
    await b.confirmRoll(g.id, g.version, 1, [1, 2, 3, 4, 5], NONE);
    expect(await code(b.confirmRoll(g.id, g.version, 1, [1, 2, 3, 4, 6], [true, true, true, true, false]))).toBe('stale_version');
  });

  it('Zahlungen sind idempotent; Korrekturen brauchen einen Grund', async () => {
    const { b, roomId, maxi } = await setup();
    const key = crypto.randomUUID();
    await b.recordPayment(roomId, maxi.id, 250, 'bar', key);
    await b.recordPayment(roomId, maxi.id, 250, 'bar', key);
    expect((await b.getRoomSnapshot(roomId)).ledger).toHaveLength(1);
    expect(await code(b.recordPayment(roomId, maxi.id, 0, null, crypto.randomUUID()))).toBe('invalid_amount');
    expect(await code(b.recordAdjustment(roomId, maxi.id, 100, '', null, crypto.randomUUID()))).toBe('reason_required');
  });

  it('fehlgeschlagene Vorgänge verändern den Speicher nicht', async () => {
    const { b, roomId } = await setup();
    const g = await b.createGame(roomId, 200, crypto.randomUUID());
    const before = JSON.stringify(await b.getGameDetail(g.id));
    expect(await code(b.scoreTurn(g.id, g.version, 1, 'chance', false))).toBe('no_roll');
    expect(await code(b.confirmRoll(g.id, g.version, 1, [1, 2, 3, 4, 9], NONE))).toBe('invalid_dice');
    expect(JSON.stringify(await b.getGameDetail(g.id))).toBe(before);
  });
});

describe('LocalBackend – Folgekorrektur', () => {
  it('Korrektur des Kniffel-Felds bewertet spätere Kniffel neu', async () => {
    const { b, roomId } = await setup();
    let g = await b.createGame(roomId, 200, crypto.randomUUID());
    const a = g.startingPlayerId;
    const step = async (dice: number[], cat: Parameters<LocalBackend['scoreTurn']>[3], strike = false) => {
      g = await b.confirmRoll(g.id, g.version, g.currentTurn, dice, NONE);
      g = await b.scoreTurn(g.id, g.version, g.currentTurn, cat, strike);
    };
    await step([3, 3, 3, 3, 3], 'kniffel', true);
    await step([1, 1, 2, 2, 3], 'chance');
    await step([4, 4, 4, 4, 4], 'large_straight');
    g = await b.correctScore(g.id, g.version, a, 'kniffel', [3, 3, 3, 3, 3], false, 'Versehentlich gestrichen');
    const scores = (await b.getGameDetail(g.id)).scores.filter((s) => s.playerId === a);
    expect(scores.find((s) => s.category === 'large_straight')).toMatchObject({ points: 40, joker: true, kniffelBonus: 50 });
  });

  it('vollständige Partie kann nicht abgebrochen werden', async () => {
    const { b, roomId } = await setup();
    const g0 = await b.createGame(roomId, 100, crypto.randomUUID());
    await playAll(b, g0.id, () => [3, 3, 3, 4, 4]);
    expect(await code(b.cancelGame(g0.id, 'Kein Bock'))).toBe('game_complete');
  });
});

describe('LocalBackend – Datensicherung', () => {
  it('exportiert und stellt den vollständigen Stand wieder her', async () => {
    const { b, roomId, maxi } = await setup();
    await b.createGame(roomId, 500, crypto.randomUUID());
    await b.recordPayment(roomId, maxi.id, 300, 'bar', crypto.randomUUID());
    const backup = b.exportData();
    const fresh = new LocalBackend(mem());
    await fresh.init();
    expect(fresh.importData(backup)).toEqual({ games: 1, ledger: 1 });
    const snap = await fresh.getRoomSnapshot(roomId);
    expect(snap.active?.game.stakeCents).toBe(500);
    expect(snap.ledger[0]).toMatchObject({ amountCents: -300, type: 'payment' });
  });

  it('weist ungültige oder manipulierte Dateien ab', async () => {
    const { b } = await setup();
    expect(() => b.importData('kein json')).toThrow(BackendError);
    expect(() => b.importData(JSON.stringify({ format: 'anderes', data: {} }))).toThrow(BackendError);
    const tampered = JSON.parse(b.exportData());
    tampered.data.games = [{ stake_amount_cents: 300 }];
    expect(() => b.importData(JSON.stringify(tampered))).toThrow(BackendError);
  });
});
