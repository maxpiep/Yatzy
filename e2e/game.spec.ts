import { expect, test, type Page } from '@playwright/test';

// Beste Werte je Feld (Maxi); Franzi streicht immer → Franzi verliert.
const CATEGORIES = [
  ['ones', 3],
  ['twos', 6],
  ['threes', 9],
  ['fours', 12],
  ['fives', 15],
  ['sixes', 18],
  ['three_kind', 28],
  ['four_kind', 29],
  ['full_house', 25],
  ['small_straight', 30],
  ['large_straight', 40],
  ['kniffel', 50],
  ['chance', 27],
] as const;

const PIN = '2580';

async function setPin(page: Page) {
  await page.getByLabel('Neue PIN (4–8 Ziffern)').fill(PIN);
  await page.getByLabel('PIN wiederholen').fill(PIN);
  await page.getByTestId('pin-save').click();
}

async function unlock(page: Page) {
  await page.getByLabel('PIN eingeben').fill(PIN);
  await page.getByTestId('pin-unlock').click();
}

async function createClub(page: Page) {
  await page.goto('/');
  await setPin(page);
  await page.getByTestId('create-club').click();
  await expect(page.getByTestId('open-start')).toBeVisible();
}

/** Feld antippen, Wert wählen, bestätigen – wie auf dem Papierblock. */
async function enterScore(page: Page, category: string, points: number) {
  await page.getByTestId(`pick-${category}`).click();
  await page.getByTestId(`opt-${points}`).click();
  await page.getByTestId('confirm-pick').click();
  await expect(page.getByTestId('confirm-pick')).toHaveCount(0);
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

  for (const [category, best] of CATEGORIES) {
    for (let i = 0; i < 2; i++) {
      const who = (await page.getByTestId('current-player').textContent())?.trim();
      await enterScore(page, category, who === 'Maxi' ? best : 0);
      if (category === 'ones' && i === 0) {
        // Wiederaufnahme nach Reload: der eingetragene Wert bleibt erhalten, Franzi ist dran.
        await page.reload();
        await expect(page.getByTestId('current-player')).toHaveText('Franzi');
      }
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
  await unlock(second);
  await expect(second.getByTestId('current-player')).toHaveText('Maxi');
  await enterScore(page, 'kniffel', 50);
  await expect(second.getByTestId('current-player')).toHaveText('Franzi');
  await expect(second.locator('[data-testid$="-kniffel"]').first()).toContainText('50');
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
  await setPin(page);
  await page.getByTestId('create-club').click();
  await page.goto('/einstellungen');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('backup-import').setInputFiles(path);
  // Die App lädt nach der Wiederherstellung selbst die Übersicht neu.
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('live-game')).toBeVisible();
});

test('PIN-Sperre: ohne richtige PIN kein Zugriff, Sperren-Knopf und Fehlversuche', async ({ page, context }) => {
  await createClub(page);
  await page.getByTestId('lock-now').click();
  await expect(page.getByRole('heading', { name: 'Gesperrt' })).toBeVisible();
  await expect(page.getByTestId('open-start')).toHaveCount(0);
  await page.getByLabel('PIN eingeben').fill('0000');
  await page.getByTestId('pin-unlock').click();
  await expect(page.getByRole('alert')).toContainText('Falsche PIN');
  await unlock(page);
  await expect(page.getByTestId('open-start')).toBeVisible();

  // Neuer Tab (= neue Sitzung) ist wieder gesperrt; Direktaufruf einer Unterseite ebenso.
  const other = await context.newPage();
  await other.goto('/kasse');
  await expect(other.getByRole('heading', { name: 'Gesperrt' })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Kniffelkasse' })).toHaveCount(0);
  // Die PIN steht nirgends im Klartext im Speicher.
  const dump = await other.evaluate(() => JSON.stringify(localStorage));
  expect(dump).not.toContain('2580');
});

test('Direkteingabe: nur mögliche Werte, Abbrechen trägt nichts ein, Zusatz-Kniffel und Korrektur', async ({ page }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  await page.getByTestId('stake-200').click();
  await page.getByTestId('confirm-start').click();
  await expect(page.getByTestId('game-stake')).toBeVisible();

  // Einser: genau 1–5 Würfel plus Streichen, Bestätigen erst nach Auswahl.
  await page.getByTestId('pick-ones').click();
  const dialog = page.getByRole('dialog', { name: 'Einser · Maxi' });
  await expect(dialog.getByRole('radio')).toHaveCount(6);
  await expect(page.getByTestId('confirm-pick')).toBeDisabled();
  await page.getByTestId('opt-4').click();
  await expect(page.getByTestId('confirm-pick')).toHaveText('4 Punkte eintragen');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('current-player')).toHaveText('Maxi');

  await enterScore(page, 'kniffel', 50); // Maxi
  await enterScore(page, 'chance', 20); // Franzi
  // Maxi: weiterer Kniffel als Joker in der Großen Straße.
  await page.getByTestId('pick-large_straight').click();
  await page.getByTestId('opt-40').click();
  await page.getByTestId('extra-kniffel').check();
  await page.getByTestId('confirm-pick').click();
  await expect(page.locator('.duel__score').first()).toContainText('140');

  // Korrektur: eingetragenen Wert antippen, neuen Wert + Grund + Bestätigung.
  const franziChance = page.locator('[data-testid$="-chance"] button').first(); // einziges eingetragenes Chance-Feld (Franzi)
  await franziChance.click();
  await page.getByTestId('opt-24').click();
  await page.getByLabel('Grund der Korrektur').fill('falsch angetippt');
  await page.getByText('Ich bestätige diese Korrektur.').click();
  await page.getByTestId('confirm-pick').click();
  await expect(page.locator('.duel__score').nth(1)).toContainText('24');
});

test('zweiter Kniffel: über das Kniffel-Feld oder den Knopf eintragen, Joker und +50', async ({ page }) => {
  await createClub(page);
  await page.getByTestId('open-start').click();
  await page.getByTestId('stake-100').click();
  await page.getByTestId('confirm-start').click();
  await expect(page.getByTestId('game-stake')).toBeVisible();

  await enterScore(page, 'kniffel', 50); // Maxi
  await enterScore(page, 'chance', 20); // Franzi

  // Weg 1: Maxi tippt auf sein belegtes Kniffel-Feld.
  await page.locator('[data-testid$="-kniffel"] button').first().click();
  await page.getByTestId('extra-kniffel-choose').click();
  await page.getByTestId('pick-fives').click();
  await expect(page.getByTestId('extra-kniffel')).toBeChecked();
  await expect(page.getByTestId('confirm-pick')).toHaveText('25 Punkte eintragen');
  await page.getByTestId('confirm-pick').click();
  await expect(page.locator('.duel__score').first()).toContainText('125');

  await enterScore(page, 'ones', 0); // Franzi

  // Weg 2: Knopf „Weiteren Kniffel gewürfelt?“.
  await page.getByTestId('extra-kniffel-start').click();
  await page.getByTestId('pick-large_straight').click();
  await expect(page.getByTestId('confirm-pick')).toHaveText('40 Punkte eintragen');
  await page.getByTestId('confirm-pick').click();
  await expect(page.locator('.duel__score').first()).toContainText('215');
});
