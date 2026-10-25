// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/domain/types';
import { ClubServer } from './clubServer';
import { FileStorage } from './fileStorage';
import { createHttpServer } from './http';

let server: Server;
let base: string;
let dir: string;
let dataFile: string;

async function session(): Promise<string> {
  const r = await fetch(`${base}/api/session`, { method: 'POST' });
  return ((await r.json()) as { token: string }).token;
}

async function rpc<T = unknown>(token: string | null, method: string, ...args: unknown[]): Promise<T> {
  const r = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ method, args }),
  });
  const body = (await r.json()) as { result?: T; error?: { code: string } };
  if (body.error) throw Object.assign(new Error(body.error.code), { code: body.error.code, status: r.status });
  return body.result as T;
}

const code = (p: Promise<unknown>) => p.then(() => null, (e: { code: string }) => e.code);
const NONE = [false, false, false, false, false];

interface G {
  id: string;
  version: number;
  currentTurn: number;
  startingPlayerId: string;
  status: string;
  winnerPlayerId: string | null;
  players: { id: string; slug: string }[];
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-server-'));
  dataFile = join(dir, 'data.json');
  server = createHttpServer({ club: new ClubServer(new FileStorage(dataFile)), sessionsPerHour: 1000 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe('Eigener Server', () => {
  let owner: string;
  let member: string;
  let roomId: string;
  let memberToken: string;
  let ownerToken: string;

  it('verlangt eine Sitzung', async () => {
    expect(await code(rpc(null, 'listRooms'))).toBe('not_authenticated');
    expect(await code(rpc('a'.repeat(64), 'listRooms'))).toBe('not_authenticated');
  });

  it('legt einen Club an und lädt per Einladung ein', async () => {
    owner = await session();
    member = await session();
    const created = await rpc<{ roomId: string; memberToken: string; ownerToken: string }>(owner, 'createRoom', 'Club', 'Maxi', 'Franzi');
    roomId = created.roomId;
    memberToken = created.memberToken;
    ownerToken = created.ownerToken;
    expect(await rpc(member, 'listRooms')).toEqual([]);
    expect(await code(rpc(member, 'getRoomSnapshot', roomId))).toBe('forbidden');
    expect(await code(rpc(member, 'joinRoom', '0'.repeat(48)))).toBe('invalid_invite');
    expect(await rpc(member, 'joinRoom', memberToken)).toEqual({ roomId, role: 'member' });
    expect(await code(rpc(member, 'rotateInvite', roomId, 'member'))).toBe('owner_required');
  });

  it('Admin-Link ist einmalig, Owner kann Geräte entfernen', async () => {
    const other = await session();
    expect(await rpc(other, 'joinRoom', ownerToken)).toEqual({ roomId, role: 'owner' });
    const late = await session();
    expect(await code(rpc(late, 'joinRoom', ownerToken))).toBe('invalid_invite');
    const members = await rpc<{ userId: string; isSelf: boolean }[]>(owner, 'listMembers', roomId);
    const otherId = (await rpc<{ userId: string; isSelf: boolean }[]>(other, 'listMembers', roomId)).find((m) => m.isSelf)!.userId;
    expect(members).toHaveLength(3);
    await rpc(owner, 'removeMember', roomId, otherId);
    expect(await code(rpc(other, 'getRoomSnapshot', roomId))).toBe('forbidden');
  });

  it('weist ungültige Einsätze ab und erstellt bei Doppelklick genau eine Partie', async () => {
    for (const stake of [0, 150, 300, '200', null]) expect(await code(rpc(owner, 'createGame', roomId, stake, crypto.randomUUID()))).toBe('invalid_stake');
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([rpc<G>(owner, 'createGame', roomId, 500, key), rpc<G>(member, 'createGame', roomId, 500, key)]);
    expect(a.id).toBe(b.id);
    expect(await code(rpc(member, 'createGame', roomId, 200, crypto.randomUUID()))).toBe('active_game_exists');
  });

  it('synchronisiert per Server-Sent Events und rechnet genau einmal ab', async () => {
    const snap = await rpc<{ active: { game: G } }>(member, 'getRoomSnapshot', roomId);
    let g = snap.active.game;

    // Zweiter Client lauscht auf Änderungen.
    const controller = new AbortController();
    const events: string[] = [];
    const res = await fetch(`${base}/api/rooms/${roomId}/events`, { headers: { Authorization: `Bearer ${member}` }, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const pump = (async () => {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          events.push(dec.decode(value));
        }
      } catch {
        /* abgebrochen */
      }
    })();

    // SSE ohne gültige Sitzung wird abgewiesen.
    expect((await fetch(`${base}/api/rooms/${roomId}/events`)).status).toBe(401);

    const maxi = g.players.find((p) => p.slug === 'maxi')!.id;
    for (let turn = 1; turn <= 26; turn++) {
      const pid = turn % 2 === 1 ? g.startingPlayerId : g.players.find((p) => p.id !== g.startingPlayerId)!.id;
      const dice = pid === maxi ? [6, 6, 6, 6, 5] : [1, 1, 2, 2, 3];
      g = await rpc<G>(turn % 2 ? owner : member, 'confirmRoll', g.id, g.version, turn, dice, NONE);
      if (turn === 1) expect(await code(rpc(member, 'confirmRoll', g.id, g.version - 1, turn, dice, [true, false, false, false, false]))).toBe('stale_version');
      g = await rpc<G>(owner, 'scoreTurn', g.id, g.version, turn, CATEGORIES[Math.floor((turn - 1) / 2)], false);
    }
    expect(await code(rpc(owner, 'cancelGame', g.id, 'Kein Bock zu zahlen'))).toBe('game_complete');

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => rpc<G>(i % 2 ? owner : member, 'finishGame', g.id)));
    expect(results.every((r) => r.status === 'finished' && r.winnerPlayerId === maxi)).toBe(true);
    const after = await rpc<{ ledger: { amountCents: number; type: string; playerId: string }[] }>(member, 'getRoomSnapshot', roomId);
    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0]).toMatchObject({ amountCents: 500, type: 'game_loss' });
    expect(after.ledger[0]!.playerId).not.toBe(maxi);

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await pump;
    const all = events.join('');
    expect(all).toContain('event: ready');
    expect(all.split('event: change').length - 1).toBeGreaterThan(20);
  });

  it('nur Owner dürfen Korrekturbuchungen vornehmen; Zahlungen sind idempotent', async () => {
    const snap = await rpc<{ players: { id: string }[] }>(member, 'getRoomSnapshot', roomId);
    const pid = snap.players[1]!.id;
    expect(await code(rpc(member, 'recordAdjustment', roomId, pid, -100, 'Kulanz', null, crypto.randomUUID()))).toBe('owner_required');
    const key = crypto.randomUUID();
    await rpc(member, 'recordPayment', roomId, pid, 200, 'bar', key);
    await rpc(member, 'recordPayment', roomId, pid, 200, 'bar', key);
    expect(await code(rpc(member, 'recordPayment', roomId, pid, 0, null, crypto.randomUUID()))).toBe('invalid_amount');
    const after = await rpc<{ ledger: unknown[] }>(member, 'getRoomSnapshot', roomId);
    expect(after.ledger).toHaveLength(2);
  });

  it('speichert dauerhaft: ein neuer Serverprozess sieht denselben Stand', async () => {
    const reloaded = new ClubServer(new FileStorage(dataFile));
    const ownerId = reloaded.authenticate(owner);
    const { result } = await reloaded.call(ownerId, 'getRoomSnapshot', [roomId]);
    const snap = result as { games: { status: string }[]; ledger: unknown[] };
    expect(snap.games[0]!.status).toBe('finished');
    expect(snap.ledger).toHaveLength(2);
    expect(readFileSync(dataFile, 'utf8')).not.toContain(memberToken);
  });

  it('liefert das Frontend nicht aus fremden Pfaden aus', async () => {
    const r = await fetch(`${base}/api/unbekannt`);
    expect(r.status).toBe(404);
  });
});
