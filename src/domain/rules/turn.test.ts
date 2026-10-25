import { describe, expect, it } from 'vitest';
import type { Dice } from '../types';
import { SCHMIDT_RULESET as R } from './ruleset';
import { TurnError, validateNextRoll } from './turn';

const d = (...v: number[]) => v as unknown as Dice;
const none = [false, false, false, false, false];

describe('Würfe pro Zug', () => {
  it('erster Wurf ohne gehaltene Würfel', () => {
    expect(validateNextRoll(null, d(1, 2, 3, 4, 5), none, R)).toBe(1);
  });

  it('beim ersten Wurf darf nichts gehalten werden', () => {
    expect(() => validateNextRoll(null, d(1, 2, 3, 4, 5), [true, false, false, false, false], R)).toThrow(TurnError);
  });

  it('gehaltene Würfel behalten ihren Wert', () => {
    const prev = { rollNo: 1, dice: d(6, 6, 2, 3, 4), held: none };
    expect(validateNextRoll(prev, d(6, 6, 5, 1, 6), [true, true, false, false, false], R)).toBe(2);
    expect(() => validateNextRoll(prev, d(5, 6, 5, 1, 6), [true, true, false, false, false], R)).toThrow(/nicht ändern/);
  });

  it('mindestens ein Würfel wird neu geworfen', () => {
    const prev = { rollNo: 1, dice: d(6, 6, 2, 3, 4), held: none };
    expect(() => validateNextRoll(prev, d(6, 6, 2, 3, 4), [true, true, true, true, true], R)).toThrow(TurnError);
  });

  it('maximal drei Würfe', () => {
    const prev = { rollNo: 3, dice: d(6, 6, 2, 3, 4), held: none };
    expect(() => validateNextRoll(prev, d(6, 6, 6, 6, 6), [true, true, false, false, false], R)).toThrow(/höchstens 3/);
  });

  it('ungültige Würfel und Markierungen werden abgelehnt', () => {
    expect(() => validateNextRoll(null, [1, 2, 3, 4, 7], none, R)).toThrow(TurnError);
    expect(() => validateNextRoll(null, [1, 2, 3, 4], none, R)).toThrow(TurnError);
    expect(() => validateNextRoll(null, d(1, 2, 3, 4, 5), [false, false], R)).toThrow(TurnError);
  });
});
