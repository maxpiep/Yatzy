import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { BackendError, ERROR_MESSAGES, toBackendError } from '../src/data/errors';
import type { ClubServer } from './clubServer';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};

const MAX_BODY = 64 * 1024;

export interface HttpOptions {
  club: ClubServer;
  /** Verzeichnis des Frontend-Builds (dist). */
  staticDir?: string;
  /** Höchstzahl neuer Geräte-Sitzungen pro IP und Stunde. */
  sessionsPerHour?: number;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(json);
}

function sendError(res: ServerResponse, err: BackendError) {
  const status =
    err.code === 'not_authenticated' ? 401 : err.code === 'forbidden' || err.code === 'owner_required' ? 403 : err.code === 'unknown' ? 500 : 409;
  // Die Meldung enthält nur den Fehlercode-Text – nie Tokens oder interne Details.
  send(res, status, { error: { code: err.code, message: ERROR_MESSAGES[err.code] ?? err.message } });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new BackendError('invalid_request');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new BackendError('invalid_request');
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function createHttpServer({ club, staticDir, sessionsPerHour = 30 }: HttpOptions): Server {
  const watchers = new Map<string, Set<ServerResponse>>();
  const sessionLog = new Map<string, number[]>();
  const root = staticDir ? resolve(staticDir) : null;

  const notify = (roomId: string) => {
    for (const res of watchers.get(roomId) ?? []) res.write(`event: change\ndata: {}\n\n`);
  };

  const heartbeat = setInterval(() => {
    for (const set of watchers.values()) for (const res of set) res.write(`: ping\n\n`);
  }, 25_000);
  heartbeat.unref();

  const serveStatic = (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    if (!root) return send(res, 404, { error: { code: 'not_found' } });
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root + sep) && file !== root) return send(res, 400, { error: { code: 'invalid_request' } });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA-Fallback für Unterseiten
    if (!existsSync(file)) return send(res, 404, { error: { code: 'not_found' } });
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { code: 'method_not_allowed' } });
        return serveStatic(req, res, path);
      }

      if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, mode: 'server' });

      if (path === '/api/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const recent = (sessionLog.get(ip) ?? []).filter((t) => now - t < 3_600_000);
        if (recent.length >= sessionsPerHour) return send(res, 429, { error: { code: 'rate_limited', message: 'Zu viele neue Geräte. Bitte später erneut versuchen.' } });
        recent.push(now);
        sessionLog.set(ip, recent);
        return send(res, 200, club.createSession());
      }

      if (path === '/api/rpc' && req.method === 'POST') {
        const userId = club.authenticate(bearer(req));
        const body = (await readJson(req)) as { method?: unknown; args?: unknown };
        if (typeof body.method !== 'string') throw new BackendError('invalid_request');
        const { result, changedRoom } = await club.call(userId, body.method, Array.isArray(body.args) ? body.args : []);
        send(res, 200, { result: result ?? null });
        if (changedRoom) notify(changedRoom);
        return;
      }

      // Echtzeit: Server-Sent Events, Authentifizierung per Header (kein Token in der URL).
      const events = /^\/api\/rooms\/([0-9a-f-]{36})\/events$/.exec(path);
      if (events && req.method === 'GET') {
        const userId = club.authenticate(bearer(req));
        const roomId = events[1]!;
        if (!club.canWatch(userId, roomId)) throw new BackendError('forbidden');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...SECURITY_HEADERS,
        });
        res.write(`event: ready\ndata: {}\n\n`);
        const set = watchers.get(roomId) ?? new Set();
        set.add(res);
        watchers.set(roomId, set);
        req.on('close', () => {
          set.delete(res);
          if (set.size === 0) watchers.delete(roomId);
        });
        return;
      }

      send(res, 404, { error: { code: 'not_found' } });
    } catch (e) {
      const err = toBackendError(e);
      if (err.code === 'unknown') console.error('Unerwarteter Serverfehler:', e instanceof Error ? e.message : e);
      if (!res.headersSent) sendError(res, err);
      else res.end();
    }
  });

  server.on('close', () => clearInterval(heartbeat));
  return server;
}
