import type { Game } from './types';

export interface PlayerStats {
  playerId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Siegquote 0–1, `null` ohne Partien. */
  winRate: number | null;
  averageScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  longestStreak: number;
}

export interface ClubStats {
  played: number;
  draws: number;
  players: Record<string, PlayerStats>;
  averageDifference: number | null;
  /** Aktuelle Siegesserie: wer gerade in Folge gewinnt (Unentschieden beendet Serien). */
  currentStreak: { playerId: string; length: number } | null;
  highestGame: { gameId: string; playerId: string; score: number } | null;
}

/** Nur gültig abgeschlossene Partien zählen. Abgebrochene/laufende Partien werden ignoriert. */
export function finishedGames(games: readonly Game[]): Game[] {
  return games
    .filter((g) => g.status === 'finished' && g.finalScores && g.finishedAt)
    .sort((a, b) => new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime());
}

export function computeStatistics(games: readonly Game[], playerIds: readonly string[]): ClubStats {
  const done = finishedGames(games);
  const players: Record<string, PlayerStats> = {};
  const scores: Record<string, number[]> = {};
  const running: Record<string, number> = {};
  for (const id of playerIds) {
    scores[id] = [];
    running[id] = 0;
    players[id] = {
      playerId: id,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: null,
      averageScore: null,
      highScore: null,
      lowScore: null,
      longestStreak: 0,
    };
  }

  let draws = 0;
  let diffSum = 0;
  let current: { playerId: string; length: number } | null = null;
  let highestGame: ClubStats['highestGame'] = null;

  for (const g of done) {
    const final = g.finalScores!;
    const values = playerIds.map((id) => final[id]).filter((v): v is number => typeof v === 'number');
    if (values.length === 2) diffSum += Math.abs(values[0]! - values[1]!);
    if (g.isDraw || !g.winnerPlayerId) draws++;

    for (const id of playerIds) {
      const stats = players[id]!;
      const score = final[id];
      if (typeof score !== 'number') continue;
      stats.played++;
      scores[id]!.push(score);
      if (!highestGame || score > highestGame.score) highestGame = { gameId: g.id, playerId: id, score };
      if (g.isDraw || !g.winnerPlayerId) {
        stats.draws++;
        running[id] = 0;
      } else if (g.winnerPlayerId === id) {
        stats.wins++;
        running[id] = (running[id] ?? 0) + 1;
        stats.longestStreak = Math.max(stats.longestStreak, running[id]!);
      } else {
        stats.losses++;
        running[id] = 0;
      }
    }
    const prev = current as ClubStats['currentStreak'];
    if (g.isDraw || !g.winnerPlayerId) current = null;
    else if (prev && prev.playerId === g.winnerPlayerId) current = { playerId: prev.playerId, length: prev.length + 1 };
    else current = { playerId: g.winnerPlayerId, length: 1 };
  }

  for (const id of playerIds) {
    const s = players[id]!;
    const list = scores[id]!;
    if (list.length > 0) {
      s.winRate = s.wins / s.played;
      s.averageScore = list.reduce((a, b) => a + b, 0) / list.length;
      s.highScore = Math.max(...list);
      s.lowScore = Math.min(...list);
    }
  }

  return {
    played: done.length,
    draws,
    players,
    averageDifference: done.length ? diffSum / done.length : null,
    currentStreak: current,
    highestGame,
  };
}
