// Sessioni: dopo l'accesso il browser riceve un cookie (HttpOnly, SameSite=Strict) e ogni
// richiesta viene ricondotta a un utente e al suo livello. Il livello lo decide il server,
// non il browser. Le sessioni scadono dopo un periodo di inattività o dopo un massimo di ore
// (vedi sessionLimits in users.mjs) e non sopravvivono al riavvio del server.
import { randomBytes } from 'node:crypto';
import { sessionLimits, viaHttps } from './users.mjs';

const COOKIE = 'gantt_sessione';
const sessions = new Map(); // token → sessione

/** colori per riconoscere a colpo d'occhio chi c'è (stesso nome = stesso colore) */
const PALETTE = ['#2f7de1', '#e07b39', '#3aa76d', '#8b5cf6', '#d6453d', '#0ea5a5', '#b45309', '#c0398f', '#4f6bd8', '#5c8a1e'];

function colorFor(name) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function createSession({ user, level, account = false, guest = false }) {
  const now = Date.now();
  const s = {
    token: randomBytes(32).toString('base64url'),
    id: 'u' + randomBytes(6).toString('hex'), // identificativo pubblico (presenze, registro)
    user,
    level,
    account,
    guest,
    color: colorFor(user),
    created: now,
    seen: now,
  };
  sessions.set(s.token, s);
  return s;
}

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function expired(s, now = Date.now()) {
  const { idleMs, maxMs } = sessionLimits();
  return now - s.seen > idleMs || now - s.created > maxMs;
}

/** sessione valida della richiesta (e ne rinnova l'attività), oppure null */
export function sessionFrom(req) {
  const token = readCookie(req?.headers?.cookie, COOKIE);
  const s = token ? sessions.get(token) : undefined;
  if (!s) return null;
  if (expired(s)) {
    sessions.delete(token);
    return null;
  }
  s.seen = Date.now();
  return s;
}

/** la sessione esiste ancora? (per i canali in tempo reale già aperti) */
export function sessionAlive(s) {
  return sessions.get(s.token) === s && !expired(s);
}

export function destroySession(s) {
  if (s) sessions.delete(s.token);
}

export function sessionCookie(s, req) {
  const maxAge = Math.floor(sessionLimits().maxMs / 1000);
  return `${COOKIE}=${s.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${viaHttps(req) ? '; Secure' : ''}`;
}

export function clearedCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${viaHttps(req) ? '; Secure' : ''}`;
}

/** quello che il browser può sapere della propria sessione (mai il token) */
export function publicSession(s) {
  return {
    id: s.id,
    user: s.user,
    level: s.level,
    color: s.color,
    account: s.account,
    guest: s.guest,
    expiresAt: new Date(s.created + sessionLimits().maxMs).toISOString(),
  };
}

// pulizia periodica delle sessioni scadute
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (expired(s, now)) sessions.delete(token);
}, 10 * 60_000).unref();

/** solo per i test */
export function _clearSessions() {
  sessions.clear();
}
