import { expect, test } from '@playwright/test';

test('zwei Geräte spielen dieselbe Partie über den eigenen Server', async ({ browser }) => {
  const maxi = await (await browser.newContext()).newPage();
  const franzi = await (await browser.newContext()).newPage();

  await maxi.goto('/');
  await maxi.getByTestId('create-club').click();
  const invite = await maxi.getByLabel('Einladungslink', { exact: true }).inputValue();
  expect(invite).toMatch(/\/beitreten#t=[0-9a-f]{48}$/);
  await maxi.getByRole('button', { name: 'Zum Club' }).click();
  await expect(maxi.getByTestId('open-start')).toBeVisible();
  await expect(maxi.getByRole('status').filter({ hasText: 'Synchronisiert' })).toBeVisible();

  // Zweites Gerät tritt über den Link bei; das Token verschwindet aus der Adresszeile.
  await franzi.goto(invite);
  await expect(franzi.getByTestId('open-start')).toBeVisible();
  expect(franzi.url()).not.toContain('#t=');

  await maxi.getByTestId('open-start').click();
  await maxi.getByTestId('stake-200').click();
  await maxi.getByTestId('confirm-start').click();
  await expect(maxi.getByTestId('game-stake')).toHaveText('Einsatz dieser Partie: 2,00 €');

  // Franzi sieht die laufende Partie live, ohne neu zu laden, und trägt den Wurf ein.
  await expect(franzi.getByTestId('live-game')).toBeVisible();
  await franzi.getByRole('link', { name: /Partie fortsetzen/ }).click();
  for (const v of [5, 5, 5, 5, 5]) await franzi.getByTestId(`pad-${v}`).click();
  await franzi.getByTestId('confirm-roll').click();

  // Maxis Gerät erhält den Wurf in Echtzeit und wertet ihn.
  await expect(maxi.getByTestId('roll-state')).toContainText('Bestätigt · Wurf 1 von 3');
  await expect(maxi.getByText('Kniffel!')).toBeVisible();
  await maxi.getByTestId('pick-kniffel').click();
  await maxi.getByTestId('confirm-score').click();

  await expect(franzi.getByTestId('current-player')).toHaveText('Franzi');
  await expect(franzi.locator('[data-testid$="-kniffel"]').first()).toContainText('50');
});

test('ungültige Einladung wird abgewiesen', async ({ page }) => {
  await page.goto(`/beitreten#t=${'0'.repeat(48)}`);
  await expect(page.getByRole('heading', { name: 'Einladung ungültig' })).toBeVisible();
});
