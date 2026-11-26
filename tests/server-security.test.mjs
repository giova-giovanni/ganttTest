// Sicurezza di base (server/security.mjs e server.mjs): intestazioni, nomi del server ammessi,
// nessun permesso CORS. L'ultimo test avvia davvero server.mjs su una cartella dati temporanea.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { allowedHosts, hostAllowed, hostOnly, securityHeaders } from '../server/security.mjs';
import { setTrustProxy } from '../server/users.mjs';
import { configure } from '../server/store.mjs';
import { browser, startApi } from './helpers/http.mjs';
import { cleanupTemp, tempDataDir } from './helpers/tmp.mjs';

after(cleanupTemp);

const req = (host, extra = {}) => ({ headers: { host, ...extra }, socket: { remoteAddress: '127.0.0.1' } });

test('intestazioni: script solo dal server, niente cornici, niente sniffing; HSTS solo in HTTPS', () => {
  const h = securityHeaders(req('localhost:5180'));
  assert.match(h['Content-Security-Policy'], /script-src 'self'(;|$)/);
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Strict-Transport-Security'], undefined);
  setTrustProxy(true);
  assert.ok(securityHeaders(req('localhost', { 'x-forwarded-proto': 'https' }))['Strict-Transport-Security']);
  setTrustProxy(false);
});

test('nome del server: «Host» con porta e IPv6', () => {
  assert.equal(hostOnly('gantt.azienda.local:5180'), 'gantt.azienda.local');
  assert.equal(hostOnly('[::1]:5180'), '::1');
  assert.equal(hostOnly('LOCALHOST'), 'localhost');
});

test('DNS rebinding: in locale solo i nomi di questo PC; in rete anche nome e indirizzi; dietro proxy decide il proxy', () => {
  const locale = { mode: 'locale', proxy: false, nomi: [] };
  assert.equal(hostAllowed(req('localhost:5180'), locale), true);
  assert.equal(hostAllowed(req('127.0.0.1:5180'), locale), true);
  assert.equal(hostAllowed(req('[::1]:5180'), locale), true);
  assert.equal(hostAllowed(req('sito-cattivo.example:5180'), locale), false);
  const rete = { mode: 'rete', proxy: false, nomi: ['gantt.azienda.local'] };
  assert.equal(hostAllowed(req(`${hostname()}:5180`), rete, allowedHosts(rete)), true);
  assert.equal(hostAllowed(req('GANTT.azienda.local'), rete, allowedHosts(rete)), true);
  assert.equal(hostAllowed(req('sito-cattivo.example'), rete, allowedHosts(rete)), false);
  assert.equal(hostAllowed(req('qualsiasi'), { mode: 'locale', proxy: true, nomi: [] }), true);
});

test('CORS: la richiesta preliminare non concede nulla a un altro sito', async () => {
  const api = await startApi();
  try {
    const r = await browser(api.base).request('OPTIONS', '/api/operazioni', undefined, {
      Origin: 'http://sito-esterno.example',
      'Access-Control-Request-Method': 'POST',
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally {
    await api.close();
  }
});

test('dietro IIS (Host riscritto in localhost): passano le scritture dalla pagina pubblica, non quelle di altri siti', async () => {
  const api = await startApi();
  try {
    configure({ dataDir: api.dataDir, appDir: api.root, port: 0, mode: 'locale', proxy: true, nomi: ['gantt.azienda.local'] });
    setTrustProxy(true);
    const b = browser(api.base);
    assert.equal((await b.login('Mario Rossi')).status, 200);
    const body = { client: 'c_iis', page: 'home' };
    assert.equal((await b.post('/api/presenza', body, { Origin: 'https://gantt.azienda.local' })).status, 200);
    assert.equal((await b.post('/api/presenza', body, { Origin: 'https://altro-sito.example' })).status, 403);
  } finally {
    setTrustProxy(false);
    await api.close();
  }
});

/** GET con Host a scelta (fetch non permette di cambiarlo) */
function rawGet(port, path, host) {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('server.mjs vero: righe GANTT_* per gli script di avvio, intestazioni, nome estraneo rifiutato, archivio creato', async () => {
  const { root, dataDir } = await tempDataDir();
  const port = 52000 + Math.floor(Math.random() * 3000);
  const child = spawn(process.execPath, ['server.mjs', '--senza-browser'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, GANTT_DATI: dataDir, GANTT_PORTA: String(port), GANTT_MODO: 'locale', GANTT_UTENTI: join(root, 'nessuno.json'), NO_OPEN: '1' },
  });
  try {
    const lines = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('il server non è partito: ' + out)), 15000);
      child.stdout.on('data', (c) => {
        out += c;
        if (out.includes('GANTT_DATA=')) {
          clearTimeout(timer);
          resolve(out);
        }
      });
      child.stderr.on('data', (c) => (out += c));
      child.on('exit', (code) => reject(new Error('uscito con codice ' + code + ': ' + out)));
    });
    const bound = Number(/GANTT_PORT=(\d+)/.exec(lines)[1]);
    assert.match(lines, /GANTT_URL=http:\/\/(localhost|127\.0\.0\.1):\d+/);
    assert.match(lines, new RegExp(`GANTT_DATA=${dataDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));

    // l'interfaccia c'è solo dopo «npm run build»: in un clone appena fatto si controllano solo le intestazioni
    const built = existsSync(join(import.meta.dirname, '..', 'dist', 'index.html'));
    const page = await rawGet(bound, '/', `localhost:${bound}`);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    if (built) {
      assert.equal(page.status, 200);
      assert.match(page.body, /<div id="root">/);
    }

    const info = await rawGet(bound, '/api/info', `127.0.0.1:${bound}`);
    assert.equal(JSON.parse(info.body).ok, true);

    const evil = await rawGet(bound, '/api/info', `sito-cattivo.example:${bound}`);
    assert.equal(evil.status, 421);

    const sibling = await rawGet(bound, '/..%5Cpackage.json', `localhost:${bound}`);
    assert.doesNotMatch(sibling.body, /"devDependencies"/, 'fuori da dist non si legge nulla');
    if (built) assert.match(sibling.body, /<div id="root">/);
  } finally {
    child.kill();
  }
});
