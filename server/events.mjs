// Tempo reale: ogni browser tiene aperto un canale (Server-Sent Events) su /api/eventi e riceve
// subito le modifiche degli altri e chi è presente su quale progetto. Se un proxy blocca il
// canale, il browser ripiega su richieste periodiche (?poll=1) con le stesse informazioni.
import { archiveRev, batchesSince, onArchiveEvent, serverStatus } from './archive.mjs';
import { sessionAlive } from './sessions.mjs';

const PRESENCE_TTL_MS = 45_000;
const PING_MS = 25_000;
const CLIENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const streams = new Set(); // { res, session, client }
const presence = new Map(); // client → presenza
let presenceTimer = null;

export const validClient = (v) => (CLIENT_RE.test(String(v ?? '')) ? String(v) : '');

function write(res, type, data, id) {
  res.write(`${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(type, data, id) {
  for (const s of streams) {
    try {
      write(s.res, type, data, id);
    } catch {
      streams.delete(s);
    }
  }
}

onArchiveEvent((ev) => {
  if (ev.type === 'batch') {
    const { type: _t, ...batch } = ev;
    broadcast('batch', batch, batch.rev);
  } else if (ev.type === 'reload') {
    broadcast('reload', { rev: archiveRev() });
  } else if (ev.type === 'server') {
    broadcast('server', serverStatus());
  }
});

/** apre il canale in tempo reale; `since` è l'ultima revisione che il browser conosce */
export function openStream(req, res, session, { client, since }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: niente buffer, gli eventi devono partire subito
  });
  res.write('retry: 3000\n\n');
  const stream = { res, session, client };
  streams.add(stream);

  const missed = batchesSince(since);
  if (missed === null) write(res, 'reload', { rev: archiveRev() });
  else for (const ev of missed) write(res, 'batch', ev, ev.rev);
  write(res, 'presenza', presenceList());
  write(res, 'server', serverStatus());

  req.on('close', () => {
    streams.delete(stream);
    if (presence.delete(client)) schedulePresence();
  });
}

/** ripiego senza canale aperto: quello che si è perso dall'ultima richiesta */
export function poll(since) {
  const missed = batchesSince(since);
  return {
    rev: archiveRev(),
    batches: missed ?? [],
    reload: missed === null,
    presence: presenceList(),
    server: serverStatus(),
  };
}

// ------------------------------------------------------------------ presenze

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/** dove si trova l'utente: pagina, progetto, riga o nota che sta modificando */
export function updatePresence(session, body) {
  const client = validClient(body?.client);
  if (!client) return false;
  presence.set(client, {
    client,
    sid: session.id,
    user: session.user,
    color: session.color,
    level: session.level,
    page: text(body.page, 20),
    project: text(body.project, 120),
    node: text(body.node, 120),
    field: text(body.field, 40),
    note: text(body.note, 120),
    at: Date.now(),
  });
  schedulePresence();
  return true;
}

export function presenceList() {
  const now = Date.now();
  return [...presence.values()]
    .filter((p) => now - p.at < PRESENCE_TTL_MS)
    .map(({ at: _at, ...p }) => p);
}

function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast('presenza', presenceList());
  }, 150);
  presenceTimer.unref?.();
}

// pulizia: presenze scadute, canali di sessioni scadute, segnale di vita per i proxy
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [client, p] of presence) {
    if (now - p.at >= PRESENCE_TTL_MS) {
      presence.delete(client);
      changed = true;
    }
  }
  for (const s of streams) {
    if (!sessionAlive(s.session)) {
      try {
        write(s.res, 'sessione', { scaduta: true });
        s.res.end();
      } catch {
        /* già chiuso */
      }
      streams.delete(s);
    } else {
      try {
        // evento vero (non un commento): il browser lo vede e capisce se un proxy trattiene il canale
        write(s.res, 'ping', { t: now });
      } catch {
        streams.delete(s);
      }
    }
  }
  if (changed) broadcast('presenza', presenceList());
}, PING_MS).unref();

/** chiude tutti i canali (arresto del server) */
export function closeStreams() {
  for (const s of streams) {
    try {
      s.res.end();
    } catch {
      /* già chiuso */
    }
  }
  streams.clear();
}
