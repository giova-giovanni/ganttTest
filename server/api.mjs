// Interfaccia HTTP di Gantt Planner (/api/*): la stessa in sviluppo (vite) e in produzione (server.mjs).
//
//   GET  /api/info              pubblica: versione, come si entra (usata anche dagli script di avvio)
//   GET  /api/sessione          chi sono (401 se serve l'accesso)
//   POST /api/sessione          accesso { nome, password } → cookie di sessione
//   POST /api/sessione/livello  sblocca admin/modifica con la password (modo «livelli»)
//   POST /api/sessione/base     torna al livello normale
//   POST /api/sessione/esci     esce
//   GET  /api/stato             tutto l'archivio + revisione
//   POST /api/operazioni        salvataggio per record { client, batch, ops }
//   GET  /api/eventi            tempo reale (SSE); ?poll=1 per il ripiego senza canale
//   POST /api/presenza          dove si trova l'utente (progetto, riga, nota)
//   GET  /api/registro          registro delle modifiche (chi, quando, cosa)
//   POST /api/backup            backup immediato (amministratore)
import { config, readBody, serverIdentity } from './store.mjs';
import { HttpError, applyBatch, archiveState, backupNow, readLog, serverStatus } from './archive.mjs';
import { accessInfo, authenticate, baseLevel, unlockLevel } from './users.mjs';
import { clearedCookie, createSession, destroySession, publicSession, sessionCookie, sessionFrom } from './sessions.mjs';
import { openStream, poll, updatePresence, validClient } from './events.mjs';

export const APP_VERSION = '3.0.0';

const LEVEL_ORDER = { lettura: 0, modifica: 1, admin: 2 };

/** richiesta malformata: risposta 400 invece di un errore del server */
class BadRequest extends Error {}

function json(res, code, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

async function parse(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequest('JSON non valido');
  }
  return body && typeof body === 'object' ? body : {};
}

/**
 * Le scritture devono arrivare come JSON: una pagina di un altro sito non può mandarle
 * senza il permesso del server (CORS), quindi non può modificare l'archivio di nascosto.
 */
const isJsonRequest = (req) => /^application\/json\b/i.test(String(req.headers['content-type'] ?? ''));

/**
 * Se arriva un'intestazione Origin deve essere quella del server stesso.
 * Insieme al cookie SameSite=Strict blocca le richieste da pagine esterne.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const c = config();
  const forwardedHost = c.proxy ? req.headers['x-forwarded-host'] : undefined;
  const host = String(forwardedHost ?? req.headers.host ?? '').toLowerCase();
  try {
    const from = new URL(origin);
    if (from.host.toLowerCase() === host) return true;
    // dietro un proxy che riscrive «Host» (es. IIS) valgono i nomi pubblici dichiarati in "nomi"
    return c.proxy === true && (c.nomi ?? []).includes(from.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function handleApi(req, res, urlPath) {
  if (!urlPath.startsWith('/api/')) return false;
  const route = urlPath.slice(4);
  const method = req.method ?? 'GET';
  const query = new URL(req.url ?? '/', 'http://x').searchParams;

  try {
    // richieste preliminari CORS: risposta senza permessi, così nessun altro sito può usare l'API
    if (method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, POST' });
      res.end();
      return true;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      if (!isJsonRequest(req)) throw new BadRequest('serve Content-Type: application/json');
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'origine' });
        return true;
      }
    }

    // ---------------------------------------------------------------- pubbliche
    if (method === 'GET' && route === '/info') {
      const c = config();
      const s = sessionFrom(req);
      json(res, 200, {
        ok: true,
        version: APP_VERSION,
        mode: c.mode,
        port: c.port,
        server: serverIdentity().host,
        access: accessInfo(req),
        status: serverStatus(),
        // i percorsi del server li vede solo l'amministratore
        ...(s?.level === 'admin' ? { dataDir: c.dataDir, appDir: c.appDir, configFile: c.configFile } : {}),
      });
      return true;
    }

    if (route === '/sessione' && method === 'GET') {
      const s = sessionFrom(req);
      if (!s) json(res, 401, { ok: false, error: 'sessione' });
      else json(res, 200, { ok: true, session: publicSession(s) });
      return true;
    }

    if (route === '/sessione' && method === 'POST') {
      const body = await parse(req);
      const r = await authenticate(req, { nome: body.nome, password: body.password });
      if (!r.ok) {
        const code = r.error === 'pausa' ? 429 : r.error === 'nome' ? 400 : 403;
        const retry = r.waitMs ? { 'Retry-After': String(Math.ceil(r.waitMs / 1000)) } : {};
        json(res, code, { ok: false, error: r.error, waitMs: r.waitMs }, retry);
        return true;
      }
      destroySession(sessionFrom(req)); // un nuovo accesso sostituisce la sessione precedente
      const s = createSession({ user: r.user, level: r.level, account: !!r.account, guest: !!r.guest });
      json(res, 200, { ok: true, session: publicSession(s) }, { 'Set-Cookie': sessionCookie(s, req) });
      return true;
    }

    // ---------------------------------------------------------------- serve una sessione
    const s = sessionFrom(req);
    if (!s) {
      json(res, 401, { ok: false, error: 'sessione' });
      return true;
    }

    if (method === 'POST' && route === '/sessione/esci') {
      destroySession(s);
      json(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie(req) });
      return true;
    }

    if (method === 'POST' && route === '/sessione/livello') {
      const body = await parse(req);
      const r = await unlockLevel(req, s.user, body.password);
      if (!r.ok) {
        json(res, r.error === 'pausa' ? 429 : 403, { ok: false, error: r.error, waitMs: r.waitMs });
        return true;
      }
      if (LEVEL_ORDER[r.level] > LEVEL_ORDER[s.level]) s.level = r.level;
      json(res, 200, { ok: true, session: publicSession(s) });
      return true;
    }

    if (method === 'POST' && route === '/sessione/base') {
      const lvl = baseLevel(req);
      if (lvl && !s.account) s.level = lvl;
      json(res, 200, { ok: true, session: publicSession(s) });
      return true;
    }

    if (method === 'GET' && route === '/stato') {
      json(res, 200, { ok: true, ...archiveState() });
      return true;
    }

    if (method === 'POST' && route === '/operazioni') {
      const body = await parse(req);
      const r = await applyBatch({
        ops: body.ops,
        session: s,
        client: validClient(body.client),
        batch: String(body.batch ?? '').slice(0, 64),
      });
      json(res, 200, r);
      return true;
    }

    if (method === 'GET' && route === '/eventi') {
      const since = Number(query.get('rev'));
      const client = validClient(query.get('client'));
      if (!client) throw new BadRequest('client');
      if (query.get('poll')) json(res, 200, { ok: true, ...poll(since) });
      else openStream(req, res, s, { client, since });
      return true;
    }

    if (method === 'POST' && route === '/presenza') {
      const body = await parse(req);
      if (!updatePresence(s, body)) throw new BadRequest('client');
      json(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && route === '/registro') {
      const entries = await readLog({
        limit: Math.min(500, Math.max(1, Number(query.get('limit')) || 100)),
        before: Number(query.get('before')) || Infinity,
        user: String(query.get('utente') ?? '').slice(0, 80),
        project: String(query.get('progetto') ?? '').slice(0, 120),
      });
      json(res, 200, { ok: true, entries });
      return true;
    }

    if (method === 'POST' && route === '/backup') {
      if (s.level !== 'admin') throw new HttpError(403, 'livello');
      json(res, 200, { ok: true, file: await backupNow() });
      return true;
    }

    json(res, 404, { ok: false, error: 'rotta sconosciuta' });
    return true;
  } catch (err) {
    if (err instanceof BadRequest) {
      json(res, 400, { ok: false, error: err.message });
    } else if (err instanceof HttpError) {
      json(res, err.status, { ok: false, error: err.message });
    } else {
      // il dettaglio (percorsi, nomi di file) resta nel registro del server, non va al browser
      console.error('GANTT_WARN=errore su ' + route + ': ' + (err?.stack ?? err));
      json(res, 500, { ok: false, error: 'errore interno' });
    }
    return true;
  }
}
