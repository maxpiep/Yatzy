import type {
  Category,
  Game,
  GameEvent,
  LedgerEntry,
  Player,
  Roll,
  Room,
  ScoreCorrection,
  ScoreRow,
  StakeCents,
} from '../domain/types';

export type BackendMode = 'supabase' | 'local';
export type ConnectionStatus = 'connecting' | 'synced' | 'offline';

export interface ActiveGameState {
  game: Game;
  rolls: Roll[];
  scores: ScoreRow[];
}

export interface RoomSnapshot {
  room: Room;
  players: Player[];
  /** Alle Partien des Raums, neueste zuerst. */
  games: Game[];
  active: ActiveGameState | null;
  ledger: LedgerEntry[];
}

export interface GameDetail {
  game: Game;
  rolls: Roll[];
  scores: ScoreRow[];
  corrections: ScoreCorrection[];
  events: GameEvent[];
  ledger: LedgerEntry[];
}

export interface CreatedRoom {
  roomId: string;
  memberToken: string | null;
  ownerToken: string | null;
}

/**
 * Einheitliche Schnittstelle für alle schreibenden und lesenden Vorgänge.
 * Implementierungen: SupabaseBackend (Mehrspieler, Quelle der Wahrheit = PostgreSQL)
 * und LocalBackend (Einzelgerät, ohne Server).
 */
export interface Backend {
  readonly mode: BackendMode;
  init(): Promise<void>;
  listRooms(): Promise<Room[]>;
  createRoom(name: string, maxiName: string, franziName: string): Promise<CreatedRoom>;
  joinRoom(token: string): Promise<{ roomId: string; role: Room['role'] }>;
  rotateInvite(roomId: string, role: Room['role']): Promise<string>;
  updateRoom(roomId: string, name: string): Promise<void>;
  updatePlayer(playerId: string, displayName: string, color: string): Promise<void>;

  getRoomSnapshot(roomId: string): Promise<RoomSnapshot>;
  getGameDetail(gameId: string): Promise<GameDetail>;

  createGame(roomId: string, stakeCents: StakeCents, idempotencyKey: string): Promise<Game>;
  confirmRoll(gameId: string, expectedVersion: number, turnNo: number, dice: number[], held: boolean[]): Promise<Game>;
  scoreTurn(gameId: string, expectedVersion: number, turnNo: number, category: Category, strike: boolean): Promise<Game>;
  correctScore(
    gameId: string,
    expectedVersion: number,
    playerId: string,
    category: Category,
    dice: number[],
    strike: boolean,
    reason: string,
  ): Promise<Game>;
  finishGame(gameId: string): Promise<Game>;
  cancelGame(gameId: string, reason: string): Promise<Game>;

  recordPayment(roomId: string, playerId: string, amountCents: number, note: string | null, idempotencyKey: string): Promise<LedgerEntry>;
  recordAdjustment(
    roomId: string,
    playerId: string,
    amountCents: number,
    reason: string,
    correctsEntryId: string | null,
    idempotencyKey: string,
  ): Promise<LedgerEntry>;

  /** Meldet Änderungen (Realtime) und Verbindungsstatus. Gibt eine Abmeldefunktion zurück. */
  subscribe(roomId: string, onChange: () => void, onStatus: (status: ConnectionStatus) => void): () => void;
}
