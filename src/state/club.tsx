import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Backend, ConnectionStatus, CreatedRoom, RoomSnapshot } from '../data/backend';
import { BackendError, REFRESH_CODES, toBackendError } from '../data/errors';
import { chooseBackend, LOCAL_MODE_KEY, type BackendChoice } from '../data/createBackend';
import { LocalBackend } from '../data/localBackend';
import type { Room } from '../domain/types';
import { readLocal, writeLocal } from '../lib/storage';
import { useToast } from './toast';

const ROOM_KEY = 'kniffel-club:room';

export type Phase =
  | { kind: 'booting' }
  | { kind: 'unconfigured' }
  | { kind: 'fatal'; error: BackendError }
  | { kind: 'no-room' }
  | { kind: 'ready' };

export type SyncState = 'connecting' | 'synced' | 'offline' | 'saving' | 'save-failed' | 'local';

interface RunOptions {
  success?: string;
  /** Fehler nicht als Toast anzeigen (z. B. weil ein Dialog sie selbst darstellt). */
  quiet?: boolean;
}

interface ClubContext {
  phase: Phase;
  backend: Backend | null;
  rooms: Room[];
  room: Room | null;
  snapshot: RoomSnapshot | null;
  syncState: SyncState;
  refresh: () => Promise<void>;
  run: <T>(fn: (backend: Backend) => Promise<T>, options?: RunOptions) => Promise<T>;
  createRoom: (name: string, maxi: string, franzi: string) => Promise<CreatedRoom>;
  joinRoom: (token: string) => Promise<{ roomId: string; role: Room['role'] }>;
  selectRoom: (roomId: string) => void;
  acceptLocalMode: () => void;
}

const Context = createContext<ClubContext | null>(null);

export function ClubProvider({ children, choice }: { children: ReactNode; choice?: () => BackendChoice }) {
  const { notify } = useToast();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'booting' });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [saving, setSaving] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const requestSeq = useRef(0);
  const chooser = useRef(choice ?? (() => chooseBackend()));

  const boot = useCallback(async (b: Backend) => {
    setBackend(b);
    try {
      await b.init();
      const list = await b.listRooms();
      setRooms(list);
      const stored = readLocal(ROOM_KEY);
      const pick = list.find((r) => r.id === stored) ?? list[0] ?? null;
      setRoomId(pick?.id ?? null);
      setPhase(pick ? { kind: 'ready' } : { kind: 'no-room' });
    } catch (e) {
      setPhase({ kind: 'fatal', error: toBackendError(e) });
    }
  }, []);

  useEffect(() => {
    const c = chooser.current();
    if (c.kind === 'unconfigured') {
      setPhase({ kind: 'unconfigured' });
      return;
    }
    void boot(c.backend);
  }, [boot]);

  const refresh = useCallback(async () => {
    if (!backend || !roomId) return;
    const id = ++requestSeq.current;
    try {
      const snap = await backend.getRoomSnapshot(roomId);
      // Nur die jüngste Antwort übernehmen (Schutz vor veralteten, verspäteten Antworten).
      if (id === requestSeq.current) setSnapshot(snap);
    } catch (e) {
      const err = toBackendError(e);
      if (id !== requestSeq.current) return;
      if (err.code === 'forbidden') {
        writeLocal(ROOM_KEY, null);
        setPhase({ kind: 'fatal', error: err });
      } else if (err.code === 'network') {
        setConnection('offline');
      } else {
        notify(err.message, 'error');
      }
    }
  }, [backend, roomId, notify]);

  useEffect(() => {
    if (!backend || !roomId || phase.kind !== 'ready') return;
    writeLocal(ROOM_KEY, roomId);
    // refresh() setzt den State erst nach dem asynchronen Laden – kein synchroner Render-Kaskadeneffekt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const unsubscribe = backend.subscribe(roomId, () => void refresh(), setConnection);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [backend, roomId, phase.kind, refresh]);

  const run = useCallback<ClubContext['run']>(
    async (fn, options) => {
      if (!backend) throw new BackendError('not_configured');
      setSaving((n) => n + 1);
      try {
        const result = await fn(backend);
        setSaveFailed(false);
        if (options?.success) notify(options.success, 'success');
        await refresh();
        return result;
      } catch (e) {
        const err = toBackendError(e);
        setSaveFailed(true);
        if (!options?.quiet) notify(err.message, 'error');
        if (REFRESH_CODES.has(err.code)) await refresh();
        throw err;
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [backend, notify, refresh],
  );

  const reloadRooms = useCallback(async (b: Backend, select: string) => {
    const list = await b.listRooms();
    setRooms(list);
    setRoomId(select);
    writeLocal(ROOM_KEY, select);
    setPhase({ kind: 'ready' });
  }, []);

  const createRoom = useCallback<ClubContext['createRoom']>(
    async (name, maxi, franzi) => {
      if (!backend) throw new BackendError('not_configured');
      try {
        const created = await backend.createRoom(name, maxi, franzi);
        const list = await backend.listRooms();
        setRooms(list);
        return created;
      } catch (e) {
        throw toBackendError(e);
      }
    },
    [backend],
  );

  const joinRoom = useCallback<ClubContext['joinRoom']>(
    async (token) => {
      if (!backend) throw new BackendError('not_configured');
      try {
        const res = await backend.joinRoom(token);
        await reloadRooms(backend, res.roomId);
        return res;
      } catch (e) {
        throw toBackendError(e);
      }
    },
    [backend, reloadRooms],
  );

  const selectRoom = useCallback(
    (id: string) => {
      setRoomId(id);
      writeLocal(ROOM_KEY, id);
      setPhase({ kind: 'ready' });
    },
    [],
  );

  const acceptLocalMode = useCallback(() => {
    writeLocal(LOCAL_MODE_KEY, '1');
    setPhase({ kind: 'booting' });
    void boot(new LocalBackend());
  }, [boot]);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  let syncState: SyncState;
  if (saving > 0) syncState = 'saving';
  else if (saveFailed) syncState = 'save-failed';
  else if (backend?.mode === 'local') syncState = 'local';
  else syncState = connection;

  const value = useMemo<ClubContext>(
    () => ({
      phase,
      backend,
      rooms,
      room: snapshot?.room ?? room,
      snapshot: snapshot?.room.id === roomId ? snapshot : null,
      syncState,
      refresh,
      run,
      createRoom,
      joinRoom,
      selectRoom,
      acceptLocalMode,
    }),
    [phase, backend, rooms, room, snapshot, roomId, syncState, refresh, run, createRoom, joinRoom, selectRoom, acceptLocalMode],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useClub(): ClubContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('ClubProvider fehlt');
  return ctx;
}

/** Nur innerhalb der Phase `ready` mit geladenem Snapshot verwenden. */
export function useSnapshot(): RoomSnapshot {
  const { snapshot } = useClub();
  if (!snapshot) throw new Error('Snapshot noch nicht geladen');
  return snapshot;
}
