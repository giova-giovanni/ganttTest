import type { Absence, ComputedMap, Person, TaskNode } from '../types';
import { workingDays } from './dates';

export interface LoadTaskShare {
  nodeId: string;
  name: string;
  hours: number; // ore in quel giorno
  rootName: string;
}

export interface DayLoad {
  hours: number;
  tasks: LoadTaskShare[];
}

/** personId (o '__none__') -> giorno ISO -> carico */
export type LoadMap = Record<string, Record<string, DayLoad>>;

export const UNASSIGNED = '__none__';

export interface LoadResult {
  map: LoadMap;
  /** ore totali per persona su tutto l'orizzonte */
  totals: Record<string, number>;
  /** attività che cadono interamente in giorni di assenza del responsabile */
  conflicts: string[];
}

/** personId -> giorno ISO -> assenza */
export type AbsenceMap = Record<string, Record<string, Absence>>;

/** chiave della mappa per le chiusure aziendali: valgono per tutti, anche per le attività non assegnate */
export const ALL_PEOPLE = '__tutti__';

/** giorni lavorativi coperti da un’assenza (gli estremi possono essere scambiati) */
function absenceDays(a: Absence): string[] {
  const from = a.start <= a.end ? a.start : a.end;
  const to = a.start <= a.end ? a.end : a.start;
  return workingDays(from, to);
}

export function buildAbsenceMap(absences: Absence[]): AbsenceMap {
  const map: AbsenceMap = {};
  for (const a of absences) {
    if (!a.start || !a.end) continue;
    const byDay = (map[a.personId ?? ALL_PEOPLE] ||= {});
    for (const d of absenceDays(a)) byDay[d] = a;
  }
  return map;
}

/** giorni di chiusura aziendale (validi per tutti) */
export function closureDays(absences: Absence[]): Set<string> {
  const out = new Set<string>();
  for (const a of absences) {
    if (a.personId !== null || !a.start || !a.end) continue;
    for (const d of absenceDays(a)) out.add(d);
  }
  return out;
}

/**
 * L’assenza che copre un giorno: quella della persona, oppure una chiusura aziendale
 * (che vale anche per le attività non assegnate).
 */
export function isAbsent(absMap: AbsenceMap, personId: string | null | undefined, day: string): Absence | undefined {
  return (personId ? absMap[personId]?.[day] : undefined) ?? absMap[ALL_PEOPLE]?.[day];
}

/** tutti i giorni in cui la persona non lavora: assenze proprie e chiusure aziendali */
export function absentDays(absMap: AbsenceMap, personId: string): Set<string> {
  return new Set([...Object.keys(absMap[personId] ?? {}), ...Object.keys(absMap[ALL_PEOPLE] ?? {})]);
}

/**
 * Distribuisce le ore previste di ogni attività FOGLIA sui suoi giorni lavorativi,
 * saltando i giorni di assenza del responsabile (ferie, malattia, ecc.) e le chiusure aziendali.
 * Le attività padre non vengono conteggiate (le loro ore sono la somma dei figli).
 * Le attività ANNULLATE e i progetti archiviati sono esclusi.
 */
export function computeLoad(
  nodes: TaskNode[],
  computed: ComputedMap,
  rootNames: Record<string, string>,
  absMap: AbsenceMap = {},
  excludeRootIds: Set<string> = new Set(),
): LoadResult {
  const map: LoadMap = {};
  const totals: Record<string, number> = {};
  const conflicts: string[] = [];

  for (const n of nodes) {
    const c = computed[n.id];
    if (!c || c.hasChildren) continue;
    if (c.status === 'CANCELLED') continue;
    if (excludeRootIds.has(c.rootId)) continue;
    const hours = n.hours ?? 0;
    if (hours <= 0 || !c.start || !c.end) continue;
    const all = workingDays(c.start, c.end);
    if (all.length === 0) continue;
    let days = all.filter((d) => !isAbsent(absMap, n.assigneeId, d));
    if (days.length === 0) {
      days = all; // interamente in assenza: si segnala il conflitto
      conflicts.push(n.id);
    }
    const perDay = hours / days.length;
    const pid = n.assigneeId ?? UNASSIGNED;
    const byDay = (map[pid] ||= {});
    totals[pid] = (totals[pid] ?? 0) + hours;
    for (const d of days) {
      const cell = (byDay[d] ||= { hours: 0, tasks: [] });
      cell.hours += perDay;
      cell.tasks.push({ nodeId: n.id, name: n.name, hours: perDay, rootName: rootNames[c.rootId] ?? '' });
    }
  }
  return { map, totals, conflicts };
}

export function capacityOf(person: Person | undefined): number {
  return person?.hoursPerDay && person.hoursPerDay > 0 ? person.hoursPerDay : 8;
}

export function loadPercent(hours: number, capacity: number): number {
  return capacity > 0 ? (hours / capacity) * 100 : 0;
}

export function loadColor(pct: number): string {
  if (pct <= 0) return 'transparent';
  if (pct <= 60) return '#bfe6cd';
  if (pct <= 100) return '#63c58c';
  if (pct <= 150) return '#f2c14e';
  if (pct <= 200) return '#e8873c';
  return '#d6453d';
}
