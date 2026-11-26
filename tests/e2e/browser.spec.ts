import { expect, test } from '@playwright/test';
import { cell, collectErrors, createProjectWithTasks, row } from './helpers';

// Modalità "solo browser": nessun server, i dati stanno nel localStorage.
// Ogni test parte da un browser pulito, quindi con i dati di esempio.

test('si apre con i dati di esempio, senza errori', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Gantt Planner');
  await expect(page.locator('.brand')).toContainText('Gantt Planner');
  await expect(page.locator('.syncbar .sb-state')).toHaveText('Dati salvati nel browser');
  await expect(page.locator('.sidebar .proj .pname')).toHaveText(['P-101 Macchina demo', 'P-102 Movimentazione']);
  await page.waitForTimeout(4500); // il controllo del backup automatico parte dopo 4 s
  expect(errors).toEqual([]);
});

test('nuovo progetto: le barre del Gantt e il riepilogo seguono le attività', async ({ page }) => {
  await page.goto('/');
  const project = await createProjectWithTasks(page);

  // il progetto si calcola dalle attività: inizio minimo, fine massima, somma delle ore
  await expect(cell(page, project, 'start')).toHaveText('02/03/2026');
  await expect(cell(page, project, 'end')).toHaveText('20/03/2026');
  await expect(cell(page, project, 'hours')).toHaveText('64');
  await expect(cell(page, 'Progettazione', 'days')).toHaveText('10');

  // una barra per riga; in scala "settimana" un giorno = 10 px
  await expect(page.locator('.gantt-body .bar')).toHaveCount(3);
  const bar = page.locator('.gantt-body .bar[title^="Progettazione"]');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.width)).toBe(12 * 10);

  // un'attività annullata esce da date e ore del progetto
  await row(page, 'Montaggio').locator('select.cell-select').first().selectOption('CANCELLED');
  await expect(cell(page, project, 'hours')).toHaveText('40');
  await expect(cell(page, project, 'end')).toHaveText('13/03/2026');
});

test('trascinare una barra sposta le date; annulla e ripristina', async ({ page }) => {
  await page.goto('/');
  await createProjectWithTasks(page);

  const bar = page.locator('.gantt-body .bar[title^="Progettazione"]');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y, { steps: 4 });
  await page.mouse.move(x + 70, y, { steps: 4 }); // +7 giorni
  await page.mouse.up();

  await expect(cell(page, 'Progettazione', 'start')).toHaveText('09/03/2026');
  await expect(cell(page, 'Progettazione', 'end')).toHaveText('20/03/2026');

  // allungare la barra dal bordo destro: +3 giorni sulla fine
  const box2 = (await bar.boundingBox())!;
  const right = box2.x + box2.width - 2;
  await page.mouse.move(right, y);
  await page.mouse.down();
  await page.mouse.move(right + 30, y, { steps: 4 });
  await page.mouse.up();
  await expect(cell(page, 'Progettazione', 'start')).toHaveText('09/03/2026');
  await expect(cell(page, 'Progettazione', 'end')).toHaveText('23/03/2026');

  await page.keyboard.press('Control+z');
  await expect(cell(page, 'Progettazione', 'end')).toHaveText('20/03/2026');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 'Progettazione', 'start')).toHaveText('02/03/2026');
  await page.keyboard.press('Control+y');
  await expect(cell(page, 'Progettazione', 'start')).toHaveText('09/03/2026');
});

test('i dati restano nel browser dopo aver ricaricato la pagina', async ({ page }) => {
  await page.goto('/');
  await createProjectWithTasks(page, 'Progetto persistente');
  await page.reload();
  await expect(page.locator('.sidebar .proj .pname', { hasText: 'Progetto persistente' })).toBeVisible();
});

test('carico di lavoro calcolato dai dati di esempio', async ({ page }) => {
  await page.goto('/');
  await page.locator('.topbar .nav button', { hasText: 'Carico di lavoro' }).click();
  // Programma PLC: 120 h su 18 giorni lavorativi (2 di malattia) → 6,67 h/giorno = 83 %
  const erika = page.locator('tr', { hasText: 'Erika Mustermann' }).first();
  await expect(erika).toContainText('83 %');
});

test('backup JSON: esporta, svuota tutto e reimporta', async ({ page }, testInfo) => {
  await page.goto('/');
  page.on('dialog', (d) => d.accept());

  await page.getByRole('button', { name: /Importa \/ Esporta/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.modal button.primary', { hasText: 'Esporta' }).click(),
  ]);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^GANTT_.*\.json$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Svuota tutto' }).click();
  await expect(page.locator('.sidebar .proj')).toHaveCount(0);

  await page.getByRole('button', { name: /Importa \/ Esporta/ }).click();
  await page.locator('.modal .tabs').getByRole('button', { name: 'Importa' }).click();
  await page.locator('.modal input[type=file]').setInputFiles(file);
  await page.locator('.modal').getByText('Sostituisci tutti i dati').click();
  await page.locator('.modal').getByRole('button', { name: 'Importa ora' }).click();
  await expect(page.locator('.sidebar .proj .pname')).toHaveText(['P-101 Macchina demo', 'P-102 Movimentazione']);
});

test('lingua tedesca e tema scuro', async ({ page }) => {
  await page.goto('/');
  await page.locator('.topbar select').selectOption('de');
  await expect(page.locator('.topbar .nav')).toContainText('Auslastung');
  await page.locator('.topbar button[title]').last().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
