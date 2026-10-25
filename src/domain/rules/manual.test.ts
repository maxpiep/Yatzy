import { describe, expect, it } from 'vitest';
import type { Scorecard } from '../types';
import { SCHMIDT_RULESET as R } from './ruleset';
import { RuleError } from './scoring';
import { extraKniffelAllowed, jokerPoints, manualKind, manualOptions, manualScore } from './manual';

const kniffel50: Scorecard = { kniffel: { category: 'kniffel', kind: 'scored', points: 50, dice: [], joker: false, kniffelBonus: 0, turnNo: 1 } };
const kniffel0: Scorecard = { kniffel: { category: 'kniffel', kind: 'struck', points: 0, dice: [], joker: false, kniffelBonus: 0, turnNo: 1 } };

describe('Direkteingabe – mögliche Werte', () => {
  it('oberer Block: 1–5 Würfel × Augenzahl', () => {
    expect(manualOptions('ones', R).map((o) => o.points)).toEqual([1, 2, 3, 4, 5]);
    expect(manualOptions('sixes', R).map((o) => o.points)).toEqual([6, 12, 18, 24, 30]);
    expect(manualOptions('fours', R)[2]).toMatchObject({ count: 3, points: 12 });
  });

  it('Pasch und Chance: Summe 5–30', () => {
    for (const c of ['three_kind', 'four_kind', 'chance'] as const) {
      expect(manualKind(c)).toBe('sum');
      const pts = manualOptions(c, R).map((o) => o.points);
      expect(pts[0]).toBe(5);
      expect(pts.at(-1)).toBe(30);
      expect(pts).toHaveLength(26);
    }
  });

  it('feste Werte: Full House 25, Straßen 30/40, Kniffel 50', () => {
    expect(manualOptions('full_house', R)).toEqual([{ points: 25, label: '25' }]);
    expect(manualOptions('small_straight', R)[0]!.points).toBe(30);
    expect(manualOptions('large_straight', R)[0]!.points).toBe(40);
    expect(manualOptions('kniffel', R)[0]!.points).toBe(50);
  });
});

describe('Direkteingabe – Prüfung', () => {
  it('akzeptiert gültige Werte und Streichen', () => {
    expect(manualScore('threes', 9, false, {}, R)).toMatchObject({ points: 9, joker: false, kniffelBonus: 0 });
    expect(manualScore('full_house', 0, false, {}, R)).toMatchObject({ points: 0 });
    expect(manualScore('chance', 23, false, {}, R).points).toBe(23);
  });

  it('lehnt unmögliche Werte ab', () => {
    for (const [c, p] of [['ones', 6], ['twos', 3], ['full_house', 20], ['chance', 4], ['chance', 31], ['kniffel', 40], ['sixes', 1.5]] as const) {
      expect(() => manualScore(c, p, false, {}, R)).toThrow(RuleError);
    }
  });

  it('belegte Felder können nicht erneut gewertet werden', () => {
    expect(() => manualScore('kniffel', 50, false, kniffel50, R)).toThrow(/bereits belegt/);
  });

  it('weiterer Kniffel nur bei Kniffel-Feld mit 50, gibt +50 und Joker', () => {
    expect(extraKniffelAllowed('fives', kniffel50, R)).toBe(true);
    expect(extraKniffelAllowed('fives', kniffel0, R)).toBe(false);
    expect(extraKniffelAllowed('fives', {}, R)).toBe(false);
    expect(manualScore('large_straight', 40, true, kniffel50, R)).toEqual({ category: 'large_straight', points: 40, joker: true, kniffelBonus: 50 });
    expect(manualScore('ones', 0, true, kniffel50, R)).toMatchObject({ points: 0, joker: false, kniffelBonus: 50 });
    expect(() => manualScore('fives', 25, true, kniffel0, R)).toThrow(/Zusatzpunkte/);
  });
});

describe('Joker-Punkte eines weiteren Kniffels', () => {
  it('oberer Block: nur das passende Feld zählt', () => {
    expect(jokerPoints('threes', 3, R)).toBe(15);
    expect(jokerPoints('sixes', 3, R)).toBe(0);
    expect(jokerPoints('ones', 1, R)).toBe(5);
  });

  it('Pasch und Chance: Augensumme statt Höchstwert', () => {
    expect(jokerPoints('three_kind', 3, R)).toBe(15);
    expect(jokerPoints('four_kind', 6, R)).toBe(30);
    expect(jokerPoints('chance', 1, R)).toBe(5);
  });

  it('Full House und Straßen: fester Wert, unabhängig von der Augenzahl', () => {
    expect(jokerPoints('full_house', 2, R)).toBe(25);
    expect(jokerPoints('small_straight', 4, R)).toBe(30);
    expect(jokerPoints('large_straight', 1, R)).toBe(40);
  });

  it('jeder Joker-Wert ist ein gültiger Eintrag', () => {
    for (const c of ['ones', 'fives', 'three_kind', 'chance', 'full_house', 'large_straight'] as const) {
      for (let face = 1; face <= 6; face++) {
        expect(() => manualScore(c, jokerPoints(c, face, R), true, kniffel50, R)).not.toThrow();
      }
    }
  });
});
