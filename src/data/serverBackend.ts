import type { Category, Game, LedgerEntry, Room, StakeCents } from '../domain/types';
import type { Backend, ConnectionStatus, CreatedRoom, GameDetail, Member, RoomSnapshot } from './backend';
import { BackendError, toBackendError } from './errors';
import { readLocal, writeLocal } from '../lib/storage';

const TOKEN_KEY = 'kniffel-club:server-session';

/**
 * Client für den eigenen Kniffel-Club-Server (server/). Jedes Gerät erhält eine zufällige
 * Sitzung; der Zugriff auf Clubs entsteht erst über Einladungslinks.
 */
export class ServerBackend implements Backend {
  readonly mode = 'server' as const;
  private token: string | null = null;

  constructor(private readonly baseUrl = '') {}

  async init(): Promise<void> {
    this.token = readLocal(TOKEN_KEY);
    if (this.token) {
      try {
        await this.call('listRooms', []);
        return;
      } catch (e) {
        if (!(e instanceof BackendError) || e.code !== 'not_authenticated') throw e;
      }
    }
    const res = await this.fetchJson<{ token: string }>('/api/session', { method: 'POST' });
    this.token = res.token;
    writeLocal(TOKEN_KEY, res.token);
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...init.headers },
      });
    } catch (e) {
      throw toBackendError(e instanceof Error ? new Error(`fetch failed: ${e.message}`) : e);
    }
    let body: { result?: T; error?: { code: string; message?: string } } & T;
    try {
      body = await res.json();
    } catch {
      throw new BackendError(res.status >= 500 ? 'unknown' : 'database_not_ready');
    }
    if (!res.ok || body.error) throw new BackendError(body.error?.code ?? 'unknown', body.error?.message);
    return body as T;
  }

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    const body = await this.fetchJson<{ result: T }>('/api/rpc', { method: 'POST', body: JSON.stringify({ method, args }) });
    return body.result;
  }

  listRooms = () => this.call<Room[]>('listRooms', []);
  createRoom = (name: string, maxi: string, franzi: string) => this.call<CreatedRoom>('createRoom', [name, maxi, franzi]);
  joinRoom = (token: string) => this.call<{ roomId: string; role: Room['role'] }>('joinRoom', [token]);
  rotateInvite = (roomId: string, role: Room['role']) => this.call<string>('rotateInvite', [roomId, role]);
  listMembers = (roomId: string) => this.call<Member[]>('listMembers', [roomId]);
  removeMember = async (roomId: string, userId: string) => void (await this.call('removeMember', [roomId, userId]));
  updateRoom = async (roomId: string, name: string) => void (await this.call('updateRoom', [roomId, name]));
  updatePlayer = async (playerId: string, displayName: string, color: string) => void (await this.call('updatePlayer', [playerId, displayName, color]));
  getRoomSnapshot = (roomId: string) => this.call<RoomSnapshot>('getRoomSnapshot', [roomId]);
  getGameDetail = (gameId: string) => this.call<GameDetail>('getGameDetail', [gameId]);
  createGame = (roomId: string, stakeCents: StakeCents, key: string) => this.call<Game>('createGame', [roomId, stakeCents, key]);
  confirmRoll = (gameId: string, v: number, turn: number, dice: number[], held: boolean[]) => this.call<Game>('confirmRoll', [gameId, v, turn, dice, held]);
  scoreTurn = (gameId: string, v: number, turn: number, category: Category, strike: boolean) => this.call<Game>('scoreTurn', [gameId, v, turn, category, strike]);
  correctScore = (gameId: string, v: number, playerId: string, category: Category, dice: number[], strike: boolean, reason: string) =>
    this.call<Game>('correctScore', [gameId, v, playerId, category, dice, strike, reason]);
  scoreManual = (gameId: string, v: number, turn: number, category: Category, points: number, extra: boolean) =>
    this.call<Game>('scoreManual', [gameId, v, turn, category, points, extra]);
  correctManual = (gameId: string, v: number, playerId: string, category: Category, points: number, extra: boolean, reason: string) =>
    this.call<Game>('correctManual', [gameId, v, playerId, category, points, extra, reason]);
  finishGame = (gameId: string) => this.call<Game>('finishGame', [gameId]);
  cancelGame = (gameId: string, reason: string) => this.call<Game>('cancelGame', [gameId, reason]);
  recordPayment = (roomId: string, playerId: string, cents: number, note: string | null, key: string) =>
    this.call<LedgerEntry>('recordPayment', [roomId, playerId, cents, note, key]);
  recordAdjustment = (roomId: string, playerId: string, cents: number, reason: string, ref: string | null, key: string) =>
    this.call<LedgerEntry>('recordAdjustment', [roomId, playerId, cents, reason, ref, key]);

  /** Server-Sent Events über fetch (Token im Header statt in der URL), mit automatischer Wiederverbindung. */
  subscribe(roomId: string, onChange: () => void, onStatus: (status: ConnectionStatus) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (stopped) return;
      onStatus('connecting');
      controller = new AbortController();
      try {
        const res = await fetch(`${this.baseUrl}/api/rooms/${roomId}/events`, {
          headers: { Authorization: `Bearer ${this.token ?? ''}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (chunk.startsWith('event: ready')) {
              retry = 1000;
              onStatus('synced');
              // Nach (Wieder-)Verbindung immer den aktuellen Serverstand laden.
              onChange();
            } else if (chunk.startsWith('event: change')) {
              onChange();
            }
          }
        }
      } catch {
        // Abbruch oder Netzwerkfehler → unten neu verbinden
      }
      if (stopped) return;
      onStatus('offline');
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15_000);
    };

    const online = () => {
      if (timer) clearTimeout(timer);
      retry = 1000;
      controller?.abort();
    };
    window.addEventListener('online', online);
    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', online);
    };
  }
}
