import type { Category } from '../types';

/**
 * Austauschbares Regelwerk. Jede Partie speichert `rulesetId` + `rulesetVersion` als Snapshot,
 * damit spätere Regeländerungen keine historischen Partien verändern.
 *
 * Die serverseitige Implementierung (supabase/migrations/*_rules.sql) setzt exakt dieselben
 * Parameter für `kniffel-schmidt` v1 um; ein Kreuztest (tests/db/rules-parity.test.ts) prüft das.
 */
export interface Ruleset {
  id: string;
  version: number;
  name: string;
  diceCount: 5;
  maxRollsPerTurn: number;
  upperBonusThreshold: number;
  upperBonus: number;
  fixedScores: {
    full_house: number;
    small_straight: number;
    large_straight: number;
    kniffel: number;
  };
  /** Zählt ein Kniffel (5 gleiche) ohne Joker auch als Full House? */
  kniffelCountsAsFullHouse: boolean;
  /** Zusatzpunkte je weiterem Kniffel. */
  extraKniffelBonus: number;
  /**
   * Joker-Variante für weitere Kniffel:
   * - `free-choice-max`: Schmidt-Spiele-Regel – beliebiges freies Feld mit dessen Höchstpunktzahl.
   * - `none`: keine Joker-Regel.
   */
  jokerMode: 'free-choice-max' | 'none';
  /**
   * Zusatzpunkte und Joker gelten nur, wenn das Kniffel-Feld bereits mit 50 Punkten belegt ist
   * (ein gestrichenes Kniffel-Feld zählt nicht als erster Kniffel).
   */
  extraKniffelRequiresScoredKniffel: boolean;
  /** Höchstpunktzahl je Feld (für die Joker-Regel). */
  maxScores: Record<Category, number>;
}

export const SCHMIDT_RULESET: Ruleset = {
  id: 'kniffel-schmidt',
  version: 1,
  name: 'Kniffel – Schmidt Spiele (Classic Line)',
  diceCount: 5,
  maxRollsPerTurn: 3,
  upperBonusThreshold: 63,
  upperBonus: 35,
  fixedScores: { full_house: 25, small_straight: 30, large_straight: 40, kniffel: 50 },
  kniffelCountsAsFullHouse: false,
  extraKniffelBonus: 50,
  jokerMode: 'free-choice-max',
  extraKniffelRequiresScoredKniffel: true,
  maxScores: {
    ones: 5,
    twos: 10,
    threes: 15,
    fours: 20,
    fives: 25,
    sixes: 30,
    three_kind: 30,
    four_kind: 30,
    full_house: 25,
    small_straight: 30,
    large_straight: 40,
    kniffel: 50,
    chance: 30,
  },
};

const RULESETS: Record<string, Ruleset> = {
  [`${SCHMIDT_RULESET.id}@${SCHMIDT_RULESET.version}`]: SCHMIDT_RULESET,
};

export const DEFAULT_RULESET = SCHMIDT_RULESET;

export function getRuleset(id: string, version: number): Ruleset {
  const ruleset = RULESETS[`${id}@${version}`];
  if (!ruleset) throw new Error(`Unbekanntes Regelwerk: ${id}@${version}`);
  return ruleset;
}
