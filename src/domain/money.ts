import { STAKE_OPTIONS_CENTS, type StakeCents } from './types';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Formatiert ganze Cent ohne Fließkomma-Rechnung (Division nur für die Anzeige). */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Betrag muss in ganzen Cent vorliegen.');
  return euro.format(cents / 100);
}

export function formatSignedCents(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? '+' : '−'}${formatCents(Math.abs(cents))}`;
}

export function isValidStake(value: unknown): value is StakeCents {
  return typeof value === 'number' && (STAKE_OPTIONS_CENTS as readonly number[]).includes(value);
}

export const MAX_AMOUNT_CENTS = 1_000_000;

/**
 * Wandelt eine Euro-Eingabe wie „12“, „12,5“, „12,50“ oder „12.50“ in ganze Cent um –
 * rein über Zeichenketten, ohne Fließkomma-Arithmetik. Gibt `null` bei ungültiger Eingabe zurück.
 */
export function parseEuroToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s|€/g, '');
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const euros = Number.parseInt(match[1] ?? '0', 10);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = euros * 100 + Number.parseInt(fraction || '0', 10);
  return Number.isSafeInteger(cents) ? cents : null;
}
