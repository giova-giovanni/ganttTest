import { useSyncExternalStore } from 'react';
import type { Absence, AppData, ColKey, HomeLayout, Note, Person, Status, TaskNode, UiState } from './types';
import { STATUSES, ABSENCE_TYPES } from './types';
import { demoData } from './demo';
import { descendantIds, sanitizeNodes } from './utils/tree';
import { parseTags, sanitizeHtml } from './utils/notes';
import { api, releaseOnUnload, type Identity, type Level, type LockInfo, type ServerInfo } from './utils/api';

const DATA_KEY = 'gantt.data.v1';
const UI_KEY = 'gantt.ui.v1';
const SESSION_KEY = 'gantt.session';
const LEVEL_KEY = 'gantt.level';

export const DATA_VERSION = 4;

let seq = 0;
export function uid(prefix = 'n'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && ISO_RE.test(v) ? v : null);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : null;
};
const isoTime = (v: unknown, fallback: string): string => {
  if (typeof v !== 'string') return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};

/**
 * Normalizza dati che possono arrivare da un file esterno o da una versione precedente.
 * Non deve mai lanciare eccezioni: valori sconosciuti vengono sostituiti dai default.
 */
export function migrate(data: Partial<AppData> | null | undefined): AppData {
  const d = data ?? {};
  const people: Person[] = (Array.isArray(d.people) ? d.people : [])
    .filter((p): p is Person => !!p && typeof p === 'object')
    .map((p) => ({
      id: str(p.id) || uid('p'),
      name: str(p.name),
      role: str(p.role),
      color: /^#[0-9a-fA-F]{6}$/.test(str(p.color)) ? p.color : '#2f7de1',
      hoursPerDay: (() => {
        const h = num(p.hoursPerDay);
        return h && h > 0 && h <= 24 ? h : 8;
      })(),
    }));
  const peopleIds = new Set(people.map((p) => p.id));

  const nodes: TaskNode[] = sanitizeNodes(
    (Array.isArray(d.nodes) ? d.nodes : [])
      .filter((n): n is TaskNode => !!n && typeof n === 'object')
      .map((n) => ({
        id: str(n.id),
        parentId: str(n.parentId) || null,
        name: str(n.name),
        status: STATUSES.includes(n.status) ? n.status : 'TODO',
        start: isoOrNull(n.start),
        end: isoOrNull(n.end),
        hours: num(n.hours),
        assigneeId: n.assigneeId && peopleIds.has(n.assigneeId) ? n.assigneeId : null,
        notes: str(n.notes),
        collapsed: !!n.collapsed,
        archived: !!n.archived,
      })),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));

  const absences: Absence[] = (Array.isArray(d.absences) ? d.absences : [])
    .filter((a): a is Absence => !!a && typeof a === 'object')
    .map((a) => {
      const s = isoOrNull(a.start);
      const e = isoOrNull(a.end) ?? s;
      return {
        id: str(a.id) || uid('a'),
        personId: str(a.personId),
        start: s && e && e < s ? e : s,
        end: s && e && e < s ? s : e,
        type: ABSENCE_TYPES.includes(a.type) ? a.type : 'OTHER',
        note: str(a.note),
      } as Absence;
    })
    .filter((a) => a.start && a.end && peopleIds.has(a.personId));

  const now = new Date().toISOString();
  const notes: Note[] = (Array.isArray(d.notes) ? d.notes : [])
    .filter((n): n is Note => !!n && typeof n === 'object')
    .map((n) => {
      const createdAt = isoTime(n.createdAt, now);
      return {
        id: str(n.id) || uid('nt'),
        nodeId: str(n.nodeId),
        title: str(n.title).slice(0, 200),
        body: sanitizeHtml(str(n.body)),
        tags: Array.isArray(n.tags) ? parseTags(n.tags.map(String).join(',')) : [],
        author: str(n.author),
        createdAt,
        updatedAt: isoTime(n.updatedAt, createdAt),
        pinned: !!n.pinned,
      };
    })
    // una nota agganciata a un'attività cancellata non serve più a nessuno
    .filter((n) => nodeIds.has(n.nodeId));

  return { version: DATA_VERSION, people, absences, nodes, notes };
}

// ---------------------------------------------------------------- stato

export type SyncMode = 'browser' | 'shared';
export type SyncRole = 'writer' | 'reader';

export interface SyncState {
  /** 'shared' = archivio su file (anche di rete); 'browser' = ripiego nel browser */
  mode: SyncMode;
  ready: boolean;
  role: SyncRole;
  info: ServerInfo | null;
  identity: Identity | null;
  /** chi sta modificando adesso (null = nessuno) */
  lock: LockInfo | null;
  rev: number;
  savedAt: string | null;
  savedBy: string | null;
  saving: boolean;
  /** ci sono modifiche non ancora scritte sul file */
  pending: boolean;
  /** qualcun altro ha salvato mentre noi modificavamo: serve ricaricare */
  conflict: boolean;
  /** mostra il dialogo "documento in uso" all'apertura */
  ask: boolean;
  error: string | null;
  /** dati presenti solo in questo browser, mai trasferiti sull'archivio condiviso */
  localOnly: AppData | null;
}

/**
 * Livello di accesso di chi sta usando il programma.
 * Senza il file `gantt-utenti.json` accanto al programma `enabled` resta false
 * e tutti lavorano come amministratori, esattamente come nelle versioni precedenti.
 */
export interface AuthState {
  ready: boolean;
  enabled: boolean;
  /** livello attuale (può essere stato sbloccato con la password) */
  level: Level;
  /** livello che spetta a questo PC senza digitare niente */
  autoLevel: Level;
  /** true se il livello automatico arriva dall'elenco dei PC */
  auto: boolean;
  /** livelli sbloccabili con una password */
  levels: Level[];
  /** come il server riconosce questo computer: si copia nell'elenco «pc» del file */
  who: string;
  file: string;
  /** il file esiste ma non è stato ancora letto? serve solo per l'avviso in Impostazioni */
  exists: boolean;
}

interface State {
  data: AppData;
  ui: UiState;
  sync: SyncState;
  auth: AuthState;
}

export const LEVEL_ORDER: Record<Level, number> = { lettura: 0, modifica: 1, admin: 2 };

const defaultHome: HomeLayout = {
  showKpi: true,
  showCalendar: true,
  showDeadlines: true,
  showOverview: true,
  showTable: true,
  calMode: 'both',
  calDayHeight: 78,
  calRatio: 0.58,
  deadlinesHeight: 420,
  overviewHeight: 420,
  deadlineDays: 30,
};

const defaultUi: UiState = {
  lang: 'it',
  theme: 'light',
  page: 'home',
  selectedProjectId: null,
  scale: 'week',
  gridWidth: 620,
  colWidths: {},
  home: defaultHome,
  userName: '',
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  Number.isFinite(v as number) ? Math.min(max, Math.max(min, v as number)) : fallback;

/** ripulisce le preferenze salvate: un valore fuori elenco tornerebbe una pagina bianca */
function sanitizeUi(raw: Partial<UiState>): UiState {
  const ui = { ...defaultUi, ...raw };
  const pages: UiState['page'][] = ['home', 'project', 'load', 'people', 'notes'];
  const home = { ...defaultHome, ...(raw.home ?? {}) };
  const colWidths: Partial<Record<ColKey, number>> = {};
  for (const [key, value] of Object.entries(raw.colWidths ?? {})) {
    if (Number.isFinite(value)) colWidths[key as ColKey] = clamp(value, 44, 800, 100);
  }
  return {
    lang: ui.lang === 'de' ? 'de' : 'it',
    theme: ui.theme === 'dark' ? 'dark' : 'light',
    page: pages.includes(ui.page) ? ui.page : 'home',
    selectedProjectId: typeof ui.selectedProjectId === 'string' ? ui.selectedProjectId : null,
    scale: ui.scale === 'day' || ui.scale === 'month' ? ui.scale : 'week',
    gridWidth: clamp(ui.gridWidth, 220, 1100, defaultUi.gridWidth),
    colWidths,
    userName: str(ui.userName).slice(0, 40),
    home: {
      showKpi: home.showKpi !== false,
      showCalendar: home.showCalendar !== false,
      showDeadlines: home.showDeadlines !== false,
      showOverview: home.showOverview !== false,
      showTable: home.showTable !== false,
      calMode: home.calMode === 'spans' || home.calMode === 'deadlines' ? home.calMode : 'both',
      calDayHeight: clamp(home.calDayHeight, 46, 220, defaultHome.calDayHeight),
      calRatio: clamp(home.calRatio, 0.3, 0.8, defaultHome.calRatio),
      deadlinesHeight: clamp(home.deadlinesHeight, 160, 900, defaultHome.deadlinesHeight),
      overviewHeight: clamp(home.overviewHeight, 160, 1200, defaultHome.overviewHeight),
      deadlineDays: clamp(home.deadlineDays, 7, 365, defaultHome.deadlineDays),
    },
  };
}

function readLocalUi(): UiState {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (raw) return sanitizeUi(JSON.parse(raw) as Partial<UiState>);
  } catch {
    /* preferenze illeggibili: default */
  }
  return defaultUi;
}

function readLocalData(): AppData | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return migrate(JSON.parse(raw) as AppData);
  } catch {
    /* dato illeggibile */
  }
  return null;
}

const emptyData = (): AppData => ({ version: DATA_VERSION, nodes: [], people: [], absences: [], notes: [] });

const isEmpty = (d: AppData) => d.nodes.length === 0 && d.people.length === 0 && d.notes.length === 0;

let state: State = {
  data: emptyData(),
  ui: defaultUi,
  sync: {
    mode: 'browser',
    ready: false,
    role: 'writer',
    info: null,
    identity: null,
    lock: null,
    rev: 0,
    savedAt: null,
    savedBy: null,
    saving: false,
    pending: false,
    conflict: false,
    ask: false,
    error: null,
    localOnly: null,
  },
  auth: {
    ready: false,
    enabled: false,
    level: 'admin',
    autoLevel: 'admin',
    auto: true,
    levels: [],
    who: '',
    file: '',
    exists: false,
  },
};

let past: AppData[] = [];
let future: AppData[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): State {
  return state;
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

function setSync(patch: Partial<SyncState>) {
  state = { ...state, sync: { ...state.sync, ...patch } };
  emit();
}

/** true quando le modifiche sono permesse (siamo noi a tenere il blocco e il livello lo consente) */
export function canEdit(): boolean {
  if (state.auth.level === 'lettura') return false;
  return state.sync.mode === 'browser' || (state.sync.role === 'writer' && !state.sync.conflict);
}

/** true per le operazioni delicate: eliminare, svuotare, gestire responsabili e assenze */
export function isAdmin(): boolean {
  return state.auth.level === 'admin';
}

/** modifiche riservate all'amministratore: valgono solo se si può comunque scrivere */
export function canAdmin(): boolean {
  return isAdmin() && canEdit();
}

function setAuth(patch: Partial<AuthState>) {
  state = { ...state, auth: { ...state.auth, ...patch } };
  emit();
}

function readSavedLevel(): Level | null {
  try {
    const v = sessionStorage.getItem(LEVEL_KEY);
    return v === 'admin' || v === 'modifica' || v === 'lettura' ? v : null;
  } catch {
    return null;
  }
}

/** sblocca un livello superiore digitando la password: vale per questa sessione del browser */
export async function unlockLevel(password: string): Promise<{ ok: boolean; level?: Level; error?: string }> {
  try {
    const r = await api.login(password);
    if (r.ok && r.level) {
      setAuth({ level: r.level });
      try {
        sessionStorage.setItem(LEVEL_KEY, r.level);
      } catch {
        /* niente sessionStorage: il livello vale finché non si ricarica */
      }
      // chi entrava in sola lettura per il livello ora può chiedere di scrivere
      if (state.sync.mode === 'shared' && state.sync.role === 'reader' && !state.sync.lock) void takeControl();
      return { ok: true, level: r.level };
    }
    return { ok: false, error: r.error === 'pausa' ? 'auth.paused' : 'auth.wrong' };
  } catch {
    return { ok: false, error: 'sync.offline' };
  }
}

/** torna al livello che spetta a questo PC (fine turno su un computer condiviso) */
export function lockLevel() {
  setAuth({ level: state.auth.autoLevel });
  try {
    sessionStorage.removeItem(LEVEL_KEY);
  } catch {
    /* niente da pulire */
  }
  if (state.auth.autoLevel === 'lettura' && state.sync.mode === 'shared' && state.sync.role === 'writer') {
    void giveUpControl();
  }
}

// ---------------------------------------------------------------- salvataggio

let uiTimer: number | undefined;

function persistUi() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(uiTimer);
  uiTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(state.ui));
    } catch {
      /* spazio esaurito */
    }
  }, 200);
}

let dataTimer: number | undefined;
let localWarned = false;

function persistLocal() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(state.data));
  } catch {
    if (!localWarned) {
      localWarned = true;
      console.warn('Gantt Planner: impossibile salvare i dati nel browser (spazio esaurito?)');
    }
  }
}

async function pushToServer() {
  const { identity, rev, mode, role, conflict } = state.sync;
  if (mode !== 'shared' || !identity || role !== 'writer' || conflict) return;
  setSync({ saving: true, error: null });
  try {
    const r = await api.save(identity, rev, state.data);
    if (r.ok && typeof r.rev === 'number') {
      setSync({ saving: false, pending: false, rev: r.rev, savedAt: new Date().toISOString(), conflict: false });
      return;
    }
    if (r.error === 'conflict') {
      setSync({ saving: false, conflict: true, error: 'sync.conflict', savedBy: r.savedBy ?? null });
      return;
    }
    if (r.error === 'locked') {
      setSync({ saving: false, role: 'reader', lock: r.lock ?? null, error: 'sync.lostLock' });
      return;
    }
    setSync({ saving: false, error: 'sync.saveFailed' });
  } catch {
    // rete o cartella momentaneamente non raggiungibile: si riprova al prossimo salvataggio
    setSync({ saving: false, error: 'sync.offline' });
  }
}

function persistData() {
  if (state.sync.mode === 'browser') {
    persistLocal();
    return;
  }
  setSync({ pending: true });
  if (typeof window === 'undefined') return;
  window.clearTimeout(dataTimer);
  dataTimer = window.setTimeout(() => void pushToServer(), 700);
}

/** salvataggio immediato (usato prima della chiusura della pagina) */
export function flushPersist() {
  if (typeof window !== 'undefined') window.clearTimeout(dataTimer);
  if (state.sync.mode === 'browser') persistLocal();
  else if (state.sync.pending) void pushToServer();
}

/** modifica dei dati con snapshot per undo */
function mutate(fn: (d: AppData) => AppData | void, history = true) {
  if (!canEdit()) {
    setSync({ error: 'sync.readOnlyBlocked' });
    return;
  }
  const snapshot: AppData = JSON.parse(JSON.stringify(state.data));
  const next = fn(state.data as AppData);
  const newData = (next as AppData) ?? state.data;
  if (history) {
    past = [...past.slice(-49), snapshot];
    future = [];
  }
  state = {
    ...state,
    data: { ...newData, nodes: [...newData.nodes], people: [...newData.people], notes: [...newData.notes] },
  };
  persistData();
  emit();
}

export function setUi(patch: Partial<UiState>) {
  state = { ...state, ui: { ...state.ui, ...patch } };
  persistUi();
  emit();
}

export function setHome(patch: Partial<HomeLayout>) {
  setUi({ home: { ...state.ui.home, ...patch } });
}

export function setColWidth(key: ColKey, width: number) {
  setUi({ colWidths: { ...state.ui.colWidths, [key]: Math.round(clamp(width, 44, 800, 100)) } });
}

export function resetColWidths() {
  setUi({ colWidths: {} });
}

export function undo() {
  if (!past.length || !canEdit()) return;
  const prev = past[past.length - 1];
  past = past.slice(0, -1);
  future = [JSON.parse(JSON.stringify(state.data)), ...future.slice(0, 49)];
  state = { ...state, data: prev };
  persistData();
  emit();
}

export function redo() {
  if (!future.length || !canEdit()) return;
  const next = future[0];
  future = future.slice(1);
  past = [...past, JSON.parse(JSON.stringify(state.data))];
  state = { ...state, data: next };
  persistData();
  emit();
}

export function canUndo() {
  return past.length > 0;
}
export function canRedo() {
  return future.length > 0;
}

// ---------------------------------------------------------------- avvio e sincronizzazione

function newSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = uid('s');
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return uid('s');
  }
}

let heartbeatTimer: number | undefined;
let pollTimer: number | undefined;

function stopTimers() {
  window.clearInterval(heartbeatTimer);
  window.clearInterval(pollTimer);
}

async function poll() {
  const { identity, mode } = state.sync;
  if (mode !== 'shared' || !identity) return;
  try {
    const s = await api.status();
    const lock = s.lock ?? null;
    const holdsLock = !!lock && lock.sessionId === identity.sessionId;

    if (state.sync.role === 'writer' && !holdsLock && lock && !lock.stale) {
      // qualcuno è subentrato mentre eravamo fermi
      setSync({ role: 'reader', lock, error: 'sync.lostLock' });
      await reload();
      return;
    }
    setSync({ lock, savedBy: s.savedBy ?? state.sync.savedBy });

    if (state.sync.role === 'reader' && s.rev !== state.sync.rev) await reload();
  } catch {
    setSync({ error: 'sync.offline' });
  }
}

async function beat() {
  const { identity, role, mode } = state.sync;
  if (mode !== 'shared' || !identity || role !== 'writer') return;
  try {
    const r = await api.heartbeat(identity.sessionId);
    if (!r.ok && r.reason === 'lost') {
      setSync({ role: 'reader', lock: r.lock ?? null, error: 'sync.lostLock' });
      await reload();
    } else if (r.lock) {
      setSync({ lock: r.lock, error: state.sync.error === 'sync.offline' ? null : state.sync.error });
    }
  } catch {
    /* un battito perso non è un problema: il blocco dura più di due battiti */
  }
}

function startTimers() {
  stopTimers();
  const every = state.sync.info?.heartbeatMs ?? 25_000;
  heartbeatTimer = window.setInterval(() => void beat(), every);
  pollTimer = window.setInterval(() => void poll(), 8_000);
}

/** rilegge i dati dal file condiviso (dopo un conflitto o quando un altro utente salva) */
export async function reload(): Promise<void> {
  if (state.sync.mode !== 'shared') return;
  try {
    const s = await api.state();
    past = [];
    future = [];
    state = { ...state, data: migrate(s.data) };
    setSync({
      rev: s.rev,
      savedAt: s.savedAt,
      savedBy: s.savedBy,
      lock: s.lock ?? null,
      conflict: false,
      pending: false,
      error: null,
    });
    ensureSelection();
  } catch {
    setSync({ error: 'sync.offline' });
  }
}

function ensureSelection() {
  const { data, ui } = state;
  if (!ui.selectedProjectId || !data.nodes.some((n) => n.id === ui.selectedProjectId && n.parentId === null)) {
    const first = data.nodes.find((n) => n.parentId === null && !n.archived);
    state = { ...state, ui: { ...state.ui, selectedProjectId: first?.id ?? null } };
  }
}

/** chiede il blocco di scrittura; `force` subentra a un blocco abbandonato */
export async function takeControl(force = false): Promise<boolean> {
  const { identity, mode } = state.sync;
  if (state.auth.level === 'lettura') return false;
  if (mode !== 'shared' || !identity) return true;
  try {
    const r = await api.lock(identity, force);
    if (r.ok) {
      await reload();
      setSync({ role: 'writer', lock: r.lock ?? null, ask: false, error: null });
      return true;
    }
    setSync({ role: 'reader', lock: r.lock ?? null, error: 'sync.busy' });
    return false;
  } catch {
    setSync({ error: 'sync.offline' });
    return false;
  }
}

/** chiede a chi sta scrivendo di lasciare il posto */
export async function askForControl(): Promise<void> {
  const { identity, mode } = state.sync;
  if (mode !== 'shared' || !identity) return;
  try {
    const r = await api.requestControl(identity);
    if (r.free) await takeControl();
    else setSync({ error: 'sync.requested' });
  } catch {
    setSync({ error: 'sync.offline' });
  }
}

/** chi sta scrivendo cede il posto e passa in sola lettura */
export async function giveUpControl(): Promise<void> {
  const { identity, mode, role } = state.sync;
  if (mode !== 'shared' || !identity || role !== 'writer') return;
  flushPersist();
  try {
    await api.yieldControl(identity.sessionId);
  } catch {
    /* il blocco scade comunque da solo */
  }
  setSync({ role: 'reader', lock: null, error: null });
}

export function continueReadOnly() {
  setSync({ ask: false });
}

/** il nome mostrato agli altri utenti: si aggiorna anche nel blocco già acquisito */
export function setUserName(name: string) {
  const clean = name.slice(0, 40);
  setUi({ userName: clean });
  const { identity, mode, role } = state.sync;
  if (mode !== 'shared' || !identity) return;
  const next: Identity = { ...identity, user: clean.trim() || identity.user };
  setSync({ identity: next });
  if (role === 'writer') void api.lock(next).catch(() => {});
}

export function dismissSyncError() {
  setSync({ error: null });
}

/** trasferisce sull'archivio condiviso i dati rimasti nel browser di questo PC */
export async function uploadLocalData(): Promise<boolean> {
  const local = state.sync.localOnly;
  if (!local || state.sync.role !== 'writer') return false;
  state = { ...state, data: local };
  setSync({ localOnly: null });
  ensureSelection();
  await pushToServer();
  return true;
}

export function dismissLocalData() {
  setSync({ localOnly: null });
}

/**
 * Prepara lo stato prima di disegnare l'interfaccia.
 * Se il server risponde i dati vengono dal file condiviso, altrimenti si continua
 * a lavorare nel browser come nelle versioni precedenti.
 */
export async function initStore(): Promise<void> {
  const ui = readLocalUi();
  state = { ...state, ui };

  let info: ServerInfo | null = null;
  try {
    info = await api.info();
  } catch {
    info = null;
  }

  if (!info) {
    const data = readLocalData() ?? demoData();
    state = { ...state, data };
    ensureSelection();
    setAuth({ ready: true });
    setSync({ mode: 'browser', ready: true, role: 'writer' });
    return;
  }

  // livello di accesso: senza gantt-utenti.json resta «admin» per tutti
  try {
    const a = await api.auth();
    const saved = readSavedLevel();
    const level =
      a.enabled && saved && a.levels.includes(saved) && LEVEL_ORDER[saved] > LEVEL_ORDER[a.level] ? saved : a.level;
    setAuth({
      ready: true,
      enabled: a.enabled,
      level,
      autoLevel: a.level,
      auto: a.auto,
      levels: a.levels,
      who: a.who,
      file: a.file,
      exists: a.exists,
    });
  } catch {
    setAuth({ ready: true });
  }

  const identity: Identity = {
    sessionId: newSessionId(),
    user: ui.userName.trim() || info.server.user,
    host: info.server.host,
  };
  if (!ui.userName.trim()) state = { ...state, ui: { ...state.ui, userName: identity.user } };

  let remote: AppData = emptyData();
  let rev = 0;
  let savedAt: string | null = null;
  let savedBy: string | null = null;
  let lock: LockInfo | null = null;
  try {
    const s = await api.state();
    remote = migrate(s.data);
    rev = s.rev;
    savedAt = s.savedAt;
    savedBy = s.savedBy;
    lock = s.lock ?? null;
  } catch {
    // il server risponde ma l'archivio non è leggibile: meglio non toccare nulla
    state = { ...state, data: emptyData() };
    setSync({ mode: 'shared', ready: true, role: 'reader', info, identity, error: 'sync.readFailed' });
    return;
  }

  const busy = !!lock && lock.sessionId !== identity.sessionId && !lock.stale && !lock.yielded;
  let role: SyncRole = 'reader';
  // chi entra in sola lettura per il livello di accesso non toglie il posto agli altri
  if (!busy && state.auth.level !== 'lettura') {
    try {
      const r = await api.lock(identity);
      if (r.ok) {
        role = 'writer';
        lock = r.lock ?? null;
      } else {
        lock = r.lock ?? lock;
      }
    } catch {
      /* si resta in sola lettura */
    }
  }

  const localData = readLocalData();
  // il travaso dei dati del browser si propone solo a chi può scrivere e solo se
  // l'archivio condiviso è ancora vuoto: altrimenti si rischia di sovrascrivere il lavoro altrui
  const localOnly =
    role === 'writer' && isEmpty(remote) && localData && !isEmpty(localData) ? localData : null;

  state = { ...state, data: remote };
  ensureSelection();
  setSync({
    mode: 'shared',
    ready: true,
    role,
    info,
    identity,
    lock,
    rev,
    savedAt,
    savedBy,
    ask: busy && state.auth.level !== 'lettura',
    localOnly,
  });

  // Nota: un archivio condiviso vuoto non viene riempito da solo con i dati di esempio.
  // Se lo facesse, chi apre il programma da un indirizzo diverso (porta occupata) non
  // vedrebbe più la proposta di travasare i propri progetti dal browser.
  // Il pulsante «Carica dati di esempio» resta nella barra laterale finché non c'è nulla.

  startTimers();

  window.addEventListener('pagehide', () => {
    if (state.sync.pending) void pushToServer();
    if (state.sync.role === 'writer' && state.sync.identity) releaseOnUnload(state.sync.identity.sessionId);
  });
}

// ---------------------------------------------------------------- azioni albero

export function newNode(parentId: string | null, name: string): TaskNode {
  return {
    id: uid(),
    parentId,
    name,
    status: 'TODO',
    start: null,
    end: null,
    hours: null,
    assigneeId: null,
    notes: '',
    collapsed: false,
    archived: false,
  };
}

/** inserisce un nodo subito dopo `afterId` (stesso genitore) oppure in fondo */
export function addNode(parentId: string | null, name: string, afterId?: string | null): string {
  const node = newNode(parentId, name);
  mutate((d) => {
    const nodes = [...d.nodes];
    if (afterId) {
      // inserisce dopo l'ultima sotto-attività di afterId per mantenere l'ordine albero
      const desc = descendantIds(nodes, afterId);
      let idx = nodes.findIndex((n) => n.id === afterId);
      for (const id of desc) idx = Math.max(idx, nodes.findIndex((n) => n.id === id));
      nodes.splice(idx + 1, 0, node);
    } else {
      nodes.push(node);
    }
    d.nodes = nodes;
  });
  return node.id;
}

export function updateNode(id: string, patch: Partial<TaskNode>, history = true) {
  mutate((d) => {
    d.nodes = d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
  }, history);
}

export function updateNodes(patches: Record<string, Partial<TaskNode>>, history = true) {
  mutate((d) => {
    d.nodes = d.nodes.map((n) => (patches[n.id] ? { ...n, ...patches[n.id] } : n));
  }, history);
}

export function deleteNode(id: string) {
  mutate((d) => {
    const kill = new Set([id, ...descendantIds(d.nodes, id)]);
    d.nodes = d.nodes.filter((n) => !kill.has(n.id));
    d.notes = d.notes.filter((n) => !kill.has(n.nodeId));
  });
  if (state.ui.selectedProjectId === id) {
    const first =
      state.data.nodes.find((n) => n.parentId === null && !n.archived) ??
      state.data.nodes.find((n) => n.parentId === null);
    setUi({ selectedProjectId: first?.id ?? null, page: first ? state.ui.page : 'home' });
  }
}

/** rende il nodo figlio del fratello precedente */
export function indentNode(id: string) {
  mutate((d) => {
    const node = d.nodes.find((n) => n.id === id);
    if (!node) return;
    const siblings = d.nodes.filter((n) => n.parentId === node.parentId);
    const pos = siblings.findIndex((n) => n.id === id);
    if (pos <= 0) return;
    const newParent = siblings[pos - 1];
    d.nodes = d.nodes.map((n) =>
      n.id === id ? { ...n, parentId: newParent.id } : n.id === newParent.id ? { ...n, collapsed: false } : n,
    );
    // riposiziona subito dopo l'ultima sotto-attività del nuovo genitore
    const moved = d.nodes.find((n) => n.id === id)!;
    const rest = d.nodes.filter((n) => n.id !== id);
    const desc = descendantIds(rest, newParent.id);
    let idx = rest.findIndex((n) => n.id === newParent.id);
    for (const dId of desc) idx = Math.max(idx, rest.findIndex((n) => n.id === dId));
    rest.splice(idx + 1, 0, moved);
    d.nodes = rest;
  });
}

/** porta il nodo allo stesso livello del genitore */
export function outdentNode(id: string) {
  mutate((d) => {
    const node = d.nodes.find((n) => n.id === id);
    if (!node || !node.parentId) return;
    const parent = d.nodes.find((n) => n.id === node.parentId);
    if (!parent) return;
    const updated = d.nodes.map((n) => (n.id === id ? { ...n, parentId: parent.parentId } : n));
    const moved = updated.find((n) => n.id === id)!;
    const rest = updated.filter((n) => n.id !== id);
    const desc = descendantIds(rest, parent.id);
    let idx = rest.findIndex((n) => n.id === parent.id);
    for (const dId of desc) idx = Math.max(idx, rest.findIndex((n) => n.id === dId));
    rest.splice(idx + 1, 0, moved);
    d.nodes = rest;
  });
}

export function moveNode(id: string, dir: -1 | 1) {
  mutate((d) => {
    const node = d.nodes.find((n) => n.id === id);
    if (!node) return;
    const siblings = d.nodes.filter((n) => n.parentId === node.parentId);
    const pos = siblings.findIndex((n) => n.id === id);
    const target = siblings[pos + dir];
    if (!target) return;
    const block = [id, ...descendantIds(d.nodes, id)];
    const blockSet = new Set(block);
    const blockNodes = d.nodes.filter((n) => blockSet.has(n.id));
    const rest = d.nodes.filter((n) => !blockSet.has(n.id));
    let idx: number;
    if (dir === 1) {
      const tDesc = descendantIds(rest, target.id);
      idx = rest.findIndex((n) => n.id === target.id);
      for (const dId of tDesc) idx = Math.max(idx, rest.findIndex((n) => n.id === dId));
      idx += 1;
    } else {
      idx = rest.findIndex((n) => n.id === target.id);
    }
    rest.splice(idx, 0, ...blockNodes);
    d.nodes = rest;
  });
}

export function setCollapsedAll(rootId: string | null, collapsed: boolean) {
  mutate((d) => {
    const ids = rootId ? new Set([rootId, ...descendantIds(d.nodes, rootId)]) : null;
    d.nodes = d.nodes.map((n) => (!ids || ids.has(n.id) ? { ...n, collapsed } : n));
  }, false);
}

export function toggleCollapsed(id: string) {
  mutate((d) => {
    d.nodes = d.nodes.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n));
  }, false);
}

export function addProject(name: string): string {
  const id = addNode(null, name);
  setUi({ selectedProjectId: id, page: 'project' });
  return id;
}

export function setStatus(id: string, status: Status) {
  updateNode(id, { status });
}

// ---------------------------------------------------------------- archivio

export function setArchived(id: string, archived: boolean) {
  updateNode(id, { archived });
  if (archived && state.ui.selectedProjectId === id) {
    const next = state.data.nodes.find((n) => n.parentId === null && !n.archived && n.id !== id);
    setUi({ selectedProjectId: next?.id ?? null, page: next ? state.ui.page : 'home' });
  } else if (!archived) {
    setUi({ selectedProjectId: id, page: 'project' });
  }
}

// ---------------------------------------------------------------- note

export function addNote(nodeId: string, patch: Partial<Note> = {}): string {
  const now = new Date().toISOString();
  const note: Note = {
    id: uid('nt'),
    nodeId,
    title: patch.title ?? '',
    body: sanitizeHtml(patch.body ?? ''),
    tags: patch.tags ?? [],
    author: patch.author ?? state.ui.userName.trim(),
    createdAt: now,
    updatedAt: now,
    pinned: !!patch.pinned,
  };
  mutate((d) => {
    d.notes = [note, ...d.notes];
  });
  return note.id;
}

/**
 * La scrittura del testo non entra nella cronologia di annulla/ripristina:
 * altrimenti ogni frase digitata riempirebbe la pila con decine di passi.
 */
export function updateNote(id: string, patch: Partial<Note>, history = false) {
  mutate((d) => {
    d.notes = d.notes.map((n) =>
      n.id === id
        ? {
            ...n,
            ...patch,
            body: patch.body !== undefined ? sanitizeHtml(patch.body) : n.body,
            updatedAt: new Date().toISOString(),
          }
        : n,
    );
  }, history);
}

export function deleteNote(id: string) {
  mutate((d) => {
    d.notes = d.notes.filter((n) => n.id !== id);
  });
}

export function toggleNotePinned(id: string) {
  const note = state.data.notes.find((n) => n.id === id);
  if (note) updateNote(id, { pinned: !note.pinned }, true);
}

// ---------------------------------------------------------------- assenze

export function addAbsence(a: Omit<Absence, 'id'>): string {
  const abs: Absence = { ...a, id: uid('a') };
  mutate((d) => {
    d.absences = [...d.absences, abs];
  });
  return abs.id;
}

export function updateAbsence(id: string, patch: Partial<Absence>) {
  mutate((d) => {
    d.absences = d.absences.map((a) => (a.id === id ? { ...a, ...patch } : a));
  });
}

export function deleteAbsence(id: string) {
  mutate((d) => {
    d.absences = d.absences.filter((a) => a.id !== id);
  });
}

// ---------------------------------------------------------------- persone

export function addPerson(p: Omit<Person, 'id'>): string {
  const person: Person = { ...p, id: uid('p') };
  mutate((d) => {
    d.people = [...d.people, person];
  });
  return person.id;
}

export function updatePerson(id: string, patch: Partial<Person>) {
  mutate((d) => {
    d.people = d.people.map((p) => (p.id === id ? { ...p, ...patch } : p));
  });
}

export function deletePerson(id: string) {
  mutate((d) => {
    d.people = d.people.filter((p) => p.id !== id);
    d.absences = d.absences.filter((a) => a.personId !== id);
    d.nodes = d.nodes.map((n) => (n.assigneeId === id ? { ...n, assigneeId: null } : n));
  });
}

// ---------------------------------------------------------------- import/export

export function replaceData(data: Partial<AppData>) {
  mutate(() => migrate(data));
  const first = state.data.nodes.find((n) => n.parentId === null && !n.archived);
  setUi({ selectedProjectId: first?.id ?? null });
}

/**
 * Aggiunge progetti/persone/assenze/note ai dati esistenti senza cancellare nulla.
 * Gli id in conflitto vengono rimappati, così due backup diversi convivono.
 */
export function mergeData(incoming: Partial<AppData>): {
  projects: number;
  tasks: number;
  people: number;
  absences: number;
  notes: number;
} {
  const add = migrate(incoming);
  const existing = state.data;
  const remap: Record<string, string> = {};
  const usedNodeIds = new Set(existing.nodes.map((n) => n.id));
  const usedPersonIds = new Set(existing.people.map((p) => p.id));

  // le persone con lo stesso nome (senza distinzione di maiuscole) vengono riusate
  const byName: Record<string, string> = {};
  for (const p of existing.people) byName[p.name.trim().toLowerCase()] = p.id;
  const newPeople: Person[] = [];
  for (const p of add.people) {
    const key = p.name.trim().toLowerCase();
    if (key && byName[key]) {
      remap[p.id] = byName[key];
      continue;
    }
    const id = usedPersonIds.has(p.id) ? uid('p') : p.id;
    usedPersonIds.add(id);
    remap[p.id] = id;
    const person = { ...p, id };
    newPeople.push(person);
    if (key) byName[key] = id;
  }

  const newNodes: TaskNode[] = [];
  for (const n of add.nodes) {
    const id = usedNodeIds.has(n.id) ? uid() : n.id;
    usedNodeIds.add(id);
    remap[n.id] = id;
    newNodes.push({ ...n, id });
  }
  for (const n of newNodes) {
    if (n.parentId) n.parentId = remap[n.parentId] ?? null;
    if (n.assigneeId) n.assigneeId = remap[n.assigneeId] ?? null;
  }

  const newAbsences: Absence[] = add.absences
    .map((a) => ({ ...a, id: uid('a'), personId: remap[a.personId] ?? a.personId }))
    .filter((a) => usedPersonIds.has(a.personId));

  const newNotes: Note[] = add.notes
    .map((n) => ({ ...n, id: uid('nt'), nodeId: remap[n.nodeId] ?? n.nodeId }))
    .filter((n) => usedNodeIds.has(n.nodeId));

  mutate((d) => {
    d.nodes = [...d.nodes, ...newNodes];
    d.people = [...d.people, ...newPeople];
    d.absences = [...d.absences, ...newAbsences];
    d.notes = [...d.notes, ...newNotes];
  });

  const projects = newNodes.filter((n) => n.parentId === null).length;
  if (projects > 0) {
    const first = newNodes.find((n) => n.parentId === null);
    if (first) setUi({ selectedProjectId: first.id });
  }
  return {
    projects,
    tasks: newNodes.length - projects,
    people: newPeople.length,
    absences: newAbsences.length,
    notes: newNotes.length,
  };
}

export function resetAll() {
  replaceData(emptyData());
  setUi({ page: 'home', selectedProjectId: null });
}

export function loadDemo() {
  replaceData(demoData());
  setUi({ page: 'home' });
}
