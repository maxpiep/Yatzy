import { defineConfig } from 'vitest/config';

// Datenbanktests gegen eine echte PostgreSQL-Instanz (siehe tests/db/README.md).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
