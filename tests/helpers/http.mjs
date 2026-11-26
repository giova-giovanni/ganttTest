// Server HTTP di prova (solo /api/*) su una cartella dati temporanea, e un «browser» minimo
// con il proprio cookie di sessione per simulare più utenti.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { handleApi } from '../../server/api.mjs';
import { configure } from '../../server/store.mjs';
import { _crash, openArchive } from '../../server/archive.mjs';
import { setUsersFile } from '../../server/users.mjs';
import { tempDataDir } from './tmp.mjs';

// il fetch vero, preso prima che client-env.mjs lo sostituisca con quello del «browser» di prova:
// ogni utente simulato deve avere il proprio cookie
const realFetch = globalThis.fetch;

export async function startApi({ usersJson = null, files = {} } = {}) {
  const { root, dataDir } = await tempDataDir();
  configure({ dataDir, appDir: root, port: 0, mode: 'locale', proxy: false });
  const { writeFile } = await import('node:fs/promises');
  const usersPath = join(root, 'gantt-utenti.json');
  if (usersJson) await writeFile(usersPath, JSON.stringify(usersJson), 'utf8');
  setUsersFile(usersPath);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dataDir, name), content, 'utf8');
  await openArchive();
  const server = createServer((req, res) => {
    handleApi(req, res, decodeURIComponent((req.url ?? '').split('?')[0])).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    root,
    dataDir,
    base,
    async close() {
      _crash();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

/** un utente con il suo cookie di sessione */
export function browser(base) {
  let cookie = '';
  const request = async (method, path, body, headers = {}) => {
    const res = await realFetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body, headers) => request('POST', path, body, headers),
    login: (nome, password = '') => request('POST', '/api/sessione', { nome, password }),
    ops: (ops, client = 'c_' + Math.random().toString(36).slice(2, 10)) =>
      request('POST', '/api/operazioni', { client, batch: 'b' + Math.random().toString(36).slice(2), ops }),
    get cookie() {
      return cookie;
    },
  };
}
