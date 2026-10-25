import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from './types';
import { balanceForPlayer, filterLedger, summarizeLedger } from './ledger';

let n = 0;
const e = (playerId: string, amountCents: number, type: LedgerEntry['type'], createdAt = '2026-10-01T12:00:00Z'): LedgerEntry => ({
  id: `e${++n}`,
  roomId: 'r',
  playerId,
  amountCents,
  type,
  description: '',
  createdAt,
  gameId: type === 'game_loss' ? `g${n}` : null,
  idempotencyKey: `k${n}`,
  correctsEntryId: null,
});

describe('Kassenbuch-Salden', () => {
  it('Einsätze erhöhen, Zahlungen senken, Korrekturen verändern den Saldo', () => {
    const entries = [e('maxi', 200, 'game_loss'), e('maxi', 500, 'game_loss'), e('maxi', -300, 'payment'), e('maxi', -100, 'adjustment'), e('franzi', 100, 'game_loss')];
    expect(balanceForPlayer(entries, 'maxi')).toMatchObject({
      balanceCents: 300,
      openCents: 300,
      creditCents: 0,
      stakesCents: 700,
      paymentsCents: 300,
      adjustmentsCents: -100,
    });
    const s = summarizeLedger(entries, ['maxi', 'franzi']);
    expect(s.totalOpenCents).toBe(400);
    expect(s.totalStakesCents).toBe(800);
  });

  it('Überzahlung wird als Guthaben ausgewiesen, nicht verworfen', () => {
    const entries = [e('franzi', 100, 'game_loss'), e('franzi', -500, 'payment')];
    expect(balanceForPlayer(entries, 'franzi')).toMatchObject({ balanceCents: -400, openCents: 0, creditCents: 400 });
  });

  it('filtert nach Person, Typ und Zeitraum', () => {
    const entries = [
      e('maxi', 200, 'game_loss', '2026-09-30T10:00:00'),
      e('maxi', -200, 'payment', '2026-10-02T10:00:00'),
      e('franzi', 500, 'game_loss', '2026-10-03T10:00:00'),
    ];
    expect(filterLedger(entries, { playerId: 'maxi' })).toHaveLength(2);
    expect(filterLedger(entries, { type: 'game_loss' })).toHaveLength(2);
    expect(filterLedger(entries, { from: '2026-10-01', to: '2026-10-02' })).toHaveLength(1);
  });
});
