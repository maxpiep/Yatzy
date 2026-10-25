import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category, type Dice, type ScoreEntry, type Scorecard } from '../types';
import { SCHMIDT_RULESET as R } from './ruleset';
import {
  RuleError,
  baseScore,
  calculateScore,
  computeTotals,
  isExtraKniffel,
  isKniffel,
  scoreOptions,
  strikeScore,
  validateDice,
} from './scoring';

const d = (...v: number[]) => v as unknown as Dice;
const entry = (category: Category, points: number, kind: ScoreEntry['kind'] = points > 0 ? 'scored' : 'struck'): ScoreEntry => ({
  category,
  kind,
  points,
  dice: d(1, 2, 3, 4, 5),
  joker: false,
  kniffelBonus: 0,
  turnNo: 1,
});

describe('oberer Block', () => {
  it.each([
    ['ones', d(1, 1, 2, 3, 1), 3],
    ['twos', d(2, 2, 2, 2, 6), 8],
    ['threes', d(3, 1, 3, 6, 6), 6],
    ['fours', d(4, 4, 4, 4, 4), 20],
    ['fives', d(5, 1, 2, 3, 4), 5],
    ['sixes', d(6, 6, 6, 1, 1), 18],
    ['sixes', d(1, 2, 3, 4, 5), 0],
  ] as const)('%s mit %j = %i', (cat, dice, expected) => {
    expect(baseScore(dice, cat, R)).toBe(expected);
  });
});

describe('unterer Block', () => {
  it('Dreierpasch: Summe aller Würfel bei mind. 3 gleichen', () => {
    expect(baseScore(d(3, 3, 3, 5, 6), 'three_kind', R)).toBe(20);
    expect(baseScore(d(3, 3, 3, 3, 6), 'three_kind', R)).toBe(18);
    expect(baseScore(d(6, 6, 6, 6, 6), 'three_kind', R)).toBe(30);
    expect(baseScore(d(3, 3, 2, 5, 6), 'three_kind', R)).toBe(0);
  });

  it('Viererpasch: Summe aller Würfel bei mind. 4 gleichen', () => {
    expect(baseScore(d(2, 2, 2, 2, 6), 'four_kind', R)).toBe(14);
    expect(baseScore(d(5, 5, 5, 5, 5), 'four_kind', R)).toBe(25);
    expect(baseScore(d(2, 2, 2, 6, 6), 'four_kind', R)).toBe(0);
  });

  it('Full House: 3 + 2 gleiche = 25', () => {
    expect(baseScore(d(2, 2, 3, 3, 3), 'full_house', R)).toBe(25);
    expect(baseScore(d(6, 1, 6, 1, 6), 'full_house', R)).toBe(25);
    expect(baseScore(d(2, 2, 3, 3, 4), 'full_house', R)).toBe(0);
    expect(baseScore(d(2, 2, 2, 2, 3), 'full_house', R)).toBe(0);
  });

  it('Full House: ein Kniffel zählt ohne Joker nicht als Full House (Schmidt-Auslegung)', () => {
    expect(baseScore(d(4, 4, 4, 4, 4), 'full_house', R)).toBe(0);
    expect(baseScore(d(4, 4, 4, 4, 4), 'full_house', { ...R, kniffelCountsAsFullHouse: true })).toBe(25);
  });

  it('Kleine Straße: 4 aufeinanderfolgende Werte = 30', () => {
    expect(baseScore(d(1, 2, 3, 4, 6), 'small_straight', R)).toBe(30);
    expect(baseScore(d(2, 3, 4, 5, 5), 'small_straight', R)).toBe(30);
    expect(baseScore(d(6, 5, 4, 3, 1), 'small_straight', R)).toBe(30);
    expect(baseScore(d(1, 2, 3, 4, 5), 'small_straight', R)).toBe(30);
    expect(baseScore(d(1, 2, 3, 5, 6), 'small_straight', R)).toBe(0);
    expect(baseScore(d(1, 1, 2, 2, 3), 'small_straight', R)).toBe(0);
  });

  it('Große Straße: 5 aufeinanderfolgende Werte = 40', () => {
    expect(baseScore(d(1, 2, 3, 4, 5), 'large_straight', R)).toBe(40);
    expect(baseScore(d(6, 2, 5, 3, 4), 'large_straight', R)).toBe(40);
    expect(baseScore(d(1, 2, 3, 4, 6), 'large_straight', R)).toBe(0);
    expect(baseScore(d(1, 3, 4, 5, 6), 'large_straight', R)).toBe(0);
  });

  it('Kniffel: 5 gleiche = 50', () => {
    expect(baseScore(d(1, 1, 1, 1, 1), 'kniffel', R)).toBe(50);
    expect(baseScore(d(1, 1, 1, 1, 2), 'kniffel', R)).toBe(0);
    expect(isKniffel(d(6, 6, 6, 6, 6))).toBe(true);
  });

  it('Chance: Summe aller Würfel', () => {
    expect(baseScore(d(1, 2, 3, 4, 6), 'chance', R)).toBe(16);
    expect(baseScore(d(6, 6, 6, 6, 6), 'chance', R)).toBe(30);
  });
});

describe('Würfelvalidierung', () => {
  it.each([
    [[1, 2, 3, 4]],
    [[1, 2, 3, 4, 5, 6]],
    [[0, 2, 3, 4, 5]],
    [[7, 2, 3, 4, 5]],
    [[1.5, 2, 3, 4, 5]],
    [['1', 2, 3, 4, 5]],
    [[]],
  ])('lehnt %j ab', (dice) => {
    expect(() => validateDice(dice)).toThrow(RuleError);
    expect(() => calculateScore(dice as unknown as Dice, 'chance', {}, R)).toThrow(RuleError);
  });
});

describe('Bonus im oberen Block', () => {
  const upper = (values: number[]): Scorecard => {
    const cats: Category[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
    return Object.fromEntries(cats.map((c, i) => [c, entry(c, values[i]!)]));
  };

  it('genau 63 Punkte ergeben 35 Bonuspunkte', () => {
    const t = computeTotals(upper([3, 6, 9, 12, 15, 18]), R);
    expect(t.upperSubtotal).toBe(63);
    expect(t.upperBonus).toBe(35);
    expect(t.upperTotal).toBe(98);
    expect(t.upperBonusMissing).toBe(0);
  });

  it('62 Punkte ergeben keinen Bonus', () => {
    const t = computeTotals(upper([2, 6, 9, 12, 15, 18]), R);
    expect(t.upperSubtotal).toBe(62);
    expect(t.upperBonus).toBe(0);
    expect(t.upperBonusMissing).toBe(1);
  });
});

describe('belegte und gestrichene Felder', () => {
  it('ein belegtes Feld kann nicht erneut gewertet werden', () => {
    const card: Scorecard = { chance: entry('chance', 20) };
    expect(() => calculateScore(d(1, 2, 3, 4, 5), 'chance', card, R)).toThrow(/bereits belegt/);
  });

  it('ein gestrichenes Feld kann nicht erneut gewertet werden', () => {
    const card: Scorecard = { kniffel: entry('kniffel', 0, 'struck') };
    expect(() => calculateScore(d(5, 5, 5, 5, 5), 'kniffel', card, R)).toThrow(RuleError);
    expect(() => strikeScore(d(5, 5, 5, 5, 5), 'kniffel', card, R)).toThrow(RuleError);
  });

  it('Streichen ergibt 0 Punkte, auch wenn eine Wertung möglich wäre', () => {
    expect(strikeScore(d(1, 2, 3, 4, 5), 'large_straight', {}, R)).toMatchObject({ points: 0, kniffelBonus: 0 });
  });

  it('Vorschau listet nur offene Felder', () => {
    const card: Scorecard = { chance: entry('chance', 20), ones: entry('ones', 0, 'struck') };
    const options = scoreOptions(d(2, 2, 2, 3, 3), card, R);
    expect(options).toHaveLength(11);
    expect(options.find((o) => o.category === 'full_house')?.points).toBe(25);
  });
});

describe('weitere Kniffel und Joker (Schmidt-Regel)', () => {
  const withKniffel: Scorecard = { kniffel: { ...entry('kniffel', 50), dice: d(3, 3, 3, 3, 3) } };

  it('erster Kniffel wird normal gewertet, ohne Zusatzpunkte', () => {
    expect(calculateScore(d(4, 4, 4, 4, 4), 'kniffel', {}, R)).toEqual({
      category: 'kniffel',
      points: 50,
      joker: false,
      kniffelBonus: 0,
    });
  });

  it('weiterer Kniffel bringt 50 Zusatzpunkte', () => {
    expect(isExtraKniffel(d(4, 4, 4, 4, 4), withKniffel, R)).toBe(true);
    expect(calculateScore(d(4, 4, 4, 4, 4), 'fours', withKniffel, R)).toMatchObject({ points: 20, kniffelBonus: 50 });
  });

  it('Joker: beliebiges freies Feld des oberen Blocks mit Höchstpunktzahl (4er-Kniffel → 25 im 5er-Feld)', () => {
    expect(calculateScore(d(4, 4, 4, 4, 4), 'fives', withKniffel, R)).toEqual({
      category: 'fives',
      points: 25,
      joker: true,
      kniffelBonus: 50,
    });
    expect(calculateScore(d(1, 1, 1, 1, 1), 'sixes', withKniffel, R)).toMatchObject({ points: 30, joker: true });
  });

  it('Joker: unterer Block mit Höchstpunktzahl', () => {
    const dice = d(2, 2, 2, 2, 2);
    expect(calculateScore(dice, 'full_house', withKniffel, R)).toMatchObject({ points: 25, joker: true });
    expect(calculateScore(dice, 'small_straight', withKniffel, R)).toMatchObject({ points: 30, joker: true });
    expect(calculateScore(dice, 'large_straight', withKniffel, R)).toMatchObject({ points: 40, joker: true });
    expect(calculateScore(dice, 'three_kind', withKniffel, R)).toMatchObject({ points: 30, joker: true });
    expect(calculateScore(dice, 'four_kind', withKniffel, R)).toMatchObject({ points: 30, joker: true });
    expect(calculateScore(dice, 'chance', withKniffel, R)).toMatchObject({ points: 30, joker: true });
  });

  it('Sechser-Kniffel im Sechser-Feld ist keine Joker-Wertung (Normalwert = Höchstwert)', () => {
    expect(calculateScore(d(6, 6, 6, 6, 6), 'sixes', withKniffel, R)).toMatchObject({ points: 30, joker: false, kniffelBonus: 50 });
  });

  it('gestrichenes Kniffel-Feld: kein Joker, keine Zusatzpunkte', () => {
    const struck: Scorecard = { kniffel: entry('kniffel', 0, 'struck') };
    expect(isExtraKniffel(d(5, 5, 5, 5, 5), struck, R)).toBe(false);
    expect(calculateScore(d(5, 5, 5, 5, 5), 'large_straight', struck, R)).toMatchObject({ points: 0, kniffelBonus: 0 });
    expect(calculateScore(d(5, 5, 5, 5, 5), 'fives', struck, R)).toMatchObject({ points: 25, kniffelBonus: 0 });
  });

  it('Streichen mit einem weiteren Kniffel behält die Zusatzpunkte', () => {
    expect(strikeScore(d(3, 3, 3, 3, 3), 'ones', withKniffel, R)).toMatchObject({ points: 0, kniffelBonus: 50 });
  });

  it('kein Kniffel → keine Sonderwertung, auch wenn Kniffel-Feld belegt', () => {
    expect(calculateScore(d(3, 3, 3, 3, 2), 'large_straight', withKniffel, R)).toMatchObject({ points: 0, kniffelBonus: 0, joker: false });
  });

  it('Joker-Punkte im oberen Block zählen zum 63er-Bonus', () => {
    const card: Scorecard = {
      ...withKniffel,
      ones: entry('ones', 3),
      twos: entry('twos', 6),
      threes: entry('threes', 9),
      fours: entry('fours', 12),
      fives: { ...entry('fives', 25), joker: true, kniffelBonus: 50 },
      sixes: entry('sixes', 12),
    };
    const t = computeTotals(card, R);
    expect(t.upperSubtotal).toBe(67);
    expect(t.upperBonus).toBe(35);
    expect(t.extraKniffelBonus).toBe(50);
    expect(t.extraKniffelCount).toBe(1);
    expect(t.total).toBe(67 + 35 + 50 + 50);
  });

  it('mehrere weitere Kniffel summieren ihre Zusatzpunkte', () => {
    const card: Scorecard = {
      ...withKniffel,
      chance: { ...entry('chance', 30), joker: true, kniffelBonus: 50 },
      full_house: { ...entry('full_house', 25), joker: true, kniffelBonus: 50 },
    };
    expect(computeTotals(card, R)).toMatchObject({ extraKniffelBonus: 100, lowerTotal: 105, total: 205 });
  });

  it('ohne Joker-Modus gibt es nur die Zusatzpunkte', () => {
    const noJoker = { ...R, jokerMode: 'none' as const };
    expect(calculateScore(d(2, 2, 2, 2, 2), 'large_straight', withKniffel, noJoker)).toMatchObject({
      points: 0,
      kniffelBonus: 50,
      joker: false,
    });
  });
});

describe('Gesamtwertung', () => {
  it('vollständige Karte: Teilsumme, Bonus, unten, Gesamt', () => {
    const values: Record<Category, number> = {
      ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 24,
      three_kind: 22, four_kind: 0, full_house: 25, small_straight: 30, large_straight: 40, kniffel: 0, chance: 21,
    };
    const card = Object.fromEntries(CATEGORIES.map((c) => [c, entry(c, values[c])])) as Scorecard;
    const t = computeTotals(card, R);
    expect(t).toMatchObject({
      upperSubtotal: 69,
      upperBonus: 35,
      upperTotal: 104,
      lowerTotal: 138,
      extraKniffelBonus: 0,
      total: 242,
      filled: 13,
      complete: true,
    });
  });

  it('leere Karte ergibt 0', () => {
    expect(computeTotals({}, R)).toMatchObject({ total: 0, filled: 0, complete: false, upperBonusMissing: 63 });
  });
});
