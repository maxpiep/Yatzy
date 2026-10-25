/**
 * PIN-Sperre für den Ein-Gerät-Modus. Gespeichert wird nur ein PBKDF2-Hash (SHA-256, Salz),
 * nie die PIN selbst. Hinweis: Dies ist eine Zugangssperre gegen Mitspieler am Tisch, kein
 * Ersatz für Geräteverschlüsselung – die Daten liegen weiterhin im Browser-Speicher des Geräts.
 */
const PIN_KEY = 'kniffel-club:pin:v1';
const ATTEMPTS_KEY = 'kniffel-club:pin-attempts:v1';
const UNLOCK_KEY = 'kniffel-club:unlocked';
const ITERATIONS = 150_000;
export const FREE_ATTEMPTS = 5;

export interface PinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredPin {
  salt: string;
  hash: string;
  iterations: number;
}

interface Attempts {
  failed: number;
  lockedUntil: number;
}

export const PIN_PATTERN = /^\d{4,8}$/;

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => Number.parseInt(h, 16)));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return toHex(bits);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class PinLock {
  constructor(
    private readonly store: PinStorage,
    private readonly session: PinStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  hasPin(): boolean {
    return Boolean(this.store.getItem(PIN_KEY));
  }

  isUnlocked(): boolean {
    return this.hasPin() && this.session.getItem(UNLOCK_KEY) === '1';
  }

  lock(): void {
    this.session.removeItem(UNLOCK_KEY);
  }

  async setPin(pin: string): Promise<void> {
    if (!PIN_PATTERN.test(pin)) throw new Error('Die PIN muss aus 4 bis 8 Ziffern bestehen.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const stored: StoredPin = { salt: toHex(salt.buffer), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
    this.store.setItem(PIN_KEY, JSON.stringify(stored));
    this.store.removeItem(ATTEMPTS_KEY);
    this.session.setItem(UNLOCK_KEY, '1');
  }

  private attempts(): Attempts {
    try {
      return { failed: 0, lockedUntil: 0, ...(JSON.parse(this.store.getItem(ATTEMPTS_KEY) ?? '{}') as Partial<Attempts>) };
    } catch {
      return { failed: 0, lockedUntil: 0 };
    }
  }

  /** Millisekunden, bis wieder ein Versuch erlaubt ist (0 = sofort). */
  waitMs(): number {
    return Math.max(0, this.attempts().lockedUntil - this.now());
  }

  failedAttempts(): number {
    return this.attempts().failed;
  }

  /** Prüft die PIN. Nach 5 Fehlversuchen steigende Wartezeit (30 s, 60 s, 120 s …). */
  async unlock(pin: string): Promise<'ok' | 'wrong' | 'wait'> {
    if (this.waitMs() > 0) return 'wait';
    const raw = this.store.getItem(PIN_KEY);
    if (!raw) return 'wrong';
    const stored = JSON.parse(raw) as StoredPin;
    const ok = PIN_PATTERN.test(pin) && safeEqual(await derive(pin, fromHex(stored.salt), stored.iterations), stored.hash);
    if (ok) {
      this.store.removeItem(ATTEMPTS_KEY);
      this.session.setItem(UNLOCK_KEY, '1');
      return 'ok';
    }
    const a = this.attempts();
    a.failed += 1;
    if (a.failed >= FREE_ATTEMPTS) a.lockedUntil = this.now() + 30_000 * 2 ** (a.failed - FREE_ATTEMPTS);
    this.store.setItem(ATTEMPTS_KEY, JSON.stringify(a));
    return 'wrong';
  }

  async changePin(oldPin: string, newPin: string): Promise<'ok' | 'wrong' | 'wait'> {
    const res = await this.unlock(oldPin);
    if (res !== 'ok') return res;
    await this.setPin(newPin);
    return 'ok';
  }

  /** Entfernt die PIN (nur zusammen mit dem Löschen aller Daten verwendet). */
  clear(): void {
    this.store.removeItem(PIN_KEY);
    this.store.removeItem(ATTEMPTS_KEY);
    this.session.removeItem(UNLOCK_KEY);
  }
}

function safeStorage(get: () => Storage): PinStorage {
  const mem = new Map<string, string>();
  const s = (): Storage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return {
    getItem: (k) => {
      try {
        return s()?.getItem(k) ?? mem.get(k) ?? null;
      } catch {
        return mem.get(k) ?? null;
      }
    },
    setItem: (k, v) => {
      try {
        s()?.setItem(k, v);
      } catch {
        /* ignorieren */
      }
      mem.set(k, v);
    },
    removeItem: (k) => {
      try {
        s()?.removeItem(k);
      } catch {
        /* ignorieren */
      }
      mem.delete(k);
    },
  };
}

export function browserPinLock(): PinLock {
  return new PinLock(
    safeStorage(() => window.localStorage),
    safeStorage(() => window.sessionStorage),
  );
}
