import { CATEGORIES, type Game, type Player, type Roll, type ScoreRow, type Scorecard } from './types';
import { computeTotals, type ScoreTotals } from './rules/scoring';
import { getRuleset } from './rules/ruleset';

export const TURNS_PER_PLAYER = CATEGORIES.length;
export const TOTAL_TURNS = TURNS_PER_PLAYER * 2;

/** Spieler am Zug für Zug `turnNo` (1-basiert): ungerade Züge → Startspieler. */
export function playerIdForTurn(turnNo: number, startingPlayerId: string, playerIds: readonly string[]): string {
  const other = playerIds.find((id) => id !== startingPlayerId);
  if (!other) throw new Error('Partie benötigt genau zwei Spieler.');
  return turnNo % 2 === 1 ? startingPlayerId : other;
}

export function roundForTurn(turnNo: number): number {
  return Math.ceil(turnNo / 2);
}

export function buildScorecard(rows: readonly ScoreRow[], playerId: string): Scorecard {
  const card: Scorecard = {};
  for (const row of rows) {
    if (row.playerId !== playerId) continue;
    card[row.category] = {
      category: row.category,
      kind: row.kind,
      points: row.points,
      dice: row.dice,
      joker: row.joker,
      kniffelBonus: row.kniffelBonus,
      turnNo: row.turnNo,
    };
  }
  return card;
}

export interface GameView {
  game: Game;
  isComplete: boolean;
  currentPlayerId: string | null;
  round: number;
  rollsThisTurn: Roll[];
  lastRoll: Roll | null;
  scorecards: Record<string, Scorecard>;
  totals: Record<string, ScoreTotals>;
  leaderId: string | null;
}

export function deriveGameView(game: Game, rows: readonly ScoreRow[], rolls: readonly Roll[]): GameView {
  const ruleset = getRuleset(game.rulesetId, game.rulesetVersion);
  const playerIds = game.players.map((p) => p.id);
  const isComplete = game.currentTurn > TOTAL_TURNS;
  const currentPlayerId = isComplete ? null : playerIdForTurn(game.currentTurn, game.startingPlayerId, playerIds);
  const rollsThisTurn = rolls
    .filter((r) => r.turnNo === game.currentTurn)
    .sort((a, b) => a.rollNo - b.rollNo);
  const scorecards: Record<string, Scorecard> = {};
  const totals: Record<string, ScoreTotals> = {};
  for (const id of playerIds) {
    scorecards[id] = buildScorecard(rows, id);
    totals[id] = computeTotals(scorecards[id], ruleset);
  }
  const [a, b] = playerIds;
  let leaderId: string | null = null;
  if (a && b && totals[a] && totals[b] && totals[a].total !== totals[b].total) {
    leaderId = totals[a].total > totals[b].total ? a : b;
  }
  return {
    game,
    isComplete,
    currentPlayerId,
    round: roundForTurn(Math.min(game.currentTurn, TOTAL_TURNS)),
    rollsThisTurn,
    lastRoll: rollsThisTurn.at(-1) ?? null,
    scorecards,
    totals,
    leaderId,
  };
}

export interface GameOutcome {
  winnerId: string | null;
  loserId: string | null;
  isDraw: boolean;
  scores: Record<string, number>;
}

export function determineOutcome(totals: Record<string, ScoreTotals>): GameOutcome {
  const ids = Object.keys(totals);
  if (ids.length !== 2) throw new Error('Partie benötigt genau zwei Spieler.');
  const [a, b] = ids as [string, string];
  const scores = { [a]: totals[a]!.total, [b]: totals[b]!.total };
  if (scores[a] === scores[b]) return { winnerId: null, loserId: null, isDraw: true, scores };
  const winnerId = scores[a]! > scores[b]! ? a : b;
  return { winnerId, loserId: winnerId === a ? b : a, isDraw: false, scores };
}

export function playerName(game: Game, players: readonly Player[], playerId: string | null): string {
  if (!playerId) return '';
  return game.players.find((p) => p.id === playerId)?.displayName ?? players.find((p) => p.id === playerId)?.displayName ?? '?';
}
