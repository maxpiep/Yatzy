import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LocalBackend, type KeyValueStorage } from '../src/data/localBackend';
import { BackendError, toBackendError } from '../src/data/errors';
import type { Member } from '../src/data/backend';
import type { MemberRole, Room } from '../src/domain/types';
import {
  adjustmentInput,
  confirmRollInput,
  categorySchema,
  correctScoreInput,
  createGameInput,
  inviteTokenSchema,
  paymentInput,
  playerProfileInput,
  roomNameSchema,
  scoreTurnInput,
  uuidSchema,
} from '../src/domain/validation';

/**
 * Kniffel-Club-Server: Zugriffsschutz (Geräte-Sitzungen, Einladungen, Rollen) um die
 * Spiel-Engine. Die Engine (LocalBackend) enthält dieselben Regeln, Validierungen,
 * Idempotenz- und Versionsprüfungen wie die PostgreSQL-Funktionen.
 *
 * Node verarbeitet jede Anfrage vollständig synchron im Event-Loop, bevor die nächste beginnt;
 * jeder Vorgang ist damit atomar und wird erst nach erfolgreicher Prüfung gespeichert.
 */

const AUTH_KEY = 'kniffel-club:server-auth:v1';
const MEMBER_INVITE_DAYS = 14;
const ROOM_LIMIT = 5;

interface Session {
  userId: string;
  createdAt: string;
}
interface Membership {
  roomId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
}
interface Invite {
  id: string;
  roomId: string;
  tokenHash: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  useCount: number;
}
interface AuthState {
  version: 1;
  sessions: Record<string, Session>;
  members: Membership[];
  invites: Invite[];
  roomsCreated: Record<string, number>;
}

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = () => randomBytes(24).toString('hex');
const sessionTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const fail = (code: string): never => {
  throw new BackendError(code);
};

export interface RpcResult {
  result: unknown;
  /** Raum, dessen Clients über eine Änderung benachrichtigt werden sollen. */
  changedRoom: string | null;
}

export class ClubServer {
  private readonly engine: LocalBackend;

  constructor(private readonly storage: KeyValueStorage) {
    this.engine = new LocalBackend(storage);
  }

  private readAuth(): AuthState {
    const raw = this.storage.getItem(AUTH_KEY);
    if (!raw) return { version: 1, sessions: {}, members: [], invites: [], roomsCreated: {} };
    return JSON.parse(raw) as AuthState;
  }

  private writeAuth(state: AuthState): void {
    this.storage.setItem(AUTH_KEY, JSON.stringify(state));
  }

  createSession(): { token: string; userId: string } {
    const auth = this.readAuth();
    const token = randomBytes(32).toString('hex');
    const userId = randomUUID();
    auth.sessions[hash(token)] = { userId, createdAt: new Date().toISOString() };
    this.writeAuth(auth);
    return { token, userId };
  }

  /** Liefert die Nutzer-ID zu einem Sitzungs-Token oder wirft `not_authenticated`. */
  authenticate(token: string | null | undefined): string {
    if (!token || !sessionTokenSchema.safeParse(token).success) fail('not_authenticated');
    const session = this.readAuth().sessions[hash(token!)];
    if (!session) fail('not_authenticated');
    return session!.userId;
  }

  private role(userId: string, roomId: string | null): MemberRole {
    if (!roomId) return fail('forbidden');
    const m = this.readAuth().members.find((x) => x.roomId === roomId && x.userId === userId);
    if (!m) fail('forbidden');
    return m!.role;
  }

  private requireMember(userId: string, roomId: string | null, owner = false): string {
    const role = this.role(userId, roomId);
    if (owner && role !== 'owner') fail('owner_required');
    return roomId!;
  }

  private createInvite(auth: AuthState, roomId: string, role: MemberRole): string {
    const token = newToken();
    const now = Date.now();
    auth.invites.push({
      id: randomUUID(),
      roomId,
      tokenHash: hash(token),
      role,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(role === 'owner' ? now + 10 * 365 * 86_400_000 : now + MEMBER_INVITE_DAYS * 86_400_000).toISOString(),
      revokedAt: null,
      useCount: 0,
    });
    return token;
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const r = schema.safeParse(value);
    if (!r.success) fail('invalid_request');
    return r.data!;
  }

  /** Führt einen Vorgang für einen angemeldeten Nutzer aus. */
  async call(userId: string, method: string, args: unknown[]): Promise<RpcResult> {
    const e = this.engine;
    const a = Array.isArray(args) ? args : [];
    const str = (i: number) => (typeof a[i] === 'string' ? (a[i] as string) : fail('invalid_request'));
    const gameRoom = (gameId: string) => this.requireMember(userId, e.roomIdForGame(this.parse(uuidSchema, gameId)));

    try {
      switch (method) {
        case 'listRooms': {
          const mine = this.readAuth().members.filter((m) => m.userId === userId);
          const rooms = await e.listRooms();
          const result: Room[] = rooms
            .filter((r) => mine.some((m) => m.roomId === r.id))
            .map((r) => ({ ...r, role: mine.find((m) => m.roomId === r.id)!.role }));
          return { result, changedRoom: null };
        }
        case 'createRoom': {
          const name = this.parse(roomNameSchema, a[0]);
          const maxi = this.parse(z.string().trim().min(1).max(30), a[1]);
          const franzi = this.parse(z.string().trim().min(1).max(30), a[2]);
          const auth = this.readAuth();
          if ((auth.roomsCreated[userId] ?? 0) >= ROOM_LIMIT) fail('room_limit');
          const created = await e.createRoom(name, maxi, franzi);
          const auth2 = this.readAuth();
          auth2.roomsCreated[userId] = (auth2.roomsCreated[userId] ?? 0) + 1;
          auth2.members.push({ roomId: created.roomId, userId, role: 'owner', joinedAt: new Date().toISOString() });
          const memberToken = this.createInvite(auth2, created.roomId, 'member');
          const ownerToken = this.createInvite(auth2, created.roomId, 'owner');
          this.writeAuth(auth2);
          return { result: { roomId: created.roomId, memberToken, ownerToken }, changedRoom: null };
        }
        case 'joinRoom': {
          const token = this.parse(inviteTokenSchema, a[0]);
          const auth = this.readAuth();
          const inv = auth.invites.find((i) => i.tokenHash === hash(token));
          if (!inv || inv.revokedAt || new Date(inv.expiresAt).getTime() < Date.now()) fail('invalid_invite');
          const existing = auth.members.find((m) => m.roomId === inv!.roomId && m.userId === userId);
          if (existing) {
            if (inv!.role === 'owner') existing.role = 'owner';
          } else {
            auth.members.push({ roomId: inv!.roomId, userId, role: inv!.role, joinedAt: new Date().toISOString() });
          }
          inv!.useCount++;
          // Admin-Links sind nur einmal verwendbar.
          if (inv!.role === 'owner') inv!.revokedAt = new Date().toISOString();
          this.writeAuth(auth);
          const role = auth.members.find((m) => m.roomId === inv!.roomId && m.userId === userId)!.role;
          return { result: { roomId: inv!.roomId, role }, changedRoom: inv!.roomId };
        }
        case 'rotateInvite': {
          const roomId = this.requireMember(userId, this.parse(uuidSchema, a[0]), true);
          const role = this.parse(z.enum(['owner', 'member']), a[1]);
          const auth = this.readAuth();
          const now = new Date().toISOString();
          for (const i of auth.invites) if (i.roomId === roomId && i.role === role && !i.revokedAt) i.revokedAt = now;
          const token = this.createInvite(auth, roomId, role);
          this.writeAuth(auth);
          return { result: token, changedRoom: null };
        }
        case 'listMembers': {
          const roomId = this.requireMember(userId, this.parse(uuidSchema, a[0]));
          const result: Member[] = this.readAuth()
            .members.filter((m) => m.roomId === roomId)
            .map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt, isSelf: m.userId === userId }));
          return { result, changedRoom: null };
        }
        case 'removeMember': {
          const roomId = this.requireMember(userId, this.parse(uuidSchema, a[0]), true);
          const target = this.parse(uuidSchema, a[1]);
          if (target === userId) fail('cannot_remove_self');
          const auth = this.readAuth();
          const before = auth.members.length;
          auth.members = auth.members.filter((m) => !(m.roomId === roomId && m.userId === target));
          if (auth.members.length === before) fail('member_not_found');
          this.writeAuth(auth);
          return { result: null, changedRoom: roomId };
        }
        case 'updateRoom': {
          const roomId = this.requireMember(userId, this.parse(uuidSchema, a[0]), true);
          await e.updateRoom(roomId, this.parse(roomNameSchema, a[1]));
          return { result: null, changedRoom: roomId };
        }
        case 'updatePlayer': {
          const input = this.parse(playerProfileInput, { playerId: a[0], displayName: a[1], color: a[2] });
          const roomId = this.requireMember(userId, e.roomIdForPlayer(input.playerId));
          await e.updatePlayer(input.playerId, input.displayName, input.color);
          return { result: null, changedRoom: roomId };
        }
        case 'getRoomSnapshot': {
          const roomId = this.requireMember(userId, this.parse(uuidSchema, a[0]));
          const snap = await e.getRoomSnapshot(roomId);
          return { result: { ...snap, room: { ...snap.room, role: this.role(userId, roomId) } }, changedRoom: null };
        }
        case 'getGameDetail': {
          gameRoom(str(0));
          return { result: await e.getGameDetail(str(0)), changedRoom: null };
        }
        case 'createGame': {
          const input = this.parse(createGameInput.extend({ stakeCents: z.unknown() }), { roomId: a[0], stakeCents: a[1], idempotencyKey: a[2] });
          const roomId = this.requireMember(userId, input.roomId);
          // Einsatz wird in der Engine erneut gegen 100/200/500 geprüft (invalid_stake).
          const result = await e.createGame(roomId, input.stakeCents as never, input.idempotencyKey);
          return { result, changedRoom: roomId };
        }
        case 'confirmRoll': {
          const input = this.parse(confirmRollInput.extend({ dice: z.array(z.unknown()), held: z.array(z.unknown()) }), {
            gameId: a[0],
            expectedVersion: a[1],
            turnNo: a[2],
            dice: a[3],
            held: a[4],
          });
          const roomId = gameRoom(input.gameId);
          const result = await e.confirmRoll(input.gameId, input.expectedVersion, input.turnNo, input.dice as number[], input.held as boolean[]);
          return { result, changedRoom: roomId };
        }
        case 'scoreTurn': {
          const input = this.parse(scoreTurnInput, { gameId: a[0], expectedVersion: a[1], turnNo: a[2], category: a[3], strike: a[4] });
          const roomId = gameRoom(input.gameId);
          const result = await e.scoreTurn(input.gameId, input.expectedVersion, input.turnNo, input.category, input.strike);
          return { result, changedRoom: roomId };
        }
        case 'correctScore': {
          const input = this.parse(correctScoreInput.extend({ dice: z.array(z.unknown()), reason: z.string() }), {
            gameId: a[0],
            expectedVersion: a[1],
            playerId: a[2],
            category: a[3],
            dice: a[4],
            strike: a[5],
            reason: a[6],
          });
          const roomId = gameRoom(input.gameId);
          if (e.roomIdForPlayer(input.playerId) !== roomId) fail('invalid_player');
          const result = await e.correctScore(input.gameId, input.expectedVersion, input.playerId, input.category, input.dice as number[], input.strike, input.reason);
          return { result, changedRoom: roomId };
        }
        case 'scoreManual': {
          const input = this.parse(
            z.object({ gameId: uuidSchema, expectedVersion: z.number().int().positive(), turnNo: z.number().int().min(1).max(26), category: categorySchema, points: z.number(), extra: z.boolean() }),
            { gameId: a[0], expectedVersion: a[1], turnNo: a[2], category: a[3], points: a[4], extra: a[5] },
          );
          const roomId = gameRoom(input.gameId);
          const result = await e.scoreManual(input.gameId, input.expectedVersion, input.turnNo, input.category, input.points, input.extra);
          return { result, changedRoom: roomId };
        }
        case 'correctManual': {
          const input = this.parse(
            z.object({ gameId: uuidSchema, expectedVersion: z.number().int().positive(), playerId: uuidSchema, category: categorySchema, points: z.number(), extra: z.boolean(), reason: z.string() }),
            { gameId: a[0], expectedVersion: a[1], playerId: a[2], category: a[3], points: a[4], extra: a[5], reason: a[6] },
          );
          const roomId = gameRoom(input.gameId);
          if (e.roomIdForPlayer(input.playerId) !== roomId) fail('invalid_player');
          const result = await e.correctManual(input.gameId, input.expectedVersion, input.playerId, input.category, input.points, input.extra, input.reason);
          return { result, changedRoom: roomId };
        }
        case 'finishGame': {
          const roomId = gameRoom(str(0));
          return { result: await e.finishGame(str(0)), changedRoom: roomId };
        }
        case 'cancelGame': {
          const roomId = this.requireMember(userId, e.roomIdForGame(this.parse(uuidSchema, a[0])), true);
          const reason = this.parse(z.string(), a[1]);
          return { result: await e.cancelGame(str(0), reason), changedRoom: roomId };
        }
        case 'recordPayment': {
          const input = this.parse(paymentInput.extend({ amountCents: z.number().int() }), {
            roomId: a[0],
            playerId: a[1],
            amountCents: a[2],
            note: a[3] ?? undefined,
            idempotencyKey: a[4],
          });
          const roomId = this.requireMember(userId, input.roomId);
          const result = await e.recordPayment(roomId, input.playerId, input.amountCents, input.note ?? null, input.idempotencyKey);
          return { result, changedRoom: roomId };
        }
        case 'recordAdjustment': {
          const input = this.parse(adjustmentInput.extend({ amountCents: z.number().int(), reason: z.string() }), {
            roomId: a[0],
            playerId: a[1],
            amountCents: a[2],
            reason: a[3],
            correctsEntryId: a[4] ?? null,
            idempotencyKey: a[5],
          });
          const roomId = this.requireMember(userId, input.roomId, true);
          const result = await e.recordAdjustment(roomId, input.playerId, input.amountCents, input.reason, input.correctsEntryId ?? null, input.idempotencyKey);
          return { result, changedRoom: roomId };
        }
        default:
          return fail('invalid_request');
      }
    } catch (err) {
      throw toBackendError(err);
    }
  }

  /** Darf der Nutzer Änderungen dieses Raums empfangen? */
  canWatch(userId: string, roomId: string): boolean {
    return this.readAuth().members.some((m) => m.roomId === roomId && m.userId === userId);
  }
}
