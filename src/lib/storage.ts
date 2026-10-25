/** Browser-Speicher nur für Komfort-Einstellungen; jeder Zugriff ist abgesichert. */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignorieren (privater Modus, blockierter Speicher)
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
