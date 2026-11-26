// Archivio condiviso (server/archive.mjs): operazioni per record, più utenti insieme,
// livelli, registro e ripristino dopo uno spegnimento, protezione dei file.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { configure } from '../server/store.mjs';
import {
  _archive,
  _crash,
  applyBatch,
  batchesSince,
  closeArchive,
  flushSnapshot,
  openArchive,
  readLog,
} from '../server/archive.mjs';
import { cleanupTemp, fakeData, node, tempDataDir } from './helpers/tmp.mjs';

after(async () => {
  _crash();
  await cleanupTemp();
});

async function fresh(files = {}) {
  _crash(); // l'archivio del test precedente si chiude senza scrivere
  const dirs = await tempDataDir();
  configure({ dataDir: dirs.dataDir, appDir: dirs.root, port: 0, mode: 'locale' });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dirs.dataDir, name), content, 'utf8');
  return { ...dirs, main: join(dirs.dataDir, 'gantt-dati.json'), bak: join(dirs.dataDir, 'gantt-dati.bak.json') };
}

const mario = { id: 'u_mario', user: 'Mario Rossi', level: 'modifica' };
const anna = { id: 'u_anna', user: 'Anna Bianchi', level: 'modifica' };
const admin = { id: 'u_admin', user: 'Admin', level: 'admin' };
const lettore = { id: 'u_lett', user: 'Lettore', level: 'lettura' };
const envelope = (rev, data, extra = {}) =>
  JSON.stringify({ kind: 'gantt-data', rev, savedAt: '2026-11-20T10:00:00.000Z', savedBy: 'Test', data, ...extra });
const base = () =>
  fakeData([node('p', 'Commessa'), node('t1', 'Montaggio', 'p', { hours: 16 }), node('t2', 'Collaudo', 'p')]);
const set = (t, id, fields, prev) => ({ op: 'set', t, id, set: fields, ...(prev ? { prev } : {}) });
const find = (id) => _archive().data.nodes.find((n) => n.id === id);
const batch = (session, ops, extra = {}) => applyBatch({ ops, session, client: 'c_' + session.id, batch: 'b' + Math.random(), ...extra });

// ------------------------------------------------------------------ protezione dei file (dalla Fase 1)

test('archivio illeggibile senza copia .bak: il server non parte e il file resta intatto', async () => {
  const broken = '{"kind":"gantt-data","rev":7,"data":{"nodes":[{"id":"n1","name":"Commessa importante"';
  const { main } = await fresh({ 'gantt-dati.json': broken });
  await assert.rejects(openArchive(), /illeggibile/);
  assert.equal(await readFile(main, 'utf8'), broken);
});

test('archivio rovinato con .bak buona: si lavora sulla .bak, e la .bak non viene distrutta', async () => {
  const { main, bak } = await fresh({ 'gantt-dati.json': '{ rotto', 'gantt-dati.bak.json': envelope(6, base()) });
  await openArchive();
  assert.equal(_archive().rev, 6);
  await batch(mario, [set('node', 't1', { hours: 20 })]);
  await flushSnapshot();
  const saved = JSON.parse(await readFile(main, 'utf8'));
  assert.equal(saved.rev, 7);
  assert.equal(saved.data.nodes.find((n) => n.id === 't1').hours, 20);
  assert.equal(JSON.parse(await readFile(bak, 'utf8')).rev, 6, 'la .bak resta l’ultima copia buona');
});

test('primo avvio senza file: archivio vuoto nel formato nuovo', async () => {
  const { main } = await fresh();
  await openArchive();
  await flushSnapshot();
  const saved = JSON.parse(await readFile(main, 'utf8'));
  assert.equal(saved.format, 2);
  assert.equal(saved.rev, 0);
  assert.deepEqual(saved.data.nodes, []);
});

test('migrazione: copia gantt-dati.pre-v2.json identica, dati invariati, revisioni aggiunte', async () => {
  const old = envelope(12, base());
  const { main, dataDir } = await fresh({ 'gantt-dati.json': old });
  await openArchive();
  await flushSnapshot();
  assert.equal(await readFile(join(dataDir, 'gantt-dati.pre-v2.json'), 'utf8'), old);
  const saved = JSON.parse(await readFile(main, 'utf8'));
  assert.equal(saved.format, 2);
  assert.equal(saved.rev, 12);
  assert.deepEqual(saved.data, JSON.parse(old).data, 'la parte «data» è la stessa: la versione precedente la legge ancora');
  await batch(mario, [set('node', 't1', { hours: 18 })]);
  await flushSnapshot();
  const next = JSON.parse(await readFile(main, 'utf8'));
  assert.deepEqual(next.meta['node:t1'].by, 'Mario Rossi');
  assert.equal(next.meta['node:t1'].rev, 13);
});

// ------------------------------------------------------------------ più utenti insieme

test('due utenti cambiano campi diversi della stessa attività: restano entrambe le modifiche', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  const a = await batch(mario, [set('node', 't1', { start: '2026-03-02' }, { start: null })]);
  const b = await batch(anna, [set('node', 't1', { hours: 24 }, { hours: 16 })]);
  assert.deepEqual([a.overwrote, b.overwrote], [[], []]);
  assert.equal(find('t1').start, '2026-03-02');
  assert.equal(find('t1').hours, 24);
});

test('stesso campo nello stesso momento: vince l’ultimo e il valore sostituito viene segnalato', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await batch(mario, [set('node', 't1', { hours: 20 }, { hours: 16 })]);
  // Anna aveva ancora sotto gli occhi 16
  const r = await batch(anna, [set('node', 't1', { hours: 30 }, { hours: 16 })]);
  assert.equal(find('t1').hours, 30);
  assert.equal(r.overwrote.length, 1);
  assert.deepEqual(
    { field: r.overwrote[0].field, value: r.overwrote[0].value, by: r.overwrote[0].by, sid: r.overwrote[0].sid },
    { field: 'hours', value: 20, by: 'Mario Rossi', sid: 'u_mario' },
  );
  // chi cambia di nuovo il proprio valore non «sovrascrive» nessuno
  const again = await batch(anna, [set('node', 't1', { hours: 32 }, { hours: 30 })]);
  assert.deepEqual(again.overwrote, []);
});

test('modifica di un’attività eliminata da un altro: saltata, con il nome di chi l’ha eliminata', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await batch(mario, [{ op: 'del', t: 'node', id: 't2' }]);
  const r = await batch(anna, [set('node', 't2', { hours: 4 })]);
  assert.equal(r.skipped[0].reason, 'eliminato');
  assert.equal(r.skipped[0].by, 'Mario Rossi');
  assert.deepEqual(r.fix, [{ t: 'node', id: 't2', deleted: true }]);
  assert.equal(find('t2'), undefined);
});

test('spostare un’attività sotto un ramo eliminato nel frattempo: lo spostamento non passa', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, fakeData([node('p', 'P'), node('a', 'A', 'p'), node('b', 'B', 'p')])) });
  await openArchive();
  await batch(mario, [{ op: 'del', t: 'node', id: 'a' }]);
  const r = await batch(anna, [set('node', 'b', { parentId: 'a' })]);
  assert.equal(find('b').parentId, 'p');
  assert.equal(r.fix[0].rec.parentId, 'p');
});

test('livelli controllati dal server: lettura, modifica, amministratore', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await assert.rejects(batch(lettore, [set('node', 't1', { hours: 1 })]), (e) => e.status === 403);
  await assert.rejects(batch(mario, [{ op: 'del', t: 'node', id: 'p' }]), (e) => e.status === 403, 'eliminare un progetto');
  await assert.rejects(
    batch(mario, [{ op: 'add', t: 'absence', rec: { id: 'a1', personId: 'x', start: '2026-03-02', end: '2026-03-03', type: 'SICK', note: '' } }]),
    (e) => e.status === 403,
    'ferie e permessi',
  );
  await assert.rejects(batch(mario, [{ op: 'replace', data: fakeData() }]), (e) => e.status === 403, 'sostituire tutto');
  assert.equal((await batch(mario, [{ op: 'del', t: 'node', id: 't2' }])).ok, true, 'eliminare un’attività è lavoro normale');
  assert.equal((await batch(admin, [{ op: 'del', t: 'node', id: 'p' }])).ok, true);
});

test('operazioni non valide rifiutate (400)', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  const bad = [
    [{ op: 'set', t: 'utente', id: 'x', set: { name: 'a' } }],
    [set('node', 't1', { collapsed: true })],
    [set('node', 't1', { start: '15/03/2026' })],
    [set('node', 't1', { hours: -4 })],
    [{ op: 'add', t: 'node', rec: { ...node('x\u0001', 'X', 'p') } }],
    [],
  ];
  for (const ops of bad) await assert.rejects(batch(mario, ops), (e) => e.status === 400, JSON.stringify(ops));
});

test('eliminazioni a cascata: ramo con figli e note; responsabile con assenze e assegnazioni', async () => {
  const data = base();
  data.people = [{ id: 'mr', name: 'Mario Rossi', role: '', color: '#2f7de1', hoursPerDay: 8 }];
  data.nodes.find((n) => n.id === 't1').assigneeId = 'mr';
  data.absences = [{ id: 'ab', personId: 'mr', start: '2026-03-02', end: '2026-03-03', type: 'VACATION', note: '' }];
  data.notes = [{ id: 'nt', nodeId: 't2', title: 'Nota', body: '', tags: [], author: '', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z', pinned: false }];
  await fresh({ 'gantt-dati.json': envelope(1, data) });
  await openArchive();
  await batch(admin, [{ op: 'del', t: 'person', id: 'mr' }]);
  assert.equal(find('t1').assigneeId, null);
  assert.equal(_archive().data.absences.length, 0);
  await batch(admin, [{ op: 'del', t: 'node', id: 'p' }]);
  assert.equal(_archive().data.nodes.length, 0);
  assert.equal(_archive().data.notes.length, 0);
});

// ------------------------------------------------------------------ registro e ripristino

test('spegnimento brusco: all’avvio si riapplicano le modifiche del registro', async () => {
  const { main } = await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await flushSnapshot();
  await batch(mario, [set('node', 't1', { hours: 21 })]);
  await batch(anna, [{ op: 'add', t: 'node', rec: node('t3', 'Imballo', 'p') }]);
  await batch(mario, [{ op: 'del', t: 'node', id: 't2' }]);
  _crash(); // gantt-dati.json non è stato riscritto
  assert.equal(JSON.parse(await readFile(main, 'utf8')).rev, 1);
  await openArchive();
  assert.equal(_archive().rev, 4);
  assert.equal(find('t1').hours, 21);
  assert.ok(find('t3'));
  assert.equal(find('t2'), undefined);
  assert.equal(_archive().meta.get('node:t3').by, 'Anna Bianchi');
});

test('registro leggibile: chi, quando, cosa; filtro per progetto', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, fakeData([...base().nodes, node('q', 'Altra commessa')])) });
  await openArchive();
  await batch(mario, [set('node', 't1', { hours: 18 }, { hours: 16 })]);
  await batch(anna, [set('node', 'q', { name: 'Altra commessa 2' })]);
  const all = await readLog();
  assert.equal(all.length, 2);
  assert.equal(all[0].user, 'Anna Bianchi', 'dal più recente');
  assert.deepEqual(all[1].changes[0].fields.hours, [16, 18]);
  const onlyP = await readLog({ project: 'p' });
  assert.equal(onlyP.length, 1);
  assert.equal(onlyP[0].changes[0].label, 'Montaggio');
});

test('chi si ricollega riceve solo quello che si è perso; dopo un riavvio deve ricaricare', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await batch(mario, [set('node', 't1', { hours: 1 })]);
  await batch(mario, [set('node', 't1', { hours: 2 })]);
  await batch(mario, [set('node', 't1', { hours: 3 })]);
  assert.deepEqual(batchesSince(2).map((e) => e.rev), [3, 4]);
  _crash();
  await openArchive();
  assert.equal(batchesSince(2), null);
});

test('stesso gruppo mandato due volte (risposta persa in rete): applicato una volta sola', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  const ops = [{ op: 'add', t: 'node', rec: node('t9', 'Nuova', 'p') }];
  const first = await applyBatch({ ops, session: mario, client: 'c_x', batch: 'b_1' });
  const second = await applyBatch({ ops, session: mario, client: 'c_x', batch: 'b_1' });
  assert.equal(second.rev, first.rev);
  assert.equal(second.duplicate, true);
  assert.equal(_archive().rev, first.rev);
});

test('salvataggi contemporanei messi in fila: revisioni consecutive, niente perso', async () => {
  await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => batch(i % 2 ? mario : anna, [{ op: 'add', t: 'node', rec: node(`n${i}`, `Riga ${i}`, 'p') }])),
  );
  assert.deepEqual(results.map((r) => r.rev).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2));
  assert.equal(_archive().data.nodes.length, 23);
});

// ------------------------------------------------------------------ cartella e file

test('un secondo server sulla stessa cartella si apre in sola lettura e non scrive', async () => {
  const { dataDir } = await fresh({ 'gantt-dati.json': envelope(1, base()) });
  const other = { host: hostname() === 'ALTRO-PC' ? 'ALTRO-PC-2' : 'ALTRO-PC', pid: 4242, url: 'http://altro-pc:5180', since: new Date().toISOString(), beat: new Date().toISOString() };
  await writeFile(join(dataDir, 'gantt-server.json'), JSON.stringify(other), 'utf8');
  const r = await openArchive();
  assert.equal(r.readOnly.host, other.host);
  assert.equal(r.readOnly.url, 'http://altro-pc:5180');
  await assert.rejects(batch(mario, [set('node', 't1', { hours: 1 })]), (e) => e.status === 503);
});

test('id con caratteri di percorso: nessun file fuori dalla cartella dati, nessun temporaneo rimasto', async () => {
  const { root, dataDir } = await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await batch(mario, [{ op: 'add', t: 'node', rec: node('../../../fuori', 'Strano', 'p') }]);
  await flushSnapshot();
  assert.deepEqual((await readdir(root)).filter((f) => f !== 'dati'), []);
  assert.deepEqual((await readdir(dataDir)).filter((f) => f.endsWith('.tmp')), []);
});

test('chiusura ordinata: file scritto e cartella liberata', async () => {
  const { dataDir, main } = await fresh({ 'gantt-dati.json': envelope(1, base()) });
  await openArchive();
  await batch(mario, [set('node', 't1', { hours: 7 })]);
  await closeArchive();
  assert.equal(JSON.parse(await readFile(main, 'utf8')).data.nodes.find((n) => n.id === 't1').hours, 7);
  assert.ok(!(await readdir(dataDir)).includes('gantt-server.json'));
});
