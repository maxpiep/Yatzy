import {
  CATEGORIES,
  LOWER_CATEGORIES,
  UPPER_CATEGORIES,
  type Category,
  type Dice,
  type DieValue,
  type ScoreEntry,
  type Scorecard,
  type UpperCategory,
} from '../types';
import type { Ruleset } from './ruleset';

export class RuleError extends Error {
  constructor(
    public readonly code: 'invalid_dice' | 'invalid_category' | 'category_taken',
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

const UPPER_FACE: Record<UpperCategory, DieValue> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
};

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isUpperCategory(category: Category): category is UpperCategory {
  return (UPPER_CATEGORIES as readonly string[]).includes(category);
}

export function isDieValue(value: unknown): value is DieValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

/** Wirft `RuleError`, wenn nicht genau fünf ganzzahlige Werte von 1 bis 6 vorliegen. */
export function validateDice(dice: readonly unknown[], diceCount = 5): asserts dice is Dice {
  if (!Array.isArray(dice) || dice.length !== diceCount) {
    throw new RuleError('invalid_dice', `Es müssen genau ${diceCount} Würfel eingetragen werden.`);
  }
  if (!dice.every(isDieValue)) {
    throw new RuleError('invalid_dice', 'Jeder Würfel muss einen Wert von 1 bis 6 haben.');
  }
}

/** Häufigkeit je Augenzahl, Index 1–6 (Index 0 ungenutzt). */
export function countFaces(dice: Dice): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d] = (counts[d] ?? 0) + 1;
  return counts;
}

export function sumDice(dice: Dice): number {
  return dice.reduce<number>((acc, d) => acc + d, 0);
}

export function isKniffel(dice: Dice): boolean {
  return dice.length > 0 && dice.every((d) => d === dice[0]);
}

function hasRun(counts: number[], from: number, length: number): boolean {
  for (let face = from; face < from + length; face++) {
    if ((counts[face] ?? 0) === 0) return false;
  }
  return true;
}

/** Reine Kategorie-Wertung ohne Joker-/Zusatzregeln. */
export function baseScore(dice: Dice, category: Category, ruleset: Ruleset): number {
  validateDice(dice, ruleset.diceCount);
  const counts = countFaces(dice);
  const maxCount = Math.max(...counts);
  const total = sumDice(dice);

  if (isUpperCategory(category)) {
    const face = UPPER_FACE[category];
    return (counts[face] ?? 0) * face;
  }

  switch (category) {
    case 'three_kind':
      return maxCount >= 3 ? total : 0;
    case 'four_kind':
      return maxCount >= 4 ? total : 0;
    case 'full_house': {
      const isFullHouse = counts.includes(3) && counts.includes(2);
      const kniffelAsFullHouse = ruleset.kniffelCountsAsFullHouse && maxCount === 5;
      return isFullHouse || kniffelAsFullHouse ? ruleset.fixedScores.full_house : 0;
    }
    case 'small_straight':
      return hasRun(counts, 1, 4) || hasRun(counts, 2, 4) || hasRun(counts, 3, 4)
        ? ruleset.fixedScores.small_straight
        : 0;
    case 'large_straight':
      return hasRun(counts, 1, 5) || hasRun(counts, 2, 5) ? ruleset.fixedScores.large_straight : 0;
    case 'kniffel':
      return maxCount === 5 ? ruleset.fixedScores.kniffel : 0;
    case 'chance':
      return total;
    default:
      throw new RuleError('invalid_category', `Unbekannte Kategorie: ${String(category)}`);
  }
}

/** Ein weiterer Kniffel liegt vor, wenn 5 gleiche gewürfelt wurden und das Kniffel-Feld bereits 50 Punkte hat. */
export function isExtraKniffel(dice: Dice, scorecard: Scorecard, ruleset: Ruleset): boolean {
  if (!isKniffel(dice)) return false;
  const kniffelEntry = scorecard.kniffel;
  if (!kniffelEntry) return false;
  if (ruleset.extraKniffelRequiresScoredKniffel) {
    return kniffelEntry.kind === 'scored' && kniffelEntry.points === ruleset.fixedScores.kniffel;
  }
  return true;
}

export interface ScoreResult {
  category: Category;
  points: number;
  joker: boolean;
  kniffelBonus: number;
}

/**
 * Zentrale Wertungsfunktion: Punkte für `dice` in `category` unter Berücksichtigung der
 * bereits belegten Felder (`scorecard`), Zusatz-Kniffel und Joker-Regel.
 */
export function calculateScore(
  dice: Dice,
  category: Category,
  scorecard: Scorecard,
  ruleset: Ruleset,
): ScoreResult {
  validateDice(dice, ruleset.diceCount);
  if (!isCategory(category)) throw new RuleError('invalid_category', 'Unbekannte Kategorie.');
  if (scorecard[category]) {
    throw new RuleError('category_taken', 'Dieses Feld ist bereits belegt.');
  }
  const base = baseScore(dice, category, ruleset);
  if (!isExtraKniffel(dice, scorecard, ruleset)) {
    return { category, points: base, joker: false, kniffelBonus: 0 };
  }
  const kniffelBonus = ruleset.extraKniffelBonus;
  if (ruleset.jokerMode === 'free-choice-max') {
    const points = Math.max(base, ruleset.maxScores[category]);
    return { category, points, joker: points > base, kniffelBonus };
  }
  return { category, points: base, joker: false, kniffelBonus };
}

/** Wertung beim bewussten Streichen: 0 Punkte, Zusatzpunkte eines weiteren Kniffels bleiben erhalten. */
export function strikeScore(dice: Dice, category: Category, scorecard: Scorecard, ruleset: Ruleset): ScoreResult {
  validateDice(dice, ruleset.diceCount);
  if (scorecard[category]) throw new RuleError('category_taken', 'Dieses Feld ist bereits belegt.');
  return {
    category,
    points: 0,
    joker: false,
    kniffelBonus: isExtraKniffel(dice, scorecard, ruleset) ? ruleset.extraKniffelBonus : 0,
  };
}

/** Vorschau aller offenen Felder für den aktuellen Wurf. */
export function scoreOptions(dice: Dice, scorecard: Scorecard, ruleset: Ruleset): ScoreResult[] {
  return CATEGORIES.filter((c) => !scorecard[c]).map((c) => calculateScore(dice, c, scorecard, ruleset));
}

export interface ScoreTotals {
  upperSubtotal: number;
  upperBonus: number;
  /** Fehlende Punkte bis zum Bonus (0, wenn erreicht). */
  upperBonusMissing: number;
  upperTotal: number;
  lowerTotal: number;
  extraKniffelBonus: number;
  extraKniffelCount: number;
  total: number;
  filled: number;
  complete: boolean;
}

export function computeTotals(scorecard: Scorecard, ruleset: Ruleset): ScoreTotals {
  const points = (c: Category) => scorecard[c]?.points ?? 0;
  const upperSubtotal = UPPER_CATEGORIES.reduce((acc, c) => acc + points(c), 0);
  const upperBonus = upperSubtotal >= ruleset.upperBonusThreshold ? ruleset.upperBonus : 0;
  const lowerTotal = LOWER_CATEGORIES.reduce((acc, c) => acc + points(c), 0);
  const entries = Object.values(scorecard).filter((e): e is ScoreEntry => Boolean(e));
  const extraKniffelBonus = entries.reduce((acc, e) => acc + e.kniffelBonus, 0);
  const filled = entries.length;
  return {
    upperSubtotal,
    upperBonus,
    upperBonusMissing: Math.max(0, ruleset.upperBonusThreshold - upperSubtotal),
    upperTotal: upperSubtotal + upperBonus,
    lowerTotal,
    extraKniffelBonus,
    extraKniffelCount: entries.filter((e) => e.kniffelBonus > 0).length,
    total: upperSubtotal + upperBonus + lowerTotal + extraKniffelBonus,
    filled,
    complete: filled === CATEGORIES.length,
  };
}

export function isScorecardComplete(scorecard: Scorecard): boolean {
  return CATEGORIES.every((c) => Boolean(scorecard[c]));
}
