import { expect, test } from '@playwright/test';
import { collectErrors, editCell, row } from './helpers';

// Modalità "server": archivio su file (cartella temporanea), un solo utente alla volta
// in modifica, gli altri in sola lettura con aggiornamento automatico.

test('archivio condiviso: salvataggio su file, blocco e sola lettura', async ({ browser, request }) => {
  test.setTimeout(90_000);

  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const errorsA = collectErrors(a);
  await a.goto('/');

  await test.step('il primo utente lavora in modifica e salva sul file', async () => {
    await expect(a.locator('.syncbar .sb-state')).toHaveText('Modifica');
    // archivio nuovo e vuoto: si caricano i dati di esempio
    await a.getByRole('button', { name: 'Carica dati di esempio' }).click();
    await expect(a.locator('.sidebar .proj')).toHaveCount(2);
    await expect
      .poll(async () => (await (await request.get('api/state')).json()).data.nodes.length, { timeout: 10_000 })
      .toBe(35);
  });

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await b.goto('/');

  await test.step('il secondo utente trova l’archivio occupato e apre in sola lettura', async () => {
    await expect(b.getByText('Archivio già in uso')).toBeVisible();
    await b.getByRole('button', { name: 'Apri in sola lettura' }).click();
    await expect(b.locator('.syncbar .sb-state')).toHaveText('Sola lettura');
    await expect(b.getByRole('button', { name: '+ Nuovo progetto' })).toBeDisabled();
  });

  await test.step('le modifiche del primo arrivano da sole al secondo', async () => {
    await a.locator('.sidebar .proj').first().click();
    await editCell(a, 'P-101 Macchina demo', 'name', 'P-101 Rinominato');
    await expect(row(a, 'P-101 Rinominato')).toBeVisible();
    await expect(b.locator('.sidebar .proj .pname').first()).toHaveText('P-101 Rinominato', { timeout: 20_000 });
  });

  await test.step('il primo lascia la modifica e il secondo subentra', async () => {
    await a.getByRole('button', { name: 'Lascia la modifica' }).click();
    await expect(a.locator('.syncbar .sb-state')).toHaveText('Sola lettura');
    await b.getByRole('button', { name: 'Chiedi di modificare' }).click();
    await expect(b.locator('.syncbar .sb-state')).toHaveText('Modifica');
    await expect(b.getByRole('button', { name: '+ Nuovo progetto' })).toBeEnabled();
  });

  await test.step('dopo il ricaricamento i dati arrivano dal file', async () => {
    await b.reload();
    await expect(b.locator('.sidebar .proj .pname').first()).toHaveText('P-101 Rinominato');
  });

  expect(errorsA).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
