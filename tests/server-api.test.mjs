// Rotte /api/* (server/api.mjs): sessioni, livelli, protezioni contro pagine esterne, presenze, registro.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../server/users.mjs';
import { _clearSessions } from '../server/sessions.mjs';
import { browser, startApi } from './helpers/http.mjs';
import { cleanupTemp, fakeData, node } from './helpers/tmp.mjs';

let api;

before(async () => {
  api = await startApi({
    usersJson: {
      utenti: [
        { nome: 'Mario Rossi', livello: 'admin', password: await hashPassword('mario') },
        { nome: 'Anna Bianchi', livello: 'modifica', password: await hashPassword('anna') },
        { nome: 'Luca Verdi', livello: 'lettura', password: await hashPassword('luca') },
      ],
      ospiti: true,
    },
    files: { 'gantt-dati.json': JSON.stringify({ kind: 'gantt-data', rev: 1, data: fakeData([node('p', 'Commessa'), node('t', 'Montaggio', 'p')]) }) },
  });
});

after(async () => {
  await api.close();
  await cleanupTemp();
});

test('/api/info è pubblica (la usano gli script di avvio) e non mostra i percorsi del server', async () => {
  const r = await browser(api.base).get('/api/info');
  assert.equal(r.status, 200);
  assert.equal(r.json.access.mode, 'account');
  assert.equal(r.json.dataDir, undefined);
});

test('senza accesso: niente dati e niente salvataggi (401)', async () => {
  const b = browser(api.base);
  assert.equal((await b.get('/api/stato')).status, 401);
  assert.equal((await b.ops([{ op: 'del', t: 'node', id: 't' }])).status, 401);
});

test('accesso: cookie HttpOnly e SameSite=Strict; poi dati e salvataggi', async () => {
  const anna = browser(api.base);
  const r = await anna.login('Anna Bianchi', 'anna');
  assert.equal(r.status, 200);
  assert.equal(r.json.session.level, 'modifica');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(r.json.session.token, undefined, 'il token non torna mai nel corpo');
  assert.equal((await anna.get('/api/stato')).json.data.nodes.length, 2);
  const s = await anna.ops([{ op: 'set', t: 'node', id: 't', set: { hours: 8 } }]);
  assert.equal(s.status, 200);
  assert.equal(s.json.rev, 2);
});

test('password sbagliata → 403; troppe → 429 con Retry-After', async () => {
  const x = browser(api.base);
  assert.equal((await x.login('Luca Verdi', 'no')).status, 403);
  let last;
  for (let i = 0; i < 6; i += 1) last = await x.login('Luca Verdi', 'no' + i);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('livelli applicati dal server: lettura non scrive, modifica non elimina progetti, admin sì', async () => {
  const ospite = browser(api.base);
  assert.equal((await ospite.login('Visitatore', '')).json.session.level, 'lettura');
  assert.equal((await ospite.ops([{ op: 'set', t: 'node', id: 't', set: { hours: 1 } }])).status, 403);
  const anna = browser(api.base);
  await anna.login('Anna Bianchi', 'anna');
  assert.equal((await anna.ops([{ op: 'del', t: 'node', id: 'p' }])).status, 403);
  const mario = browser(api.base);
  await mario.login('Mario Rossi', 'mario');
  assert.equal((await mario.get('/api/info')).json.dataDir !== undefined, true, 'l’admin vede i percorsi');
});

test('pagine di altri siti: niente scritture senza JSON né con un’altra origine', async () => {
  const anna = browser(api.base);
  await anna.login('Anna Bianchi', 'anna');
  const body = JSON.stringify({ client: 'c_x', batch: 'b_x', ops: [{ op: 'set', t: 'node', id: 't', set: { hours: 99 } }] });
  const plain = await anna.request('POST', '/api/operazioni', body, { 'Content-Type': 'text/plain' });
  assert.equal(plain.status, 400);
  const foreign = await anna.post('/api/operazioni', JSON.parse(body), { Origin: 'http://sito-esterno.example' });
  assert.equal(foreign.status, 403);
  const same = await anna.post('/api/operazioni', JSON.parse(body), { Origin: api.base });
  assert.equal(same.status, 200);
});

test('JSON rotto → 400, rotta sconosciuta → 404', async () => {
  const anna = browser(api.base);
  await anna.login('Anna Bianchi', 'anna');
  assert.equal((await anna.request('POST', '/api/operazioni', '{rotto')).status, 400);
  assert.equal((await anna.get('/api/nulla')).status, 404);
});

test('presenze e modifiche altrui con il ripiego senza canale (poll)', async () => {
  const anna = browser(api.base);
  await anna.login('Anna Bianchi', 'anna');
  const mario = browser(api.base);
  await mario.login('Mario Rossi', 'mario');
  const start = (await mario.get('/api/eventi?poll=1&rev=0&client=c_mario')).json;
  await anna.post('/api/presenza', { client: 'c_anna', page: 'project', project: 'p', node: 't', field: 'hours' });
  await anna.ops([{ op: 'set', t: 'node', id: 't', set: { name: 'Montaggio finale' } }], 'c_anna');
  const r = (await mario.get(`/api/eventi?poll=1&rev=${start.rev}&client=c_mario`)).json;
  assert.equal(r.batches.at(-1).user, 'Anna Bianchi');
  assert.deepEqual(r.batches.at(-1).ops[0].set, { name: 'Montaggio finale' });
  const p = r.presence.find((x) => x.client === 'c_anna');
  assert.deepEqual({ user: p.user, project: p.project, node: p.node }, { user: 'Anna Bianchi', project: 'p', node: 't' });
});

test('registro delle modifiche per chi ha fatto l’accesso', async () => {
  const mario = browser(api.base);
  await mario.login('Mario Rossi', 'mario');
  const r = await mario.get('/api/registro?limit=5');
  assert.equal(r.status, 200);
  assert.ok(r.json.entries.length >= 1);
  assert.ok(r.json.entries.every((e) => e.user && e.at && Array.isArray(e.changes)));
});

test('uscita e sessione dimenticata dal server (riavvio): serve un nuovo accesso', async () => {
  const anna = browser(api.base);
  await anna.login('Anna Bianchi', 'anna');
  assert.equal((await anna.post('/api/sessione/esci', {})).status, 200);
  assert.equal((await anna.get('/api/stato')).status, 401);
  await anna.login('Anna Bianchi', 'anna');
  _clearSessions();
  assert.equal((await anna.get('/api/sessione')).status, 401);
});
