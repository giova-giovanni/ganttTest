// Export CSV (src/utils/io.ts): stessi numeri che si vedono nelle schermate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeopleCsv } from '../src/utils/io.ts';
import { parseCsv } from '../src/utils/csv.ts';
import { migrate } from '../src/store.ts';
import { node } from './helpers/tmp.mjs';

test('CSV Responsabili: niente progetti archiviati né attività annullate (come la schermata Responsabili)', () => {
  const week = { start: '2026-03-09', end: '2026-03-13' };
  const data = migrate({
    people: [{ id: 'p1', name: 'Mario Rossi', role: 'PM', color: '#2f7de1', hoursPerDay: 8 }],
    nodes: [
      node('a', 'Commessa attiva'),
      node('a1', 'Montaggio', 'a', { assigneeId: 'p1', hours: 10, ...week }),
      node('a2', 'Annullata', 'a', { assigneeId: 'p1', hours: 5, status: 'CANCELLED', ...week }),
      node('x', 'Commessa archiviata', null, { archived: true }),
      node('x1', 'Vecchio lavoro', 'x', { assigneeId: 'p1', hours: 30, ...week }),
    ],
  });
  const rows = parseCsv(buildPeopleCsv(data, 'it'));
  // Nome · Ruolo · Ore/giorno · Attività · Ore assegnate (h) · Colore
  assert.equal(rows[1][0], 'Mario Rossi');
  assert.equal(rows[1][3], '1', 'attività contate');
  assert.equal(rows[1][4], '10', 'ore');
});
