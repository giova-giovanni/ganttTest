// Interfaccia HTTP dell'archivio condiviso: la stessa in sviluppo (vite) e in produzione (server.mjs).
import {
  HEARTBEAT_MS,
  LOCK_TTL_MS,
  acquireLock,
  beatLock,
  config,
  dataPaths,
  readBody,
  readLock,
  readMeta,
  readState,
  releaseLock,
  requestControl,
  serverIdentity,
  writeAutoBackup,
  writeState,
  yieldControl,
} from './store.mjs';
import { authState, login } from './users.mjs';

export const APP_VERSION = '2.0.0';

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function parse(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/** dati di chi sta chiedendo: il client li manda, il server completa i buchi */
function whoFrom(body) {
  const id = serverIdentity();
  const user = String(body?.user ?? '').trim() || id.user;
  const host = String(body?.host ?? '').trim() || id.host;
  const sessionId = String(body?.sessionId ?? '').trim();
  return { user, host, sessionId, label: `${user} (${host})` };
}

/**
 * Gestisce una richiesta /api/*.
 * Ritorna true se la richiesta è stata gestita, false se non è una rotta conosciuta.
 */
export async function handleApi(req, res, urlPath) {
  if (!urlPath.startsWith('/api/')) return false;
  const route = urlPath.slice(4); // '/state', '/lock', ...

  try {
    if (req.method === 'GET' && route === '/info') {
      const c = config();
      json(res, 200, {
        ok: true,
        version: APP_VERSION,
        mode: c.mode,
        dataDir: c.dataDir,
        appDir: c.appDir,
        configFile: c.configFile,
        port: c.port,
        server: serverIdentity(),
        heartbeatMs: HEARTBEAT_MS,
        lockTtlMs: LOCK_TTL_MS,
      });
      return true;
    }

    // livello di accesso di chi sta chiedendo (vedi gantt-utenti.json)
    if (req.method === 'GET' && route === '/auth') {
      json(res, 200, authState(req));
      return true;
    }

    if (req.method === 'POST' && route === '/auth') {
      const body = await parse(req);
      const r = await login(req, String(body?.password ?? ''));
      json(res, r.ok ? 200 : 403, r);
      return true;
    }

    if (req.method === 'GET' && route === '/state') {
      const state = await readState();
      const lock = await readLock();
      json(res, 200, { ok: true, rev: state.rev, savedAt: state.savedAt, savedBy: state.savedBy, data: state.data, lock });
      return true;
    }

    if (req.method === 'GET' && route === '/status') {
      const meta = await readMeta();
      const lock = await readLock();
      json(res, 200, { ok: true, ...meta, lock });
      return true;
    }

    if (req.method === 'POST' && route === '/lock') {
      const body = await parse(req);
      const who = whoFrom(body);
      if (!who.sessionId) {
        json(res, 400, { ok: false, error: 'sessionId mancante' });
        return true;
      }
      const r = await acquireLock({ ...who, force: !!body.force });
      const meta = await readMeta();
      json(res, r.ok ? 200 : 409, { ...r, ...meta });
      return true;
    }

    if (req.method === 'POST' && route === '/heartbeat') {
      const body = await parse(req);
      const r = await beatLock(String(body.sessionId ?? ''));
      const meta = await readMeta();
      json(res, 200, { ...r, ...meta });
      return true;
    }

    if (req.method === 'POST' && route === '/unlock') {
      const body = await parse(req);
      json(res, 200, await releaseLock(String(body.sessionId ?? '')));
      return true;
    }

    if (req.method === 'POST' && route === '/request-control') {
      const body = await parse(req);
      json(res, 200, await requestControl(whoFrom(body)));
      return true;
    }

    if (req.method === 'POST' && route === '/yield') {
      const body = await parse(req);
      json(res, 200, await yieldControl(String(body.sessionId ?? '')));
      return true;
    }

    if (req.method === 'POST' && route === '/save') {
      const body = await parse(req);
      const who = whoFrom(body);
      if (!body.data || typeof body.data !== 'object' || !Array.isArray(body.data.nodes)) {
        json(res, 400, { ok: false, error: 'formato' });
        return true;
      }
      const lock = await readLock();
      if (lock && lock.sessionId !== who.sessionId && !lock.stale) {
        json(res, 409, { ok: false, error: 'locked', lock });
        return true;
      }
      const r = await writeState(body.data, {
        sessionId: who.sessionId,
        who: who.label,
        baseRev: Number.isFinite(body.baseRev) ? body.baseRev : undefined,
      });
      json(res, r.ok ? 200 : 409, r);
      return true;
    }

    if (req.method === 'POST' && route === '/backup') {
      const body = await parse(req);
      const data = body && Array.isArray(body.nodes) ? body : body?.data;
      if (!data || !Array.isArray(data.nodes)) {
        json(res, 400, { ok: false, error: 'formato' });
        return true;
      }
      const file = await writeAutoBackup(data);
      json(res, 200, { ok: true, file, dir: dataPaths().backups });
      return true;
    }

    json(res, 404, { ok: false, error: 'rotta sconosciuta' });
    return true;
  } catch (err) {
    json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
