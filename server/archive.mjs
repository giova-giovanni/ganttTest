// Archivio condiviso di Gantt Planner: i dati stanno in memoria nel server, che è l'UNICO a scriverli.
//
// Ogni salvataggio dei browser è un gruppo di operazioni su singoli record (shared/ops.mjs):
//   1. si controllano forma e livello di accesso;
//   2. si applicano ai dati in memoria (vince l'ultimo che scrive, campo per campo; chi viene
//      sovrascritto riceve un avviso con il valore perso);
//   3. si scrive una riga nel registro (registro/AAAA-MM.jsonl): da quel momento la modifica è al
//      sicuro anche se il server si spegne di colpo;
//   4. si avvisano subito tutti gli altri browser (eventi in tempo reale);
//   5. entro un secondo si riscrive gantt-dati.json (con .bak, copie orarie e backup settimanale).
// All'avvio si legge gantt-dati.json e si riapplicano le righe del registro più recenti del file.
import { appendFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { KINDS, applyOps, invalidOps, keyOf, same } from '../shared/ops.mjs';
import {
  dataPaths,
  ensureDirs,
  lastAutoBackupDay,
  readDataFile,
  readJson,
  replaceFile,
  writeAutoBackup,
  writeSnapshot,
} from './store.mjs';

export const FORMAT = 2;
const SNAPSHOT_DELAY_MS = 800;
const RECENT_MAX = 3000; // salvataggi tenuti in memoria per chi si ricollega
const SERVER_BEAT_MS = 20_000;
const SERVER_STALE_MS = 65_000;
const JOURNAL_RE = /^\d{4}-\d{2}\.jsonl$/;

let A = null; // { rev, savedAt, savedBy, data, meta: Map<chiave, {rev, at, by, sid}> }
let fileFormat = 0;
let recent = [];
const deletions = new Map(); // chiave → { by, at }: chi ha eliminato cosa (per gli avvisi)
const listeners = new Set();
let readOnly = null; // { host, url, since } quando un altro server sta già usando la cartella
let health = { ok: true, error: null };
let snapshotTimer = null;
let snapshotDirty = false;
let timers = [];
let me = null; // { host, pid, url, since }
let lastMtime = 0;
/** @type {Promise<unknown>} */
let batchQueue = Promise.resolve();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const emptyData = () => ({ version: 4, nodes: [], people: [], absences: [], notes: [] });

function normalizeData(d) {
  const lists = {};
  for (const name of Object.values(KINDS)) {
    lists[name] = (Array.isArray(d?.[name]) ? d[name] : []).filter(
      (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id,
    );
  }
  return { version: Number.isFinite(d?.version) ? d.version : 4, ...lists };
}

// ------------------------------------------------------------------ eventi

/** chi vuole sapere delle modifiche (il canale in tempo reale verso i browser) */
export function onArchiveEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* un ascoltatore rotto non deve fermare il salvataggio */
    }
  }
}

function setHealth(ok, error = null) {
  if (health.ok === ok && health.error === error) return;
  health = { ok, error };
  emit({ type: 'server', ...serverStatus() });
}

export function serverStatus() {
  return { health, readOnly };
}

// ------------------------------------------------------------------ apertura e chiusura

/**
 * Apre l'archivio. Se un altro server sta già usando la stessa cartella (es. un secondo
 * avvio del programma sulla stessa cartella di rete) questo si apre in SOLA LETTURA e lo dice.
 */
export async function openArchive({ url = '' } = {}) {
  await ensureDirs();
  me = { host: hostname(), pid: process.pid, url, since: new Date().toISOString() };
  readOnly = await claimFolder();
  await loadFromDisk();
  const t = [];
  if (readOnly) {
    t.push(setInterval(() => void watchOtherServer(), 5000));
  } else {
    if (fileFormat < FORMAT || snapshotDirty) scheduleSnapshot();
    t.push(setInterval(() => void beatFolder(), SERVER_BEAT_MS));
    t.push(setInterval(() => void weeklyBackup(), 60 * 60_000));
    t.push(setTimeout(() => void weeklyBackup(), 60_000));
  }
  for (const x of t) x.unref?.();
  timers = t;
  return { rev: A.rev, readOnly };
}

/** indirizzo con cui gli altri raggiungono questo server (mostrato da un secondo server in sola lettura) */
export function setArchiveUrl(url) {
  if (me) me.url = url;
  if (!readOnly) void beatFolder();
}

export async function closeArchive() {
  for (const x of timers) clearInterval(x);
  timers = [];
  clearTimeout(snapshotTimer);
  snapshotTimer = null;
  await batchQueue.catch(() => {});
  if (!readOnly) {
    await flushSnapshot();
    await releaseFolder();
  }
}

async function loadFromDisk() {
  const { json } = await readDataFile(); // eccezione se illeggibile e senza .bak: mai ripartire da vuoto
  const meta = new Map();
  if (json) {
    const d = json.data && typeof json.data === 'object' ? json.data : json;
    A = {
      rev: Number.isFinite(json.rev) ? json.rev : 0,
      savedAt: typeof json.savedAt === 'string' ? json.savedAt : null,
      savedBy: typeof json.savedBy === 'string' ? json.savedBy : null,
      data: normalizeData(d),
      meta,
    };
    if (json.meta && typeof json.meta === 'object') {
      for (const [k, v] of Object.entries(json.meta)) if (v && Number.isFinite(v.rev)) meta.set(k, v);
    }
    fileFormat = Number.isFinite(json.format) ? json.format : 1;
  } else {
    A = { rev: 0, savedAt: null, savedBy: null, data: emptyData(), meta };
    fileFormat = 0;
  }
  const replayed = await replayJournal();
  if (replayed) snapshotDirty = true;
  recent = [];
  const s = await stat(dataPaths().data).catch(() => null);
  lastMtime = s?.mtimeMs ?? 0;
  return replayed;
}

// ------------------------------------------------------------------ un server per cartella

async function claimFolder() {
  const file = dataPaths().server;
  const mine = JSON.stringify({ ...me, beat: new Date().toISOString() }, null, 2);
  try {
    const h = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    try {
      await h.writeFile(mine, 'utf8');
    } finally {
      await h.close();
    }
    return null;
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  const other = await readJson(file);
  const age = other ? Date.now() - Date.parse(other.beat ?? other.since ?? '') : Infinity;
  const sameHostDead = other?.host === me.host && other?.pid !== me.pid && !processAlive(other?.pid);
  if (!other || !(age < SERVER_STALE_MS) || sameHostDead || (other.host === me.host && other.pid === me.pid)) {
    await replaceFile(file, mine); // server precedente spento male: si prende il posto
    return null;
  }
  return { host: String(other.host ?? '?'), url: String(other.url ?? ''), since: String(other.since ?? '') };
}

function processAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

async function beatFolder() {
  try {
    const cur = await readJson(dataPaths().server);
    if (cur && (cur.host !== me.host || cur.pid !== me.pid)) {
      // un altro server ha preso la cartella (questo era fermo da troppo): si passa in sola lettura
      readOnly = { host: String(cur.host), url: String(cur.url ?? ''), since: String(cur.since ?? '') };
      emit({ type: 'server', ...serverStatus() });
      return;
    }
    await replaceFile(dataPaths().server, JSON.stringify({ ...me, beat: new Date().toISOString() }, null, 2));
  } catch {
    /* si riprova al prossimo battito */
  }
}

async function releaseFolder() {
  const cur = await readJson(dataPaths().server);
  if (cur && cur.host === me.host && cur.pid === me.pid) await rm(dataPaths().server, { force: true }).catch(() => {});
}

/** server in sola lettura: segue il file scritto dall'altro e riprova a prendere il posto */
async function watchOtherServer() {
  try {
    const claim = await claimFolder();
    if (!claim) {
      readOnly = null;
      await loadFromDisk();
      for (const x of timers) clearInterval(x);
      timers = [setInterval(() => void beatFolder(), SERVER_BEAT_MS), setInterval(() => void weeklyBackup(), 60 * 60_000)];
      for (const x of timers) x.unref?.();
      emit({ type: 'server', ...serverStatus() });
      emit({ type: 'reload' });
      return;
    }
    readOnly = claim;
    const s = await stat(dataPaths().data).catch(() => null);
    if (s && s.mtimeMs !== lastMtime) {
      await loadFromDisk();
      emit({ type: 'reload' });
    }
  } catch {
    /* cartella momentaneamente non raggiungibile */
  }
}

// ------------------------------------------------------------------ registro (journal)

const monthFile = (iso) => join(dataPaths().journal, `${iso.slice(0, 7)}.jsonl`);

async function appendJournal(entry) {
  await mkdir(dataPaths().journal, { recursive: true });
  await appendFile(monthFile(entry.at), JSON.stringify(entry) + '\n', 'utf8');
}

async function journalFiles() {
  return (await readdir(dataPaths().journal).catch(() => [])).filter((f) => JOURNAL_RE.test(f)).sort();
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (Number.isFinite(e.rev) && Array.isArray(e.ops)) out.push(e);
    } catch {
      /* riga troncata da uno spegnimento brusco: si ignora */
    }
  }
  return out;
}

/** riapplica le righe del registro più recenti di gantt-dati.json (spegnimento senza salvataggio) */
async function replayJournal() {
  const files = await journalFiles();
  const entries = [];
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const fileEntries = parseLines(await readFile(join(dataPaths().journal, files[i]), 'utf8'));
    entries.unshift(...fileEntries);
    if (fileEntries.length && fileEntries[0].rev <= A.rev) break;
  }
  let count = 0;
  for (const e of entries) {
    if (e.rev <= A.rev) continue;
    applyOps(A.data, e.ops);
    stampMeta(e.ops, { rev: e.rev, at: e.at, by: e.user, sid: e.sid });
    A.rev = e.rev;
    A.savedAt = e.at;
    A.savedBy = e.user;
    count += 1;
  }
  return count;
}

function stampMeta(ops, info) {
  for (const o of ops) {
    if (o.op === 'replace') {
      A.meta.clear();
      for (const [t, list] of Object.entries(KINDS)) for (const r of A.data[list]) A.meta.set(keyOf(/** @type {any} */ (t), r.id), info);
    } else if (o.op === 'add') A.meta.set(keyOf(o.t, o.rec.id), info);
    else if (o.op === 'set') A.meta.set(keyOf(o.t, o.id), info);
    else if (o.op === 'del') A.meta.delete(keyOf(o.t, o.id));
  }
}

// ------------------------------------------------------------------ file completo

function scheduleSnapshot(delay = SNAPSHOT_DELAY_MS) {
  snapshotDirty = true;
  if (snapshotTimer || readOnly) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void flushSnapshot();
  }, delay);
  snapshotTimer.unref?.();
}

/** scrive gantt-dati.json adesso (chiamata anche alla chiusura del server) */
export async function flushSnapshot() {
  if (!snapshotDirty || readOnly || !A) return;
  snapshotDirty = false;
  const text = JSON.stringify(
    {
      kind: 'gantt-data',
      format: FORMAT,
      rev: A.rev,
      savedAt: A.savedAt,
      savedBy: A.savedBy,
      data: A.data,
      meta: Object.fromEntries(A.meta),
    },
    null,
    2,
  );
  try {
    if (fileFormat < FORMAT) await preV2Copy();
    await writeSnapshot(text);
    fileFormat = FORMAT;
    const s = await stat(dataPaths().data).catch(() => null);
    lastMtime = s?.mtimeMs ?? lastMtime;
    setHealth(true);
  } catch (err) {
    // le modifiche restano al sicuro nel registro: si riprova tra poco
    setHealth(false, err?.message ?? String(err));
    scheduleSnapshot(5000);
  }
}

/** prima scrittura nel formato nuovo: si conserva una volta sola il file originale */
async function preV2Copy() {
  const p = dataPaths();
  const original = await readFile(p.data).catch(() => null);
  if (original) await writeFile(p.preV2, original, { flag: 'wx' }).catch(() => {});
}

async function weeklyBackup() {
  if (readOnly || !A) return;
  try {
    const last = await lastAutoBackupDay();
    if (last && Date.now() - Date.parse(`${last}T00:00:00Z`) < 7 * 86400_000) return;
    await writeAutoBackup(A.data);
  } catch (err) {
    console.error('GANTT_WARN=backup settimanale non riuscito: ' + (err?.message ?? err));
  }
}

/** backup immediato (pulsante «Esegui adesso» dell'amministratore) */
export function backupNow() {
  return writeAutoBackup(A.data);
}

// ------------------------------------------------------------------ lettura

export function archiveState() {
  return { rev: A.rev, savedAt: A.savedAt, savedBy: A.savedBy, data: A.data, ...serverStatus() };
}

export function archiveRev() {
  return A?.rev ?? 0;
}

/** salvataggi successivi a `rev` per chi si ricollega; null = troppo vecchio, deve ricaricare */
export function batchesSince(rev) {
  if (!Number.isFinite(rev) || rev >= A.rev) return [];
  const first = recent.findIndex((e) => e.rev > rev);
  if (first < 0 || recent[first].rev !== rev + 1) return null;
  return recent.slice(first);
}

// ------------------------------------------------------------------ salvataggi

const LEVEL_ORDER = { lettura: 0, modifica: 1, admin: 2 };

function findIn(t, id) {
  return A.data[KINDS[t]].find((r) => r.id === id) ?? null;
}

/** le operazioni delicate restano all'amministratore (come nell'interfaccia) */
function needsAdmin(o) {
  if (o.op === 'replace') return true;
  if (o.t === 'absence') return true;
  if (o.op === 'del' && o.t === 'person') return true;
  if (o.op === 'del' && o.t === 'node') return findIn('node', o.id)?.parentId === null;
  return false;
}

function labelOf(t, rec) {
  if (!rec) return '';
  if (t === 'node' || t === 'person') return String(rec.name ?? '');
  if (t === 'note') return String(rec.title || '').slice(0, 80);
  if (t === 'absence') return `${findIn('person', rec.personId)?.name ?? ''} ${rec.start}–${rec.end}`.trim();
  return '';
}

function rootOf(nodeId) {
  let cur = findIn('node', nodeId);
  for (let guard = 0; cur && cur.parentId && guard < 200; guard += 1) cur = findIn('node', cur.parentId);
  return cur?.id ?? null;
}

function isDescendant(nodeId, ancestorId) {
  let cur = findIn('node', nodeId);
  for (let guard = 0; cur && guard < 500; guard += 1) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? findIn('node', cur.parentId) : null;
  }
  return false;
}

const projectOf = (t, rec) => (t === 'node' ? rootOf(rec.id) : t === 'note' ? rootOf(rec.nodeId) : null);

/**
 * Applica un gruppo di operazioni mandate da un browser. Le richieste vengono messe in fila:
 * una alla volta, nell'ordine di arrivo.
 */
export function applyBatch(args) {
  const run = batchQueue.then(() => applyNow(args));
  batchQueue = run.catch(() => {});
  return run;
}

async function applyNow({ ops, session, client = '', batch = '' }) {
  if (readOnly) throw new HttpError(503, 'altro-server');
  if (LEVEL_ORDER[session.level] < 1) throw new HttpError(403, 'livello');
  const bad = invalidOps(ops);
  if (bad) throw new HttpError(400, bad);
  if (session.level !== 'admin' && ops.some(needsAdmin)) throw new HttpError(403, 'livello');

  // lo stesso gruppo rimandato dopo un errore di rete (la risposta si era persa): una volta sola
  if (client && batch) {
    const dup = recent.find((e) => e.client === client && e.batch === batch);
    if (dup) return { ok: true, rev: dup.rev, duplicate: true, skipped: [], fix: [], overwrote: [] };
  }

  const at = new Date().toISOString();
  const applied = []; // operazioni davvero applicate (con le conseguenze esplicite)
  const journal = []; // le stesse, con i valori di prima (per il registro)
  const skipped = []; // operazioni non applicabili (record eliminato nel frattempo, riferimento mancante)
  const fix = []; // stato attuale dei record coinvolti, per correggere il browser che ha scritto
  const overwrote = []; // valori appena scritti da altri e sostituiti da questo salvataggio
  const fixRecord = (t, id) => {
    const rec = findIn(t, id);
    fix.push(rec ? { t, rec } : { t, id, deleted: true });
  };
  const run = (o, extra = {}) => {
    applyOps(A.data, [o]);
    applied.push(o);
    journal.push({ ...o, ...extra });
  };

  for (const o of ops) {
    if (o.op === 'replace') {
      run({ op: 'replace', data: normalizeData(o.data) });
      continue;
    }
    if (o.op === 'order') {
      const before = A.data.nodes.filter((n) => (n.parentId ?? null) === o.parent).map((n) => n.id);
      applyOps(A.data, [o]);
      const after = A.data.nodes.filter((n) => (n.parentId ?? null) === o.parent).map((n) => n.id);
      if (!same(before, after)) {
        applied.push(o);
        journal.push({ ...o, root: o.parent ? rootOf(o.parent) : null });
      }
      continue;
    }
    if (o.op === 'add') {
      const rec = { ...o.rec };
      if (findIn(o.t, rec.id)) {
        skipped.push({ t: o.t, id: rec.id, reason: 'esiste' });
        fixRecord(o.t, rec.id);
        continue;
      }
      const missing =
        (o.t === 'node' && rec.parentId !== null && !findIn('node', rec.parentId)) ||
        (o.t === 'absence' && !findIn('person', rec.personId)) ||
        (o.t === 'note' && !findIn('node', rec.nodeId));
      if (missing) {
        const ref = o.t === 'node' ? rec.parentId : o.t === 'note' ? rec.nodeId : rec.personId;
        const refType = o.t === 'absence' ? 'person' : 'node';
        skipped.push({ t: o.t, id: rec.id, reason: 'eliminato', label: labelOf(o.t, rec), ...deletions.get(keyOf(refType, ref)) });
        fix.push({ t: o.t, id: rec.id, deleted: true });
        continue;
      }
      if (o.t === 'node' && rec.assigneeId && !findIn('person', rec.assigneeId)) rec.assigneeId = null;
      run({ op: 'add', t: o.t, rec }, { label: labelOf(o.t, rec), root: projectOf(o.t, rec) });
      continue;
    }
    if (o.op === 'set') {
      const cur = findIn(o.t, o.id);
      const key = keyOf(o.t, o.id);
      if (!cur) {
        skipped.push({ t: o.t, id: o.id, reason: 'eliminato', ...deletions.get(key) });
        fix.push({ t: o.t, id: o.id, deleted: true });
        continue;
      }
      const set = {};
      const was = {};
      let partial = false;
      for (const [f, v] of Object.entries(o.set)) {
        if (same(cur[f], v)) continue;
        const refBroken =
          (o.t === 'node' && f === 'parentId' && v !== null && (!findIn('node', v) || isDescendant(v, o.id))) ||
          (o.t === 'node' && f === 'assigneeId' && v !== null && !findIn('person', v)) ||
          (o.t === 'absence' && f === 'personId' && !findIn('person', v)) ||
          (o.t === 'note' && f === 'nodeId' && !findIn('node', v));
        if (refBroken) {
          partial = true;
          continue;
        }
        // il valore che il browser aveva sotto gli occhi non è più quello attuale:
        // qualcun altro l'ha cambiato nel frattempo e ora viene sostituito
        if (o.prev && f in o.prev && !same(o.prev[f], cur[f])) {
          const m = A.meta.get(key);
          if (m && m.sid !== session.id) {
            overwrote.push({ t: o.t, id: o.id, field: f, value: cur[f] ?? null, by: m.by, sid: m.sid, label: labelOf(o.t, cur) });
          }
        }
        set[f] = v;
        was[f] = cur[f] ?? null;
      }
      if (Object.keys(set).length) {
        run({ op: 'set', t: o.t, id: o.id, set }, { was, label: labelOf(o.t, { ...cur, ...set }), root: projectOf(o.t, cur) });
      }
      if (partial) {
        skipped.push({ t: o.t, id: o.id, reason: 'riferimento' });
        fixRecord(o.t, o.id);
      }
      continue;
    }
    if (o.op === 'del') {
      const cur = findIn(o.t, o.id);
      if (!cur) continue; // già eliminato da qualcun altro: niente da fare
      const cascade = [];
      if (o.t === 'node') {
        // il ramo intero e le sue note (dai figli alla radice del ramo)
        const branch = A.data.nodes.filter((n) => n.id === o.id || isDescendant(n.id, o.id));
        const ids = new Set(branch.map((n) => n.id));
        for (const note of A.data.notes) if (ids.has(note.nodeId)) cascade.push({ t: 'note', rec: note });
        for (const n of branch.reverse()) cascade.push({ t: 'node', rec: n });
      } else if (o.t === 'person') {
        for (const a of A.data.absences) if (a.personId === o.id) cascade.push({ t: 'absence', rec: a });
        for (const n of A.data.nodes) {
          if (n.assigneeId === o.id) {
            run({ op: 'set', t: 'node', id: n.id, set: { assigneeId: null } }, { was: { assigneeId: o.id }, label: n.name, root: rootOf(n.id) });
          }
        }
        cascade.push({ t: 'person', rec: cur });
      } else {
        cascade.push({ t: o.t, rec: cur });
      }
      const root = o.t === 'node' ? rootOf(o.id) : o.t === 'note' ? rootOf(cur.nodeId) : null;
      for (const { t, rec } of cascade) {
        deletions.set(keyOf(t, rec.id), { by: session.user, at });
        run({ op: 'del', t, id: rec.id }, { rec, label: labelOf(t, rec), root });
      }
      if (deletions.size > 5000) deletions.delete(deletions.keys().next().value);
    }
  }

  if (!applied.length) return { ok: true, rev: A.rev, skipped, fix, overwrote: [] };

  const rev = A.rev + 1;
  const entry = { rev, at, user: session.user, sid: session.id, client, batch, ops: journal };
  try {
    await appendJournal(entry);
  } catch (err) {
    // senza registro la modifica non è al sicuro: si torna allo stato salvato
    await loadFromDisk().catch(() => {});
    emit({ type: 'reload' });
    throw new HttpError(500, 'registro non scrivibile: ' + (err?.message ?? err));
  }
  stampMeta(applied, { rev, at, by: session.user, sid: session.id });
  A.rev = rev;
  A.savedAt = at;
  A.savedBy = session.user;
  scheduleSnapshot();

  const event = { rev, at, user: session.user, sid: session.id, client, batch, ops: applied, overwrote };
  recent.push(event);
  if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);
  emit({ type: 'batch', ...event });
  return { ok: true, rev, skipped, fix, overwrote };
}

// ------------------------------------------------------------------ registro per l'interfaccia

const short = (v) => {
  if (typeof v === 'string') return v.length > 160 ? v.slice(0, 157) + '…' : v;
  if (Array.isArray(v)) return v.join(', ').slice(0, 160);
  return v ?? null;
};

function summarize(e) {
  const changes = [];
  for (const o of e.ops) {
    if (o.op === 'replace') {
      changes.push({ op: 'replace', count: Object.values(KINDS).reduce((s, l) => s + (o.data?.[l]?.length ?? 0), 0) });
      continue;
    }
    if (o.op === 'order') {
      changes.push({ op: 'order', t: 'node', id: o.parent, root: o.root ?? null });
      continue;
    }
    const c = { op: o.op, t: o.t, id: o.id ?? o.rec?.id, label: o.label ?? '', root: o.root ?? null };
    if (o.op === 'set') {
      c.fields = {};
      for (const [f, v] of Object.entries(o.set)) {
        // il testo delle note può essere lungo e formattato: nel registro basta sapere che è cambiato
        c.fields[f] = f === 'body' ? null : [short(o.was?.[f]), short(v)];
      }
    }
    changes.push(c);
  }
  return { rev: e.rev, at: e.at, user: e.user, changes };
}

/** pagina del registro, dalla modifica più recente; filtri per utente e progetto */
export async function readLog({ limit = 100, before = Infinity, user = '', project = '' } = {}) {
  const out = [];
  const files = (await journalFiles()).reverse();
  for (const f of files) {
    const entries = parseLines(await readFile(join(dataPaths().journal, f), 'utf8')).reverse();
    for (const e of entries) {
      if (!(e.rev < before)) continue;
      if (user && e.user !== user) continue;
      const s = summarize(e);
      if (project) {
        s.changes = s.changes.filter((c) => c.root === project || c.id === project);
        if (!s.changes.length) continue;
      }
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** solo per i test: stato interno */
export function _archive() {
  return A;
}

/** solo per i test: come uno spegnimento brusco (niente scrittura finale di gantt-dati.json) */
export function _crash() {
  for (const x of timers) clearInterval(x);
  timers = [];
  clearTimeout(snapshotTimer);
  snapshotTimer = null;
  snapshotDirty = false;
}
