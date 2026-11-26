// Stato e import «Aggiungi» (src/store.ts → mergeData), migrazione e annulla/ripristina.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addProject, canUndo, getState, mergeData, migrate, redo, replaceData, undo, updateNode } from '../src/store.ts';
import { node } from './helpers/tmp.mjs';

const mario = { id: 'p1', name: 'Mario Rossi', role: 'PM', color: '#2f7de1', hoursPerDay: 8 };
const backup = {
  version: 4,
  people: [mario],
  absences: [{ id: 'a1', personId: 'p1', start: '2026-03-09', end: '2026-03-13', type: 'VACATION', note: '' }],
  nodes: [node('n1', 'P-199'), node('n2', 'Montaggio', 'n1', { assigneeId: 'p1' })],
  notes: [],
};

test('aggiungere due volte lo stesso file non raddoppia le assenze (né i giorni di ferie)', () => {
  replaceData({});
  mergeData(backup);
  const second = mergeData(backup);
  const d = getState().data;
  assert.equal(d.people.length, 1, 'la persona viene riconosciuta per nome');
  assert.equal(d.absences.length, 1, 'stessa persona, stesse date, stesso motivo = la stessa assenza');
  assert.equal(second.absences, 0);
});

test('aggiungere un backup: id in conflitto rimappati, collegamenti conservati', () => {
  replaceData(backup);
  const r = mergeData(backup);
  const d = getState().data;
  assert.equal(r.projects, 1);
  assert.equal(d.nodes.length, 4);
  const copy = d.nodes.find((n) => n.name === 'Montaggio' && n.id !== 'n2');
  const copyParent = d.nodes.find((n) => n.id === copy.parentId);
  assert.equal(copyParent.name, 'P-199');
  assert.notEqual(copyParent.id, 'n1');
  assert.equal(copy.assigneeId, 'p1');
});

test('migrazione: dati sporchi ripuliti senza eccezioni', () => {
  const d = migrate({
    nodes: [
      { id: 'a', parentId: 'b', name: 'ciclo A' },
      { id: 'b', parentId: 'a', name: 'ciclo B' },
      { id: 'a', parentId: null, name: 'doppione' },
      { id: 'c', parentId: 'manca', name: 'orfano', hours: '16,5', start: '2026-03-20', end: '2026-03-10' },
      null,
      'testo',
    ],
    people: [{ id: 'p', name: 'X', hoursPerDay: 99, color: 'rosso' }],
    absences: [{ id: 'z', personId: 'nessuno', start: '2026-01-01', end: '2026-01-02' }],
  });
  assert.equal(d.nodes.length, 4);
  assert.equal(new Set(d.nodes.map((n) => n.id)).size, 4, 'id unici');
  const orphan = d.nodes.find((n) => n.name === 'orfano');
  assert.equal(orphan.parentId, null);
  assert.equal(orphan.hours, 16.5);
  assert.deepEqual([orphan.start, orphan.end], ['2026-03-10', '2026-03-20']);
  assert.equal(d.people[0].hoursPerDay, 8);
  assert.equal(d.people[0].color, '#2f7de1');
  assert.equal(d.absences.length, 0);
  // nessun ciclo rimasto: risalendo i genitori si arriva sempre a una radice
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  for (const n of d.nodes) {
    let cur = n;
    let steps = 0;
    while (cur.parentId && steps++ < 10) cur = byId[cur.parentId];
    assert.ok(steps < 10, 'ciclo non spezzato');
  }
});

test('annulla / ripristina', () => {
  replaceData({});
  const id = addProject('Nuovo');
  updateNode(id, { name: 'Rinominato' });
  assert.equal(getState().data.nodes[0].name, 'Rinominato');
  assert.ok(canUndo());
  undo();
  assert.equal(getState().data.nodes[0].name, 'Nuovo');
  redo();
  assert.equal(getState().data.nodes[0].name, 'Rinominato');
});
