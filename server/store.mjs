// File dell'archivio di Gantt Planner (livello «disco»: lettura, scrittura sicura, copie).
//
// Nella cartella dati vivono:
//   gantt-dati.json          i dati (progetti, attività, persone, assenze, note) + revisioni per record
//   gantt-dati.bak.json      copia della versione precedente (rete di sicurezza)
//   gantt-dati.pre-v2.json   copia fatta una volta sola prima del passaggio al formato multi-utente
//   gantt-server.json        quale server sta usando la cartella (uno solo alla volta)
//   registro/AAAA-MM.jsonl  registro delle modifiche: chi, quando, cosa (una riga per salvataggio)
//   versioni/               storico automatico (una copia all'ora, ultime 30)
//   backups/                backup settimanali (stesso formato dell'export JSON)

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';

const DATA_FILE = 'gantt-dati.json';
const MAX_VERSIONS = 30;
const VERSION_EVERY_MS = 60 * 60 * 1000; // una copia di storico all'ora
const MAX_BODY = 40 * 1024 * 1024;

let cfg = null;
let paths = null;

export function configure(config) {
  cfg = config;
  const dir = config.dataDir;
  paths = {
    dir,
    data: join(dir, DATA_FILE),
    bak: join(dir, 'gantt-dati.bak.json'),
    preV2: join(dir, 'gantt-dati.pre-v2.json'),
    server: join(dir, 'gantt-server.json'),
    journal: join(dir, 'registro'),
    versions: join(dir, 'versioni'),
    backups: join(dir, 'backups'),
  };
  return paths;
}

export function dataPaths() {
  if (!paths) throw new Error('archivio non configurato');
  return paths;
}

export function config() {
  if (!cfg) throw new Error('archivio non configurato');
  return cfg;
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

export async function ensureDirs() {
  await mkdir(dataPaths().dir, { recursive: true });
}

// ------------------------------------------------------------------ una scrittura alla volta

// Le richieste arrivano in parallelo: le scritture su disco passano da una coda, così due
// salvataggi non si scrivono sopra a vicenda (e su Windows il secondo rename non fallisce).
/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function exclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// ------------------------------------------------------------------ lettura e scrittura file

const stripBom = (text) => text.replace(/^﻿/, '');

/**
 * null = il file non esiste; eccezione = esiste ma non si legge o è rovinato.
 * I due casi non vanno mai confusi: un archivio illeggibile NON è un archivio vuoto.
 */
export async function readJsonStrict(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  const json = JSON.parse(stripBom(raw));
  if (!json || typeof json !== 'object') throw new Error('contenuto non valido');
  return json;
}

/** versione tollerante: qualunque problema vale come «file assente» */
export async function readJson(file) {
  try {
    return await readJsonStrict(file);
  } catch {
    return null;
  }
}

export function isJson(text) {
  try {
    JSON.parse(stripBom(text));
    return true;
  } catch {
    return false;
  }
}

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Scrive un file temporaneo e lo rinomina sul file finale: se la rete cade a metà
 * il file buono resta intatto. Il nome del temporaneo è casuale (mai dati del client).
 * Su Windows il rename può fallire per un attimo se un antivirus o un indicizzatore
 * tiene aperto il file: si riprova per circa un secondo prima di arrendersi.
 */
export async function replaceFile(target, text) {
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmp, target);
      return;
    } catch (err) {
      if (!RETRY_CODES.has(err?.code) || attempt >= 10) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

// ------------------------------------------------------------------ archivio

/**
 * Legge l'archivio, con la copia .bak come ripiego.
 * `source`: 'main' | 'bak' | 'none' (nessun file: primo avvio).
 * Se l'archivio esiste ma è illeggibile e non c'è una .bak buona lancia un'eccezione:
 * far finta che sia vuoto vorrebbe dire cancellarlo al primo salvataggio.
 */
export async function readDataFile() {
  let mainError = null;
  try {
    const json = await readJsonStrict(dataPaths().data);
    if (json) return { json, source: 'main' };
  } catch (err) {
    mainError = err;
  }
  const bak = await readJson(dataPaths().bak);
  if (bak && bak.data && typeof bak.data === 'object') {
    if (mainError) console.error(`GANTT_WARN=file dati illeggibile (${mainError.message}), usata la copia gantt-dati.bak.json`);
    return { json: bak, source: 'bak' };
  }
  if (mainError) throw new Error(`archivio ${DATA_FILE} illeggibile: ${mainError.message}`);
  return { json: null, source: 'none' };
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
 * Scrive l'archivio completo (busta con dati e revisioni). La versione precedente va in
 * .bak solo se è leggibile: un file rovinato non deve prendere il posto della copia buona.
 */
export function writeSnapshot(text) {
  return exclusive(async () => {
    await ensureDirs();
    const previous = await readFile(dataPaths().data, 'utf8').catch(() => null);
    if (previous && isJson(previous)) await writeFile(dataPaths().bak, previous, 'utf8').catch(() => {});
    await replaceFile(dataPaths().data, text);
    await writeVersionIfDue(text);
  });
}

// ------------------------------------------------------------------ backup settimanale

const BACKUP_NAME_RE = /^GANTT_backup_auto_(\d{4}-\d{2}-\d{2})\.json$/;
const MAX_AUTO_BACKUPS = 20;

/** data (AAAA-MM-GG) dell'ultimo backup settimanale presente, o null */
export async function lastAutoBackupDay() {
  const files = await readdir(dataPaths().backups).catch(() => []);
  const days = files.map((f) => BACKUP_NAME_RE.exec(f)?.[1]).filter(Boolean).sort();
  return days[days.length - 1] ?? null;
}

export function writeAutoBackup(data) {
  return exclusive(async () => {
    const dir = dataPaths().backups;
    await mkdir(dir, { recursive: true });
    const file = `GANTT_backup_auto_${new Date().toISOString().slice(0, 10)}.json`;
    await replaceFile(join(dir, file), JSON.stringify(data, null, 2));
    const all = (await readdir(dir)).filter((f) => BACKUP_NAME_RE.test(f)).sort();
    await Promise.all(
      all.slice(0, Math.max(0, all.length - MAX_AUTO_BACKUPS)).map((f) => unlink(join(dir, f)).catch(() => {})),
    );
    return file;
  });
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
