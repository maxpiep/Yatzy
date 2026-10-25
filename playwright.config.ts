import { defineConfig, devices } from '@playwright/test';

// E2E-Tests laufen gegen den lokalen Modus (ohne Supabase). Multiplayer über Supabase
// wird auf Datenbankebene in tests/db getestet.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: { VITE_BACKEND_MODE: 'local' },
  },
});
