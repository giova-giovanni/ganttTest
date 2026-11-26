import type { AbsenceType, AppData, Lang, Note, Person, Status, TaskNode } from '../types';
import { translate, type TKey } from '../i18n';
import { byId, computeAll, flatten, pathOf, roots, rootIdOf } from './tree';
import { formatDateTime, plainText } from './notes';
import { formatDate, isoWeek, startOfWeek, addDays, diffDays, weekdayName, countWorkingDays } from './dates';
import { buildAbsenceMap, capacityOf, computeLoad, loadPercent, UNASSIGNED } from './load';
import { migrate, uid } from '../store';
import {
  csvBlob,
  formatNumber,
  indentLevel,
  normalizeHeader,
  parseCsv,
  parseCsvDate,
  parseNumber,
  toCsv,
  type CsvRow,
} from './csv';

// ================================================================== download

export function download(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
const fileName = (kind: string, ext: string) => `GANTT_${kind}_${stamp()}.${ext}`;

// ================================================================== export

export type Dataset = 'backup' | 'tasks' | 'load' | 'people' | 'absences' | 'notes';

export interface ExportOptions {
  dataset: Dataset;
  /** 'current' esporta solo il progetto selezionato */
  scope: 'all' | 'current';
  projectId: string | null;
  includeArchived: boolean;
  /** solo per il carico */
  unit: 'hours' | 'percent';
  granularity: 'day' | 'week';
}

export const defaultExportOptions: ExportOptions = {
  dataset: 'backup',
  scope: 'all',
  projectId: null,
  includeArchived: false,
  unit: 'hours',
  granularity: 'day',
};

/** progetti radice che rientrano nell'ambito scelto */
function selectedRoots(data: AppData, o: ExportOptions): TaskNode[] {
  let list = roots(data.nodes);
  if (!o.includeArchived) list = list.filter((r) => !r.archived);
  if (o.scope === 'current' && o.projectId) list = list.filter((r) => r.id === o.projectId);
  return list;
}

export function exportJson(data: AppData) {
  download(fileName('backup', 'json'), JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

function taskHeader(lang: Lang): string[] {
  return [
    lang === 'de' ? 'Ebene' : 'Livello',
    'ID',
    lang === 'de' ? 'Übergeordnete ID' : 'ID padre',
    lang === 'de' ? 'Projekt' : 'Progetto',
    translate(lang, 'col.name'),
    translate(lang, 'col.status'),
    translate(lang, 'col.start'),
    translate(lang, 'col.end'),
    `${translate(lang, 'col.hours')} (h)`,
    translate(lang, 'col.days'),
    `${translate(lang, 'col.progress')} (%)`,
    translate(lang, 'col.assignee'),
    translate(lang, 'col.notes'),
  ];
}

export function buildTasksCsv(data: AppData, lang: Lang, o: ExportOptions): string {
  const computed = computeAll(data.nodes);
  const people = Object.fromEntries(data.people.map((p) => [p.id, p.name]));
  const rootNames = Object.fromEntries(roots(data.nodes).map((r) => [r.id, r.name]));
  const keep = new Set(selectedRoots(data, o).map((r) => r.id));

  const rows: CsvRow[] = [taskHeader(lang)];
  for (const root of selectedRoots(data, o)) {
    for (const r of flatten(data.nodes, computed, root.id)) {
      const c = r.computed;
      if (!keep.has(c.rootId)) continue;
      rows.push([
        String(c.depth + 1),
        r.node.id,
        r.node.parentId ?? '',
        rootNames[c.rootId] ?? '',
        '  '.repeat(c.depth) + r.node.name,
        translate(lang, `status.${c.status}` as TKey),
        formatDate(c.start, lang),
        formatDate(c.end, lang),
        formatNumber(c.hours || null),
        c.workDays ? String(c.workDays) : '',
        formatNumber(Math.round(c.progress * 100), 0),
        r.node.assigneeId ? people[r.node.assigneeId] ?? '' : '',
        (r.node.notes ?? '').replace(/\s*\n\s*/g, ' · '),
      ]);
    }
  }
  return toCsv(rows);
}

// nell'elenco dei responsabili non compare il conteggio delle assenze:
// è un dato personale e sta solo nella schermata Ferie e permessi.
// Attività e ore hanno lo stesso perimetro della schermata Responsabili: niente attività
// annullate né progetti archiviati, e le ore sono quelle del carico di lavoro.
export function buildPeopleCsv(data: AppData, lang: Lang): string {
  const computed = computeAll(data.nodes);
  const archived = new Set(roots(data.nodes).filter((r) => r.archived).map((r) => r.id));
  const rootNames = Object.fromEntries(roots(data.nodes).map((r) => [r.id, r.name]));
  const { totals } = computeLoad(data.nodes, computed, rootNames, buildAbsenceMap(data.absences), archived);
  const rows: CsvRow[] = [
    [
      translate(lang, 'people.name'),
      translate(lang, 'people.role'),
      translate(lang, 'people.hoursPerDay'),
      translate(lang, 'people.tasks'),
      `${translate(lang, 'people.hours')} (h)`,
      translate(lang, 'people.color'),
    ],
  ];
  for (const p of data.people) {
    let tasks = 0;
    for (const n of data.nodes) {
      const c = computed[n.id];
      if (!c || c.hasChildren || n.assigneeId !== p.id || c.status === 'CANCELLED' || archived.has(c.rootId)) continue;
      tasks += 1;
    }
    rows.push([p.name, p.role, formatNumber(capacityOf(p)), String(tasks), formatNumber(totals[p.id] ?? 0), p.color]);
  }
  return toCsv(rows);
}

/** una riga per nota: si apre in Excel e si filtra per data, autore o etichetta */
export function buildNotesCsvFrom(notes: Note[], nodes: TaskNode[], lang: Lang): string {
  const names = byId(nodes);
  const rows: CsvRow[] = [
    [
      translate(lang, 'notes.created'),
      translate(lang, 'notes.updated'),
      translate(lang, 'notes.author'),
      lang === 'de' ? 'Projekt' : 'Progetto',
      translate(lang, 'notes.position'),
      translate(lang, 'notes.noteTitle'),
      translate(lang, 'notes.body'),
      translate(lang, 'notes.tags'),
    ],
  ];
  for (const n of notes) {
    if (!names[n.nodeId]) continue;
    const rootId = rootIdOf(nodes, n.nodeId);
    rows.push([
      formatDateTime(n.createdAt),
      formatDateTime(n.updatedAt),
      n.author,
      names[rootId]?.name ?? '',
      pathOf(nodes, n.nodeId).filter(Boolean).join(' > '),
      n.title,
      plainText(n.body),
      n.tags.join(', '),
    ]);
  }
  return toCsv(rows);
}

export function buildNotesCsv(data: AppData, lang: Lang, o: ExportOptions): string {
  const keep = new Set(selectedRoots(data, o).map((r) => r.id));
  const names = byId(data.nodes);
  const list = [...data.notes]
    .filter((n) => names[n.nodeId] && keep.has(rootIdOf(data.nodes, n.nodeId)))
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  return buildNotesCsvFrom(list, data.nodes, lang);
}

/** esporta l'elenco già filtrato della schermata Note, nell'ordine che si vede */
export function exportNotesList(notes: Note[], nodes: TaskNode[], lang: Lang) {
  download(fileName('note', 'csv'), csvBlob(buildNotesCsvFrom(notes, nodes, lang)));
}

export function buildAbsencesCsv(data: AppData, lang: Lang): string {
  const names = Object.fromEntries(data.people.map((p) => [p.id, p.name]));
  const rows: CsvRow[] = [
    [
      translate(lang, 'absence.person'),
      translate(lang, 'absence.from'),
      translate(lang, 'absence.to'),
      translate(lang, 'absence.type'),
      translate(lang, 'col.days'),
      translate(lang, 'absence.note'),
    ],
  ];
  const sorted = [...data.absences].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (const a of sorted) {
    rows.push([
      names[a.personId] ?? '',
      formatDate(a.start, lang),
      formatDate(a.end, lang),
      translate(lang, `absence.${a.type}` as TKey),
      String(countWorkingDays(a.start, a.end)),
      a.note ?? '',
    ]);
  }
  return toCsv(rows);
}

/** matrice responsabile × giorno (o settimana) con ore oppure percentuale di carico */
export function buildLoadCsv(data: AppData, lang: Lang, o: ExportOptions): string {
  const computed = computeAll(data.nodes);
  const rootNames = Object.fromEntries(roots(data.nodes).map((r) => [r.id, r.name]));
  const allowed = new Set(selectedRoots(data, o).map((r) => r.id));
  const excluded = new Set(roots(data.nodes).filter((r) => !allowed.has(r.id)).map((r) => r.id));
  const absMap = buildAbsenceMap(data.absences);
  const { map, totals } = computeLoad(data.nodes, computed, rootNames, absMap, excluded);

  // intervallo: dal primo all'ultimo giorno con carico
  let min: string | null = null;
  let max: string | null = null;
  for (const days of Object.values(map)) {
    for (const d of Object.keys(days)) {
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  if (!min || !max) return toCsv([[translate(lang, 'load.noTasks')]]);

  const isWeek = o.granularity === 'week';
  const cols: { key: string; label: string; days: string[] }[] = [];
  if (isWeek) {
    let cur = startOfWeek(min);
    const guard = 520; // massimo 10 anni di settimane
    while (cur <= max && cols.length < guard) {
      const days = [0, 1, 2, 3, 4].map((i) => addDays(cur, i));
      cols.push({ key: cur, label: `${translate(lang, 'load.week')} ${isoWeek(cur)}`, days });
      cur = addDays(cur, 7);
    }
  } else {
    const total = Math.min(diffDays(min, max) + 1, 1100); // massimo ~3 anni di giorni
    for (let i = 0; i < total; i++) {
      const d = addDays(min, i);
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === 0 || dow === 6) continue; // solo giorni lavorativi
      cols.push({ key: d, label: `${weekdayName(new Date(d + 'T00:00:00'), lang)} ${formatDate(d, lang)}`, days: [d] });
    }
  }

  const unitLabel = o.unit === 'percent' ? '%' : 'h';
  const header = [
    translate(lang, 'load.person'),
    translate(lang, 'people.role'),
    `${translate(lang, 'load.capacity')} (h/${lang === 'de' ? 'Tag' : 'gg'})`,
    ...cols.map((c) => `${c.label} [${unitLabel}]`),
    `${translate(lang, 'load.total')} (h)`,
    `${translate(lang, 'load.avg')} (%)`,
    `${translate(lang, 'load.peak')} (%)`,
    translate(lang, 'load.overloadDays'),
  ];
  const rows: CsvRow[] = [header];

  const entries: { id: string; name: string; role: string; cap: number }[] = data.people.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    cap: capacityOf(p),
  }));
  if (map[UNASSIGNED]) entries.push({ id: UNASSIGNED, name: translate(lang, 'load.unassigned'), role: '', cap: 8 });

  for (const e of entries) {
    const byDay = map[e.id] ?? {};
    const cells: string[] = [];
    let peak = 0;
    let sumPct = 0;
    let counted = 0;
    let over = 0;
    for (const col of cols) {
      const hours = col.days.reduce((s, d) => s + (byDay[d]?.hours ?? 0), 0);
      const cap = e.cap * col.days.length;
      const pct = loadPercent(hours, cap);
      if (hours > 0) {
        peak = Math.max(peak, pct);
        sumPct += pct;
        counted += 1;
        if (pct > 100) over += 1;
      }
      cells.push(hours > 0 ? formatNumber(o.unit === 'percent' ? pct : hours, o.unit === 'percent' ? 0 : 1) : '');
    }
    rows.push([
      e.name,
      e.role,
      formatNumber(e.cap),
      ...cells,
      formatNumber(totals[e.id] ?? 0),
      formatNumber(counted ? sumPct / counted : 0, 0),
      formatNumber(peak, 0),
      String(over),
    ]);
  }
  return toCsv(rows);
}

/** modello vuoto da compilare in Excel */
export function buildTemplateCsv(lang: Lang): string {
  const head = taskHeader(lang);
  const de = lang === 'de';
  const sample: CsvRow[] = [
    head,
    ['1', '', '', '', de ? 'P-100 Beispielprojekt' : 'P-100 Progetto esempio', '', '', '', '', '', '', '', ''],
    [
      '2',
      '',
      '',
      '',
      de ? '  Mechanik' : '  Meccanica',
      translate(lang, 'status.IN_PROGRESS'),
      formatDate(stamp(), lang),
      formatDate(addDays(stamp(), 20), lang),
      '',
      '',
      '',
      '',
      '',
    ],
    [
      '3',
      '',
      '',
      '',
      de ? '    Konstruktion' : '    Progettazione',
      translate(lang, 'status.TODO'),
      formatDate(stamp(), lang),
      formatDate(addDays(stamp(), 10), lang),
      '40',
      '',
      '',
      de ? 'Max Mustermann' : 'Mario Rossi',
      '',
    ],
  ];
  return toCsv(sample);
}

export function runExport(data: AppData, lang: Lang, o: ExportOptions) {
  if (o.dataset === 'backup') return exportJson(data);
  const map: Record<Exclude<Dataset, 'backup'>, [string, string]> = {
    tasks: ['attivita', buildTasksCsv(data, lang, o)],
    load: ['carico', buildLoadCsv(data, lang, o)],
    people: ['responsabili', buildPeopleCsv(data, lang)],
    absences: ['assenze', buildAbsencesCsv(data, lang)],
    notes: ['note', buildNotesCsv(data, lang, o)],
  };
  const [name, content] = map[o.dataset];
  download(fileName(name, 'csv'), csvBlob(content));
}

export function downloadTemplate(lang: Lang) {
  download(fileName('modello', 'csv'), csvBlob(buildTemplateCsv(lang)));
}

// ================================================================== import

export type ImportKind = 'backup' | 'tasks' | 'people' | 'absences';

export interface ColumnInfo {
  header: string;
  field: string | null;
}

export interface ImportPreview {
  ok: boolean;
  /** chiave i18n dell'errore quando ok = false */
  errorKey?: TKey;
  kind: ImportKind;
  rowCount: number;
  columns: ColumnInfo[];
  warnings: string[];
  data: AppData;
  counts: { projects: number; tasks: number; people: number; absences: number; notes: number };
}

/** sinonimi accettati nelle intestazioni, in italiano, tedesco e inglese */
const FIELD_SYNONYMS: Record<string, string[]> = {
  level: ['livello', 'liv', 'ebene', 'stufe', 'level', 'wbs', 'gliederung', 'gliederungsebene'],
  id: ['id', 'idattivita', 'idaufgabe', 'taskid', 'nr', 'nummer', 'codice', 'code'],
  parentId: ['idpadre', 'padre', 'parent', 'parentid', 'ubergeordneteid', 'ubergeordnet', 'ubergeordnetenr', 'vorgesetzteid'],
  project: ['progetto', 'projekt', 'project', 'commessa', 'auftrag', 'auftragsnummer', 'ordine'],
  name: ['attivita', 'attivita1', 'nome', 'nomeattivita', 'aufgabe', 'aufgabenname', 'bezeichnung', 'name', 'task', 'taskname', 'titolo', 'titel', 'descrizione', 'beschreibung', 'vorgangsname'],
  status: ['stato', 'status', 'zustand', 'fase', 'phase'],
  start: ['inizio', 'datainizio', 'dal', 'beginn', 'anfang', 'start', 'startdatum', 'anfangstermin', 'von', 'startdate'],
  end: ['fine', 'datafine', 'al', 'ende', 'endtermin', 'enddatum', 'end', 'scadenza', 'termin', 'faelligkeit', 'bis', 'enddate', 'deadline'],
  hours: ['ore', 'oreprev', 'orepreviste', 'orepianificate', 'stunden', 'geplantestd', 'geplantestunden', 'aufwand', 'hours', 'arbeit', 'work', 'h'],
  assignee: ['responsabile', 'verantwortlich', 'verantwortlicher', 'assignee', 'owner', 'bearbeiter', 'zustaendig', 'zustandig', 'ressource', 'ressourcennamen', 'risorsa', 'persona', 'person'],
  notes: ['note', 'nota', 'notizen', 'notiz', 'notes', 'bemerkung', 'bemerkungen', 'commento', 'kommentar', 'comment'],
  role: ['ruolo', 'rolle', 'role', 'funzione', 'funktion'],
  capacity: ['oregiorno', 'oreal giorno', 'stdtag', 'stundentag', 'kapazitat', 'capacita', 'capacity', 'hoursperday'],
  color: ['colore', 'farbe', 'color'],
  absenceType: ['motivo', 'grund', 'tipo', 'typ', 'type', 'reason'],
};

function mapHeaders(header: CsvRow): { columns: ColumnInfo[]; index: Record<string, number> } {
  const columns: ColumnInfo[] = [];
  const index: Record<string, number> = {};
  header.forEach((h, i) => {
    const norm = normalizeHeader(h);
    let field: string | null = null;
    for (const [key, syns] of Object.entries(FIELD_SYNONYMS)) {
      // «Ore (h)» → ore: l'inizio basta, ma solo per sinonimi di almeno 3 lettere,
      // altrimenti «Altro» diventerebbe «Al» (data di fine) e «Idea» la colonna ID
      if (syns.includes(norm) || syns.some((s) => s.length >= 3 && norm.startsWith(s) && norm.length <= s.length + 4)) {
        field = key;
        break;
      }
    }
    // una colonna già assegnata non viene sovrascritta da un sinonimo più debole
    if (field && index[field] === undefined) index[field] = i;
    else if (field) field = null;
    columns.push({ header: h.trim(), field });
  });
  return { columns, index };
}

const STATUS_WORDS: Record<string, Status> = {};
const addStatus = (s: Status, words: string[]) => words.forEach((w) => (STATUS_WORDS[normalizeHeader(w)] = s));
addStatus('TODO', ['TODO', 'DA FARE', 'DAFARE', 'ZU ERLEDIGEN', 'OFFEN', 'APERTO', 'NUOVO', 'NEU', 'NOT STARTED', 'NON INIZIATA', 'NICHT BEGONNEN', '0%']);
addStatus('IN_PROGRESS', ['IN_PROGRESS', 'IN PROGRESS', 'IN CORSO', 'INCORSO', 'IN ARBEIT', 'LAUFEND', 'WIP', 'AVVIATA', 'BEGONNEN', 'CORSO']);
addStatus('DONE', ['DONE', 'FINITO', 'FERTIG', 'COMPLETATO', 'ERLEDIGT', 'ABGESCHLOSSEN', 'CHIUSO', 'GESCHLOSSEN', 'COMPLETE', 'COMPLETED', '100%']);
addStatus('CANCELLED', ['CANCELLED', 'CANCELED', 'ANNULLATO', 'ANNULLATA', 'STORNIERT', 'ABGEBROCHEN', 'ANNULLIERT', 'SOSPESO']);

function parseStatus(raw: string): Status | null {
  const n = normalizeHeader(raw);
  return n ? STATUS_WORDS[n] ?? null : null;
}

const ABSENCE_WORDS: Record<string, AbsenceType> = {};
(['ferie', 'urlaub', 'vacation', 'ferien', 'holiday'] as const).forEach((w) => (ABSENCE_WORDS[w] = 'VACATION'));
(['malattia', 'krankheit', 'sick', 'krank', 'infortunio'] as const).forEach((w) => (ABSENCE_WORDS[w] = 'SICK'));

function parseAbsenceType(raw: string): AbsenceType {
  return ABSENCE_WORDS[normalizeHeader(raw)] ?? 'OTHER';
}

function detectKind(index: Record<string, number>): ImportKind {
  const has = (f: string) => index[f] !== undefined;
  if (has('name') && (has('role') || has('capacity')) && !has('start') && !has('level')) return 'people';
  if (has('assignee') && has('start') && has('end') && has('absenceType') && !has('name')) return 'absences';
  return 'tasks';
}

const emptyData = (): AppData => ({ version: 4, nodes: [], people: [], absences: [], notes: [] });

/**
 * I file della cartella dati (gantt-dati.json, gantt-dati.bak.json, versioni/*.json) tengono
 * i dati dentro una «busta» { kind, rev, savedAt, savedBy, data }: si apre la busta.
 */
function unwrapData(parsed: unknown): Partial<AppData> {
  if (Array.isArray(parsed)) return { nodes: parsed as TaskNode[] };
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) && obj.data && typeof obj.data === 'object') return obj.data as Partial<AppData>;
  return obj as Partial<AppData>;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** numero di struttura WBS / Gliederung: «1» → 0, «1.2» → 1, «1.2.3» → 2 */
function outlineDepth(raw: string): number {
  const s = raw.trim().replace(/\.$/, '');
  return /^\d+(\.\d+)*$/.test(s) ? s.split('.').length - 1 : 0;
}

/**
 * Analizza il contenuto di un file (CSV o JSON) e prepara i dati da importare,
 * senza modificare nulla: l'utente vede l'anteprima e poi conferma.
 */
export function analyzeImport(text: string, filename: string, existing: AppData, lang: Lang): ImportPreview {
  const base: ImportPreview = {
    ok: false,
    kind: 'tasks',
    rowCount: 0,
    columns: [],
    warnings: [],
    data: emptyData(),
    counts: { projects: 0, tasks: 0, people: 0, absences: 0, notes: 0 },
  };
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return { ...base, errorKey: 'io.errorEmpty' };

  // ---- JSON (backup completo)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = migrate(unwrapData(JSON.parse(trimmed)));
      if (!data.nodes.length && !data.people.length && !data.absences.length) {
        return { ...base, kind: 'backup', errorKey: 'io.errorEmpty' };
      }
      return {
        ...base,
        ok: true,
        kind: 'backup',
        rowCount: data.nodes.length,
        data,
        counts: countOf(data),
      };
    } catch {
      return { ...base, errorKey: 'io.errorParse' };
    }
  }

  // ---- CSV
  let rows: CsvRow[];
  try {
    rows = parseCsv(trimmed);
  } catch {
    return { ...base, errorKey: 'io.errorParse' };
  }
  if (rows.length < 2) return { ...base, errorKey: 'io.errorEmpty' };

  const { columns, index } = mapHeaders(rows[0]);
  const body = rows.slice(1);
  const kind = detectKind(index);
  const warnings: string[] = [];

  if (kind === 'people') {
    const data = emptyData();
    for (const r of body) {
      const name = (r[index.name] ?? '').trim();
      if (!name) continue;
      const cap = index.capacity !== undefined ? parseNumber(r[index.capacity]) : null;
      const color = index.color !== undefined ? (r[index.color] ?? '').trim() : '';
      data.people.push({
        id: uid('p'),
        name,
        role: index.role !== undefined ? (r[index.role] ?? '').trim() : '',
        color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : pickColor(data.people.length),
        hoursPerDay: cap && cap > 0 && cap <= 24 ? cap : 8,
      });
    }
    if (!data.people.length) return { ...base, kind, columns, errorKey: 'io.errorEmpty' };
    return { ...base, ok: true, kind, columns, rowCount: body.length, data, counts: countOf(data) };
  }

  if (kind === 'absences') {
    const data = emptyData();
    const byName = new Map(existing.people.map((p) => [p.name.trim().toLowerCase(), p]));
    const created = new Map<string, Person>();
    for (const r of body) {
      const who = (r[index.assignee] ?? '').trim();
      const from = parseCsvDate(r[index.start] ?? '');
      const to = parseCsvDate(r[index.end] ?? '') ?? from;
      if (!who || !from || !to) continue;
      const key = who.toLowerCase();
      let person = byName.get(key) ?? created.get(key);
      if (!person) {
        person = { id: uid('p'), name: who, role: '', color: pickColor(created.size), hoursPerDay: 8 };
        created.set(key, person);
        data.people.push(person);
      }
      data.absences.push({
        id: uid('a'),
        personId: person.id,
        start: from,
        end: to,
        type: index.absenceType !== undefined ? parseAbsenceType(r[index.absenceType] ?? '') : 'OTHER',
        note: index.notes !== undefined ? (r[index.notes] ?? '').trim() : '',
      });
    }
    if (!data.absences.length) return { ...base, kind, columns, errorKey: 'io.errorEmpty' };
    return { ...base, ok: true, kind, columns, rowCount: body.length, data, counts: countOf(data) };
  }

  // ---- attività
  if (index.name === undefined) return { ...base, kind, columns, errorKey: 'io.errorNoName' };

  const data = emptyData();
  const peopleByName = new Map(existing.people.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const newPeople = new Map<string, Person>();
  const resolvePerson = (raw: string): string | null => {
    const name = raw.trim();
    if (!name) return null;
    const key = name.toLowerCase();
    const found = peopleByName.get(key);
    if (found) return found;
    const already = newPeople.get(key);
    if (already) return already.id;
    const p: Person = { id: uid('p'), name, role: '', color: pickColor(newPeople.size), hoursPerDay: 8 };
    newPeople.set(key, p);
    return p.id;
  };

  interface Parsed {
    level: number;
    name: string;
    srcId: string;
    srcParent: string;
    project: string;
    node: TaskNode;
  }

  const parsedRows: Parsed[] = [];
  let unknownStatus = 0;
  let badDates = 0;
  // colonna WBS / Gliederung (MS Project): numeri di struttura «1.2.3», non livelli «1, 2, 3»
  const outlineColumn =
    index.level !== undefined && /^(wbs|gliederung(?!sebene))/.test(normalizeHeader(rows[0][index.level] ?? ''));

  for (const r of body) {
    const rawName = r[index.name] ?? '';
    const ind = indentLevel(rawName);
    const name = ind.text || rawName.trim();
    if (!name) continue;

    let level = 0;
    if (index.level !== undefined && outlineColumn) {
      level = outlineDepth(r[index.level] ?? '');
    } else if (index.level !== undefined) {
      const lv = parseNumber(r[index.level] ?? '');
      level = lv && lv >= 1 ? Math.round(lv) - 1 : 0;
    } else {
      level = ind.level;
    }

    const statusRaw = index.status !== undefined ? (r[index.status] ?? '').trim() : '';
    const status = parseStatus(statusRaw);
    if (statusRaw && !status) unknownStatus += 1;

    const startRaw = index.start !== undefined ? (r[index.start] ?? '').trim() : '';
    const endRaw = index.end !== undefined ? (r[index.end] ?? '').trim() : '';
    let start = parseCsvDate(startRaw);
    let end = parseCsvDate(endRaw);
    if ((startRaw && !start) || (endRaw && !end)) badDates += 1;
    if (start && end && end < start) [start, end] = [end, start];

    parsedRows.push({
      level,
      name,
      srcId: index.id !== undefined ? (r[index.id] ?? '').trim() : '',
      srcParent: index.parentId !== undefined ? (r[index.parentId] ?? '').trim() : '',
      project: index.project !== undefined ? (r[index.project] ?? '').trim() : '',
      node: {
        id: uid(),
        parentId: null,
        name,
        status: status ?? 'TODO',
        start,
        end,
        hours: index.hours !== undefined ? parseNumber(r[index.hours] ?? '') : null,
        assigneeId: index.assignee !== undefined ? resolvePerson(r[index.assignee] ?? '') : null,
        notes: index.notes !== undefined ? (r[index.notes] ?? '').trim() : '',
        collapsed: false,
        archived: false,
      },
    });
  }

  if (!parsedRows.length) return { ...base, kind, columns, errorKey: 'io.errorEmpty' };

  // --- ricostruzione della gerarchia
  // livelli normalizzati in modo che il minimo diventi 0 (servono anche con gli ID, per le righe senza)
  const minLevel = Math.min(...parsedRows.map((p) => p.level));
  for (const p of parsedRows) p.level -= minLevel;

  const useIds = index.id !== undefined && index.parentId !== undefined && parsedRows.some((p) => p.srcId && p.srcParent);
  if (useIds) {
    const bySrc = new Map(parsedRows.filter((p) => p.srcId).map((p) => [p.srcId, p.node.id]));
    // le righe aggiunte a mano in Excel non hanno ID: per loro vale il livello
    // (colonna Livello o rientro del nome), altrimenti diventerebbero progetti a sé
    const stack: string[] = [];
    for (const p of parsedRows) {
      if (p.srcParent) p.node.parentId = bySrc.get(p.srcParent) ?? null;
      else p.node.parentId = p.level > 0 ? stack[p.level - 1] ?? null : null;
      stack[p.level] = p.node.id;
      stack.length = p.level + 1;
    }
  } else {
    const hasProject = index.project !== undefined && parsedRows.some((p) => p.project);
    const projectIds = new Map<string, string>();
    const stack: string[] = [];

    for (const p of parsedRows) {
      let baseParent: string | null = null;
      if (hasProject) {
        const key = p.project || (lang === 'de' ? 'Ohne Projekt' : 'Senza progetto');
        let pid = projectIds.get(key);
        if (!pid && p.level === 0 && sameText(p.name, key)) {
          // la riga È il progetto (export di Gantt Planner senza le colonne ID): niente contenitore doppio
          projectIds.set(key, p.node.id);
          p.node.parentId = null;
          stack.length = 0;
          stack[0] = p.node.id;
          continue;
        }
        if (!pid) {
          const projectNode: TaskNode = {
            id: uid(),
            parentId: null,
            name: key,
            status: 'TODO',
            start: null,
            end: null,
            hours: null,
            assigneeId: null,
            notes: '',
            collapsed: false,
            archived: false,
          };
          data.nodes.push(projectNode);
          pid = projectNode.id;
          projectIds.set(key, pid);
          stack.length = 0;
        }
        baseParent = pid;
      }
      const lvl = p.level;
      p.node.parentId = lvl === 0 ? baseParent : stack[lvl - 1] ?? baseParent;
      stack[lvl] = p.node.id;
      stack.length = lvl + 1;
    }

    // elenco piatto senza colonna progetto: si crea un contenitore col nome del file
    if (!hasProject && parsedRows.every((p) => p.level === 0) && parsedRows.length > 1) {
      const label = filename.replace(/\.[^.]+$/, '').trim() || (lang === 'de' ? 'Importiertes Projekt' : 'Progetto importato');
      const container: TaskNode = {
        id: uid(),
        parentId: null,
        name: label,
        status: 'TODO',
        start: null,
        end: null,
        hours: null,
        assigneeId: null,
        notes: '',
        collapsed: false,
        archived: false,
      };
      data.nodes.push(container);
      for (const p of parsedRows) p.node.parentId = container.id;
      warnings.push(
        lang === 'de'
          ? `Flache Liste erkannt: alle Zeilen wurden unter das Projekt „${label}“ gelegt.`
          : `Elenco piatto: tutte le righe sono state messe sotto il progetto «${label}».`,
      );
    }
  }

  for (const p of parsedRows) data.nodes.push(p.node);
  data.people.push(...newPeople.values());

  if (unknownStatus) {
    warnings.push(
      lang === 'de'
        ? `${unknownStatus} Zeile(n) mit unbekanntem Status → „${translate(lang, 'status.TODO')}“.`
        : `${unknownStatus} riga/righe con stato non riconosciuto → «${translate(lang, 'status.TODO')}».`,
    );
  }
  if (badDates) {
    warnings.push(
      lang === 'de'
        ? `${badDates} Zeile(n) mit unlesbarem Datum → leer gelassen.`
        : `${badDates} riga/righe con data illeggibile → lasciata vuota.`,
    );
  }
  if (newPeople.size) {
    warnings.push(
      lang === 'de'
        ? `${newPeople.size} neue Verantwortliche werden angelegt: ${[...newPeople.values()].map((p) => p.name).join(', ')}.`
        : `${newPeople.size} nuovi responsabili verranno creati: ${[...newPeople.values()].map((p) => p.name).join(', ')}.`,
    );
  }
  const ignored = columns.filter((c) => !c.field && c.header).length;
  if (ignored) {
    warnings.push(
      lang === 'de' ? `${ignored} Spalte(n) ignoriert.` : `${ignored} colonna/colonne ignorate.`,
    );
  }

  return { ...base, ok: true, kind, columns, rowCount: parsedRows.length, warnings, data, counts: countOf(data) };
}

function countOf(data: AppData) {
  const projects = data.nodes.filter((n) => !n.parentId).length;
  return {
    projects,
    tasks: data.nodes.length - projects,
    people: data.people.length,
    absences: data.absences.length,
    notes: data.notes.length,
  };
}

const PALETTE = ['#2f7de1', '#e07b39', '#3aa76d', '#8b5cf6', '#d6453d', '#0ea5a5', '#b45309', '#6b7280'];
function pickColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

/** compatibilità con la versione precedente */
export function parseImport(text: string): AppData | null {
  try {
    const parsed = unwrapData(JSON.parse(text));
    if (!Array.isArray(parsed.nodes)) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}
