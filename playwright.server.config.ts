import { defineConfig, devices } from '@playwright/test';

// Zwei-Geräte-Tests gegen den eigenen Kniffel-Club-Server (Build + Start mit frischer Datendatei).
export default defineConfig({
  testDir: './e2e',
  testMatch: /server\.spec\.ts/,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4180', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build:selfhost && node e2e/reset-data.cjs && node dist-server/index.js',
    port: 4180,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: '4180', DATA_FILE: 'test-results/e2e-data.json' },
  },
});
