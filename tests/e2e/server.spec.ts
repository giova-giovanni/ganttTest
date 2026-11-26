import { expect, test, type Browser, type Page } from '@playwright/test';
import { cell, collectErrors, editCell } from './helpers';

// Modalità "server": archivio su file (cartella temporanea), più persone che lavorano insieme.
// Ogni utente ha il proprio contesto del browser (cookie e localStorage separati).

interface User {
  page: Page;
  errors: string[];
  close: () => Promise<void>;
}

/** apre il programma ed entra con un nome (modo «aperto»: nessun gantt-utenti.json) */
async function enter(browser: Browser, name: string): Promise<User> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto('/');
  const dialog = page.locator('.modal', { hasText: 'Accesso a Gantt Planner' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type=text]').fill(name);
  await dialog.getByRole('button', { name: 'Entra' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.syncbar .sb-state')).toHaveText('In linea');
  return { page, errors, close: () => ctx.close() };
}

test('archivio condiviso: due persone modificano insieme e si vedono a vicenda', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await enter(browser, 'Utente Uno');

  await test.step('il primo utente carica i dati di esempio nell’archivio vuoto', async () => {
    await a.page.getByRole('button', { name: 'Carica dati di esempio' }).click();
    await expect(a.page.locator('.sidebar .proj')).toHaveCount(2);
  });

  const b = await enter(browser, 'Utente Due');

  await test.step('anche il secondo entra in modifica, con gli stessi dati', async () => {
    await expect(b.page.locator('.sidebar .proj')).toHaveCount(2);
    await expect(a.page.getByRole('button', { name: '+ Nuovo progetto' })).toBeEnabled();
    await expect(b.page.getByRole('button', { name: '+ Nuovo progetto' })).toBeEnabled();
  });

  await test.step('ognuno vede chi altro è connesso', async () => {
    await expect(a.page.locator('.syncbar .presence-dots .avatar[title="Utente Due"]')).toBeVisible();
    await expect(b.page.locator('.syncbar .presence-dots .avatar[title="Utente Uno"]')).toBeVisible();
  });

  await test.step('le modifiche di ciascuno arrivano subito all’altro', async () => {
    await a.page.locator('.sidebar .proj').first().click();
    await b.page.locator('.sidebar .proj').first().click();
    await editCell(a.page, 'P-101 Macchina demo', 'name', 'P-101 Rinominato');
    await expect(b.page.locator('.sidebar .proj .pname').first()).toHaveText(/^P-101 Rinominato/, { timeout: 10_000 });
    await editCell(b.page, 'Requisiti', 'hours', '30');
    await expect(cell(a.page, 'Requisiti', 'hours')).toHaveText('30', { timeout: 10_000 });
  });

  await test.step('stessa cella quasi insieme: vince l’ultimo, l’altro può rimettere il suo valore', async () => {
    // il salvataggio del secondo resta in viaggio finché il primo non ha salvato il suo
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await b.page.route('**/api/operazioni', async (route) => {
      await gate;
      await route.continue();
    });
    await editCell(b.page, 'Telaio', 'hours', '20');
    const savedA = a.page.waitForResponse((r) => r.url().includes('/api/operazioni') && r.ok());
    await editCell(a.page, 'Telaio', 'hours', '10');
    await savedA;
    release();

    await expect(cell(a.page, 'Telaio', 'hours')).toHaveText('20', { timeout: 10_000 });
    const restore = a.page.getByRole('button', { name: 'Rimetti il mio valore' });
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(cell(a.page, 'Telaio', 'hours')).toHaveText('10');
    await expect(cell(b.page, 'Telaio', 'hours')).toHaveText('10', { timeout: 10_000 });
    await b.page.unroute('**/api/operazioni');
  });

  await test.step('il registro dice chi ha cambiato cosa', async () => {
    await a.page.getByRole('button', { name: 'Registro modifiche' }).click();
    const log = a.page.locator('.modal', { hasText: 'Registro delle modifiche' });
    await expect(log).toContainText('Utente Uno');
    await expect(log).toContainText('Utente Due');
    await a.page.keyboard.press('Escape');
    await expect(log).toHaveCount(0);
  });

  await test.step('dopo il ricaricamento i dati arrivano dal server, senza chiedere di nuovo il nome', async () => {
    await b.page.reload();
    await expect(b.page.locator('.sidebar .proj .pname').first()).toHaveText(/^P-101 Rinominato/);
    await expect(b.page.locator('.syncbar .sb-state')).toHaveText('In linea');
  });

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.close();
  await b.close();
});
