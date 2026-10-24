import { describe, expect, it } from 'vitest';
import type { Game } from './types';
import { computeStatistics } from './statistics';

let i = 0;
const game = (maxi: number, franzi: number, status: Game['status'] = 'finished'): Game => {
  i++;
  const draw = maxi === franzi;
  return {
    id: `g${i}`,
    roomId: 'r',
    status,
    rulesetId: 'kniffel-schmidt',
    rulesetVersion: 1,
    stakeCents: 200,
    startingPlayerId: 'm',
    currentTurn: 27,
    version: 1,
    players: [],
    startedAt: `2026-10-${String(i).padStart(2, '0')}T10:00:00Z`,
    finishedAt: status === 'finished' ? `2026-10-${String(i).padStart(2, '0')}T11:00:00Z` : null,
    winnerPlayerId: status !== 'finished' || draw ? null : maxi > franzi ? 'm' : 'f',
    isDraw: status === 'finished' ? draw : null,
    finalScores: status === 'finished' ? { m: maxi, f: franzi } : null,
    settlementStatus: 'settled',
    settledAt: null,
    cancelReason: null,
  };
};

describe('Statistik', () => {
  it('berechnet Siege, Serien, Durchschnitt und ignoriert nicht abgeschlossene Partien', () => {
    const games = [
      game(250, 200), // m
      game(260, 210), // m
      game(220, 220), // draw
      game(180, 230), // f
      game(190, 240), // f
      game(170, 300), // f
      game(100, 100, 'cancelled'),
      game(50, 10, 'active'),
    ];
    const s = computeStatistics(games, ['m', 'f']);
    expect(s.played).toBe(6);
    expect(s.draws).toBe(1);
    expect(s.players.m).toMatchObject({ wins: 2, losses: 3, draws: 1, longestStreak: 2, highScore: 260, lowScore: 170 });
    expect(s.players.f).toMatchObject({ wins: 3, losses: 2, draws: 1, longestStreak: 3, highScore: 300 });
    expect(s.players.m!.winRate).toBeCloseTo(2 / 6);
    expect(s.players.m!.averageScore).toBeCloseTo((250 + 260 + 220 + 180 + 190 + 170) / 6);
    expect(s.currentStreak).toEqual({ playerId: 'f', length: 3 });
    expect(s.averageDifference).toBeCloseTo((50 + 50 + 0 + 50 + 50 + 130) / 6);
    expect(s.highestGame).toMatchObject({ playerId: 'f', score: 300 });
  });

  it('ohne Partien gibt es keine Werte', () => {
    const s = computeStatistics([], ['m', 'f']);
    expect(s.played).toBe(0);
    expect(s.players.m!.winRate).toBeNull();
    expect(s.currentStreak).toBeNull();
  });
});
