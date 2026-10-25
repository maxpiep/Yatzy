import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KeyValueStorage } from '../src/data/localBackend';

/**
 * Persistenter Schlüssel-Wert-Speicher in einer JSON-Datei.
 * Jeder Schreibvorgang wird atomar ersetzt (temporäre Datei + fsync + rename) –
 * ein Absturz hinterlässt nie eine halb geschriebene Datei. Vor jedem Start wird ein Backup angelegt.
 */
export class FileStorage implements KeyValueStorage {
  private data: Record<string, string>;

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      copyFileSync(file, `${file}.bak`);
    } else {
      this.data = {};
      this.flush();
    }
  }

  getItem(key: string): string | null {
    return this.data[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = value;
    this.flush();
  }

  private flush(): void {
    const tmp = join(dirname(this.file), `.${Date.now()}-${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.data));
    const fd = openSync(tmp, 'r');
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, this.file);
  }
}
