// shared/ops.mjs: le operazioni per record devono ricostruire ESATTAMENTE quello che l'utente vede.
// Per ogni azione dell'interfaccia: dati prima → azione → dati dopo; le operazioni calcolate,
// applicate ai dati di prima (come farà il server), devono dare gli stessi record e lo stesso ordine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, diffOps, invalidOps } from '../shared/ops.mjs';
import {
  addNode,
  addNote,
  addPerson,
  deleteNode,
  deletePerson,
  getState,
  indentNode,
  mergeData,
  moveNode,
  outdentNode,
  replaceData,
  toggleCollapsed,
  undo,
  updateNode,
} from '../src/store.ts';
import { node } from './helpers/tmp.mjs';

const clone = (d) => JSON.parse(JSON.stringify(d));
const strip = (list) => list.map(({ collapsed: _c, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id));
const childOrder = (d) => {
  const m = {};
  for (const n of d.nodes) (m[n.parentId ?? '·'] ||= []).push(n.id);
  return m;
};

function same(action, label) {
  const before = clone(getState().data);
  action();
  const after = clone(getState().data);
  const ops = diffOps(before, after);
  assert.equal(invalidOps(ops.length ? ops : [{ op: 'del', t: 'node', id: 'x' }]), null, `${label}: operazioni valide`);
  const server = clone(before);
  applyOps(server, ops);
  assert.deepEqual(childOrder(server), childOrder(after), `${label}: ordine`);
  for (const list of ['nodes', 'people', 'absences', 'notes']) {
    assert.deepEqual(strip(server[list]), strip(after[list]), `${label}: ${list}`);
  }
  return ops;
}

const tree = () => ({
  people: [{ id: 'mr', name: 'Mario Rossi', role: 'PM', color: '#2f7de1', hoursPerDay: 8 }],
  nodes: [
    node('p', 'Commessa'),
    node('a', 'Meccanica', 'p'),
    node('a1', 'Progettazione', 'a', { hours: 40, assigneeId: 'mr' }),
    node('a2', 'Montaggio', 'a'),
    node('b', 'Software', 'p'),
    node('b1', 'PLC', 'b'),
    node('c', 'Collaudo', 'p'),
    node('q', 'Altra commessa'),
  ],
});

test('rientra, togli rientro, sposta su/giù, aggiungi dopo, elimina ramo: stesso albero sul server', () => {
  replaceData(tree());
  same(() => indentNode('b'), 'rientra');
  same(() => outdentNode('b'), 'togli rientro');
  same(() => moveNode('c', -1), 'sposta su');
  same(() => moveNode('a', 1), 'sposta giù');
  same(() => addNode('a', 'Nuova', 'a1'), 'aggiungi dopo');
  same(() => addNode('p', 'In fondo'), 'aggiungi in fondo');
  same(() => moveNode('q', -1), 'sposta un progetto');
  same(() => deleteNode('a'), 'elimina ramo');
  same(() => updateNode('b1', { hours: 12, start: '2026-03-02', end: '2026-03-06' }), 'campi');
  same(() => addNote('b1', { title: 'Riunione' }), 'nota');
  same(() => addPerson({ name: 'Anna', role: '', color: '#e07b39', hoursPerDay: 6 }), 'persona');
  same(() => deletePerson('mr'), 'elimina persona');
  same(() => undo(), 'annulla');
  same(() => mergeData(tree()), 'aggiungi un backup');
});

test('aprire o chiudere un ramo non genera operazioni (è una preferenza di chi guarda)', () => {
  replaceData(tree());
  const ops = same(() => toggleCollapsed('a'), 'ramo');
  assert.deepEqual(ops, []);
});

test('un set riporta i valori di prima (servono a riconoscere le sovrascritture)', () => {
  replaceData(tree());
  const ops = same(() => updateNode('a1', { hours: 44 }), 'ore');
  assert.deepEqual(ops, [{ op: 'set', t: 'node', id: 'a1', set: { hours: 44 }, prev: { hours: 40 } }]);
});

test('le modifiche locali non ancora confermate non vengono toccate da un evento altrui', () => {
  const data = { nodes: [node('x', 'X', null, { hours: 1, name: 'Mio nome' })], people: [], absences: [], notes: [] };
  applyOps(data, [{ op: 'set', t: 'node', id: 'x', set: { hours: 9, name: 'Nome di Anna' } }], {
    keep: (t, id) => (t === 'node' && id === 'x' ? new Set(['name']) : undefined),
  });
  assert.equal(data.nodes[0].hours, 9);
  assert.equal(data.nodes[0].name, 'Mio nome');
});

test('controlli: tipi, campi e valori ammessi', () => {
  assert.equal(invalidOps([{ op: 'set', t: 'node', id: 'a', set: { hours: 3 } }]), null);
  assert.match(invalidOps([{ op: 'set', t: 'node', id: 'a', set: { hours: '3' } }]), /hours/);
  assert.match(invalidOps([{ op: 'set', t: 'note', id: 'a', set: { tags: new Array(20).fill('x') } }]), /tags/);
  assert.match(invalidOps([{ op: 'order', t: 'person', parent: null, ids: [] }]), /order/);
  assert.match(invalidOps('niente'), /nessuna/);
});
