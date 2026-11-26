// Chi può entrare in Gantt Planner e con quale livello (file `gantt-utenti.json` accanto al programma).
//
// Tre modi, scelti dal contenuto del file:
//   aperto   — file assente o "attivo": false: ognuno scrive il proprio nome ed è amministratore
//              (come le versioni precedenti)
//   livelli  — file senza elenco utenti: nome libero; il livello è "predefinito" o quello
//              dell'elenco "pc", e si alza digitando la password di admin/modifica
//   account  — file con "utenti": ognuno entra con il proprio nome e la propria password;
//              con "ospiti": true chi non ha un account può entrare in sola lettura
//
//   {
//     "attivo": true,
//     "utenti": [
//       { "nome": "Mario Rossi",  "livello": "admin",    "password": "scrypt$16384$8$1$…" },
//       { "nome": "Anna Bianchi", "livello": "modifica", "password": "scrypt$16384$8$1$…" }
//     ],
//     "ospiti": false,
//     "sessioneOre": 10, "inattivitaMinuti": 120
//   }
//
// Le password si salvano come hash scrypt (`node tools/password.mjs`): chi legge il file non le
// ricava. Una password ancora in chiaro funziona, ma il server avvisa all'avvio.
// La password non arriva mai al browser: il browser manda quella digitata, il server risponde sì o no.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { APP_DIR } from './config.mjs';
import { serverIdentity } from './store.mjs';

export const USERS_FILE = resolve(APP_DIR, 'gantt-utenti.json');

/** percorso effettivo del file utenti (i test lo spostano in una cartella temporanea) */
let usersFile = USERS_FILE;

export function setUsersFile(file) {
  usersFile = file;
  cache = { mtimeMs: -1, value: null };
}

export const LEVELS = ['lettura', 'modifica', 'admin'];
const ORDER = { lettura: 0, modifica: 1, admin: 2 };

/** dopo quanti tentativi sbagliati si mette in pausa */
const MAX_TRIES = 5;
const PAUSE_MS = 30_000;
const NAME_MAX_TRIES = 15; // stesso nome da indirizzi diversi (es. tutti dietro un proxy)
const NAME_PAUSE_MS = 5 * 60_000;
const WRONG_DELAY_MS = 400;

const str = (v) => (typeof v === 'string' ? v : '');
const list = (v) =>
  (Array.isArray(v) ? v : [v])
    .map((x) => str(x).trim().toLowerCase())
    .filter(Boolean);
const level = (v, fallback) => {
  const l = str(v).trim().toLowerCase();
  return LEVELS.includes(l) ? l : fallback;
};
const positive = (v, fallback, max) => (typeof v === 'number' && v > 0 && v <= max ? v : fallback);

function normalize(json) {
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const admin = obj(json.admin);
  const modifica = obj(json.modifica ?? json.utente);
  const utenti = (Array.isArray(json.utenti) ? json.utenti : [])
    .filter((u) => u && typeof u === 'object' && str(u.nome).trim())
    .map((u) => ({
      nome: str(u.nome).trim().slice(0, 80),
      livello: level(u.livello, 'modifica'),
      password: str(u.password),
      attivo: u.attivo !== false,
    }));
  return {
    attivo: json.attivo !== false && json.enabled !== false,
    predefinito: level(json.predefinito ?? json.default, 'modifica'),
    admin: { password: str(admin.password), pc: list(admin.pc) },
    modifica: { attivo: modifica.attivo === true, password: str(modifica.password), pc: list(modifica.pc) },
    utenti,
    ospiti: json.ospiti === true,
    sessioneOre: positive(json.sessioneOre, 10, 24 * 30),
    inattivitaMinuti: positive(json.inattivitaMinuti, 120, 24 * 60 * 30),
  };
}

let cache = { mtimeMs: -1, value: null };
let warned = '';

/**
 * Legge il file degli utenti. Viene riletto da solo appena cambia la data del file:
 * si possono cambiare utenti e password senza riavviare il programma.
 */
function users() {
  try {
    if (!existsSync(usersFile)) {
      cache = { mtimeMs: -1, value: null };
      return null;
    }
    const st = statSync(usersFile);
    if (cache.value && cache.mtimeMs === st.mtimeMs) return cache.value;
    const raw = readFileSync(usersFile, 'utf8').replace(/^﻿/, '');
    const value = normalize(JSON.parse(raw));
    cache = { mtimeMs: st.mtimeMs, value };
    warned = '';
    warnPlainPasswords(value);
    return value;
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (warned !== msg) {
      warned = msg;
      console.error('GANTT_WARN=gantt-utenti.json non leggibile: ' + msg);
    }
    // file rovinato: si torna al comportamento senza controllo accessi
    cache = { mtimeMs: -1, value: null };
    return null;
  }
}

function warnPlainPasswords(cfg) {
  const plain = [cfg.admin.password, cfg.modifica.password, ...cfg.utenti.map((u) => u.password)].filter(
    (p) => p && !p.startsWith('scrypt$'),
  );
  if (plain.length) {
    console.error(
      `GANTT_WARN=gantt-utenti.json contiene ${plain.length} password in chiaro: convertile con «node tools/password.mjs --converti»`,
    );
  }
}

export function accessMode(cfg = users()) {
  if (!cfg || !cfg.attivo) return 'aperto';
  return cfg.utenti.length ? 'account' : 'livelli';
}

/** durata delle sessioni (si possono cambiare in gantt-utenti.json) */
export function sessionLimits() {
  const cfg = users();
  return {
    maxMs: (cfg?.sessioneOre ?? 10) * 3600_000,
    idleMs: (cfg?.inattivitaMinuti ?? 120) * 60_000,
  };
}

// ------------------------------------------------------------------ password

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password, salt, keylen, opts) {
  return new Promise((res, rej) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? rej(err) : res(key))));
}

/** hash di riferimento per i nomi che non corrispondono a nessun account */
let dummyHash = Promise.resolve('');
setImmediate(() => {
  dummyHash = hashPassword(randomBytes(12).toString('hex'));
});

/** hash da scrivere in gantt-utenti.json al posto della password in chiaro */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(String(plain).normalize('NFC'), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** confronta la password digitata con quella salvata (hash scrypt o, per i file vecchi, in chiaro) */
export async function verifyPassword(typed, stored) {
  if (!stored) return false;
  const plain = String(typed ?? '').normalize('NFC');
  if (stored.startsWith('scrypt$')) {
    const [, n, r, p, saltB64, keyB64] = stored.split('$');
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    if (!(N >= 1024 && N <= 1 << 20 && R >= 1 && R <= 32 && P >= 1 && P <= 16)) return false;
    const salt = Buffer.from(saltB64 ?? '', 'base64');
    const expected = Buffer.from(keyB64 ?? '', 'base64');
    if (!salt.length || expected.length < 16) return false;
    try {
      const key = await scrypt(plain, salt, expected.length, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
      return timingSafeEqual(key, expected);
    } catch {
      return false;
    }
  }
  const a = Buffer.from(plain, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ chi sta chiedendo

let trustProxy = false;

/** con un proxy HTTPS davanti (IIS, nginx) l'indirizzo vero arriva in X-Forwarded-For */
export function setTrustProxy(value) {
  trustProxy = !!value;
}

function cleanIp(raw) {
  const ip = str(raw).trim().toLowerCase();
  if (!ip) return '';
  // Node scrive gli indirizzi IPv4 in forma "::ffff:192.168.1.20"
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');

/** indirizzo del PC che sta chiedendo (dietro un proxy fidato: quello inoltrato dal proxy) */
export function clientIp(req) {
  const socketIp = cleanIp(req?.socket?.remoteAddress);
  if (trustProxy && isLoopback(socketIp)) {
    const forwarded = str(req?.headers?.['x-forwarded-for']).split(',')[0];
    if (forwarded.trim()) return cleanIp(forwarded);
  }
  return socketIp;
}

/** true se la richiesta arriva dal proxy HTTPS (serve per il cookie «Secure») */
export function viaHttps(req) {
  if (req?.socket?.encrypted) return true;
  return trustProxy && str(req?.headers?.['x-forwarded-proto']).toLowerCase() === 'https';
}

/**
 * Come il server riconosce il computer che sta chiedendo.
 * Dallo stesso PC del server si conoscono nome utente e computer; dalla rete solo l'indirizzo.
 * Dietro un proxy le richieste arrivano tutte da 127.0.0.1: lì conta solo l'indirizzo inoltrato,
 * altrimenti ogni utente verrebbe scambiato per il PC del server.
 */
export function callerTags(req) {
  const ip = clientIp(req);
  const tags = [];
  const proxied = trustProxy && isLoopback(cleanIp(req?.socket?.remoteAddress)) && !!str(req?.headers?.['x-forwarded-for']);
  if (isLoopback(ip) && !proxied) {
    const id = serverIdentity();
    const user = str(id.user).toLowerCase();
    const host = str(id.host).toLowerCase();
    if (host) tags.push(host);
    if (user) tags.push(user);
    if (user && host) tags.push(`${user}@${host}`);
  }
  if (ip) tags.push(ip);
  return tags;
}

const matches = (allowed, tags) => allowed.some((a) => tags.includes(a));

function autoLevel(req, cfg) {
  const tags = callerTags(req);
  if (matches(cfg.admin.pc, tags)) return { level: 'admin', auto: true };
  if (cfg.modifica.attivo && matches(cfg.modifica.pc, tags)) return { level: 'modifica', auto: true };
  return { level: cfg.predefinito, auto: false };
}

async function levelForPassword(cfg, password) {
  if (await verifyPassword(password, cfg.admin.password)) return 'admin';
  if (cfg.modifica.attivo && (await verifyPassword(password, cfg.modifica.password))) return 'modifica';
  return null;
}

/** come si entra: serve alla finestra di accesso del browser (niente password, niente elenco utenti) */
export function accessInfo(req) {
  const cfg = users();
  const mode = accessMode(cfg);
  const info = { mode, ospiti: !!cfg?.ospiti, levels: [], autoLevel: 'admin', auto: false, who: callerTags(req).join(' · ') };
  if (mode === 'livelli') {
    const a = autoLevel(req, cfg);
    info.autoLevel = a.level;
    info.auto = a.auto;
    if (cfg.admin.password) info.levels.push('admin');
    if (cfg.modifica.attivo && cfg.modifica.password) info.levels.push('modifica');
  }
  return info;
}

// ------------------------------------------------------------------ tentativi sbagliati

const tries = new Map();

function throttle(key, pauseMs) {
  const now = Date.now();
  const rec = tries.get(key);
  if (!rec) return 0;
  if (rec.until > now) return rec.until - now;
  if (now - rec.last > pauseMs) tries.delete(key);
  return 0;
}

function noteWrong(key, max, pauseMs) {
  const now = Date.now();
  const rec = tries.get(key) ?? { count: 0, until: 0, last: now };
  rec.count += 1;
  rec.last = now;
  if (rec.count >= max) {
    rec.until = now + pauseMs;
    rec.count = 0;
  }
  tries.set(key, rec);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pausedFor(req, name) {
  const ipKey = `${clientIp(req) || 'locale'}|${name.toLowerCase()}`;
  const nameKey = `*|${name.toLowerCase()}`;
  return {
    ipKey,
    nameKey,
    waitMs: Math.max(throttle(ipKey, PAUSE_MS), throttle(nameKey, NAME_PAUSE_MS)),
  };
}

async function wrong(keys) {
  // un accesso riuscito NON azzera i tentativi sbagliati (altrimenti si potrebbe alternare
  // una password nota a tentativi su un'altra): il conteggio decade da solo col tempo
  noteWrong(keys.ipKey, MAX_TRIES, PAUSE_MS);
  noteWrong(keys.nameKey, NAME_MAX_TRIES, NAME_PAUSE_MS);
  await wait(WRONG_DELAY_MS);
  return { ok: false, error: 'password' };
}

const cleanName = (v) =>
  str(v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

/**
 * Accesso: nome (e password, se serve) → utente e livello per la sessione.
 * Errori: 'nome' (manca), 'password' (sbagliata o utente sconosciuto: non si dice quale), 'pausa'.
 */
export async function authenticate(req, { nome, password }) {
  const cfg = users();
  const mode = accessMode(cfg);
  const name = cleanName(nome);
  if (!name) return { ok: false, error: 'nome' };
  const typed = str(password);

  const keys = pausedFor(req, name);
  if (keys.waitMs > 0) return { ok: false, error: 'pausa', waitMs: keys.waitMs };

  if (mode === 'aperto') return { ok: true, user: name, level: 'admin', mode };

  if (mode === 'livelli') {
    let lvl = autoLevel(req, cfg).level;
    if (typed) {
      const unlocked = await levelForPassword(cfg, typed);
      if (!unlocked) return wrong(keys);
      if (ORDER[unlocked] > ORDER[lvl]) lvl = unlocked;
    }
    return { ok: true, user: name, level: lvl, mode };
  }

  const account = cfg.utenti.find((u) => u.attivo && u.nome.toLowerCase() === name.toLowerCase());
  if (!typed) {
    // ospite in sola lettura, ma mai con il nome di un account esistente
    if (cfg.ospiti && !account) return { ok: true, user: name, level: 'lettura', mode, guest: true };
    return wrong(keys);
  }
  if (!account) {
    // stesso tempo di risposta di una password sbagliata: non si capisce se l'utente esiste
    await verifyPassword(typed, await dummyHash);
    return wrong(keys);
  }
  if (!(await verifyPassword(typed, account.password))) return wrong(keys);
  return { ok: true, user: account.nome, level: account.livello, mode, account: true };
}

/** modo «livelli»: alza il livello della sessione con la password di admin o modifica */
export async function unlockLevel(req, name, password) {
  const cfg = users();
  if (accessMode(cfg) !== 'livelli') return { ok: false, error: 'modo' };
  const keys = pausedFor(req, `livello:${name}`);
  if (keys.waitMs > 0) return { ok: false, error: 'pausa', waitMs: keys.waitMs };
  const unlocked = await levelForPassword(cfg, str(password));
  if (!unlocked) return wrong(keys);
  return { ok: true, level: unlocked };
}

/** livello che spetterebbe senza password (per «torna al livello normale») */
export function baseLevel(req) {
  const cfg = users();
  return accessMode(cfg) === 'livelli' ? autoLevel(req, cfg).level : null;
}
