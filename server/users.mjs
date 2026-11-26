// Livelli di accesso di Gantt Planner (file «utenti e password»).
//
// Accanto al programma si può mettere `gantt-utenti.json` (copia di
// `gantt-utenti.esempio.json`). Se il file non c'è, o ha "attivo": false,
// tutti lavorano come amministratori: il programma si comporta come prima.
//
//   {
//     "attivo": true,
//     "predefinito": "modifica",
//     "admin":    { "password": "cambiami", "pc": ["NOME-DEL-PC"] },
//     "modifica": { "attivo": false, "password": "", "pc": [] }
//   }
//
// Tre livelli, in ordine: lettura < modifica < admin.
//   lettura   guarda e stampa, non tocca nulla
//   modifica  lavoro normale: progetti, attività, note
//   admin     in più: elimina progetti, responsabili, assenze, svuota e sostituisce l'archivio
//
// "predefinito" è il livello di chi non digita nessuna password.
// "pc" è l'elenco dei computer che ottengono il livello da soli, senza password:
// nome del PC, utente, "utente@PC" oppure indirizzo IP (vedi /api/auth per sapere
// come il server riconosce il computer collegato).
//
// La password non viene mai mandata al browser: il browser manda quella digitata e
// il server risponde solo sì o no. Resta comunque una protezione contro gli errori,
// non una cassaforte: chi ha accesso alla cartella del programma può leggere il file.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { APP_DIR } from './config.mjs';
import { serverIdentity } from './store.mjs';

export const USERS_FILE = resolve(APP_DIR, 'gantt-utenti.json');

export const LEVELS = ['lettura', 'modifica', 'admin'];

/** dopo quanti tentativi sbagliati dallo stesso indirizzo si mette in pausa */
const MAX_TRIES = 5;
const PAUSE_MS = 30_000;
const WRONG_DELAY_MS = 400;

const str = (v) => (typeof v === 'string' ? v : '');
const list = (v) =>
  (Array.isArray(v) ? v : [v])
    .map((x) => str(x).trim().toLowerCase())
    .filter(Boolean);

function normalize(json) {
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const admin = obj(json.admin);
  const modifica = obj(json.modifica ?? json.utente);
  const predefinito = str(json.predefinito ?? json.default).trim().toLowerCase();
  return {
    attivo: json.attivo !== false && json.enabled !== false,
    predefinito: LEVELS.includes(predefinito) ? predefinito : 'modifica',
    admin: { password: str(admin.password), pc: list(admin.pc) },
    modifica: {
      attivo: modifica.attivo === true,
      password: str(modifica.password),
      pc: list(modifica.pc),
    },
  };
}

let cache = { mtimeMs: -1, value: null };
let warned = '';

/**
 * Legge il file degli utenti. Viene riletto da solo appena cambia la data del file:
 * si può cambiare la password senza chiudere il programma.
 */
function users() {
  try {
    if (!existsSync(USERS_FILE)) {
      cache = { mtimeMs: -1, value: null };
      return null;
    }
    const st = statSync(USERS_FILE);
    if (cache.value && cache.mtimeMs === st.mtimeMs) return cache.value;
    const raw = readFileSync(USERS_FILE, 'utf8').replace(/^﻿/, '');
    const value = normalize(JSON.parse(raw));
    cache = { mtimeMs: st.mtimeMs, value };
    warned = '';
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

function cleanIp(raw) {
  const ip = str(raw).trim().toLowerCase();
  if (!ip) return '';
  // Node scrive gli indirizzi IPv4 in forma "::ffff:192.0.2.10"
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');

/**
 * Come il server riconosce chi sta chiedendo.
 * Se la richiesta arriva da questo stesso PC (uso normale, un programma per persona)
 * si conosce nome utente e nome del computer; se arriva dalla rete si ha solo l'indirizzo.
 */
export function callerTags(req) {
  const ip = cleanIp(req?.socket?.remoteAddress);
  const tags = [];
  if (isLoopback(ip)) {
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

/** confronto che non si accorcia sulla prima lettera diversa */
function samePassword(typed, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(typed), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** livello che spetta a questo computer senza digitare niente */
export function authState(req) {
  const cfg = users();
  const file = USERS_FILE;
  if (!cfg || !cfg.attivo) {
    return {
      ok: true,
      enabled: false,
      level: 'admin',
      auto: true,
      levels: [],
      who: callerTags(req).join(' · '),
      file,
      exists: existsSync(file),
    };
  }
  const tags = callerTags(req);
  const levels = [];
  if (cfg.admin.password) levels.push('admin');
  if (cfg.modifica.attivo && cfg.modifica.password) levels.push('modifica');

  let level = cfg.predefinito;
  let auto = false;
  if (matches(cfg.admin.pc, tags)) {
    level = 'admin';
    auto = true;
  } else if (cfg.modifica.attivo && matches(cfg.modifica.pc, tags)) {
    level = 'modifica';
    auto = true;
  }
  return { ok: true, enabled: true, level, auto, levels, who: tags.join(' · '), file, exists: true };
}

// tentativi sbagliati per indirizzo: rallenta chi prova a indovinare
const tries = new Map();

function throttle(key) {
  const now = Date.now();
  const rec = tries.get(key);
  if (!rec) return 0;
  if (rec.until > now) return rec.until - now;
  if (now - rec.last > PAUSE_MS) {
    tries.delete(key);
    return 0;
  }
  return 0;
}

function noteWrong(key) {
  const now = Date.now();
  const rec = tries.get(key) ?? { count: 0, until: 0, last: now };
  rec.count += 1;
  rec.last = now;
  if (rec.count >= MAX_TRIES) {
    rec.until = now + PAUSE_MS;
    rec.count = 0;
  }
  tries.set(key, rec);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** verifica la password digitata e restituisce il livello sbloccato */
export async function login(req, password) {
  const cfg = users();
  if (!cfg || !cfg.attivo) return { ok: true, level: 'admin', enabled: false };

  const key = cleanIp(req?.socket?.remoteAddress) || 'locale';
  const paused = throttle(key);
  if (paused > 0) return { ok: false, error: 'pausa', waitMs: paused };

  if (samePassword(password, cfg.admin.password)) {
    tries.delete(key);
    return { ok: true, level: 'admin' };
  }
  if (cfg.modifica.attivo && samePassword(password, cfg.modifica.password)) {
    tries.delete(key);
    return { ok: true, level: 'modifica' };
  }
  noteWrong(key);
  await wait(WRONG_DELAY_MS);
  return { ok: false, error: 'password' };
}
