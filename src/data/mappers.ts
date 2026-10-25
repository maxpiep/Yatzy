import type {
  Category,
  Dice,
  Game,
  GameEvent,
  LedgerEntry,
  Player,
  PlayerSlug,
  Roll,
  Room,
  ScoreCorrection,
  ScoreRow,
  StakeCents,
} from '../domain/types';

/* Zeilenformate der Datenbank (snake_case), wie PostgREST und pg sie liefern. */
export interface DbGame {
  id: string;
  room_id: string;
  status: Game['status'];
  ruleset_id: string;
  ruleset_version: number;
  stake_amount_cents: number;
  starting_player_id: string;
  current_turn: number;
  version: number;
  players_snapshot: { id: string; slug: PlayerSlug; display_name: string }[];
  started_at: string;
  finished_at: string | null;
  winner_player_id: string | null;
  is_draw: boolean | null;
  final_scores: Record<string, number> | null;
  settlement_status: Game['settlementStatus'];
  settled_at: string | null;
  cancel_reason: string | null;
}

export interface DbRoll {
  id: number | string;
  game_id: string;
  turn_no: number;
  roll_no: number;
  player_id: string;
  dice: number[];
  held: boolean[];
  created_at: string;
}

export interface DbScore {
  id: number | string;
  game_id: string;
  player_id: string;
  category: Category;
  kind: ScoreRow['kind'];
  points: number;
  dice: number[];
  joker: boolean;
  kniffel_bonus: number;
  turn_no: number;
  created_at: string;
  corrected_at: string | null;
  correction_count: number;
}

export interface DbLedger {
  id: string;
  room_id: string;
  player_id: string;
  amount_cents: number;
  entry_type: LedgerEntry['type'];
  description: string;
  created_at: string;
  game_id: string | null;
  idempotency_key: string;
  corrects_entry_id: string | null;
}

export interface DbPlayer {
  id: string;
  room_id: string;
  slug: PlayerSlug;
  display_name: string;
  color: string;
}

export interface DbRoom {
  id: string;
  name: string;
  created_at: string;
}

export interface DbCorrection {
  id: number | string;
  score_id: number | string;
  game_id: string;
  player_id: string;
  category: Category;
  old_value: { points: number; kind: ScoreRow['kind'] };
  new_value: { points: number; kind: ScoreRow['kind'] };
  reason: string;
  created_at: string;
}

export interface DbEvent {
  id: number | string;
  game_id: string;
  event_type: GameEvent['type'];
  payload: Record<string, unknown>;
  created_at: string;
}

export const mapGame = (g: DbGame): Game => ({
  id: g.id,
  roomId: g.room_id,
  status: g.status,
  rulesetId: g.ruleset_id,
  rulesetVersion: g.ruleset_version,
  stakeCents: g.stake_amount_cents as StakeCents,
  startingPlayerId: g.starting_player_id,
  currentTurn: g.current_turn,
  version: g.version,
  players: (g.players_snapshot ?? []).map((p) => ({ id: p.id, slug: p.slug, displayName: p.display_name })),
  startedAt: g.started_at,
  finishedAt: g.finished_at,
  winnerPlayerId: g.winner_player_id,
  isDraw: g.is_draw,
  finalScores: g.final_scores,
  settlementStatus: g.settlement_status,
  settledAt: g.settled_at,
  cancelReason: g.cancel_reason,
});

export const mapRoll = (r: DbRoll): Roll => ({
  id: String(r.id),
  gameId: r.game_id,
  turnNo: r.turn_no,
  rollNo: r.roll_no,
  playerId: r.player_id,
  dice: r.dice as unknown as Dice,
  held: r.held,
  createdAt: r.created_at,
});

export const mapScore = (s: DbScore): ScoreRow => ({
  id: String(s.id),
  gameId: s.game_id,
  playerId: s.player_id,
  category: s.category,
  kind: s.kind,
  points: s.points,
  dice: s.dice as unknown as Dice,
  joker: s.joker,
  kniffelBonus: s.kniffel_bonus,
  turnNo: s.turn_no,
  createdAt: s.created_at,
  correctedAt: s.corrected_at,
  correctionCount: s.correction_count,
});

export const mapLedger = (e: DbLedger): LedgerEntry => ({
  id: e.id,
  roomId: e.room_id,
  playerId: e.player_id,
  amountCents: e.amount_cents,
  type: e.entry_type,
  description: e.description,
  createdAt: e.created_at,
  gameId: e.game_id,
  idempotencyKey: e.idempotency_key,
  correctsEntryId: e.corrects_entry_id,
});

export const mapPlayer = (p: DbPlayer): Player => ({
  id: p.id,
  roomId: p.room_id,
  slug: p.slug,
  displayName: p.display_name,
  color: p.color,
});

export const mapRoom = (r: DbRoom, role: Room['role']): Room => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  role,
});

export const mapCorrection = (c: DbCorrection): ScoreCorrection => ({
  id: String(c.id),
  gameId: c.game_id,
  scoreId: String(c.score_id),
  playerId: c.player_id,
  category: c.category,
  oldPoints: c.old_value.points,
  newPoints: c.new_value.points,
  oldKind: c.old_value.kind,
  newKind: c.new_value.kind,
  reason: c.reason,
  createdAt: c.created_at,
});

export const mapEvent = (e: DbEvent): GameEvent => ({
  id: String(e.id),
  gameId: e.game_id,
  type: e.event_type,
  payload: e.payload,
  createdAt: e.created_at,
});
