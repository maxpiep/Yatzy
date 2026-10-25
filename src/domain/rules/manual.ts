import { UPPER_CATEGORIES, type Category, type Scorecard } from '../types';
import type { Ruleset } from './ruleset';
import { RuleError, type ScoreResult } from './scoring';

/**
 * Direkteingabe wie auf dem Papierblock: Gewürfelt wird mit echten Würfeln, eingetragen wird
 * nur der Wert eines Feldes. Diese Funktionen legen fest, welche Werte je Feld möglich sind,
 * und prüfen Zusatz-Kniffel (+50) samt Joker.
 */

const UPPER_FACE: Record<string, number> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
const SUM_CATEGORIES = new Set<Category>(['three_kind', 'four_kind', 'chance']);

export type ManualKind = 'count' | 'sum' | 'fixed';

export interface ManualOption {
  points: number;
  /** Beschriftung, z. B. „3 Einser“ oder „25“. */
  label: string;
  /** Nur für den oberen Block: Anzahl der Würfel mit dieser Augenzahl. */
  count?: number;
}

export function isUpper(category: Category): boolean {
  return (UPPER_CATEGORIES as readonly string[]).includes(category);
}

export function manualKind(category: Category): ManualKind {
  if (isUpper(category)) return 'count';
  if (SUM_CATEGORIES.has(category)) return 'sum';
  return 'fixed';
}

/** Alle möglichen Werte > 0 eines Feldes (0 = Streichen ist immer zusätzlich möglich). */
export function manualOptions(category: Category, ruleset: Ruleset): ManualOption[] {
  const kind = manualKind(category);
  if (kind === 'count') {
    const face = UPPER_FACE[category]!;
    return [1, 2, 3, 4, 5].map((count) => ({ points: count * face, count, label: String(count) }));
  }
  if (kind === 'sum') {
    return Array.from({ length: 26 }, (_, i) => ({ points: i + 5, label: String(i + 5) }));
  }
  const fixed = ruleset.fixedScores[category as keyof Ruleset['fixedScores']];
  return [{ points: fixed, label: String(fixed) }];
}

/** Ist ein weiterer Kniffel (+50) für diesen Spieler in diesem Feld überhaupt möglich? */
export function extraKniffelAllowed(category: Category, scorecard: Scorecard, ruleset: Ruleset): boolean {
  if (category === 'kniffel') return false;
  const k = scorecard.kniffel;
  if (!k) return false;
  return ruleset.extraKniffelRequiresScoredKniffel ? k.kind === 'scored' && k.points === ruleset.fixedScores.kniffel : true;
}

/**
 * Prüft einen direkt eingetragenen Wert. Bei einem weiteren Kniffel gilt die Joker-Regel:
 * das Feld darf mit dem gewählten Wert belegt werden (Höchstwerte sind in den Optionen enthalten).
 */
export function manualScore(
  category: Category,
  points: number,
  extraKniffel: boolean,
  scorecard: Scorecard,
  ruleset: Ruleset,
  opts: { ignoreTaken?: boolean } = {},
): ScoreResult {
  if (!opts.ignoreTaken && scorecard[category]) throw new RuleError('category_taken', 'Dieses Feld ist bereits belegt.');
  if (!Number.isInteger(points) || (points !== 0 && !manualOptions(category, ruleset).some((o) => o.points === points))) {
    throw new RuleError('invalid_dice', 'Dieser Wert ist für dieses Feld nicht möglich.');
  }
  if (extraKniffel && !extraKniffelAllowed(category, scorecard, ruleset)) {
    throw new RuleError('invalid_dice', 'Zusatzpunkte gibt es nur, wenn das Kniffel-Feld bereits mit 50 Punkten belegt ist.');
  }
  return {
    category,
    points,
    // Joker: Fester Wert bzw. Höchstwert durch einen weiteren Kniffel.
    joker: extraKniffel && points > 0 && category !== 'kniffel',
    kniffelBonus: extraKniffel ? ruleset.extraKniffelBonus : 0,
  };
}
