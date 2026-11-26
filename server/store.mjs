// Archivio dei dati di Gantt Planner su file, con blocco in scrittura in stile Excel.
//
// Nella cartella dati vivono:
//   gantt-dati.json         i dati veri e propri (progetti, attività, persone, note)
//   gantt-dati.bak.json     copia della versione precedente (rete di sicurezza)
//   gantt-blocco.json       chi sta modificando adesso
//   versioni/               storico automatico (una copia all'ora, ultime 30)
//   backups/                backup settimanali (compatibile con la versione precedente)
//
// La cartella può stare su una cartella di rete condivisa: un solo utente alla volta
// ottiene il blocco di scrittura, gli altri vedono i dati in sola lettura e ricevono
// gli aggiornamenti appena chi scrive salva.

import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname, userInfo } from 'node:os';

const DATA_FILE = 'gantt-dati.json';
const BAK_FILE = 'gantt-dati.bak.json';
const LOCK_FILE = 'gantt-blocco.json';
const VERSIONS_DIR = 'versioni';
const BACKUPS_DIR = 'backups';

/** dopo quanti millisecondi senza segnale di vita il blocco è considerato abbandonato */
export const LOCK_TTL_MS = 75_000;
/** ogni quanto il client deve dare un segnale di vita (usato anche dall'interfaccia) */
export const HEARTBEAT_MS = 25_000;

const MAX_VERSIONS = 30;
const VERSION_EVERY_MS = 60 * 60 * 1000; // una copia di storico all'ora
const MAX_BODY = 40 * 1024 * 1024;

let cfg = null;
let paths = null;

export function configure(config) {
  cfg = config;
  paths = {
    dir: config.dataDir,
    data: join(config.dataDir, DATA_FILE),
    bak: join(config.dataDir, BAK_FILE),
    lock: join(config.dataDir, LOCK_FILE),
    versions: join(config.dataDir, VERSIONS_DIR),
    backups: join(config.dataDir, BACKUPS_DIR),
  };
  return paths;
}

export function dataPaths() {
  if (!paths) throw new Error('archivio non configurato');
  return paths;
}

export function serverIdentity() {
  let user = 'utente';
  try {
    user = userInfo().username || user;
  } catch {
    /* alcuni ambienti non espongono l'utente */
  }
  let host = 'PC';
  try {
    host = hostname() || host;
  } catch {
    /* idem */
  }
  return { user, host };
}

async function ensureDirs() {
  await mkdir(dataPaths().dir, { recursive: true });
}

const emptyData = () => ({ version: 4, nodes: [], people: [], absences: [], notes: [] });

function envelope(data, rev, savedAt, savedBy) {
  return { kind: 'gantt-data', rev, savedAt, savedBy, data };
}

async function readJson(file) {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ dati

/** Legge l'archivio. Se il file non esiste lo crea vuoto. */
export async function readState() {
  await ensureDirs();
  let json = await readJson(dataPaths().data);
  if (!json) {
    // file mancante o illeggibile: si prova la copia di sicurezza prima di ripartire da zero
    const bak = await readJson(dataPaths().bak);
    if (bak && bak.data) {
      json = bak;
      console.error('GANTT_WARN=file dati illeggibile, usata la copia gantt-dati.bak.json');
    }
  }
  if (!json || typeof json !== 'object') {
    const fresh = envelope(emptyData(), 0, new Date().toISOString(), null);
    await writeFile(dataPaths().data, JSON.stringify(fresh, null, 2), 'utf8');
    return { ...fresh, created: true };
  }
  // tollera anche un file che contiene direttamente i dati (backup rinominato a mano)
  const data = json.data && typeof json.data === 'object' ? json.data : json;
  return {
    kind: 'gantt-data',
    rev: Number.isFinite(json.rev) ? json.rev : 0,
    savedAt: typeof json.savedAt === 'string' ? json.savedAt : null,
    savedBy: typeof json.savedBy === 'string' ? json.savedBy : null,
    data,
  };
}

/** Solo i metadati: usato dal controllo periodico dei client in sola lettura. */
export async function readMeta() {
  const json = await readJson(dataPaths().data);
  if (!json) return { rev: 0, savedAt: null, savedBy: null, empty: true };
  return {
    rev: Number.isFinite(json.rev) ? json.rev : 0,
    savedAt: json.savedAt ?? null,
    savedBy: json.savedBy ?? null,
    empty: false,
  };
}

async function writeVersionIfDue(text) {
  try {
    await mkdir(dataPaths().versions, { recursive: true });
    const files = (await readdir(dataPaths().versions)).filter((f) => f.endsWith('.json')).sort();
    const last = files[files.length - 1];
    if (last) {
      const s = await stat(join(dataPaths().versions, last)).catch(() => null);
      if (s && Date.now() - s.mtimeMs < VERSION_EVERY_MS) return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    await writeFile(join(dataPaths().versions, `gantt-${stamp}.json`), text, 'utf8');
    const all = (await readdir(dataPaths().versions)).filter((f) => f.endsWith('.json')).sort();
    for (const stale of all.slice(0, Math.max(0, all.length - MAX_VERSIONS))) {
      await unlink(join(dataPaths().versions, stale)).catch(() => {});
    }
  } catch {
    /* lo storico è un extra: un errore qui non deve impedire il salvataggio */
  }
}

/**
 * Salva i dati. Scrive prima un file temporaneo e poi lo rinomina: se la rete
 * cade a metà scrittura il file buono resta intatto.
 * `baseRev` è la revisione da cui parte il client: se nel frattempo qualcun altro
 * ha salvato, il salvataggio viene rifiutato invece di sovrascrivere il lavoro altrui.
 */
export async function writeState(data, { sessionId, who, baseRev }) {
  await ensureDirs();
  const current = await readMeta();
  if (Number.isFinite(baseRev) && !current.empty && baseRev !== current.rev) {
    return { ok: false, error: 'conflict', rev: current.rev, savedBy: current.savedBy };
  }
  const rev = (current.rev ?? 0) + 1;
  const text = JSON.stringify(envelope(data, rev, new Date().toISOString(), who), null, 2);
  const tmp = `${dataPaths().data}.${sessionId || 'tmp'}.tmp`;

  // copia di sicurezza della versione precedente
  const previous = await readFile(dataPaths().data, 'utf8').catch(() => null);
  if (previous) await writeFile(dataPaths().bak, previous, 'utf8').catch(() => {});

  await writeFile(tmp, text, 'utf8');
  await rename(tmp, dataPaths().data);
  await writeVersionIfDue(text);
  return { ok: true, rev };
}

// ------------------------------------------------------------------ blocco

function lockFromJson(json) {
  if (!json || typeof json !== 'object' || !json.sessionId) return null;
  const beat = typeof json.beat === 'string' ? json.beat : json.since;
  const age = Date.now() - new Date(beat ?? 0).getTime();
  return {
    sessionId: String(json.sessionId),
    user: String(json.user ?? '?'),
    host: String(json.host ?? '?'),
    since: String(json.since ?? beat ?? new Date().toISOString()),
    beat: String(beat ?? new Date().toISOString()),
    requests: Array.isArray(json.requests) ? json.requests.slice(0, 10) : [],
    yielded: !!json.yielded,
    stale: !Number.isFinite(age) || age > LOCK_TTL_MS,
    ageMs: Number.isFinite(age) ? age : Number.MAX_SAFE_INTEGER,
  };
}

export async function readLock() {
  return lockFromJson(await readJson(dataPaths().lock));
}

async function writeLock(lock) {
  await ensureDirs();
  const tmp = `${dataPaths().lock}.${lock.sessionId}.tmp`;
  await writeFile(tmp, JSON.stringify(lock, null, 2), 'utf8');
  await rename(tmp, dataPaths().lock);
}

/** creazione esclusiva: fallisce se il file esiste già (operazione atomica anche in rete) */
async function createLockExclusive(lock) {
  await ensureDirs();
  let handle = null;
  try {
    handle = await open(dataPaths().lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.writeFile(JSON.stringify(lock, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Chiede il blocco di scrittura.
 *  - libero o abbandonato (nessun segnale di vita da 75 s) → concesso
 *  - occupato → risposta 'busy' con i dati di chi lo tiene
 *  - `force` → subentra comunque (l'interfaccia lo propone solo su blocco abbandonato)
 */
export async function acquireLock({ sessionId, user, host, force = false }) {
  const now = new Date().toISOString();
  const mine = { sessionId, user, host, since: now, beat: now, requests: [], yielded: false };

  const existing = await readLock();
  if (!existing) {
    if (await createLockExclusive(mine)) return { ok: true, lock: lockFromJson(mine) };
    // qualcun altro ha vinto la corsa per un soffio
    const other = await readLock();
    if (other && other.sessionId !== sessionId && !other.stale) return { ok: false, reason: 'busy', lock: other };
  } else if (existing.sessionId === sessionId) {
    // stessa sessione: si aggiorna il segnale di vita e l'eventuale nuovo nome utente
    const next = { ...existing, user, host, beat: now, yielded: false };
    await writeLock(next);
    return { ok: true, lock: lockFromJson(next) };
  } else if (!existing.stale && !existing.yielded && !force) {
    return { ok: false, reason: 'busy', lock: existing };
  }

  await writeLock(mine);
  return { ok: true, lock: lockFromJson(mine), takenOver: true };
}

/** segnale di vita: conferma che chi scrive è ancora al lavoro */
export async function beatLock(sessionId) {
  const lock = await readLock();
  if (!lock) return { ok: false, reason: 'lost' };
  if (lock.sessionId !== sessionId) return { ok: false, reason: 'lost', lock };
  const next = { ...lock, beat: new Date().toISOString() };
  await writeLock(next);
  return { ok: true, lock: lockFromJson(next) };
}

export async function releaseLock(sessionId) {
  const lock = await readLock();
  if (!lock || lock.sessionId !== sessionId) return { ok: false };
  await rm(dataPaths().lock, { force: true }).catch(() => {});
  return { ok: true };
}

/** un utente in sola lettura chiede a chi sta scrivendo di lasciargli il posto */
export async function requestControl({ sessionId, user, host }) {
  const lock = await readLock();
  if (!lock) return { ok: true, free: true };
  if (lock.sessionId === sessionId) return { ok: true, mine: true };
  const requests = lock.requests.filter((r) => r.sessionId !== sessionId);
  requests.push({ sessionId, user, host, at: new Date().toISOString() });
  await writeLock({ ...lock, requests });
  return { ok: true, lock: lockFromJson({ ...lock, requests }) };
}

/** chi scrive cede il posto: il blocco resta marcato come "libero al primo che arriva" */
export async function yieldControl(sessionId) {
  const lock = await readLock();
  if (!lock || lock.sessionId !== sessionId) return { ok: false };
  await rm(dataPaths().lock, { force: true }).catch(() => {});
  return { ok: true };
}

// ------------------------------------------------------------------ backup

const BACKUP_NAME_RE = /^GANTT_backup_auto_\d{4}-\d{2}-\d{2}\.json$/;
const MAX_AUTO_BACKUPS = 20;

export async function writeAutoBackup(data) {
  const dir = dataPaths().backups;
  await mkdir(dir, { recursive: true });
  const file = `GANTT_backup_auto_${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(join(dir, file), JSON.stringify(data, null, 2), 'utf8');
  const all = (await readdir(dir)).filter((f) => BACKUP_NAME_RE.test(f)).sort();
  await Promise.all(
    all.slice(0, Math.max(0, all.length - MAX_AUTO_BACKUPS)).map((f) => unlink(join(dir, f)).catch(() => {})),
  );
  return file;
}

// ------------------------------------------------------------------ utilità HTTP

export function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('richiesta troppo grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function config() {
  if (!cfg) throw new Error('archivio non configurato');
  return cfg;
}
