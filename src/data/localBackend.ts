import { CATEGORIES, type Category, type Game, type LedgerEntry, type Player, type Room, type StakeCents } from '../domain/types';
import { buildScorecard, determineOutcome, playerIdForTurn, TOTAL_TURNS } from '../domain/gameState';
import { getRuleset, DEFAULT_RULESET } from '../domain/rules/ruleset';
import { calculateScore, computeTotals, isKniffel, RuleError, strikeScore, validateDice } from '../domain/rules/scoring';
import { TurnError, validateNextRoll } from '../domain/rules/turn';
import { isValidStake, MAX_AMOUNT_CENTS, formatCents } from '../domain/money';
import type { Backend, ConnectionStatus, CreatedRoom, GameDetail, RoomSnapshot } from './backend';
import { BackendError } from './errors';
import type { DbCorrection, DbEvent, DbGame, DbLedger, DbPlayer, DbRoll, DbScore } from './mappers';
import { mapCorrection, mapEvent, mapGame, mapLedger, mapPlayer, mapRoll, mapScore } from './mappers';

/**
 * Lokaler Einzelgerät-Modus ohne Server. Bildet die Semantik der PostgreSQL-Funktionen nach
 * (gleiche Validierungen und Fehlercodes), speichert aber nur im Browser dieses Geräts.
 * Für echten Mehrspielerbetrieb wird Supabase benötigt.
 */

interface LocalState {
  version: 1;
  userId: string;
  rooms: { id: string; name: string; created_at: string }[];
  players: DbPlayer[];
  games: (DbGame & { idempotency_key: string })[];
  rolls: DbRoll[];
  scores: DbScore[];
  corrections: DbCorrection[];
  events: DbEvent[];
  ledger: DbLedger[];
  seq: number;
}

const STORAGE_KEY = 'kniffel-club:local:v1';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function defaultStorage(): KeyValueStorage {
  try {
    const s = window.localStorage;
    s.setItem('kniffel-club:probe', '1');
    return s;
  } catch {
    return memoryStorage();
  }
}

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = (code: string): never => {
  throw new BackendError(code);
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class LocalBackend implements Backend {
  readonly mode = 'local' as const;
  private listeners = new Set<() => void>();
  private readonly storage: KeyValueStorage;

  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? defaultStorage();
  }

  async init(): Promise<void> {
    this.read();
  }

  private read(): LocalState {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LocalState;
        if (parsed.version === 1) return parsed;
      } catch {
        // beschädigter Speicher → neu beginnen wäre Datenverlust; daher Fehler melden
        throw new BackendError('unknown', 'Der lokale Speicher ist beschädigt.');
      }
    }
    const fresh: LocalState = {
      version: 1,
      userId: uuid(),
      rooms: [],
      players: [],
      games: [],
      rolls: [],
      scores: [],
      corrections: [],
      events: [],
      ledger: [],
      seq: 0,
    };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  /** Atomarer Schreibvorgang: Änderungen an einer Kopie, gespeichert nur bei Erfolg. */
  private transact<T>(fn: (s: LocalState) => T): T {
    const state = clone(this.read());
    let result: T;
    try {
      result = fn(state);
    } catch (e) {
      if (e instanceof RuleError || e instanceof TurnError) throw new BackendError(e.code);
      throw e;
    }
    this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
    queueMicrotask(() => this.listeners.forEach((l) => l()));
    return result;
  }

  private log(s: LocalState, gameId: string, type: DbEvent['event_type'], payload: Record<string, unknown>) {
    s.events.push({ id: ++s.seq, game_id: gameId, event_type: type, payload, created_at: now() });
  }

  private requireRoom(s: LocalState, roomId: string) {
    const room = s.rooms.find((r) => r.id === roomId);
    if (!room) fail('forbidden');
    return room!;
  }

  private lockGame(s: LocalState, gameId: string, expectedVersion: number | null) {
    const g = s.games.find((x) => x.id === gameId);
    if (!g) return fail('game_not_found');
    if (g.status !== 'active') fail('game_not_active');
    if (expectedVersion !== null && g.version !== expectedVersion) fail('stale_version');
    return g;
  }

  private turnPlayer(s: LocalState, g: DbGame, turn: number): string {
    const ids = s.players.filter((p) => p.room_id === g.room_id).map((p) => p.id);
    return playerIdForTurn(turn, g.starting_player_id, ids);
  }

  async listRooms(): Promise<Room[]> {
    return this.read().rooms.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, role: 'owner' as const }));
  }

  async createRoom(name: string, maxiName: string, franziName: string): Promise<CreatedRoom> {
    return this.transact((s) => {
      const n = name.trim();
      if (!n || n.length > 60 || !maxiName.trim() || !franziName.trim()) fail('invalid_name');
      const id = uuid();
      s.rooms.push({ id, name: n, created_at: now() });
      s.players.push(
        { id: uuid(), room_id: id, slug: 'maxi', display_name: maxiName.trim(), color: '#2f6f8f' },
        { id: uuid(), room_id: id, slug: 'franzi', display_name: franziName.trim(), color: '#c2513f' },
      );
      return { roomId: id, memberToken: null, ownerToken: null };
    });
  }

  async joinRoom(): Promise<{ roomId: string; role: Room['role'] }> {
    throw new BackendError('not_supported_local');
  }

  async rotateInvite(): Promise<string> {
    throw new BackendError('not_supported_local');
  }

  async updateRoom(roomId: string, name: string): Promise<void> {
    this.transact((s) => {
      const room = this.requireRoom(s, roomId);
      if (!name.trim() || name.trim().length > 60) fail('invalid_name');
      room.name = name.trim();
    });
  }

  async updatePlayer(playerId: string, displayName: string, color: string): Promise<void> {
    this.transact((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p) return fail('invalid_player');
      if (!displayName.trim() || displayName.trim().length > 30) fail('invalid_name');
      if (!/^#[0-9a-f]{6}$/i.test(color)) fail('invalid_color');
      p.display_name = displayName.trim();
      p.color = color.toLowerCase();
    });
  }

  async getRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
    const s = this.read();
    const room = this.requireRoom(s, roomId);
    const games = s.games
      .filter((g) => g.room_id === roomId)
      .map(mapGame)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const activeGame = games.find((g) => g.status === 'active') ?? null;
    return {
      room: { id: room.id, name: room.name, createdAt: room.created_at, role: 'owner' },
      players: s.players.filter((p) => p.room_id === roomId).map(mapPlayer).sort((a, b) => b.slug.localeCompare(a.slug)),
      games,
      active: activeGame
        ? {
            game: activeGame,
            rolls: s.rolls.filter((r) => r.game_id === activeGame.id).map(mapRoll),
            scores: s.scores.filter((x) => x.game_id === activeGame.id).map(mapScore),
          }
        : null,
      ledger: s.ledger
        .filter((e) => e.room_id === roomId)
        .map(mapLedger)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async getGameDetail(gameId: string): Promise<GameDetail> {
    const s = this.read();
    const g = s.games.find((x) => x.id === gameId);
    if (!g) throw new BackendError('game_not_found');
    return {
      game: mapGame(g),
      rolls: s.rolls.filter((r) => r.game_id === gameId).map(mapRoll),
      scores: s.scores.filter((r) => r.game_id === gameId).map(mapScore),
      corrections: s.corrections.filter((r) => r.game_id === gameId).map(mapCorrection),
      events: s.events.filter((r) => r.game_id === gameId).map(mapEvent),
      ledger: s.ledger.filter((r) => r.game_id === gameId).map(mapLedger),
    };
  }

  async createGame(roomId: string, stakeCents: StakeCents, idempotencyKey: string): Promise<Game> {
    return this.transact((s) => {
      this.requireRoom(s, roomId);
      if (!isValidStake(stakeCents)) fail('invalid_stake');
      const existing = s.games.find((g) => g.room_id === roomId && g.idempotency_key === idempotencyKey);
      if (existing) {
        if (existing.stake_amount_cents !== stakeCents) fail('idempotency_conflict');
        return mapGame(existing);
      }
      if (s.games.some((g) => g.room_id === roomId && g.status === 'active')) fail('active_game_exists');
      const players = s.players.filter((p) => p.room_id === roomId);
      const last = s.games.filter((g) => g.room_id === roomId).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
      const maxi = players.find((p) => p.slug === 'maxi')!;
      const franzi = players.find((p) => p.slug === 'franzi')!;
      const start = !last || last.starting_player_id !== maxi.id ? maxi : franzi;
      const g: LocalState['games'][number] = {
        id: uuid(),
        room_id: roomId,
        status: 'active',
        ruleset_id: DEFAULT_RULESET.id,
        ruleset_version: DEFAULT_RULESET.version,
        stake_amount_cents: stakeCents,
        starting_player_id: start.id,
        current_turn: 1,
        version: 1,
        players_snapshot: [maxi, franzi].map((p) => ({ id: p.id, slug: p.slug, display_name: p.display_name })),
        started_at: now(),
        finished_at: null,
        winner_player_id: null,
        is_draw: null,
        final_scores: null,
        settlement_status: 'pending',
        settled_at: null,
        cancel_reason: null,
        idempotency_key: idempotencyKey,
      };
      s.games.push(g);
      this.log(s, g.id, 'game_created', { stake_amount_cents: stakeCents, starting_player_id: start.id });
      return mapGame(g);
    });
  }

  async confirmRoll(gameId: string, expectedVersion: number, turnNo: number, dice: number[], held: boolean[]): Promise<Game> {
    return this.transact((s) => {
      const g = this.lockGame(s, gameId, expectedVersion);
      if (g.current_turn > TOTAL_TURNS || turnNo !== g.current_turn) fail('wrong_turn');
      const ruleset = getRuleset(g.ruleset_id, g.ruleset_version);
      const prevRow = s.rolls
        .filter((r) => r.game_id === g.id && r.turn_no === g.current_turn)
        .sort((a, b) => b.roll_no - a.roll_no)[0];
      const prev = prevRow ? { rollNo: prevRow.roll_no, dice: prevRow.dice as never, held: prevRow.held } : null;
      const rollNo = validateNextRoll(prev, dice, held, ruleset);
      const playerId = this.turnPlayer(s, g, g.current_turn);
      s.rolls.push({
        id: ++s.seq,
        game_id: g.id,
        turn_no: g.current_turn,
        roll_no: rollNo,
        player_id: playerId,
        dice: [...dice],
        held: [...held],
        created_at: now(),
      });
      g.version++;
      this.log(s, g.id, 'roll_confirmed', { turn_no: turnNo, roll_no: rollNo, player_id: playerId, dice, held });
      return mapGame(g);
    });
  }

  async scoreTurn(gameId: string, expectedVersion: number, turnNo: number, category: Category, strike: boolean): Promise<Game> {
    return this.transact((s) => {
      const g = this.lockGame(s, gameId, expectedVersion);
      if (g.current_turn > TOTAL_TURNS || turnNo !== g.current_turn) fail('wrong_turn');
      if (!(CATEGORIES as readonly string[]).includes(category)) fail('invalid_category');
      const ruleset = getRuleset(g.ruleset_id, g.ruleset_version);
      const roll = s.rolls
        .filter((r) => r.game_id === g.id && r.turn_no === g.current_turn)
        .sort((a, b) => b.roll_no - a.roll_no)[0];
      if (!roll) return fail('no_roll');
      const playerId = this.turnPlayer(s, g, g.current_turn);
      const card = buildScorecard(s.scores.filter((x) => x.game_id === g.id).map(mapScore), playerId);
      const dice = roll.dice as never;
      const result = strike ? strikeScore(dice, category, card, ruleset) : calculateScore(dice, category, card, ruleset);
      s.scores.push({
        id: ++s.seq,
        game_id: g.id,
        player_id: playerId,
        category,
        kind: result.points === 0 ? 'struck' : 'scored',
        points: result.points,
        dice: [...roll.dice],
        joker: result.joker,
        kniffel_bonus: result.kniffelBonus,
        turn_no: g.current_turn,
        created_at: now(),
        corrected_at: null,
        correction_count: 0,
      });
      g.current_turn++;
      g.version++;
      this.log(s, g.id, 'category_scored', {
        turn_no: turnNo,
        player_id: playerId,
        category,
        points: result.points,
        joker: result.joker,
        kniffel_bonus: result.kniffelBonus,
        struck: result.points === 0,
      });
      return mapGame(g);
    });
  }

  async correctScore(
    gameId: string,
    expectedVersion: number,
    playerId: string,
    category: Category,
    dice: number[],
    strike: boolean,
    reason: string,
  ): Promise<Game> {
    return this.transact((s) => {
      const g = this.lockGame(s, gameId, expectedVersion);
      const r = reason.trim();
      if (r.length < 3 || r.length > 300) fail('reason_required');
      const row = s.scores.find((x) => x.game_id === g.id && x.player_id === playerId && x.category === category);
      if (!row) return fail('score_not_found');
      validateDice(dice);
      const ruleset = getRuleset(g.ruleset_id, g.ruleset_version);
      const own = s.scores.filter((x) => x.game_id === g.id && x.player_id === playerId);
      if (category === 'kniffel' && own.some((x) => x.turn_no > row.turn_no && isKniffel(x.dice as never))) {
        fail('correction_conflict');
      }
      // Kontext: Kniffel-Feld zum Zeitpunkt der ursprünglichen Wertung, ohne das korrigierte Feld.
      const context = buildScorecard(
        own.filter((x) => x.category === 'kniffel' && x.turn_no < row.turn_no).map(mapScore),
        playerId,
      );
      const result = strike
        ? strikeScore(dice as never, category, context, ruleset)
        : calculateScore(dice as never, category, context, ruleset);
      s.corrections.push({
        id: ++s.seq,
        score_id: row.id,
        game_id: g.id,
        player_id: playerId,
        category,
        old_value: { points: row.points, kind: row.kind },
        new_value: { points: result.points, kind: result.points === 0 ? 'struck' : 'scored' },
        reason: r,
        created_at: now(),
      });
      const oldPoints = row.points;
      Object.assign(row, {
        points: result.points,
        kind: result.points === 0 ? 'struck' : 'scored',
        dice: [...dice],
        joker: result.joker,
        kniffel_bonus: result.kniffelBonus,
        corrected_at: now(),
        correction_count: row.correction_count + 1,
      });
      g.version++;
      this.log(s, g.id, 'score_corrected', { player_id: playerId, category, old_points: oldPoints, new_points: result.points, reason: r });
      return mapGame(g);
    });
  }

  async finishGame(gameId: string): Promise<Game> {
    return this.transact((s) => {
      const g = s.games.find((x) => x.id === gameId);
      if (!g) return fail('game_not_found');
      if (g.status === 'finished') return mapGame(g);
      if (g.status === 'cancelled') fail('game_cancelled');
      const ruleset = getRuleset(g.ruleset_id, g.ruleset_version);
      const rows = s.scores.filter((x) => x.game_id === g.id).map(mapScore);
      const ids = g.players_snapshot.map((p) => p.id);
      const totals = Object.fromEntries(ids.map((id) => [id, computeTotals(buildScorecard(rows, id), ruleset)]));
      if (g.current_turn !== TOTAL_TURNS + 1 || ids.some((id) => !totals[id]!.complete)) fail('game_incomplete');
      const outcome = determineOutcome(totals);
      let entryId: string | null = null;
      if (outcome.loserId) {
        const key = `game_loss:${g.id}`;
        if (!s.ledger.some((e) => e.idempotency_key === key || (e.game_id === g.id && e.entry_type === 'game_loss'))) {
          entryId = uuid();
          const lose = outcome.scores[outcome.loserId]!;
          const win = outcome.scores[outcome.winnerId!]!;
          s.ledger.push({
            id: entryId,
            room_id: g.room_id,
            player_id: outcome.loserId,
            amount_cents: g.stake_amount_cents,
            entry_type: 'game_loss',
            description: `Einsatz ${formatCents(g.stake_amount_cents)} – Partie verloren (${lose} : ${win})`,
            created_at: now(),
            game_id: g.id,
            idempotency_key: key,
            corrects_entry_id: null,
          });
        }
      }
      Object.assign(g, {
        status: 'finished',
        finished_at: now(),
        winner_player_id: outcome.winnerId,
        is_draw: outcome.isDraw,
        final_scores: outcome.scores,
        settlement_status: outcome.loserId ? 'settled' : 'no_charge',
        settled_at: now(),
        version: g.version + 1,
      });
      this.log(s, g.id, 'game_finished', { scores: outcome.scores, winner_player_id: outcome.winnerId, is_draw: outcome.isDraw });
      this.log(s, g.id, 'cash_settled', {
        loser_player_id: outcome.loserId,
        amount_cents: outcome.loserId ? g.stake_amount_cents : 0,
        ledger_entry_id: entryId,
      });
      return mapGame(g);
    });
  }

  async cancelGame(gameId: string, reason: string): Promise<Game> {
    return this.transact((s) => {
      const g = this.lockGame(s, gameId, null);
      if (reason.trim().length < 3) fail('reason_required');
      Object.assign(g, { status: 'cancelled', settlement_status: 'void', cancel_reason: reason.trim(), version: g.version + 1 });
      this.log(s, g.id, 'game_cancelled', { reason: reason.trim() });
      return mapGame(g);
    });
  }

  private ensurePlayer(s: LocalState, roomId: string, playerId: string): Player {
    const p = s.players.find((x) => x.id === playerId && x.room_id === roomId);
    if (!p) fail('invalid_player');
    return mapPlayer(p!);
  }

  async recordPayment(roomId: string, playerId: string, amountCents: number, note: string | null, idempotencyKey: string): Promise<LedgerEntry> {
    return this.transact((s) => {
      this.requireRoom(s, roomId);
      if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) fail('invalid_amount');
      this.ensurePlayer(s, roomId, playerId);
      const key = `payment:${idempotencyKey}`;
      const existing = s.ledger.find((e) => e.room_id === roomId && e.idempotency_key === key);
      if (existing) {
        if (existing.player_id !== playerId || existing.amount_cents !== -amountCents) fail('idempotency_conflict');
        return mapLedger(existing);
      }
      const n = note?.trim();
      if (n && n.length > 200) fail('invalid_note');
      const e: DbLedger = {
        id: uuid(),
        room_id: roomId,
        player_id: playerId,
        amount_cents: -amountCents,
        entry_type: 'payment',
        description: n ? `Zahlung – ${n}` : 'Zahlung',
        created_at: now(),
        game_id: null,
        idempotency_key: key,
        corrects_entry_id: null,
      };
      s.ledger.push(e);
      return mapLedger(e);
    });
  }

  async recordAdjustment(
    roomId: string,
    playerId: string,
    amountCents: number,
    reason: string,
    correctsEntryId: string | null,
    idempotencyKey: string,
  ): Promise<LedgerEntry> {
    return this.transact((s) => {
      this.requireRoom(s, roomId);
      if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > MAX_AMOUNT_CENTS) fail('invalid_amount');
      const r = reason.trim();
      if (r.length < 3 || r.length > 300) fail('reason_required');
      this.ensurePlayer(s, roomId, playerId);
      if (correctsEntryId && !s.ledger.some((e) => e.id === correctsEntryId && e.room_id === roomId)) fail('invalid_reference');
      const key = `adjustment:${idempotencyKey}`;
      const existing = s.ledger.find((e) => e.room_id === roomId && e.idempotency_key === key);
      if (existing) {
        if (existing.player_id !== playerId || existing.amount_cents !== amountCents) fail('idempotency_conflict');
        return mapLedger(existing);
      }
      const e: DbLedger = {
        id: uuid(),
        room_id: roomId,
        player_id: playerId,
        amount_cents: amountCents,
        entry_type: 'adjustment',
        description: `Korrektur – ${r}`,
        created_at: now(),
        game_id: null,
        idempotency_key: key,
        corrects_entry_id: correctsEntryId,
      };
      s.ledger.push(e);
      return mapLedger(e);
    });
  }

  subscribe(_roomId: string, onChange: () => void, onStatus: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(onChange);
    // Andere Tabs desselben Browsers synchronisieren über das storage-Event.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) onChange();
    };
    window.addEventListener('storage', onStorage);
    onStatus('synced');
    return () => {
      this.listeners.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  }
}
