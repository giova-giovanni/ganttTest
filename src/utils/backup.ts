import type { AppData } from '../types';

/**
 * Backup automatico settimanale.
 *
 * Due modi, in ordine di preferenza:
 *  1. «cartella» — il browser scrive direttamente in una cartella scelta una volta
 *     dall'utente (File System Access API). Nessun server coinvolto: funziona anche
 *     se un domani il programma non gira più su localhost.
 *  2. «server» — ripiego automatico: il server locale scrive nella cartella `backups`
 *     accanto al programma. Serve a non chiedere nulla a chi non configura niente.
 *
 * Il controllo scatta all'apertura del programma e poi una volta al giorno: se sono
 * passati 7+ giorni dall'ultimo backup riuscito ne viene creato uno nuovo.
 */

const KEY = 'gantt.autoBackup.v1';
const INTERVAL_DAYS = 7;
const MAX_BACKUPS = 20;
const NAME_RE = /^GANTT_backup_auto_\d{4}-\d{2}-\d{2}\.json$/;

// ------------------------------------------------------------------ tipi

/** L'API per scegliere una cartella non è ancora nei tipi standard di TypeScript. */
type PermissionState_ = 'granted' | 'denied' | 'prompt';
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState_>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState_>;
  /** iterazione del contenuto: presente nei browser, non ancora nei tipi standard */
  values(): AsyncIterableIterator<{ kind: 'file' | 'directory'; name: string }>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirHandle>;
  }
}

export type BackupMode = 'folder' | 'server';

export interface BackupResult {
  done: boolean;
  file?: string;
  mode?: BackupMode;
  /** la cartella è configurata ma il browser vuole una conferma dell'utente */
  needsPermission?: boolean;
}

// ------------------------------------------------------------------ registro (localStorage)

interface Log {
  lastAt: string; // ISO 8601 completo
  lastFile?: string;
  mode?: BackupMode;
}

function readLog(): Log | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Log) : null;
  } catch {
    return null;
  }
}

function writeLog(log: Log) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* spazio esaurito: si riproverà al prossimo avvio */
  }
}

export function lastAutoBackupAt(): string | null {
  return readLog()?.lastAt ?? null;
}

export function lastAutoBackupMode(): BackupMode | null {
  return readLog()?.mode ?? null;
}

export function isAutoBackupDue(): boolean {
  const log = readLog();
  if (!log) return true;
  return (Date.now() - new Date(log.lastAt).getTime()) / 86400000 >= INTERVAL_DAYS;
}

// ------------------------------------------------------------------ cartella scelta dall'utente

// il permesso sulla cartella è un oggetto, non una stringa: va in IndexedDB, non in localStorage
const DB_NAME = 'gantt-backup';
const STORE = 'handles';
const HANDLE_ID = 'dir';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function dbGet(db: IDBDatabase): Promise<DirHandle | null> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_ID);
    req.onsuccess = () => resolve((req.result as DirHandle) ?? null);
    req.onerror = () => resolve(null);
  });
}

function dbPut(db: IDBDatabase, handle: DirHandle | null): Promise<void> {
  return new Promise((resolve) => {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const req = handle ? store.put(handle, HANDLE_ID) : store.delete(HANDLE_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

export function supportsFolderBackup(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function savedDir(): Promise<DirHandle | null> {
  const db = await openDb();
  if (!db) return null;
  const handle = await dbGet(db);
  db.close();
  return handle;
}

/** Nome della cartella configurata, per mostrarlo nell'interfaccia. */
export async function backupFolderName(): Promise<string | null> {
  const dir = await savedDir();
  return dir?.name ?? null;
}

/** Chiede all'utente di scegliere la cartella. Va chiamata da un click. */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'gantt-backup' });
    const db = await openDb();
    if (db) {
      await dbPut(db, dir);
      db.close();
    }
    return dir.name;
  } catch {
    return null; // l'utente ha annullato
  }
}

export async function forgetBackupFolder(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await dbPut(db, null);
  db.close();
}

async function permissionOf(dir: DirHandle, ask: boolean): Promise<PermissionState_> {
  const opts = { mode: 'readwrite' } as const;
  try {
    if (ask && dir.requestPermission) return await dir.requestPermission(opts);
    if (dir.queryPermission) return await dir.queryPermission(opts);
  } catch {
    return 'denied';
  }
  return 'granted'; // browser senza gestione esplicita del permesso
}

// ------------------------------------------------------------------ scrittura

function fileNameFor(date = new Date()): string {
  return `GANTT_backup_auto_${date.toISOString().slice(0, 10)}.json`;
}

/** Scrive nella cartella scelta e tiene solo gli ultimi MAX_BACKUPS file. */
async function writeToFolder(dir: DirHandle, data: AppData): Promise<string> {
  const name = fileNameFor();
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  await stream.write(JSON.stringify(data, null, 2));
  await stream.close();

  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && NAME_RE.test(entry.name)) names.push(entry.name);
  }
  names.sort();
  for (const stale of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) {
    await dir.removeEntry(stale).catch(() => {});
  }
  return name;
}

/** Ripiego: il server locale scrive nella cartella `backups` del programma. */
async function writeToServer(data: AppData): Promise<string | null> {
  try {
    const res = await fetch('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; file?: string };
    return json.ok ? json.file ?? fileNameFor() : null;
  } catch {
    return null; // nessun server: normale se l'app non è servita da server.mjs
  }
}

let inFlight = false;

/**
 * Esegue il backup. `force` ignora l'intervallo di 7 giorni (pulsante «esegui adesso»),
 * `interactive` permette di chiedere il permesso sulla cartella (solo da un click).
 */
export async function runAutoBackup(
  data: AppData,
  opts: { force?: boolean; interactive?: boolean } = {},
): Promise<BackupResult> {
  if (inFlight) return { done: false };
  if (!opts.force && !isAutoBackupDue()) return { done: false };
  inFlight = true;
  try {
    const dir = await savedDir();
    if (dir) {
      const perm = await permissionOf(dir, !!opts.interactive);
      if (perm === 'granted') {
        try {
          const file = await writeToFolder(dir, data);
          writeLog({ lastAt: new Date().toISOString(), lastFile: file, mode: 'folder' });
          return { done: true, file, mode: 'folder' };
        } catch {
          /* cartella non più accessibile (chiavetta staccata?): si prova col server */
        }
      } else if (perm === 'prompt') {
        return { done: false, needsPermission: true };
      }
    }
    const file = await writeToServer(data);
    if (!file) return { done: false };
    writeLog({ lastAt: new Date().toISOString(), lastFile: file, mode: 'server' });
    return { done: true, file, mode: 'server' };
  } finally {
    inFlight = false;
  }
}

/** Compatibilità con la chiamata automatica all'avvio. */
export function runAutoBackupIfDue(data: AppData): Promise<BackupResult> {
  return runAutoBackup(data);
}
