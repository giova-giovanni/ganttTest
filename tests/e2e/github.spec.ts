import { expect, test, type Browser, type Page } from '@playwright/test';
import { cell, collectErrors, editCell, row } from './helpers';
import { FakeGitHub, preconnect } from './fake-github';

// Archivio su GitHub (sito statico, per esempio GitHub Pages): l'app legge e scrive un file in un
// repository con le API di GitHub. Qui GitHub è simulato in memoria (fake-github.ts): stesse
// chiamate, stesso controllo dello sha, più persone sullo stesso file.

const node = (id: string, parentId: string | null, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  parentId,
  name,
  status: 'TODO',
  start: null,
  end: null,
  hours: null,
  assigneeId: null,
  notes: '',
  collapsed: false,
  archived: false,
  ...extra,
});

const seedData = {
  version: 4,
  people: [{ id: 'u1', name: 'Mario Rossi', role: 'Tecnico', color: '#2f7de1', hoursPerDay: 8 }],
  absences: [],
  notes: [],
  nodes: [
    node('P1', null, 'Impianto Nord'),
    node('T1', 'P1', 'Progettazione', { start: '2026-03-02', end: '2026-03-13', hours: 40 }),
    node('T2', 'P1', 'Montaggio', { start: '2026-03-16', end: '2026-03-20', hours: 24 }),
  ],
};

const hoursOf = (gh: FakeGitHub, id: string) => gh.file()?.data.nodes.find((n) => n.id === id)?.hours;

interface User {
  page: Page;
  errors: string[];
  close: () => Promise<void>;
}

/** un utente con il proprio browser, già collegato al repository con il suo token */
async function open(browser: Browser, gh: FakeGitHub, token: string): Promise<User> {
  const ctx = await browser.newContext();
  await gh.install(ctx);
  await preconnect(ctx, token);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('.syncbar .sb-state')).toHaveText('GitHub');
  return { page, errors, close: () => ctx.close() };
}

const syncNow = (page: Page) => page.getByRole('button', { name: /Aggiorna/ }).click();

test('collegamento: i dati del browser vanno nel file, che si rilegge dopo il ricaricamento', async ({ page }) => {
  const gh = new FakeGitHub();
  await gh.install(page);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('.syncbar .sb-state')).toHaveText('Dati salvati nel browser');

  await page.getByRole('button', { name: 'Salva su GitHub…' }).click();
  await page.getByLabel('Repository dei dati').fill('prova/gantt-dati');
  await page.getByLabel('Token di accesso').fill('tok-mario');
  await page.getByRole('button', { name: 'Collega', exact: true }).click();

  await expect(page.locator('.syncbar .sb-state')).toHaveText('GitHub');
  await expect(page.locator('.syncbar')).toContainText('prova/gantt-dati · @mario');

  // repository appena creato e progetti solo nel browser: si propone di trasferirli
  await page.getByRole('button', { name: 'Trasferisci nell’archivio' }).click();
  await expect(page.locator('.sidebar .proj .pname')).toHaveText(['P-101 Macchina demo', 'P-102 Movimentazione']);
  await expect.poll(() => gh.file()?.data.nodes.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(5);
  await expect(page.locator('.syncbar .sb-info')).toContainText('Salvato');
  expect(gh.commits).toHaveLength(1);
  expect(gh.commits[0].user).toBe('mario');
  expect(gh.commits[0].message).toMatch(/^Gantt: Modifiche: \d+ progetti, \d+ attività/);
  expect(gh.file()).toMatchObject({ kind: 'gantt-data', savedBy: 'Mario Rossi' });

  // il token non finisce mai nel file
  expect(JSON.stringify(gh.file())).not.toContain('tok-mario');

  await page.reload();
  await expect(page.locator('.syncbar .sb-state')).toHaveText('GitHub');
  await expect(page.locator('.sidebar .proj .pname')).toHaveText(['P-101 Macchina demo', 'P-102 Movimentazione']);
  expect(errors).toEqual([]);
});

test('due persone sullo stesso file: le modifiche si uniscono, nessun lavoro perso', async ({ browser }) => {
  test.setTimeout(90_000);
  const gh = new FakeGitHub();
  gh.seed(seedData);
  const a = await open(browser, gh, 'tok-mario');
  const b = await open(browser, gh, 'tok-anna');
  await expect(row(a.page, 'Progettazione')).toBeVisible();
  await expect(row(b.page, 'Montaggio')).toBeVisible();

  await test.step('ognuno modifica una cosa diversa, senza sapere dell’altro', async () => {
    await editCell(a.page, 'Progettazione', 'hours', '20');
    await editCell(b.page, 'Montaggio', 'name', 'Montaggio finale');
  });

  await test.step('il primo salva; il secondo trova il file cambiato, unisce e salva da solo', async () => {
    await syncNow(a.page);
    await expect.poll(() => gh.commits.length).toBe(1);
    await syncNow(b.page);
    await expect.poll(() => gh.commits.length).toBe(2);
    expect(gh.conflicts).toBeGreaterThanOrEqual(1);
    expect(hoursOf(gh, 'T1')).toBe(20);
    expect(gh.file()!.data.nodes.find((n) => n.id === 'T2')!.name).toBe('Montaggio finale');
    expect(gh.commits.map((c) => c.user)).toEqual(['mario', 'anna']);
    expect(gh.commits.map((c) => c.message)).toEqual([
      'Gantt: Modifica: attività «Progettazione»',
      'Gantt: Modifica: attività «Montaggio finale»',
    ]);
  });

  await test.step('entrambi vedono tutte e due le modifiche', async () => {
    await expect(cell(b.page, 'Progettazione', 'hours')).toHaveText('20');
    await syncNow(a.page);
    await expect(row(a.page, 'Montaggio finale')).toBeVisible();
  });

  await test.step('«annulla» toglie solo la propria modifica, non quella del collega', async () => {
    await a.page.keyboard.press('Control+z');
    await expect(cell(a.page, 'Progettazione', 'hours')).toHaveText('40');
    await expect(row(a.page, 'Montaggio finale')).toBeVisible();
    await syncNow(a.page);
    await expect.poll(() => hoursOf(gh, 'T1')).toBe(40);
    expect(gh.file()!.data.nodes.find((n) => n.id === 'T2')!.name).toBe('Montaggio finale');
  });

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.close();
  await b.close();
});

test('senza rete le modifiche restano nel browser e partono alla riapertura', async ({ browser }) => {
  const gh = new FakeGitHub();
  gh.seed(seedData);
  const ctx = await browser.newContext();
  await gh.install(ctx);
  await preconnect(ctx, 'tok-mario');
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(row(page, 'Progettazione')).toBeVisible();

  gh.offline = true;
  await editCell(page, 'Progettazione', 'hours', '33');
  await syncNow(page);
  await expect(page.locator('.toast.err')).toContainText('GitHub non raggiungibile');
  await expect(page.locator('.syncbar .sb-info.warn')).toHaveText('Modifiche da salvare');
  await page.close();
  expect(hoursOf(gh, 'T1')).toBe(40);

  gh.offline = false;
  const again = await ctx.newPage();
  await again.goto('/');
  await expect(cell(again, 'Progettazione', 'hours')).toHaveText('33');
  await expect.poll(() => hoursOf(gh, 'T1'), { timeout: 15_000 }).toBe(33);
  await expect(again.locator('.syncbar .sb-info')).toContainText('Salvato');
  await ctx.close();
});

test('repository pubblico: avviso chiaro e conferma prima di collegare', async ({ page }) => {
  const gh = new FakeGitHub();
  gh.private = false;
  await gh.install(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Salva su GitHub…' }).click();
  await page.getByLabel('Repository dei dati').fill('https://github.com/prova/gantt-dati');
  await page.getByLabel('Token di accesso').fill('tok-anna');
  await page.getByRole('button', { name: 'Collega', exact: true }).click();
  await expect(page.locator('.gh-msg.caution')).toContainText('prova/gantt-dati è un repository pubblico');
  await expect(page.locator('.syncbar .sb-state')).toHaveText('Dati salvati nel browser');
  await page.getByRole('button', { name: 'Collega comunque' }).click();
  await expect(page.locator('.syncbar .sb-state')).toHaveText('GitHub');
});

test('token sbagliato: messaggio chiaro e nessun collegamento', async ({ page }) => {
  const gh = new FakeGitHub();
  await gh.install(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Salva su GitHub…' }).click();
  await page.getByLabel('Repository dei dati').fill('prova/gantt-dati');
  await page.getByLabel('Token di accesso').fill('tok-sbagliato');
  await page.getByRole('button', { name: 'Collega', exact: true }).click();
  await expect(page.locator('.gh-msg.err')).toContainText('Token di GitHub non valido o scaduto');
  await expect(page.locator('.syncbar .sb-state')).toHaveText('Dati salvati nel browser');
});
