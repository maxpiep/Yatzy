import { expect, test, type Page } from '@playwright/test';

const CATEGORIES = [
  ['ones', [1, 1, 1, 2, 3]],
  ['twos', [2, 2, 2, 1, 3]],
  ['threes', [3, 3, 3, 1, 2]],
  ['fours', [4, 4, 4, 1, 2]],
  ['fives', [5, 5, 5, 1, 2]],
  ['sixes', [6, 6, 6, 1, 2]],
  ['three_kind', [6, 6, 6, 5, 5]],
  ['four_kind', [6, 6, 6, 6, 5]],
  ['full_house', [2, 2, 3, 3, 3]],
  ['small_straight', [1, 2, 3, 4, 6]],
  ['large_straight', [2, 3, 4, 5, 6]],
  ['kniffel', [4, 4, 4, 4, 4]],
  ['chance', [6, 6, 5, 5, 4]],
] as const;

async function createClub(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-club').click();
  await expect(page.getByTestId('open-start')).toBeVisible();
}

async function enterRoll(page: Page, dice: readonly number[]) {
  for (const v of dice) await page.getByTestId(`pad-${v}`).click();
  await page.getByTestId('confirm-roll').click();
  await expect(page.getByTestId('roll-state')).toContainText('Bestätigt');
}

async function noHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
}

test('Abbrechen im Einsatz-Modal erstellt keine Partie', async ({ page }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  const dialog = page.getByRole('dialog', { name: 'Wie hoch ist der Einsatz für diese Partie?' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirm-start')).toBeDisabled();
  await page.getByTestId('stake-500').click();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('live-game')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('open-start')).toBeVisible();
});

test('komplette Partie: Einsatz 5 €, Abschluss, Historie und Kasse', async ({ page }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  await page.getByTestId('stake-500').click();
  await page.getByTestId('confirm-start').dblclick();
  // Der zweite Klick kann nach dem Schließen auf der Navigation landen – entscheidend ist: genau eine Partie.
  await page.goto('/partie');
  const games = await page.evaluate(() => JSON.parse(localStorage.getItem('kniffel-club:local:v1') ?? '{}').games.length);
  expect(games).toBe(1);
  await expect(page.getByTestId('game-stake')).toHaveText('Einsatz dieser Partie: 5,00 €');
  await noHorizontalOverflow(page);

  for (const [category, good] of CATEGORIES) {
    for (let i = 0; i < 2; i++) {
      const who = (await page.getByTestId('current-player').textContent())?.trim();
      // Maxi würfelt gut, Franzi immer 1-1-2-2-3 (meist gestrichen) → Franzi verliert.
      await enterRoll(page, who === 'Maxi' ? good : [1, 1, 2, 2, 3]);
      if (category === 'ones' && i === 0) {
        // Wiederaufnahme nach Reload: bestätigter Wurf bleibt erhalten.
        await page.reload();
        await expect(page.getByTestId('roll-state')).toContainText('Bestätigt · Wurf 1 von 3');
      }
      await page.getByTestId(`pick-${category}`).click();
      await page.getByTestId('confirm-score').click();
      await expect(page.getByTestId('confirm-score')).toHaveCount(0);
    }
  }

  await page.getByTestId('open-finish').click();
  await expect(page.getByRole('dialog', { name: 'Partie abschließen' })).toContainText('Franzi wird 5,00 € in der Kniffelkasse belastet');
  await page.getByTestId('confirm-finish').click();
  await expect(page.getByRole('heading', { name: 'Sieg für Maxi' })).toBeVisible();
  await expect(page.getByText('Einsatz dieser Partie: 5,00 €')).toBeVisible();
  await expect(page.getByText('Franzi zahlt 5,00 €')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('open-franzi')).toHaveText('5,00 €');
  await expect(page.getByTestId('open-maxi')).toHaveText('0,00 €');

  await page.goto('/kasse');
  await expect(page.locator('tr[data-entry]')).toHaveCount(1);
  await page.getByTestId('open-payment').click();
  await page.getByLabel('Betrag in €').fill('2,50');
  await noHorizontalOverflow(page);
  await page.getByTestId('confirm-payment').click();
  await expect(page.locator('tr[data-entry]')).toHaveCount(2);
  await page.goto('/');
  await expect(page.getByTestId('open-franzi')).toHaveText('2,50 €');

  await page.goto('/bestenliste');
  await expect(page.getByText('Berechnet aus 1 abgeschlossenen Partien')).toBeVisible();
  await page.goto('/historie');
  await expect(page.locator('.game-list li')).toHaveCount(1);
  await noHorizontalOverflow(page);
});

test('zwei Tabs sehen denselben Spielstand', async ({ page, context }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  await page.getByTestId('stake-100').click();
  await page.getByTestId('confirm-start').click();
  await expect(page.getByTestId('game-stake')).toBeVisible();
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByTestId('roll-state')).toContainText('Entwurf · Wurf 1');
  await enterRoll(page, [5, 5, 5, 5, 5]);
  await expect(second.getByTestId('roll-state')).toContainText('Bestätigt · Wurf 1 von 3');
  await expect(second.getByText('Kniffel!')).toBeVisible();
});

test('Direktaufruf einer unbekannten Seite zeigt eine Fehlerseite', async ({ page }) => {
  await createClub(page);
  await page.goto('/gibt-es-nicht');
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
});

test('Datensicherung lässt sich herunterladen und wiederherstellen', async ({ page }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  await page.getByTestId('stake-200').click();
  await page.getByTestId('confirm-start').click();
  await expect(page.getByTestId('game-stake')).toBeVisible();
  await page.goto('/einstellungen');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-export').click()]);
  const path = await download.path();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.getByTestId('create-club').click();
  await page.goto('/einstellungen');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('backup-import').setInputFiles(path);
  await page.waitForLoadState('load');
  await page.goto('/');
  await expect(page.getByTestId('live-game')).toBeVisible();
});
