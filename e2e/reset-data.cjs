// Entfernt die Datendatei der E2E-Serverläufe, damit jeder Lauf frisch beginnt.
require('node:fs').rmSync(process.env.DATA_FILE ?? 'test-results/e2e-data.json', { force: true });
