import { describe, expect, it } from 'vitest';
import { formatCents, formatSignedCents, isValidStake, parseEuroToCents } from './money';

describe('Geldbeträge', () => {
  it('formatiert Cent als Euro (de-DE)', () => {
    expect(formatCents(200).replace(/\s/g, ' ')).toBe('2,00 €');
    expect(formatCents(1).replace(/\s/g, ' ')).toBe('0,01 €');
    expect(formatSignedCents(-150).replace(/\s/g, ' ')).toBe('−1,50 €');
  });

  it('akzeptiert nur 100, 200 und 500 Cent als Einsatz', () => {
    expect([100, 200, 500].every(isValidStake)).toBe(true);
    expect([0, 1, 150, 300, 1000, -100, 2, '200', 2.0001].some(isValidStake)).toBe(false);
  });

  it('wandelt Euro-Eingaben centgenau ohne Fließkomma um', () => {
    expect(parseEuroToCents('12')).toBe(1200);
    expect(parseEuroToCents('12,5')).toBe(1250);
    expect(parseEuroToCents('0,10')).toBe(10);
    expect(parseEuroToCents('0.29')).toBe(29);
    expect(parseEuroToCents('1,005')).toBeNull();
    expect(parseEuroToCents('-3')).toBeNull();
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents(' 7,00 € ')).toBe(700);
  });

  it('0,1 + 0,2 wird centgenau summiert', () => {
    expect(parseEuroToCents('0,1')! + parseEuroToCents('0,2')!).toBe(30);
  });
});
