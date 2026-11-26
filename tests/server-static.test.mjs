// File statici dell'interfaccia (server/static.mjs): niente accesso fuori dalla cartella dist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { staticPath } from '../server/static.mjs';

const ROOT = resolve('/gantt-app/dist');

test('file normali dentro dist', () => {
  assert.equal(staticPath(ROOT, '/'), join(ROOT, 'index.html'));
  assert.equal(staticPath(ROOT, '/assets/index.js'), join(ROOT, 'assets', 'index.js'));
});

test('niente uscita verso cartelle sorelle che iniziano con «dist»', () => {
  // %5C = backslash: su Windows è un separatore di percorso
  for (const url of ['/..%5Cdist-vecchia%5Csegreto.txt', '/../dist-vecchia/segreto.txt', '/..%2Fdist.zip']) {
    const file = staticPath(ROOT, url);
    assert.equal(file, join(ROOT, 'index.html'), `${url} → ${file}`);
  }
});

test('niente uscita verso la cartella del programma (gantt-utenti.json, dati)', () => {
  for (const url of ['/..%5Cgantt-utenti.json', '/../dati/gantt-dati.json', '/%2e%2e/%2e%2e/server/users.mjs']) {
    assert.equal(staticPath(ROOT, url), join(ROOT, 'index.html'), url);
  }
});

test('indirizzo con codifica rotta: nessuna eccezione, risposta null (→ 400)', () => {
  assert.equal(staticPath(ROOT, '/%E0%A4%A'), null);
});
