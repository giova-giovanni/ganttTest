import { expect, type Locator, type Page } from '@playwright/test';

/** colonne della tabella attività, nell'ordine in cui compaiono */
export const COL = { name: 0, status: 1, start: 2, end: 3, hours: 4, days: 5, assignee: 6, notes: 7 } as const;

/**
 * Raccoglie gli errori JavaScript della pagina.
 * Le richieste di rete fallite non contano: senza server (modalità browser) il backup
 * settimanale prova comunque /api/backup e il browser registra il 404, ma l'app lo gestisce.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  return errors;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** riga della tabella attività con questo nome */
export function row(page: Page, name: string): Locator {
  return page
    .locator('table.grid tbody tr')
    .filter({ has: page.locator('.name-text', { hasText: new RegExp(`^${escapeRe(name)}`) }) })
    .first();
}

export function cell(page: Page, name: string, col: keyof typeof COL): Locator {
  return row(page, name).locator('td').nth(COL[col]);
}

/** doppio clic sulla cella, scrive il valore e conferma con Invio */
export async function editCell(page: Page, name: string, col: 'name' | 'start' | 'end' | 'hours', value: string) {
  await cell(page, name, col).dblclick();
  const input = page.locator('table.grid input.cell-input');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** crea un progetto con due attività e restituisce i nomi usati */
export async function createProjectWithTasks(page: Page, project = 'Progetto di prova') {
  page.once('dialog', (d) => d.accept(project));
  await page.getByRole('button', { name: '+ Nuovo progetto' }).click();
  await expect(row(page, project)).toBeVisible();

  for (const t of [
    { name: 'Progettazione', start: '02/03/2026', end: '13/03/2026', hours: '40' },
    { name: 'Montaggio', start: '16/03/2026', end: '20/03/2026', hours: '24' },
  ]) {
    await row(page, project).click();
    await page.getByRole('button', { name: '+ Sotto-attività' }).click();
    await editCell(page, 'Nuova attività', 'name', t.name);
    await editCell(page, t.name, 'start', t.start);
    await editCell(page, t.name, 'end', t.end);
    await editCell(page, t.name, 'hours', t.hours);
  }
  return project;
}
