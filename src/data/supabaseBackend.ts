import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Category, Game, LedgerEntry, Room, StakeCents } from '../domain/types';
import type { Backend, ConnectionStatus, CreatedRoom, GameDetail, Member, RoomSnapshot } from './backend';
import { BackendError, toBackendError } from './errors';
import {
  mapCorrection,
  mapEvent,
  mapGame,
  mapLedger,
  mapPlayer,
  mapRoll,
  mapRoom,
  mapScore,
  type DbCorrection,
  type DbEvent,
  type DbGame,
  type DbLedger,
  type DbPlayer,
  type DbRoll,
  type DbRoom,
  type DbScore,
} from './mappers';

type Result<T> = { data: T | null; error: unknown };

async function unwrap<T>(promise: PromiseLike<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await promise;
  } catch (e) {
    throw toBackendError(e);
  }
  if (res.error) throw toBackendError(res.error);
  if (res.data === null || res.data === undefined) throw new BackendError('unknown');
  return res.data;
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;
  private userId: string | null = null;

  constructor(private readonly sb: SupabaseClient) {}

  async init(): Promise<void> {
    const { data, error } = await this.sb.auth.getSession();
    if (error) throw toBackendError(error);
    if (data.session) {
      this.userId = data.session.user.id;
      return;
    }
    const signIn = await this.sb.auth.signInAnonymously();
    if (signIn.error) throw toBackendError(signIn.error);
    this.userId = signIn.data.user?.id ?? null;
    if (!this.userId) throw new BackendError('not_authenticated');
  }

  private rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return unwrap<T>(this.sb.rpc(fn, args) as unknown as PromiseLike<Result<T>>);
  }

  async listRooms(): Promise<Room[]> {
    if (!this.userId) throw new BackendError('not_authenticated');
    const rows = await unwrap(
      this.sb.from('room_members').select('role, rooms(id, name, created_at)').eq('user_id', this.userId),
    );
    return (rows as unknown as { role: Room['role']; rooms: DbRoom | null }[])
      .filter((r) => r.rooms)
      .map((r) => mapRoom(r.rooms!, r.role))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createRoom(name: string, maxiName: string, franziName: string): Promise<CreatedRoom> {
    const res = await this.rpc<{ room_id: string; member_token: string; owner_token: string }>('create_room', {
      p_name: name,
      p_maxi_name: maxiName,
      p_franzi_name: franziName,
    });
    return { roomId: res.room_id, memberToken: res.member_token, ownerToken: res.owner_token };
  }

  async joinRoom(token: string): Promise<{ roomId: string; role: Room['role'] }> {
    const res = await this.rpc<{ room_id: string; role: Room['role'] }>('join_room', { p_token: token });
    return { roomId: res.room_id, role: res.role };
  }

  rotateInvite(roomId: string, role: Room['role']): Promise<string> {
    return this.rpc<string>('rotate_invite', { p_room_id: roomId, p_role: role });
  }

  async listMembers(roomId: string): Promise<Member[]> {
    const rows = await unwrap(this.sb.from('room_members').select('user_id, role, joined_at').eq('room_id', roomId).order('joined_at'));
    return (rows as { user_id: string; role: Room['role']; joined_at: string }[]).map((m) => ({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      isSelf: m.user_id === this.userId,
    }));
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    const { error } = await this.sb.rpc('remove_member', { p_room_id: roomId, p_user_id: userId });
    if (error) throw toBackendError(error);
  }

  async updateRoom(roomId: string, name: string): Promise<void> {
    await this.rpc('update_room', { p_room_id: roomId, p_name: name });
  }

  async updatePlayer(playerId: string, displayName: string, color: string): Promise<void> {
    await this.rpc('update_player', { p_player_id: playerId, p_display_name: displayName, p_color: color });
  }

  async getRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
    const [membership, room, players, games, ledger] = await Promise.all([
      unwrap(this.sb.from('room_members').select('role').eq('room_id', roomId).eq('user_id', this.userId ?? '').maybeSingle()),
      unwrap(this.sb.from('rooms').select('id, name, created_at').eq('id', roomId).maybeSingle()),
      unwrap(this.sb.from('players').select('*').eq('room_id', roomId).order('slug', { ascending: false })),
      unwrap(this.sb.from('games').select('*').eq('room_id', roomId).order('started_at', { ascending: false })),
      unwrap(this.sb.from('cash_ledger').select('*').eq('room_id', roomId).order('created_at', { ascending: false })),
    ]).catch((e) => {
      // maybeSingle liefert null ohne Treffer → unwrap wirft 'unknown'; das bedeutet: kein Zugriff.
      if (e instanceof BackendError && e.code === 'unknown') throw new BackendError('forbidden');
      throw e;
    });
    const mappedGames = (games as DbGame[]).map(mapGame);
    const activeGame = mappedGames.find((g) => g.status === 'active') ?? null;
    let active: RoomSnapshot['active'] = null;
    if (activeGame) {
      const [rolls, scores] = await Promise.all([
        unwrap(this.sb.from('game_rolls').select('*').eq('game_id', activeGame.id).order('id')),
        unwrap(this.sb.from('game_scores').select('*').eq('game_id', activeGame.id).order('turn_no')),
      ]);
      active = { game: activeGame, rolls: (rolls as DbRoll[]).map(mapRoll), scores: (scores as DbScore[]).map(mapScore) };
    }
    return {
      room: mapRoom(room as unknown as DbRoom, (membership as unknown as { role: Room["role"] }).role),
      players: (players as DbPlayer[]).map(mapPlayer),
      games: mappedGames,
      active,
      ledger: (ledger as DbLedger[]).map(mapLedger),
    };
  }

  async getGameDetail(gameId: string): Promise<GameDetail> {
    const game = await unwrap(this.sb.from('games').select('*').eq('id', gameId).maybeSingle()).catch((e) => {
      if (e instanceof BackendError && e.code === 'unknown') throw new BackendError('game_not_found');
      throw e;
    });
    const [rolls, scores, corrections, events, ledger] = await Promise.all([
      unwrap(this.sb.from('game_rolls').select('*').eq('game_id', gameId).order('id')),
      unwrap(this.sb.from('game_scores').select('*').eq('game_id', gameId).order('turn_no')),
      unwrap(this.sb.from('score_corrections').select('*').eq('game_id', gameId).order('id')),
      unwrap(this.sb.from('game_events').select('*').eq('game_id', gameId).order('id')),
      unwrap(this.sb.from('cash_ledger').select('*').eq('game_id', gameId).order('created_at')),
    ]);
    return {
      game: mapGame(game as unknown as DbGame),
      rolls: (rolls as DbRoll[]).map(mapRoll),
      scores: (scores as DbScore[]).map(mapScore),
      corrections: (corrections as DbCorrection[]).map(mapCorrection),
      events: (events as DbEvent[]).map(mapEvent),
      ledger: (ledger as DbLedger[]).map(mapLedger),
    };
  }

  async createGame(roomId: string, stakeCents: StakeCents, idempotencyKey: string): Promise<Game> {
    return mapGame(
      await this.rpc<DbGame>('create_game', { p_room_id: roomId, p_stake_cents: stakeCents, p_idempotency_key: idempotencyKey }),
    );
  }

  async confirmRoll(gameId: string, expectedVersion: number, turnNo: number, dice: number[], held: boolean[]): Promise<Game> {
    return mapGame(
      await this.rpc<DbGame>('confirm_roll', {
        p_game_id: gameId,
        p_expected_version: expectedVersion,
        p_turn_no: turnNo,
        p_dice: dice,
        p_held: held,
      }),
    );
  }

  async scoreTurn(gameId: string, expectedVersion: number, turnNo: number, category: Category, strike: boolean): Promise<Game> {
    return mapGame(
      await this.rpc<DbGame>('score_turn', {
        p_game_id: gameId,
        p_expected_version: expectedVersion,
        p_turn_no: turnNo,
        p_category: category,
        p_strike: strike,
      }),
    );
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
    return mapGame(
      await this.rpc<DbGame>('correct_score', {
        p_game_id: gameId,
        p_expected_version: expectedVersion,
        p_player_id: playerId,
        p_category: category,
        p_dice: dice,
        p_strike: strike,
        p_reason: reason,
      }),
    );
  }

  async finishGame(gameId: string): Promise<Game> {
    return mapGame(await this.rpc<DbGame>('finish_game', { p_game_id: gameId }));
  }

  async cancelGame(gameId: string, reason: string): Promise<Game> {
    return mapGame(await this.rpc<DbGame>('cancel_game', { p_game_id: gameId, p_reason: reason }));
  }

  async recordPayment(roomId: string, playerId: string, amountCents: number, note: string | null, idempotencyKey: string): Promise<LedgerEntry> {
    return mapLedger(
      await this.rpc<DbLedger>('record_payment', {
        p_room_id: roomId,
        p_player_id: playerId,
        p_amount_cents: amountCents,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      }),
    );
  }

  async recordAdjustment(
    roomId: string,
    playerId: string,
    amountCents: number,
    reason: string,
    correctsEntryId: string | null,
    idempotencyKey: string,
  ): Promise<LedgerEntry> {
    return mapLedger(
      await this.rpc<DbLedger>('record_adjustment', {
        p_room_id: roomId,
        p_player_id: playerId,
        p_amount_cents: amountCents,
        p_reason: reason,
        p_corrects_entry_id: correctsEntryId,
        p_idempotency_key: idempotencyKey,
      }),
    );
  }

  subscribe(roomId: string, onChange: () => void, onStatus: (status: ConnectionStatus) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 120);
    };
    onStatus('connecting');
    const filter = `room_id=eq.${roomId}`;
    let channel: RealtimeChannel = this.sb.channel(`room:${roomId}`);
    for (const table of ['games', 'game_rolls', 'game_scores', 'cash_ledger', 'players']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, changed);
    }
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, changed);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onStatus('synced');
        // Nach (Wieder-)Verbindung immer den aktuellen Serverstand laden.
        onChange();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onStatus('offline');
      }
    });
    const goOffline = () => onStatus('offline');
    const goOnline = () => {
      onStatus((channel as unknown as { state?: string }).state === 'joined' ? 'synced' : 'connecting');
      onChange();
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      void this.sb.removeChannel(channel);
    };
  }
}
