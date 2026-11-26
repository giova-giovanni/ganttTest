// Accesso (server/users.mjs): account personali, password scrypt, livelli, tentativi a raffica, proxy.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authenticate, callerTags, hashPassword, setTrustProxy, setUsersFile, unlockLevel, verifyPassword } from '../server/users.mjs';
import { cleanupTemp, tempDataDir } from './helpers/tmp.mjs';

after(cleanupTemp);

async function usersFile(json) {
  const { root } = await tempDataDir();
  const file = join(root, 'gantt-utenti.json');
  await writeFile(file, JSON.stringify(json), 'utf8');
  setUsersFile(file);
}

let ip = 0;
const fakeReq = () => ({ socket: { remoteAddress: `10.0.0.${++ip}` }, headers: {} });

test('hash scrypt: formato, verifica, sale diverso a ogni hash', async () => {
  const h1 = await hashPassword('Segreta!2026');
  const h2 = await hashPassword('Segreta!2026');
  assert.match(h1, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword('Segreta!2026', h1), true);
  assert.equal(await verifyPassword('segreta!2026', h1), false);
  assert.equal(await verifyPassword('x', 'scrypt$rotto'), false);
  assert.equal(await verifyPassword('vecchia', 'vecchia'), true, 'password in chiaro dei file vecchi: ancora accettata');
});

test('senza file utenti: si entra con il nome, come amministratore (comportamento di prima)', async () => {
  setUsersFile(join((await tempDataDir()).root, 'non-esiste.json'));
  assert.deepEqual(await authenticate(fakeReq(), { nome: '  Mario   Rossi ', password: '' }), {
    ok: true,
    user: 'Mario Rossi',
    level: 'admin',
    mode: 'aperto',
  });
  assert.equal((await authenticate(fakeReq(), { nome: '   ' })).error, 'nome');
});

test('account personali: nome e password giusti → livello dell’account', async () => {
  await usersFile({
    utenti: [
      { nome: 'Mario Rossi', livello: 'admin', password: await hashPassword('mario-2026') },
      { nome: 'Anna Bianchi', livello: 'modifica', password: await hashPassword('anna-2026') },
    ],
  });
  const r = await authenticate(fakeReq(), { nome: 'anna bianchi', password: 'anna-2026' });
  assert.deepEqual({ ok: r.ok, user: r.user, level: r.level }, { ok: true, user: 'Anna Bianchi', level: 'modifica' });
  assert.equal((await authenticate(fakeReq(), { nome: 'Anna Bianchi', password: 'mario-2026' })).error, 'password');
  assert.equal((await authenticate(fakeReq(), { nome: 'Nessuno', password: 'x' })).error, 'password', 'non si dice se l’utente esiste');
  assert.equal((await authenticate(fakeReq(), { nome: 'Anna Bianchi', password: '' })).error, 'password', 'senza ospiti serve la password');
});

test('ospiti: senza account si entra in sola lettura, ma mai con il nome di un account', async () => {
  await usersFile({ ospiti: true, utenti: [{ nome: 'Mario Rossi', livello: 'admin', password: await hashPassword('m') }] });
  const g = await authenticate(fakeReq(), { nome: 'Visitatore', password: '' });
  assert.equal(g.level, 'lettura');
  assert.equal(g.guest, true);
  assert.equal((await authenticate(fakeReq(), { nome: 'mario rossi', password: '' })).ok, false);
});

test('modo «livelli» (file di prima): nome libero, password per admin/modifica', async () => {
  await usersFile({ attivo: true, predefinito: 'lettura', admin: { password: 'admin-segreta' }, modifica: { attivo: true, password: await hashPassword('modifica-nota') } });
  assert.equal((await authenticate(fakeReq(), { nome: 'Luca', password: '' })).level, 'lettura');
  assert.equal((await authenticate(fakeReq(), { nome: 'Luca', password: 'admin-segreta' })).level, 'admin');
  assert.equal((await authenticate(fakeReq(), { nome: 'Luca', password: 'modifica-nota' })).level, 'modifica');
  assert.equal((await unlockLevel(fakeReq(), 'Luca', 'admin-segreta')).level, 'admin');
});

test('dopo 5 password sbagliate scatta la pausa (e un accesso riuscito non la azzera)', async () => {
  await usersFile({ utenti: [{ nome: 'Mario', livello: 'admin', password: await hashPassword('giusta') }, { nome: 'Anna', livello: 'modifica', password: await hashPassword('nota') }] });
  const req = fakeReq();
  for (let i = 0; i < 4; i += 1) assert.equal((await authenticate(req, { nome: 'Mario', password: 'x' + i })).ok, false);
  assert.equal((await authenticate(req, { nome: 'Anna', password: 'nota' })).ok, true);
  assert.equal((await authenticate(req, { nome: 'Mario', password: 'x5' })).ok, false);
  const r = await authenticate(req, { nome: 'Mario', password: 'giusta' });
  assert.equal(r.error, 'pausa');
  assert.ok(r.waitMs > 0);
});

test('dietro un proxy fidato conta l’indirizzo inoltrato, non 127.0.0.1 (che darebbe a tutti il livello del server)', () => {
  const viaProxy = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '192.168.1.44, 10.0.0.1' } };
  setTrustProxy(false);
  assert.ok(callerTags(viaProxy).includes('127.0.0.1'));
  setTrustProxy(true);
  assert.deepEqual(callerTags(viaProxy), ['192.168.1.44']);
  setTrustProxy(false);
});
