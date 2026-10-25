/**
 * Zentrale, typsichere Domänenmodelle von Kniffel Club.
 * Diese Datei kennt weder React noch Supabase.
 */

export const PLAYER_SLUGS = ['maxi', 'franzi'] as const;
export type PlayerSlug = (typeof PLAYER_SLUGS)[number];

export const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
export const LOWER_CATEGORIES = [
  'three_kind',
  'four_kind',
  'full_house',
  'small_straight',
  'large_straight',
  'kniffel',
  'chance',
] as const;
export const CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES] as const;

export type UpperCategory = (typeof UPPER_CATEGORIES)[number];
export type LowerCategory = (typeof LOWER_CATEGORIES)[number];
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ones: 'Einser',
  twos: 'Zweier',
  threes: 'Dreier',
  fours: 'Vierer',
  fives: 'Fünfer',
  sixes: 'Sechser',
  three_kind: 'Dreierpasch',
  four_kind: 'Viererpasch',
  full_house: 'Full House',
  small_straight: 'Kleine Straße',
  large_straight: 'Große Straße',
  kniffel: 'Kniffel',
  chance: 'Chance',
};

export const CATEGORY_HINTS: Record<Category, string> = {
  ones: 'Summe aller Einser',
  twos: 'Summe aller Zweier',
  threes: 'Summe aller Dreier',
  fours: 'Summe aller Vierer',
  fives: 'Summe aller Fünfer',
  sixes: 'Summe aller Sechser',
  three_kind: 'Mind. 3 gleiche – Summe aller Augen',
  four_kind: 'Mind. 4 gleiche – Summe aller Augen',
  full_house: '3 gleiche + 2 gleiche – 25 Punkte',
  small_straight: '4 in Folge – 30 Punkte',
  large_straight: '5 in Folge – 40 Punkte',
  kniffel: '5 gleiche – 50 Punkte',
  chance: 'Summe aller Augen',
};

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
/** Genau fünf Würfelwerte 1–6. Validierung über `validateDice`. */
export type Dice = readonly DieValue[];
export type HeldMask = readonly boolean[];

/** `scored` = Punkte eingetragen, `struck` = Feld bewusst gestrichen (0 Punkte). Leere Felder haben keinen Eintrag. */
export type ScoreKind = 'scored' | 'struck';

export interface ScoreEntry {
  category: Category;
  kind: ScoreKind;
  points: number;
  dice: Dice;
  /** Wertung kam über die Joker-Regel eines weiteren Kniffels zustande. */
  joker: boolean;
  /** Zusatzpunkte für einen weiteren Kniffel (0 oder 50). */
  kniffelBonus: number;
  turnNo: number;
}

export type Scorecard = Partial<Record<Category, ScoreEntry>>;

export type GameStatus = 'active' | 'finished' | 'cancelled';
export type SettlementStatus = 'pending' | 'settled' | 'no_charge' | 'void';

export const STAKE_OPTIONS_CENTS = [100, 200, 500] as const;
export type StakeCents = (typeof STAKE_OPTIONS_CENTS)[number];

export type LedgerEntryType = 'game_loss' | 'payment' | 'adjustment';
export type MemberRole = 'owner' | 'member';

export interface Player {
  id: string;
  roomId: string;
  slug: PlayerSlug;
  displayName: string;
  color: string;
}

export interface Room {
  id: string;
  name: string;
  createdAt: string;
  role: MemberRole;
}

export interface PlayerSnapshot {
  id: string;
  slug: PlayerSlug;
  displayName: string;
}

export interface Game {
  id: string;
  roomId: string;
  status: GameStatus;
  rulesetId: string;
  rulesetVersion: number;
  stakeCents: StakeCents;
  startingPlayerId: string;
  currentTurn: number;
  version: number;
  players: PlayerSnapshot[];
  startedAt: string;
  finishedAt: string | null;
  winnerPlayerId: string | null;
  isDraw: boolean | null;
  /** player_id → Endpunktzahl; erst nach Abschluss gesetzt. */
  finalScores: Record<string, number> | null;
  settlementStatus: SettlementStatus;
  settledAt: string | null;
  cancelReason: string | null;
}

export interface Roll {
  id: string;
  gameId: string;
  turnNo: number;
  rollNo: number;
  playerId: string;
  dice: Dice;
  held: HeldMask;
  createdAt: string;
}

export interface ScoreRow extends ScoreEntry {
  id: string;
  gameId: string;
  playerId: string;
  createdAt: string;
  correctedAt: string | null;
  correctionCount: number;
}

export interface ScoreCorrection {
  id: string;
  gameId: string;
  scoreId: string;
  playerId: string;
  category: Category;
  oldPoints: number;
  newPoints: number;
  oldKind: ScoreKind;
  newKind: ScoreKind;
  reason: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  roomId: string;
  playerId: string;
  /** Positiv = Verbindlichkeit steigt (Einsatz), negativ = sinkt (Zahlung). Immer ganze Cent. */
  amountCents: number;
  type: LedgerEntryType;
  description: string;
  createdAt: string;
  gameId: string | null;
  idempotencyKey: string;
  correctsEntryId: string | null;
}

export type GameEventType =
  | 'game_created'
  | 'roll_confirmed'
  | 'category_scored'
  | 'score_corrected'
  | 'game_finished'
  | 'cash_settled'
  | 'game_cancelled';

export interface GameEvent {
  id: string;
  gameId: string;
  type: GameEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
