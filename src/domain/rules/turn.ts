import type { Dice, HeldMask } from '../types';
import type { Ruleset } from './ruleset';
import { validateDice } from './scoring';

export class TurnError extends Error {
  constructor(
    public readonly code: 'max_rolls_reached' | 'invalid_hold' | 'invalid_dice',
    message: string,
  ) {
    super(message);
    this.name = 'TurnError';
  }
}

export interface ConfirmedRoll {
  rollNo: number;
  dice: Dice;
  held: HeldMask;
}

/**
 * Prüft einen neuen Wurf gegen den vorherigen Wurf desselben Zuges.
 * - Wurf 1: nichts darf gehalten sein.
 * - Wurf 2/3: gehaltene Würfel müssen ihren Wert behalten, mindestens ein Würfel wird neu geworfen.
 * - Höchstens `maxRollsPerTurn` Würfe.
 * Gibt die Nummer des neuen Wurfs zurück.
 */
export function validateNextRoll(
  previous: ConfirmedRoll | null,
  dice: readonly unknown[],
  held: readonly unknown[],
  ruleset: Ruleset,
): number {
  try {
    validateDice(dice, ruleset.diceCount);
  } catch (e) {
    throw new TurnError('invalid_dice', (e as Error).message);
  }
  if (!Array.isArray(held) || held.length !== ruleset.diceCount || !held.every((h) => typeof h === 'boolean')) {
    throw new TurnError('invalid_hold', 'Ungültige Markierung gehaltener Würfel.');
  }
  if (!previous) {
    if (held.some(Boolean)) throw new TurnError('invalid_hold', 'Beim ersten Wurf kann kein Würfel gehalten werden.');
    return 1;
  }
  const rollNo = previous.rollNo + 1;
  if (rollNo > ruleset.maxRollsPerTurn) {
    throw new TurnError('max_rolls_reached', `Pro Zug sind höchstens ${ruleset.maxRollsPerTurn} Würfe erlaubt.`);
  }
  if (held.every(Boolean)) {
    throw new TurnError('invalid_hold', 'Mindestens ein Würfel muss neu geworfen werden.');
  }
  for (let i = 0; i < ruleset.diceCount; i++) {
    if (held[i] && previous.dice[i] !== dice[i]) {
      throw new TurnError('invalid_hold', 'Gehaltene Würfel dürfen ihren Wert nicht ändern.');
    }
  }
  return rollNo;
}
