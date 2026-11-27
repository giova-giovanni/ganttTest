import { useSyncExternalStore } from 'react';
import type { Absence, AbsenceType, AppData, ColKey, HomeLayout, Note, Page, Person, Status, TaskNode, UiState } from './types';
import { STATUSES, ABSENCE_TYPES } from './types';
import type { TKey } from './i18n';
import { demoData } from './demo';
import { descendantIds, sanitizeNodes } from './utils/tree';
import { parseTags, sanitizeHtml } from './utils/notes';
import { emptyColors, isHex, sanitizeColors } from './theme';
import {
  api,
  ApiError,
  eventsUrl,
  sendOpsOnUnload,
  type AccessMode,
  type BatchEvent,
  type Fix,
  type Level,
  type OpsResponse,
  type Presence,
  type ServerInfo,
  type ServerStatus,
  type Session,
} from './utils/api';
import { KINDS, applyOps, diffOps, isPhotoUrl, keyOf, same, type Op, type RecordKind } from '../shared/ops.mjs';
import {
  GitHubError,
  cleanPath,
  clearGitHubConfig,
  decodeData,
  encodeData,
  getRepo,
  getUser,
  historyUrl,
  pagesSite,
  readFile,
  readGitHubConfig,
  saveGitHubConfig,
  writeFile,
  type GitHubConfig,
} from './utils/github';
import { describeChanges, rebase } from './utils/merge';

const DATA_KEY = 'gantt.data.v1';
const UI_KEY = 'gantt.ui.v1';
/** rami aperti/chiusi nell'archivio condiviso: preferenza di questo browser, non dei dati comuni */
const COLLAPSE_KEY = 'gantt.rami.v1';

export const DATA_VERSION = 4;

let seq = 0;
export function uid(prefix = 'n'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** identifica questa scheda del browser verso il server (le proprie modifiche tornano indietro marcate) */
export const CLIENT_ID = uid('c');

// ---------------------------------------------------------------- normalizzazione dei dati

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

type Raw = Record<string, unknown>;

function normPerson(p: Raw): Person {
  const h = num(p.hoursPerDay);
  return {
    id: str(p.id) || uid('p'),
    name: str(p.name),
    role: str(p.role),
    color: isHex(p.color) ? p.color : '#2f7de1',
    hoursPerDay: h && h > 0 && h <= 24 ? h : 8,
    // solo indirizzi web veri: un file o un altro utente non possono far caricare altro
    photo: isPhotoUrl(str(p.photo).trim()) ? str(p.photo).trim() : '',
    email: str(p.email).slice(0, 200),
    phone: str(p.phone).slice(0, 60),
    about: str(p.about).slice(0, 2000),
  };
}

function normNode(n: Raw): TaskNode {
  return {
    id: str(n.id),
    parentId: str(n.parentId) || null,
    name: str(n.name),
    status: STATUSES.includes(n.status as Status) ? (n.status as Status) : 'TODO',
    start: isoOrNull(n.start),
    end: isoOrNull(n.end),
    hours: num(n.hours),
    assigneeId: str(n.assigneeId) || null,
    notes: str(n.notes),
    collapsed: !!n.collapsed,
    archived: !!n.archived,
    color: isHex(n.color) ? n.color : null,
  };
}

function normAbsence(a: Raw): Absence {
  const s = isoOrNull(a.start);
  const e = isoOrNull(a.end) ?? s;
  const type = ABSENCE_TYPES.includes(a.type as AbsenceType) ? (a.type as AbsenceType) : 'OTHER';
  return {
    id: str(a.id) || uid('a'),
    // la chiusura aziendale non ha una persona (vale per tutti), le altre assenze sì
    personId: type === 'CLOSURE' ? null : str(a.personId),
    start: (s && e && e < s ? e : s) as string,
    end: (s && e && e < s ? s : e) as string,
    type,
    note: str(a.note),
  };
}

function normNote(n: Raw, now: string): Note {
  const createdAt = isoTime(n.createdAt, now);
  return {
    id: str(n.id) || uid('nt'),
    nodeId: str(n.nodeId),
    title: str(n.title).slice(0, 200),
    // il testo formattato viene sempre ripulito: un file o un altro utente non possono iniettare codice
    body: sanitizeHtml(str(n.body)),
    tags: Array.isArray(n.tags) ? parseTags(n.tags.map(String).join(',')) : [],
    author: str(n.author),
    createdAt,
    updatedAt: isoTime(n.updatedAt, createdAt),
    pinned: !!n.pinned,
  };
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object';

/**
 * Normalizza dati che possono arrivare da un file esterno o da una versione precedente.
 * Non deve mai lanciare eccezioni: valori sconosciuti vengono sostituiti dai default.
 */
export function migrate(data: Partial<AppData> | null | undefined): AppData {
  const d = (data ?? {}) as Raw;
  const people: Person[] = (Array.isArray(d.people) ? d.people : []).filter(isObj).map(normPerson);
  const peopleIds = new Set(people.map((p) => p.id));

  const nodes: TaskNode[] = sanitizeNodes(
    (Array.isArray(d.nodes) ? d.nodes : [])
      .filter(isObj)
      .map(normNode)
      .map((n) => (n.assigneeId && !peopleIds.has(n.assigneeId) ? { ...n, assigneeId: null } : n)),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));

  const absences: Absence[] = (Array.isArray(d.absences) ? d.absences : [])
    .filter(isObj)
    .map(normAbsence)
    .filter((a) => a.start && a.end && (a.personId === null || peopleIds.has(a.personId)));

  const now = new Date().toISOString();
  const notes: Note[] = (Array.isArray(d.notes) ? d.notes : [])
    .filter(isObj)
    .map((n) => normNote(n, now))
    // una nota agganciata a un'attività cancellata non serve più a nessuno
    .filter((n) => nodeIds.has(n.nodeId));

  return { version: DATA_VERSION, people, absences, nodes, notes };
}

/** le operazioni che arrivano dagli altri utenti passano dalla stessa normalizzazione dei file */
function cleanRemoteOp(o: Op): Op {
  const now = new Date().toISOString();
  if (o.op === 'replace') return { op: 'replace', data: migrate(o.data) };
  if (o.op === 'add') {
    const rec = o.rec as Raw;
    const clean =
      o.t === 'node' ? normNode(rec) : o.t === 'person' ? normPerson(rec) : o.t === 'absence' ? normAbsence(rec) : normNote(rec, now);
    return { op: 'add', t: o.t, rec: clean as unknown as Raw & { id: string } };
  }
  if (o.op === 'set' && o.t === 'note' && typeof o.set.body === 'string') {
    return { ...o, set: { ...o.set, body: sanitizeHtml(o.set.body) } };
  }
  return o;
}

// ---------------------------------------------------------------- stato

/** 'shared' = server Node; 'github' = file in un repository GitHub; 'browser' = solo questo browser */
export type SyncMode = 'browser' | 'shared' | 'github';

/** collegamento all'archivio su GitHub, per la barra di stato e le impostazioni */
export interface GitHubStatus {
  /** proprietario/nome del repository */
  repo: string;
  path: string;
  /** ramo usato (quello principale se non indicato) */
  branch: string;
  /** utente GitHub del token ('' finché non risponde GitHub) */
  user: string;
  private: boolean | null;
  canWrite: boolean;
  historyUrl: string;
  lastCommitUrl: string | null;
  /** ultimo controllo riuscito delle modifiche altrui */
  checkedAt: string | null;
}

/** avviso da mostrare (con eventuale «Rimetti il mio valore») */
export interface Notice {
  id: string;
  text: TKey;
  vars: Record<string, string | number>;
  /** campo da rimettere com'era con un clic */
  restore?: { t: RecordKind; id: string; field: string; value: unknown };
  /** per formattare i valori nel testo (date, persone, stati) */
  field?: { t: RecordKind; name: string; mine: unknown; theirs: unknown };
}

export interface SyncState {
  /** 'shared' = archivio sul server (più utenti insieme); 'browser' = ripiego nel browser */
  mode: SyncMode;
  ready: boolean;
  /** serve l'accesso: prima volta, sessione scaduta o uscita */
  needLogin: boolean;
  /** la sessione era scaduta: lo si dice nella finestra di accesso */
  expired: boolean;
  session: Session | null;
  info: ServerInfo | null;
  /** ultima revisione dell'archivio ricevuta dal server */
  rev: number;
  /** canale in tempo reale attivo */
  online: boolean;
  saving: boolean;
  /** operazioni non ancora confermate dal server */
  pending: number;
  savedAt: string | null;
  error: TKey | null;
  server: ServerStatus | null;
  presence: Presence[];
  notices: Notice[];
  /** dati presenti solo in questo browser (versioni senza server), da trasferire */
  localOnly: AppData | null;
  /** solo in modalità 'github' */
  github: GitHubStatus | null;
}

/**
 * Livello di accesso di chi sta usando il programma. Nell'archivio condiviso lo decide
 * il server (sessione); nel browser senza server si è amministratori come sempre.
 */
export interface AuthState {
  ready: boolean;
  mode: AccessMode | 'browser';
  /** controllo accessi attivo (file gantt-utenti.json) */
  enabled: boolean;
  level: Level;
  /** livello senza password (modo «livelli») */
  autoLevel: Level;
  /** true se il livello automatico arriva dall'elenco dei PC */
  auto: boolean;
  /** livelli sbloccabili con una password (modo «livelli») */
  levels: Level[];
  ospiti: boolean;
  /** come il server riconosce questo computer */
  who: string;
}

interface State {
  data: AppData;
  ui: UiState;
  sync: SyncState;
  auth: AuthState;
}

export const LEVEL_ORDER: Record<Level, number> = { lettura: 0, modifica: 1, admin: 2 };

export const defaultHome: HomeLayout = {
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

export const PAGES: Page[] = ['home', 'project', 'load', 'people', 'notes'];

/** limiti dei cursori di ingrandimento: gli stessi usati per ripulire le preferenze salvate */
export const ZOOM_LIMITS = { page: [0.8, 2] as const, menu: [0.9, 1.5] as const };
export const CHART_LIMITS = { rowHeight: [24, 52] as const, dayWidth: [0.5, 3] as const };

export const defaultChart = { rowHeight: 28, dayWidth: 1 };

export const defaultZoom = (): Record<Page, number> => ({ home: 1, project: 1, load: 1, people: 1, notes: 1 });

const defaultUi: UiState = {
  lang: 'it',
  theme: 'light',
  page: 'home',
  colors: emptyColors(),
  zoom: defaultZoom(),
  menuZoom: 1,
  chart: defaultChart,
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
export function sanitizeUi(raw: Partial<UiState>): UiState {
  const ui = { ...defaultUi, ...raw };
  const home = { ...defaultHome, ...(raw.home ?? {}) };
  const colWidths: Partial<Record<ColKey, number>> = {};
  for (const [key, value] of Object.entries(raw.colWidths ?? {})) {
    if (Number.isFinite(value)) colWidths[key as ColKey] = clamp(value, 44, 800, 100);
  }
  const zoom = defaultZoom();
  for (const page of PAGES) zoom[page] = clamp(raw.zoom?.[page], ...ZOOM_LIMITS.page, 1);
  return {
    lang: ui.lang === 'de' ? 'de' : 'it',
    theme: ui.theme === 'dark' ? 'dark' : 'light',
    page: PAGES.includes(ui.page) ? ui.page : 'home',
    colors: sanitizeColors(raw.colors),
    zoom,
    menuZoom: clamp(raw.menuZoom, ...ZOOM_LIMITS.menu, 1),
    chart: {
      rowHeight: Math.round(clamp(raw.chart?.rowHeight, ...CHART_LIMITS.rowHeight, defaultChart.rowHeight)),
      dayWidth: clamp(raw.chart?.dayWidth, ...CHART_LIMITS.dayWidth, defaultChart.dayWidth),
    },
    selectedProjectId: typeof ui.selectedProjectId === 'string' ? ui.selectedProjectId : null,
    scale: ui.scale === 'day' || ui.scale === 'month' ? ui.scale : 'week',
    gridWidth: clamp(ui.gridWidth, 220, 1100, defaultUi.gridWidth),
    colWidths,
    userName: str(ui.userName).slice(0, 80),
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
    needLogin: false,
    expired: false,
    session: null,
    info: null,
    rev: 0,
    online: false,
    saving: false,
    pending: 0,
    savedAt: null,
    error: null,
    server: null,
    presence: [],
    notices: [],
    localOnly: null,
    github: null,
  },
  auth: {
    ready: false,
    mode: 'browser',
    enabled: false,
    level: 'admin',
    autoLevel: 'admin',
    auto: true,
    levels: [],
    ospiti: false,
    who: '',
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

function setAuth(patch: Partial<AuthState>) {
  state = { ...state, auth: { ...state.auth, ...patch } };
  emit();
}

/** true quando le modifiche sono permesse: livello e server lo consentono */
export function canEditState(s: State): boolean {
  if (s.auth.level === 'lettura') return false;
  if (s.sync.mode === 'browser' || s.sync.mode === 'github') return true;
  return !!s.sync.session && !s.sync.server?.readOnly;
}

export function canEdit(): boolean {
  return canEditState(state);
}

/** true per le operazioni delicate: eliminare, svuotare, gestire responsabili e assenze */
export function isAdmin(): boolean {
  return state.auth.level === 'admin';
}

/** modifiche riservate all'amministratore: valgono solo se si può comunque scrivere */
export function canAdmin(): boolean {
  return isAdmin() && canEdit();
}

// ---------------------------------------------------------------- accesso

function applySession(session: Session) {
  setSync({ session, needLogin: false, expired: false });
  setAuth({ ready: true, level: session.level });
  if (session.user && session.user !== state.ui.userName) setUi({ userName: session.user });
}

/** accesso con nome (e password se serve): poi si caricano i dati e si apre il tempo reale */
export async function login(nome: string, password: string): Promise<{ ok: boolean; error?: TKey }> {
  try {
    const r = await api.login(nome.trim(), password);
    applySession(r.session);
    await startShared();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) return { ok: false, error: 'auth.paused' };
      if (err.status === 400) return { ok: false, error: 'login.nameRequired' };
      if (err.status === 403) return { ok: false, error: 'auth.wrong' };
    }
    return { ok: false, error: 'sync.offline' };
  }
}

/** esce (o cambia utente): le modifiche ancora in coda restano e partono al prossimo accesso */
export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    /* sessione già chiusa */
  }
  stopEvents();
  stopPresence();
  setSync({ session: null, needLogin: true, online: false, presence: [] });
}

/** modo «livelli»: sblocca un livello superiore digitando la password (vale per questa sessione) */
export async function unlockLevel(password: string): Promise<{ ok: boolean; level?: Level; error?: string }> {
  try {
    const r = await api.unlock(password);
    applySession(r.session);
    return { ok: true, level: r.session.level };
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) return { ok: false, error: 'auth.paused' };
    if (err instanceof ApiError && err.status === 403) return { ok: false, error: 'auth.wrong' };
    return { ok: false, error: 'sync.offline' };
  }
}

/** torna al livello che spetta a questo PC senza password (fine turno su un computer condiviso) */
export async function lockLevel(): Promise<void> {
  try {
    const r = await api.baseLevel();
    applySession(r.session);
  } catch {
    /* si riproverà */
  }
}

// ---------------------------------------------------------------- preferenze e dati locali

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

function readCollapsed(): Set<string> | null {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(list) ? new Set(list.map(String)) : null;
  } catch {
    return null;
  }
}

function saveCollapsed() {
  try {
    const ids = state.data.nodes.filter((n) => n.collapsed).map((n) => n.id);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids));
  } catch {
    /* preferenza non salvata: pazienza */
  }
}

/** applica ai dati appena arrivati i rami aperti/chiusi scelti in questo browser */
function withLocalCollapse(data: AppData, from: Set<string> | null = readCollapsed()): AppData {
  if (!from) return data;
  return { ...data, nodes: data.nodes.map((n) => (n.collapsed === from.has(n.id) ? n : { ...n, collapsed: from.has(n.id) })) };
}

const currentCollapsed = () => new Set(state.data.nodes.filter((n) => n.collapsed).map((n) => n.id));

/** aprire o chiudere rami: nell'archivio condiviso è una scelta personale (vale anche in sola lettura) */
function setCollapsedLocal(ids: string[], collapsed: boolean) {
  const set = new Set(ids);
  state = {
    ...state,
    data: { ...state.data, nodes: state.data.nodes.map((n) => (set.has(n.id) && n.collapsed !== collapsed ? { ...n, collapsed } : n)) },
  };
  saveCollapsed();
  emit();
}

const onlyCollapse = (patch: Partial<TaskNode>) => Object.keys(patch).every((k) => k === 'collapsed');

// ---------------------------------------------------------------- modifiche e annulla

const cloneData = (d: AppData): AppData => JSON.parse(JSON.stringify(d));

/** dati da mandare al server (il campo «collapsed» resta nel browser) */
const sharedData = (d: AppData): AppData => ({
  ...d,
  nodes: d.nodes.map((n) => ({ ...n, collapsed: false })),
});

/** modifica dei dati con istantanea per «annulla» */
function mutate(fn: (d: AppData) => AppData | void, history = true, opts: { replace?: boolean } = {}) {
  if (!canEdit()) {
    setSync({ error: 'sync.readOnlyBlocked' });
    return;
  }
  const before = cloneData(state.data);
  const next = (fn(state.data as AppData) as AppData | undefined) ?? state.data;
  const after: AppData = {
    ...next,
    nodes: [...next.nodes],
    people: [...next.people],
    absences: [...next.absences],
    notes: [...next.notes],
  };
  if (history) {
    past = [...past.slice(-49), before];
    future = [];
  }
  state = { ...state, data: after };
  afterChange(before, after, opts.replace);
  emit();
}

/** dopo ogni modifica: nel browser si salva subito; sul server si mandano solo i record cambiati */
function afterChange(before: AppData, after: AppData, replace = false) {
  if (state.sync.mode === 'browser') {
    persistLocal();
    return;
  }
  if (state.sync.mode === 'github') {
    ghLocalChanged();
    return;
  }
  const ops: Op[] = replace ? [{ op: 'replace', data: sharedData(after) }] : diffOps(before, after);
  if (ops.length) enqueue(ops);
}

export function setUi(patch: Partial<UiState>) {
  state = { ...state, ui: { ...state.ui, ...patch } };
  persistUi();
  emit();
}

export function setHome(patch: Partial<HomeLayout>) {
  setUi({ home: { ...state.ui.home, ...patch } });
}

/** ingrandimento della pagina che si sta guardando: serve a chi trasforma i pixel del mouse */
export function pageZoom(): number {
  return state.ui.zoom[state.ui.page];
}

export function setColWidth(key: ColKey, width: number) {
  setUi({ colWidths: { ...state.ui.colWidths, [key]: Math.round(clamp(width, 44, 800, 100)) } });
}

export function resetColWidths() {
  setUi({ colWidths: {} });
}

/**
 * Annulla l'ultima modifica PROPRIA. Le modifiche arrivate dagli altri vengono riportate
 * anche nelle istantanee (vedi applyRemote): annullare non cancella il lavoro altrui.
 */
export function undo() {
  if (!past.length || !canEdit()) return;
  const prev = past[past.length - 1];
  past = past.slice(0, -1);
  const current = cloneData(state.data);
  future = [current, ...future.slice(0, 49)];
  state = { ...state, data: withLocalCollapse(prev, currentCollapsed()) };
  afterChange(current, state.data);
  emit();
}

export function redo() {
  if (!future.length || !canEdit()) return;
  const next = future[0];
  future = future.slice(1);
  const current = cloneData(state.data);
  past = [...past, current];
  state = { ...state, data: withLocalCollapse(next, currentCollapsed()) };
  afterChange(current, state.data);
  emit();
}

export function canUndo() {
  return past.length > 0;
}
export function canRedo() {
  return future.length > 0;
}

// ---------------------------------------------------------------- coda dei salvataggi

interface Batch {
  id: string;
  ops: Op[];
}

/** gruppi di operazioni da mandare, nell'ordine; uno solo alla volta è «in viaggio» */
let queue: Batch[] = [];
let inflight: Batch | null = null;
let retryTimer: number | undefined;
let retryDelay = 0;

const pendingCount = () => queue.reduce((s, b) => s + b.ops.length, inflight?.ops.length ?? 0);

function enqueue(ops: Op[]) {
  const last = queue[queue.length - 1];
  // le modifiche ravvicinate partono insieme (es. il titolo di una nota mentre si scrive)
  if (last && last.ops.length + ops.length <= 5000) last.ops.push(...ops);
  else queue.push({ id: uid('b'), ops });
  setSync({ pending: pendingCount() });
  void pump();
}

async function pump(): Promise<void> {
  if (inflight || !queue.length || state.sync.needLogin || retryTimer !== undefined) return;
  const batch = queue.shift()!;
  inflight = batch;
  setSync({ saving: true });
  try {
    const r = await api.ops({ client: CLIENT_ID, batch: batch.id, ops: batch.ops });
    inflight = null;
    retryDelay = 0;
    handleOpsResponse(r);
    setSync({
      saving: false,
      pending: pendingCount(),
      savedAt: new Date().toISOString(),
      error: state.sync.error === 'sync.offline' ? null : state.sync.error,
    });
  } catch (err) {
    inflight = null;
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 401) {
      queue.unshift(batch);
      stopEvents();
      setSync({ saving: false, needLogin: true, expired: true, online: false });
      return;
    }
    if (status === 400 || status === 403) {
      // modifica rifiutata (livello o dati non validi): si torna allo stato vero del server
      setSync({ saving: false, pending: pendingCount(), error: status === 403 ? 'auth.needAdmin' : 'sync.rejected' });
      await reload();
    } else {
      // rete o server momentaneamente non raggiungibili: si riprova, nulla va perso
      queue.unshift(batch);
      retryDelay = Math.min(30_000, retryDelay ? retryDelay * 2 : 1500);
      setSync({ saving: false, pending: pendingCount(), error: status === 503 ? 'sync.readOnlyBlocked' : 'sync.offline' });
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void pump();
      }, retryDelay);
      return;
    }
  }
  void pump();
}

/** il server ha saltato qualcosa (record eliminato da altri…): si corregge e si avvisa */
function handleOpsResponse(r: OpsResponse) {
  if (r.fix?.length) {
    const data = copyLists(state.data);
    for (const f of r.fix as Fix[]) {
      const list = data[KINDS[f.t]] as unknown as Array<{ id: string; collapsed?: boolean }>;
      if ('deleted' in f) {
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list.splice(i, 1);
      } else {
        const clean = (cleanRemoteOp({ op: 'add', t: f.t, rec: f.rec }) as Extract<Op, { op: 'add' }>).rec as {
          id: string;
          collapsed?: boolean;
        };
        const i = list.findIndex((x) => x.id === clean.id);
        if (i >= 0) list[i] = f.t === 'node' ? { ...clean, collapsed: list[i].collapsed } : clean;
        else list.push(clean);
      }
    }
    state = { ...state, data };
    ensureSelection();
  }
  for (const s of r.skipped ?? []) {
    if (s.reason !== 'eliminato') continue;
    pushNotice({
      text: s.by ? 'notice.deleted' : 'notice.deletedUnknown',
      vars: { name: s.label || '…', user: s.by ?? '' },
    });
  }
  emit();
}

// ---------------------------------------------------------------- avvisi

function pushNotice(n: Omit<Notice, 'id'>) {
  setSync({ notices: [...state.sync.notices.slice(-4), { ...n, id: uid('av') }] });
}

export function dismissNotice(id: string) {
  setSync({ notices: state.sync.notices.filter((n) => n.id !== id) });
}

/** «Rimetti il mio valore»: riscrive il valore che un altro utente ha appena sostituito */
export function restoreValue(notice: Notice) {
  const r = notice.restore;
  dismissNotice(notice.id);
  if (!r) return;
  mutate((d) => {
    const key = KINDS[r.t];
    (d as unknown as Record<string, Array<{ id: string }>>)[key] = (d[key] as unknown as Array<{ id: string }>).map((x) =>
      x.id === r.id ? { ...x, [r.field]: r.value } : x,
    );
  });
}

export function dismissSyncError() {
  setSync({ error: null });
}

// ---------------------------------------------------------------- modifiche degli altri

/** campi con modifiche locali non ancora confermate: un evento altrui non li tocca */
function pendingFields() {
  const map = new Map<string, Set<string>>();
  for (const b of inflight ? [inflight, ...queue] : queue) {
    for (const o of b.ops) {
      if (o.op !== 'set') continue;
      const k = keyOf(o.t, o.id);
      const s = map.get(k) ?? new Set<string>();
      for (const f of Object.keys(o.set)) s.add(f);
      map.set(k, s);
    }
  }
  return (t: RecordKind, id: string) => map.get(keyOf(t, id));
}

const copyLists = (d: AppData): AppData => ({
  ...d,
  nodes: [...d.nodes],
  people: [...d.people],
  absences: [...d.absences],
  notes: [...d.notes],
});

/** applica un salvataggio di un altro utente: dati, istantanee di «annulla», avvisi */
function applyRemote(ev: BatchEvent) {
  if (ev.rev <= state.sync.rev) return;
  if (ev.rev !== state.sync.rev + 1) {
    void reload(); // ci siamo persi qualcosa: si ricarica tutto
    return;
  }
  if (ev.client !== CLIENT_ID) {
    const ops = ev.ops.map(cleanRemoteOp);
    const collapsed = currentCollapsed();
    const data = copyLists(state.data);
    applyOps(data, ops, { keep: pendingFields() });
    for (const snap of past) applyOps(snap, ops);
    for (const snap of future) applyOps(snap, ops);
    state = { ...state, data: ops.some((o) => o.op === 'replace') ? withLocalCollapse(data, collapsed) : data };
    ensureSelection();
  }
  const mine = state.sync.session?.id;
  for (const o of ev.overwrote ?? []) {
    if (o.sid !== mine || ev.sid === mine) continue;
    const newValue = ev.ops.find((x) => x.op === 'set' && x.t === o.t && x.id === o.id) as Extract<Op, { op: 'set' }> | undefined;
    pushNotice({
      text: 'notice.overwritten',
      vars: { user: ev.user, name: o.label || '…' },
      restore: { t: o.t, id: o.id, field: o.field, value: o.value },
      field: { t: o.t, name: o.field, mine: o.value, theirs: newValue?.set[o.field] ?? null },
    });
  }
  state = { ...state, sync: { ...state.sync, rev: ev.rev } };
  emit();
}

/** rilegge tutto dal server (dopo un buco nella sequenza, un rifiuto o un riavvio del server) */
export async function reload(): Promise<void> {
  if (state.sync.mode !== 'shared') return;
  try {
    const s = await api.state();
    const collapsed = state.data.nodes.length ? currentCollapsed() : readCollapsed();
    const data = withLocalCollapse(migrate(s.data), collapsed);
    // le modifiche ancora in coda si rimettono sopra: partiranno comunque
    for (const b of inflight ? [inflight, ...queue] : queue) applyOps(data, b.ops.filter((o) => o.op !== 'replace'));
    past = [];
    future = [];
    state = { ...state, data };
    setSync({ rev: s.rev, savedAt: s.savedAt, server: { health: s.health, readOnly: s.readOnly } });
    ensureSelection();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) setSync({ needLogin: true, expired: true });
    else setSync({ error: 'sync.offline' });
  }
}

// ---------------------------------------------------------------- tempo reale

let source: EventSource | null = null;
let pollTimer: number | undefined;
let pollMs = 2500;
let sseFailures = 0;
let lastEventAt = 0;
let watchdog: number | undefined;
/** il server manda un «ping» ogni 25 s: senza notizie per più di 70 s il canale è bloccato */
const SILENCE_MS = 70_000;

/** solo per i test: intervallo del ripiego senza canale in tempo reale */
export function setPollInterval(ms: number) {
  pollMs = ms;
}

function stopEvents() {
  source?.close();
  source = null;
  if (typeof window !== 'undefined') {
    window.clearTimeout(pollTimer);
    window.clearInterval(watchdog);
  }
  pollTimer = undefined;
}

function startEvents() {
  stopEvents();
  if (typeof EventSource === 'undefined' || sseFailures >= 4) {
    startPolling();
    return;
  }
  const es = new EventSource(eventsUrl(state.sync.rev, CLIENT_ID));
  source = es;
  lastEventAt = Date.now();
  const parse = (e: Event) => {
    lastEventAt = Date.now();
    return JSON.parse((e as MessageEvent<string>).data);
  };
  es.addEventListener('open', () => {
    sseFailures = 0;
    lastEventAt = Date.now();
    setSync({ online: true, error: state.sync.error === 'sync.offline' ? null : state.sync.error });
  });
  // un proxy che trattiene il canale (buffer) non dà errori ma nemmeno eventi: si ripiega
  watchdog = window.setInterval(() => {
    if (source === es && Date.now() - lastEventAt > SILENCE_MS) {
      sseFailures = 4;
      startEvents();
    }
  }, 15_000);
  es.addEventListener('ping', (e) => void parse(e));
  es.addEventListener('batch', (e) => applyRemote(parse(e) as BatchEvent));
  es.addEventListener('presenza', (e) => setSync({ presence: parse(e) as Presence[] }));
  es.addEventListener('server', (e) => setSync({ server: parse(e) as ServerStatus }));
  es.addEventListener('reload', () => void reload());
  es.addEventListener('sessione', () => {
    stopEvents();
    setSync({ online: false, needLogin: true, expired: true });
  });
  es.onerror = () => {
    setSync({ online: false });
    sseFailures += 1;
    // un proxy che blocca il canale: si passa alle richieste periodiche
    if (sseFailures >= 4) startEvents();
  };
}

function startPolling() {
  const tick = async () => {
    pollTimer = undefined;
    if (state.sync.needLogin || state.sync.mode !== 'shared') return;
    try {
      const r = await api.poll(state.sync.rev, CLIENT_ID);
      if (r.reload) await reload();
      else for (const ev of r.batches) applyRemote(ev);
      setSync({ presence: r.presence, server: r.server, online: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSync({ online: false, needLogin: true, expired: true });
        return;
      }
      setSync({ online: false });
    }
    pollTimer = window.setTimeout(() => void tick(), pollMs);
  };
  void tick();
}

// ---------------------------------------------------------------- presenze

interface Where {
  page: string | null;
  project: string | null;
  node: string | null;
  field: string | null;
  note: string | null;
}

let where: Where = { page: null, project: null, node: null, field: null, note: null };
let presenceTimer: number | undefined;
let presenceBeat: number | undefined;

function sendPresence() {
  if (state.sync.mode !== 'shared' || !state.sync.session || state.sync.needLogin) return;
  void api.presence({ client: CLIENT_ID, ...where }).catch(() => {});
}

/** dove si trova l'utente: lo vedono gli altri (progetto aperto, riga o nota in modifica) */
export function reportPresence(patch: Partial<Where>) {
  where = { ...where, ...patch };
  if (typeof window === 'undefined') return;
  window.clearTimeout(presenceTimer);
  presenceTimer = window.setTimeout(sendPresence, 200);
}

function startPresence() {
  stopPresence();
  sendPresence();
  presenceBeat = window.setInterval(sendPresence, 20_000);
}

function stopPresence() {
  if (typeof window === 'undefined') return;
  window.clearInterval(presenceBeat);
  window.clearTimeout(presenceTimer);
}

// ---------------------------------------------------------------- avvio

/** salvataggio immediato alla chiusura della pagina */
export function flushPersist() {
  if (state.sync.mode === 'browser') {
    persistLocal();
    return;
  }
  if (state.sync.mode === 'github') {
    // la copia locale è già aggiornata a ogni modifica: ciò che non è partito parte alla prossima apertura
    writeGhLocal();
    return;
  }
  if (!inflight && queue.length) {
    const ops = queue.flatMap((b) => b.ops);
    if (sendOpsOnUnload({ client: CLIENT_ID, batch: queue[0].id, ops })) queue = [];
  }
}

function ensureSelection() {
  const { data, ui } = state;
  if (!ui.selectedProjectId || !data.nodes.some((n) => n.id === ui.selectedProjectId && n.parentId === null)) {
    const first = data.nodes.find((n) => n.parentId === null && !n.archived);
    state = { ...state, ui: { ...state.ui, selectedProjectId: first?.id ?? null } };
  }
}

let loadedOnce = false;

/** dopo l'accesso: dati (la prima volta o dopo una sessione scaduta), tempo reale, presenze, coda */
async function startShared() {
  if (!loadedOnce) {
    const s = await api.state();
    const data = withLocalCollapse(migrate(s.data));
    const localData = readLocalData();
    // il travaso dei dati del browser si propone solo se l'archivio condiviso è ancora vuoto
    const localOnly = canEdit() && isEmpty(data) && localData && !isEmpty(localData) ? localData : null;
    state = { ...state, data };
    ensureSelection();
    setSync({ ready: true, rev: s.rev, savedAt: s.savedAt, server: { health: s.health, readOnly: s.readOnly }, localOnly });
    loadedOnce = true;
  } else {
    await reload();
  }
  startEvents();
  startPresence();
  void pump();
}

/**
 * Prepara lo stato prima di disegnare l'interfaccia.
 * Se il server risponde i dati vengono dall'archivio condiviso (dopo l'accesso), altrimenti
 * si continua a lavorare nel browser come nelle versioni precedenti.
 */
export async function initStore(): Promise<void> {
  const ui = readLocalUi();
  state = { ...state, ui };

  // su GitHub Pages non c'è nessun server da cercare
  const onPages = typeof window !== 'undefined' && !!pagesSite();
  let info: ServerInfo | null = null;
  if (!onPages) {
    try {
      info = await api.info();
    } catch {
      info = null;
    }
  }

  // il server Node, se risponde, ha la precedenza; altrimenti l'archivio su GitHub, se collegato
  const ghConfig = info ? null : readGitHubConfig();
  if (ghConfig) {
    await startGitHub(ghConfig);
    return;
  }

  if (!info) {
    const data = readLocalData() ?? demoData();
    state = { ...state, data };
    ensureSelection();
    setAuth({ ready: true, mode: 'browser' });
    setSync({ mode: 'browser', ready: true });
    return;
  }

  const a = info.access;
  setAuth({
    mode: a.mode,
    // finché il server non conferma la sessione non si mostra nessun livello di privilegio
    level: 'lettura',
    enabled: a.mode !== 'aperto',
    autoLevel: a.autoLevel,
    auto: a.auto,
    levels: a.levels,
    ospiti: a.ospiti,
    who: a.who,
  });
  setSync({ mode: 'shared', info, server: info.status });

  try {
    const r = await api.session();
    applySession(r.session);
    await startShared();
    return;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      setSync({ ready: true, error: 'sync.readFailed' });
      setAuth({ ready: true });
      return;
    }
  }
  // senza account personali si entra da soli con il nome già usato su questo PC
  // (il livello è quello di base: per alzarlo c'è il lucchetto in alto)
  if ((a.mode === 'aperto' || a.mode === 'livelli') && ui.userName.trim()) {
    const r = await login(ui.userName, '');
    if (r.ok) return;
  }
  setAuth({ ready: true });
  setSync({ ready: true, needLogin: true });
}

// ---------------------------------------------------------------- archivio su GitHub
//
// I dati stanno in un file JSON di un repository GitHub (vedi utils/github.ts).
// - Ogni modifica resta subito nel browser (copia locale) e parte verso GitHub dopo qualche
//   secondo di calma: un commit raccoglie più modifiche ravvicinate.
// - Si scrive sempre «sopra» la versione letta (sha): se un altro ha salvato nel frattempo,
//   GitHub rifiuta, si legge la sua versione, si uniscono le modifiche (utils/merge.ts) e si riprova.
// - Ogni 30 s (e quando si torna sulla scheda) si controlla se altri hanno salvato.
// - Nulla va perso chiudendo la pagina: la copia locale e la versione di partenza restano nel
//   browser e le modifiche non ancora partite vengono unite e salvate alla prossima apertura.

const GH_BASE_KEY = 'gantt.github.base.v1';
const GH_LOCAL_KEY = 'gantt.github.local.v1';
/** calma dopo l'ultima modifica prima di salvare */
const GH_DEBOUNCE_MS = 2500;
/** al massimo un commit ogni 10 s (GitHub limita le scritture troppo fitte) */
const GH_MIN_GAP_MS = 10_000;
/** chi modifica di continuo salva comunque almeno ogni 20 s */
const GH_MAX_WAIT_MS = 20_000;
const GH_POLL_MS = 30_000;

interface GhBase {
  /** sha del file su GitHub (null = file non ancora creato) */
  sha: string | null;
  etag: string | null;
  /** i dati di quella versione: il punto di partenza per capire cosa è cambiato qui */
  data: AppData;
}

interface GhSession {
  cfg: GitHubConfig;
  key: string;
  base: GhBase;
  /** il file su GitHub non è leggibile: niente salvataggi finché non viene sistemato */
  blocked: boolean;
  /** errore che richiede l'utente (token, permessi): niente tentativi automatici */
  halted: boolean;
  user: string;
}

let gh: GhSession | null = null;
let ghChain: Promise<unknown> = Promise.resolve();
let ghSaveTimer: number | undefined;
let ghRetryTimer: number | undefined;
let ghPollTimer: number | undefined;
let ghDirtySince = 0;
let ghLastCommitAt = 0;
let ghLastCheckAt = 0;
let ghRetryMs = 0;

const ghKeyOf = (c: GitHubConfig) => `${c.owner}/${c.repo}@${c.branch}:${cleanPath(c.path)}`.toLowerCase();

/** una sola operazione con GitHub alla volta: una lettura e una scrittura non si incrociano mai */
function ghLocked<T>(fn: () => Promise<T>): Promise<T> {
  const run = ghChain.then(fn, fn);
  ghChain = run.catch(() => undefined);
  return run;
}

function readGhCache(key: string): { base: GhBase | null; local: AppData | null } {
  try {
    const b = JSON.parse(localStorage.getItem(GH_BASE_KEY) ?? 'null') as
      | { key: string; sha: string | null; etag: string | null; data: AppData }
      | null;
    const l = JSON.parse(localStorage.getItem(GH_LOCAL_KEY) ?? 'null') as { key: string; data: AppData } | null;
    const base = b && b.key === key ? { sha: b.sha ?? null, etag: b.etag ?? null, data: migrate(b.data) } : null;
    // senza la versione di partenza la copia locale non serve: non si saprebbe cosa è cambiato qui
    return { base, local: base && l && l.key === key ? migrate(l.data) : null };
  } catch {
    return { base: null, local: null };
  }
}

function clearGhCache() {
  try {
    localStorage.removeItem(GH_BASE_KEY);
    localStorage.removeItem(GH_LOCAL_KEY);
  } catch {
    /* niente da togliere */
  }
}

function writeGhBase() {
  if (!gh) return;
  try {
    localStorage.setItem(GH_BASE_KEY, JSON.stringify({ key: gh.key, sha: gh.base.sha, etag: gh.base.etag, data: gh.base.data }));
  } catch {
    // spazio esaurito: meglio nessuna copia che una copia vecchia (si unirebbe male alla prossima apertura)
    clearGhCache();
  }
}

function writeGhLocal() {
  if (!gh) return;
  try {
    localStorage.setItem(GH_LOCAL_KEY, JSON.stringify({ key: gh.key, data: sharedData(state.data) }));
  } catch {
    if (!localWarned) {
      localWarned = true;
      console.warn('Gantt Planner: impossibile salvare la copia locale (spazio esaurito?)');
    }
  }
}

function setGh(patch: Partial<GitHubStatus>) {
  if (!state.sync.github) return;
  setSync({ github: { ...state.sync.github, ...patch } });
}

/** ci sono modifiche fatte qui e non ancora su GitHub */
function ghDirty(): boolean {
  return !!gh && diffOps(gh.base.data, state.data).length > 0;
}

function ghClearError() {
  if (state.sync.error?.startsWith('gh.')) setSync({ error: null });
}

function ghOk() {
  ghRetryMs = 0;
  ghLastCheckAt = Date.now();
  setSync({ online: true });
  setGh({ checkedAt: new Date().toISOString() });
  if (state.sync.error === 'gh.err.network' || state.sync.error === 'gh.err.rateLimit') ghClearError();
}

/**
 * Un errore di GitHub: rete e limiti si riprovano da soli; token, permessi e file rovinato no.
 * `quiet`: un controllo periodico non riuscito non mostra avvisi (lo dice già la barra di stato).
 */
function ghFailed(err: unknown, retry: (() => void) | null, quiet = false) {
  if (!gh) return;
  const kind = err instanceof GitHubError ? err.kind : 'network';
  if (!(err instanceof GitHubError)) console.warn('Gantt Planner: errore con GitHub', err);
  if (kind === 'network' || kind === 'rateLimit' || kind === 'conflict') {
    const first = kind === 'rateLimit' ? 60_000 : 5000;
    ghRetryMs = Math.min(5 * 60_000, ghRetryMs ? ghRetryMs * 2 : first);
    if (quiet) setSync({ online: false });
    else setSync({ online: false, error: kind === 'rateLimit' ? 'gh.err.rateLimit' : 'gh.err.network' });
    if (retry) {
      window.clearTimeout(ghRetryTimer);
      ghRetryTimer = window.setTimeout(retry, ghRetryMs);
    }
    return;
  }
  if (kind === 'invalid') gh.blocked = true;
  else gh.halted = true;
  if (kind === 'forbidden') {
    setGh({ canWrite: false });
  }
  setSync({ error: `gh.err.${kind}` as TKey, online: kind === 'invalid' || kind === 'forbidden' });
}

/**
 * Dopo un'unione i record rimasti identici tengono lo stesso oggetto: l'interfaccia non ridisegna
 * ciò che non è cambiato e un campo in corso di scrittura (es. le etichette di una nota) non si azzera.
 */
function keepUnchanged(prev: AppData, next: AppData): AppData {
  const keep = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const old = new Map(a.map((r) => [r.id, r]));
    return b.map((r) => {
      const o = old.get(r.id);
      return o && JSON.stringify(o) === JSON.stringify(r) ? o : r;
    });
  };
  return {
    ...next,
    nodes: keep(prev.nodes, next.nodes),
    people: keep(prev.people, next.people),
    absences: keep(prev.absences, next.absences),
    notes: keep(prev.notes, next.notes),
  };
}

/** unisce la versione remota alle modifiche fatte qui (che restano e partono al prossimo salvataggio) */
function ghApplyRemote(remote: AppData, sha: string, etag: string | null) {
  const g = gh!;
  const collapsed = state.data.nodes.length ? currentCollapsed() : readCollapsed();
  const { data, theirs, dropped } = rebase(g.base.data, state.data, remote);
  // «annulla» non deve cancellare il lavoro degli altri: le loro modifiche entrano anche nelle istantanee
  for (const snap of past) applyOps(snap, theirs);
  for (const snap of future) applyOps(snap, theirs);
  g.base = { sha, etag, data: remote };
  state = { ...state, data: keepUnchanged(state.data, withLocalCollapse(migrate(data), collapsed)) };
  ensureSelection();
  writeGhBase();
  writeGhLocal();
  for (const d of dropped) pushNotice({ text: 'notice.deletedUnknown', vars: { name: d.label || '…' } });
  setSync({ pending: ghDirty() ? 1 : 0 });
  emit();
}

/** legge il file su GitHub e unisce le modifiche altrui (da chiamare dentro ghLocked) */
async function ghPullInner(): Promise<void> {
  const g = gh;
  if (!g) return;
  const r = await readFile(g.cfg, g.base.sha ? g.base.etag : null);
  if (gh !== g) return;
  if (r === 'unchanged') {
    ghOk();
    return;
  }
  if (r === null) {
    // il file non c'è ancora (repository nuovo) o è stato tolto: il prossimo salvataggio lo crea
    // con tutti i dati di questo browser, mai con un archivio vuoto
    if (g.base.sha !== null) {
      g.base = { sha: null, etag: null, data: emptyData() };
      writeGhBase();
    }
    g.blocked = false;
    ghOk();
    return;
  }
  if (r.sha === g.base.sha) {
    g.base.etag = r.etag;
    g.blocked = false;
    ghOk();
    return;
  }
  const remote = migrate(decodeData(r.text)); // file illeggibile → errore 'invalid': non si sovrascrive
  g.blocked = false;
  if (state.sync.error === 'gh.err.invalid') ghClearError();
  ghApplyRemote(remote, r.sha, r.etag);
  ghOk();
}

function ghPull(): Promise<void> {
  return ghLocked(async () => {
    try {
      await ghPullInner();
    } catch (err) {
      ghFailed(err, null, true); // la lettura si ripete comunque al prossimo controllo
    }
  });
}

/** salva adesso su GitHub le modifiche fatte qui */
function ghSaveNow(): Promise<void> {
  return ghLocked(async () => {
    const g = gh;
    if (!g || g.blocked || g.halted || !canEdit()) return;
    window.clearTimeout(ghSaveTimer);
    ghSaveTimer = undefined;
    ghDirtySince = 0;
    let saved = false;
    setSync({ saving: true });
    try {
      for (let attempt = 0; attempt < 6 && !saved; attempt++) {
        const snapshot = cloneData(sharedData(state.data)); // esattamente ciò che si manda
        const ops = diffOps(g.base.data, snapshot);
        if (!ops.length) break;
        try {
          const text = encodeData(snapshot, g.user || state.ui.userName.trim() || g.cfg.owner);
          const message = describeChanges(ops, g.base.data, snapshot, state.ui.lang);
          const r = await writeFile(g.cfg, text, g.base.sha, message);
          if (gh !== g) return;
          g.base = { sha: r.sha, etag: null, data: snapshot };
          writeGhBase();
          ghLastCommitAt = Date.now();
          saved = true;
          setSync({ savedAt: r.at });
          setGh({ lastCommitUrl: r.commitUrl });
          ghOk();
        } catch (err) {
          if (!(err instanceof GitHubError) || err.kind !== 'conflict') throw err;
          // un altro ha salvato nel frattempo: si prende la sua versione, si uniscono le modifiche, si riprova
          await ghPullInner();
          if (gh !== g || g.blocked) return;
        }
      }
      if (!saved && ghDirty()) throw new GitHubError('conflict', 409, 'troppi salvataggi contemporanei');
    } catch (err) {
      if (gh === g) ghFailed(err, () => void ghSaveNow());
    } finally {
      if (gh === g) {
        const dirty = ghDirty();
        setSync({ saving: false, pending: dirty ? 1 : 0 });
        // modifiche fatte mentre si salvava: partono con il prossimo giro
        if (saved && dirty) scheduleGhSave();
      }
    }
  });
}

function scheduleGhSave(delay = GH_DEBOUNCE_MS) {
  if (!gh || gh.blocked || gh.halted || typeof window === 'undefined') return;
  const now = Date.now();
  if (!ghDirtySince) ghDirtySince = now;
  const earliest = ghLastCommitAt + GH_MIN_GAP_MS;
  const wanted = Math.max(now + delay, earliest);
  const latest = Math.max(ghDirtySince + GH_MAX_WAIT_MS, earliest);
  window.clearTimeout(ghSaveTimer);
  ghSaveTimer = window.setTimeout(() => {
    ghSaveTimer = undefined;
    void ghSaveNow();
  }, Math.max(0, Math.min(wanted, latest) - now));
}

/** dopo ogni modifica: copia locale subito, GitHub dopo qualche secondo di calma */
function ghLocalChanged() {
  writeGhLocal();
  if (!state.sync.pending) state = { ...state, sync: { ...state.sync, pending: 1 } };
  scheduleGhSave();
}

const ghVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** controllo delle modifiche altrui (al massimo uno ogni 5 s) */
function ghCheck() {
  if (!gh || gh.halted || !ghVisible() || Date.now() - ghLastCheckAt < 5000) return;
  ghLastCheckAt = Date.now();
  void ghPull().then(() => {
    if (ghDirty() && ghSaveTimer === undefined) scheduleGhSave(0);
  });
}

function onGhVisibility() {
  if (!gh) return;
  // si cambia scheda o si chiude: le modifiche partono subito
  if (!ghVisible()) {
    if (ghDirty()) void ghSaveNow();
  } else {
    ghCheck();
  }
}

function onGhOnline() {
  if (!gh) return;
  ghRetryMs = 0;
  ghLastCheckAt = 0;
  ghCheck();
  if (ghDirty()) scheduleGhSave(0);
}

function startGhTimers() {
  stopGhTimers();
  const tick = () => {
    ghCheck();
    ghPollTimer = window.setTimeout(tick, GH_POLL_MS);
  };
  ghPollTimer = window.setTimeout(tick, GH_POLL_MS);
  document.addEventListener('visibilitychange', onGhVisibility);
  window.addEventListener('focus', ghCheck);
  window.addEventListener('online', onGhOnline);
}

function stopGhTimers() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(ghPollTimer);
  window.clearTimeout(ghSaveTimer);
  window.clearTimeout(ghRetryTimer);
  ghPollTimer = ghSaveTimer = ghRetryTimer = undefined;
  document.removeEventListener('visibilitychange', onGhVisibility);
  window.removeEventListener('focus', ghCheck);
  window.removeEventListener('online', onGhOnline);
}

async function startGitHub(cfg: GitHubConfig): Promise<void> {
  stopGhTimers();
  const key = ghKeyOf(cfg);
  const cache = readGhCache(key);
  const g: GhSession = {
    cfg,
    key,
    base: cache.base ?? { sha: null, etag: null, data: emptyData() },
    blocked: false,
    halted: false,
    user: '',
  };
  gh = g;
  ghRetryMs = 0;
  ghLastCommitAt = 0;
  ghLastCheckAt = 0;
  ghDirtySince = 0;
  past = [];
  future = [];
  // si parte dalla copia locale (anche senza rete), poi si aggiorna da GitHub
  state = { ...state, data: withLocalCollapse(cache.local ?? cache.base?.data ?? emptyData()) };
  ensureSelection();
  setAuth({ ready: true, mode: 'browser', enabled: false, level: 'admin', levels: [], ospiti: false, who: '' });
  setSync({
    mode: 'github',
    ready: false,
    online: false,
    saving: false,
    pending: 0,
    error: null,
    notices: [],
    localOnly: null,
    savedAt: null,
    github: {
      repo: `${cfg.owner}/${cfg.repo}`,
      path: cleanPath(cfg.path),
      branch: cfg.branch,
      user: '',
      private: null,
      canWrite: true,
      historyUrl: historyUrl(cfg, cfg.branch),
      lastCommitUrl: null,
      checkedAt: null,
    },
  });

  try {
    const [user, repo] = await Promise.all([getUser(cfg), getRepo(cfg)]);
    if (gh !== g) return;
    g.user = user.name || user.login;
    if (!state.ui.userName.trim()) setUi({ userName: g.user });
    const branch = cfg.branch || repo.defaultBranch;
    setGh({ user: user.login, private: repo.private, canWrite: repo.canPush, branch, historyUrl: historyUrl(cfg, branch) });
    if (!repo.canPush) setAuth({ level: 'lettura' });
    await ghLocked(ghPullInner);
    if (gh !== g) return;
    // archivio su GitHub ancora vuoto e progetti rimasti solo in questo browser: si propone di trasferirli
    const browserData = readLocalData();
    if (canEdit() && isEmpty(state.data) && browserData && !isEmpty(browserData)) setSync({ localOnly: browserData });
  } catch (err) {
    if (gh === g) ghFailed(err, null);
  }
  if (gh !== g) return;
  setSync({ ready: true, pending: ghDirty() ? 1 : 0 });
  startGhTimers();
  // modifiche rimaste in sospeso dall'ultima volta (pagina chiusa prima del salvataggio)
  if (ghDirty() && !g.halted && !g.blocked) scheduleGhSave(0);
}

/** collega questo browser a un archivio su GitHub (la configurazione resta solo in questo browser) */
export async function connectGitHub(cfg: GitHubConfig): Promise<void> {
  // i dati della modalità «solo browser» restano al loro posto: tornano scollegando GitHub
  if (state.sync.mode === 'browser') persistLocal();
  saveGitHubConfig(cfg);
  await startGitHub(cfg);
}

/** scollega GitHub da questo browser: si cancellano token e copie locali dell'archivio */
export function disconnectGitHub(): void {
  stopGhTimers();
  gh = null;
  clearGitHubConfig();
  clearGhCache();
  past = [];
  future = [];
  state = { ...state, data: readLocalData() ?? demoData() };
  ensureSelection();
  setAuth({ ready: true, mode: 'browser', enabled: false, level: 'admin' });
  setSync({
    mode: 'browser',
    github: null,
    error: null,
    saving: false,
    pending: 0,
    online: false,
    localOnly: null,
    notices: [],
    savedAt: null,
  });
}

/** «Aggiorna»: salva subito le modifiche di qui e legge quelle degli altri (sblocca anche dopo un errore) */
export async function syncGitHubNow(): Promise<void> {
  const g = gh;
  if (!g) return;
  g.halted = false;
  ghRetryMs = 0;
  ghClearError();
  if (ghDirty()) await ghSaveNow();
  if (gh !== g) return;
  ghLastCheckAt = Date.now();
  await ghPull();
}

/** modifiche non ancora arrivate su GitHub: chiudendo la pagina si avvisa */
export function hasUnsavedChanges(): boolean {
  return state.sync.mode === 'github' && (state.sync.saving || ghDirty());
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
    color: null,
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

/** il nodo ha già questi valori: la modifica non cambierebbe nulla */
function unchanged(id: string, patch: Partial<TaskNode>): boolean {
  const cur = state.data.nodes.find((n) => n.id === id) as unknown as Record<string, unknown> | undefined;
  return !!cur && Object.entries(patch).every(([k, v]) => same(cur[k], v));
}

export function updateNode(id: string, patch: Partial<TaskNode>, history = true) {
  if (state.sync.mode !== 'browser' && onlyCollapse(patch)) {
    setCollapsedLocal([id], !!patch.collapsed);
    return;
  }
  // una cella confermata con Invio viene confermata di nuovo quando perde il fuoco: la seconda
  // volta non cambia nulla e non deve diventare un passo in più di «annulla»
  if (unchanged(id, patch)) return;
  mutate((d) => {
    d.nodes = d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
  }, history);
}

export function updateNodes(patches: Record<string, Partial<TaskNode>>, history = true) {
  const entries = Object.entries(patches);
  if (state.sync.mode !== 'browser' && entries.length && entries.every(([, p]) => onlyCollapse(p))) {
    const open = entries.filter(([, p]) => !p.collapsed).map(([id]) => id);
    const close = entries.filter(([, p]) => p.collapsed).map(([id]) => id);
    if (open.length) setCollapsedLocal(open, false);
    if (close.length) setCollapsedLocal(close, true);
    return;
  }
  if (entries.every(([id, p]) => unchanged(id, p))) return;
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
  if (state.ui.selectedProjectId === id && !state.data.nodes.some((n) => n.id === id)) {
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
  if (state.sync.mode !== 'browser') saveCollapsed();
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
  const ids = rootId ? [rootId, ...descendantIds(state.data.nodes, rootId)] : state.data.nodes.map((n) => n.id);
  if (state.sync.mode !== 'browser') {
    setCollapsedLocal(ids, collapsed);
    return;
  }
  const set = new Set(ids);
  mutate((d) => {
    d.nodes = d.nodes.map((n) => (set.has(n.id) ? { ...n, collapsed } : n));
  }, false);
}

export function toggleCollapsed(id: string) {
  const node = state.data.nodes.find((n) => n.id === id);
  if (!node) return;
  if (state.sync.mode !== 'browser') {
    setCollapsedLocal([id], !node.collapsed);
    return;
  }
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
    author: patch.author ?? (state.sync.session?.user ?? state.ui.userName.trim()),
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
  const person: Person = { photo: '', email: '', phone: '', about: '', ...p, id: uid('p') };
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
  mutate(() => migrate(data), true, { replace: true });
  const first = state.data.nodes.find((n) => n.parentId === null && !n.archived);
  setUi({ selectedProjectId: first?.id ?? null });
}

/**
 * Aggiunge progetti/persone/assenze/note ai dati esistenti senza cancellare nulla.
 * Gli id in conflitto vengono rimappati, così due backup diversi convivono.
 * Nell'archivio condiviso le assenze le gestisce solo l'amministratore: per gli altri
 * livelli vengono lasciate fuori (il conteggio restituito lo dice).
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

  // la stessa assenza (persona, date, motivo) aggiunta due volte non si raddoppia:
  // i giorni di ferie dell'anno si sommano assenza per assenza
  const absKey = (a: Absence) => `${a.personId ?? '*'}|${a.start}|${a.end}|${a.type}`;
  const knownAbsences = new Set(existing.absences.map(absKey));
  const newAbsences: Absence[] = [];
  const absencesAllowed = state.sync.mode === 'browser' || isAdmin();
  for (const a of absencesAllowed ? add.absences : []) {
    // una chiusura aziendale non ha persona da rimappare: vale per tutti
    const personId = a.personId === null ? null : (remap[a.personId] ?? a.personId);
    const mapped: Absence = { ...a, id: uid('a'), personId };
    if ((personId !== null && !usedPersonIds.has(personId)) || knownAbsences.has(absKey(mapped))) continue;
    knownAbsences.add(absKey(mapped));
    newAbsences.push(mapped);
  }

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

/** browser senza server: nome dell'autore delle note (nell'archivio condiviso vale l'accesso) */
export function setUserName(name: string) {
  setUi({ userName: name.slice(0, 80) });
}

/** trasferisce sull'archivio condiviso i dati rimasti nel browser di questo PC */
export async function uploadLocalData(): Promise<boolean> {
  const local = state.sync.localOnly;
  if (!local || !canEdit()) return false;
  setSync({ localOnly: null });
  mutate(() => migrate(local));
  ensureSelection();
  return true;
}

export function dismissLocalData() {
  setSync({ localOnly: null });
}

export function resetAll() {
  replaceData(emptyData());
  setUi({ page: 'home', selectedProjectId: null });
}

export function loadDemo() {
  replaceData(demoData());
  setUi({ page: 'home' });
}
