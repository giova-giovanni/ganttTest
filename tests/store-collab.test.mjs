// Lavoro in contemporanea «stile Google Fogli», dal punto di vista del browser (src/store.ts):
// Mario usa l'interfaccia vera, Anna è un secondo utente che scrive direttamente sul server.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { _archive } from '../server/archive.mjs';
import { _clearSessions } from '../server/sessions.mjs';
import { startClientEnv, until } from './helpers/client-env.mjs';
import { browser } from './helpers/http.mjs';
import { cleanupTemp, fakeData, node } from './helpers/tmp.mjs';

const start = fakeData([
  node('p', 'Commessa P-199'),
  node('t1', 'Montaggio', 'p', { hours: 16 }),
  node('t2', 'Collaudo', 'p', { hours: 8 }),
]);

let env;
let store;
let anna;

before(async () => {
  env = await startClientEnv({ files: { 'gantt-dati.json': JSON.stringify({ kind: 'gantt-data', rev: 1, data: start }) } });
  store = await import('../src/store.ts');
  store.setPollInterval(40);
  anna = browser(env.base);
  await anna.login('Anna Bianchi');
});

after(async () => {
  await env.close();
  await cleanupTemp();
});

const S = () => store.getState();
const local = (id) => S().data.nodes.find((n) => n.id === id);
const onServer = (id) => _archive().data.nodes.find((n) => n.id === id);
const settled = () => until(() => S().sync.pending === 0 && !S().sync.saving);

test('all’apertura si chiede il nome; dopo l’accesso arrivano i dati del server', async () => {
  await store.initStore();
  assert.equal(S().sync.mode, 'shared');
  assert.equal(S().sync.needLogin, true);
  const r = await store.login('Mario Rossi', '');
  assert.equal(r.ok, true);
  assert.equal(S().sync.session.user, 'Mario Rossi');
  assert.equal(local('t1').name, 'Montaggio');
  assert.equal(S().sync.rev, 1);
});

test('una modifica dell’interfaccia arriva al server come operazione sul singolo record', async () => {
  store.updateNode('t1', { hours: 20 });
  await settled();
  assert.equal(onServer('t1').hours, 20);
  assert.equal(S().sync.error, null);
});

test('le modifiche di un altro utente compaiono da sole, senza ricaricare', async () => {
  await anna.ops([{ op: 'add', t: 'node', rec: node('t3', 'Imballo (Anna)', 'p') }]);
  await until(() => !!local('t3'));
  assert.equal(local('t3').parentId, 'p');
});

test('campi diversi della stessa attività: restano entrambe le modifiche, nessun avviso', async () => {
  store.updateNode('t2', { start: '2026-03-09' });
  await anna.ops([{ op: 'set', t: 'node', id: 't2', set: { hours: 12 }, prev: { hours: 8 } }]);
  await settled();
  await until(() => local('t2').hours === 12);
  assert.equal(local('t2').start, '2026-03-09');
  assert.equal(onServer('t2').start, '2026-03-09');
  assert.equal(onServer('t2').hours, 12);
  assert.equal(S().sync.notices.length, 0);
});

test('stessa cella: vince l’ultimo; chi è stato sostituito vede l’avviso e può rimettere il suo valore', async () => {
  // Anna aveva ancora sotto gli occhi 16 (prima della modifica di Mario a 20)
  await anna.ops([{ op: 'set', t: 'node', id: 't1', set: { hours: 30 }, prev: { hours: 16 } }]);
  await until(() => local('t1').hours === 30);
  await until(() => S().sync.notices.length > 0);
  const n = S().sync.notices.at(-1);
  assert.equal(n.text, 'notice.overwritten');
  assert.equal(n.vars.user, 'Anna Bianchi');
  assert.deepEqual(n.restore, { t: 'node', id: 't1', field: 'hours', value: 20 });
  store.restoreValue(n);
  await settled();
  assert.equal(onServer('t1').hours, 20);
  assert.equal(S().sync.notices.length, 0);
});

test('«annulla» annulla solo il proprio lavoro, non quello arrivato dagli altri', async () => {
  store.updateNode('t2', { name: 'Collaudo (Mario)' });
  await settled();
  await anna.ops([{ op: 'set', t: 'node', id: 't1', set: { name: 'Montaggio (Anna)' } }]);
  await until(() => local('t1').name === 'Montaggio (Anna)');
  store.undo();
  await settled();
  assert.equal(onServer('t2').name, 'Collaudo');
  assert.equal(onServer('t1').name, 'Montaggio (Anna)', 'il lavoro di Anna resta');
  assert.equal(local('t1').name, 'Montaggio (Anna)');
});

test('rete lenta: salvataggi accodati, nessun falso conflitto, niente perso', async () => {
  env.responseDelay['/api/operazioni'] = 150;
  for (const name of ['A', 'B', 'C', 'D']) store.addNode('p', `Riga ${name}`);
  assert.ok(S().sync.pending > 0);
  await settled();
  env.responseDelay = {};
  const names = _archive().data.nodes.map((n) => n.name);
  for (const name of ['A', 'B', 'C', 'D']) assert.ok(names.includes(`Riga ${name}`), name);
  assert.equal(S().sync.error, null);
  // stesso ordine dei figli nel browser e sul server
  const order = (nodes) => nodes.filter((n) => n.parentId === 'p').map((n) => n.id);
  assert.deepEqual(order(_archive().data.nodes), order(S().data.nodes));
});

test('rami aperti/chiusi: scelta personale, non va sul server', async () => {
  const before = env.requests.filter((r) => r === '/api/operazioni').length;
  store.toggleCollapsed('p');
  assert.equal(local('p').collapsed, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(env.requests.filter((r) => r === '/api/operazioni').length, before);
  assert.equal(onServer('p').collapsed, false);
  // una modifica di Anna alla riga non riapre il ramo di Mario
  await anna.ops([{ op: 'set', t: 'node', id: 'p', set: { name: 'Commessa P-199 bis' } }]);
  await until(() => local('p').name === 'Commessa P-199 bis');
  assert.equal(local('p').collapsed, true);
});

test('modifica su una riga appena eliminata da un altro: avviso con il nome di chi l’ha eliminata', async () => {
  // Mario non riceve aggiornamenti per qualche secondo (rete lenta): il prossimo giro è tra 5 s
  store.setPollInterval(5000);
  await new Promise((r) => setTimeout(r, 150));
  await anna.ops([{ op: 'del', t: 'node', id: 't2' }]);
  assert.ok(local('t2'), 'Mario non ha ancora saputo dell’eliminazione');
  store.updateNode('t2', { hours: 3 });
  await settled();
  const notice = S().sync.notices.find((n) => n.text === 'notice.deleted');
  assert.ok(notice);
  assert.equal(notice.vars.user, 'Anna Bianchi');
  assert.equal(local('t2'), undefined, 'la riga sparisce anche per Mario');
  store.setPollInterval(40);
});

test('sessione scaduta: le modifiche restano in coda e partono dopo il nuovo accesso', async () => {
  _clearSessions();
  store.addNode('p', 'Durante la scadenza');
  await until(() => S().sync.needLogin);
  assert.ok(S().sync.pending > 0);
  assert.equal(S().sync.expired, true);
  const r = await store.login('Mario Rossi', '');
  assert.equal(r.ok, true);
  await settled();
  assert.ok(_archive().data.nodes.some((n) => n.name === 'Durante la scadenza'));
});
