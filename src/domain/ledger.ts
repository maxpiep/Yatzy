import type { LedgerEntry, LedgerEntryType } from './types';

export interface PlayerBalance {
  playerId: string;
  /** Saldo: > 0 offener Betrag, < 0 Guthaben (Überzahlung). */
  balanceCents: number;
  openCents: number;
  creditCents: number;
  stakesCents: number;
  paymentsCents: number;
  adjustmentsCents: number;
}

export function balanceForPlayer(entries: readonly LedgerEntry[], playerId: string): PlayerBalance {
  let stakes = 0;
  let payments = 0;
  let adjustments = 0;
  for (const e of entries) {
    if (e.playerId !== playerId) continue;
    if (!Number.isSafeInteger(e.amountCents)) throw new Error('Ungültiger Buchungsbetrag.');
    if (e.type === 'game_loss') stakes += e.amountCents;
    else if (e.type === 'payment') payments += -e.amountCents;
    else adjustments += e.amountCents;
  }
  const balance = stakes - payments + adjustments;
  return {
    playerId,
    balanceCents: balance,
    openCents: Math.max(0, balance),
    creditCents: Math.max(0, -balance),
    stakesCents: stakes,
    paymentsCents: payments,
    adjustmentsCents: adjustments,
  };
}

export interface LedgerSummary {
  balances: Record<string, PlayerBalance>;
  totalOpenCents: number;
  totalStakesCents: number;
  totalPaymentsCents: number;
  totalAdjustmentsCents: number;
}

export function summarizeLedger(entries: readonly LedgerEntry[], playerIds: readonly string[]): LedgerSummary {
  const balances: Record<string, PlayerBalance> = {};
  for (const id of playerIds) balances[id] = balanceForPlayer(entries, id);
  const all = Object.values(balances);
  return {
    balances,
    totalOpenCents: all.reduce((a, b) => a + b.openCents, 0),
    totalStakesCents: all.reduce((a, b) => a + b.stakesCents, 0),
    totalPaymentsCents: all.reduce((a, b) => a + b.paymentsCents, 0),
    totalAdjustmentsCents: all.reduce((a, b) => a + b.adjustmentsCents, 0),
  };
}

export interface LedgerFilter {
  playerId?: string | 'all';
  type?: LedgerEntryType | 'all';
  /** ISO-Datum (inklusive), z. B. 2026-10-01 */
  from?: string;
  /** ISO-Datum (inklusive) */
  to?: string;
}

export function filterLedger(entries: readonly LedgerEntry[], filter: LedgerFilter): LedgerEntry[] {
  const fromTs = filter.from ? new Date(`${filter.from}T00:00:00`).getTime() : null;
  const toTs = filter.to ? new Date(`${filter.to}T23:59:59.999`).getTime() : null;
  return entries.filter((e) => {
    if (filter.playerId && filter.playerId !== 'all' && e.playerId !== filter.playerId) return false;
    if (filter.type && filter.type !== 'all' && e.type !== filter.type) return false;
    const ts = new Date(e.createdAt).getTime();
    if (fromTs !== null && ts < fromTs) return false;
    if (toTs !== null && ts > toTs) return false;
    return true;
  });
}

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  game_loss: 'Einsatz',
  payment: 'Zahlung',
  adjustment: 'Korrektur',
};
