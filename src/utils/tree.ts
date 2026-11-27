import type { ComputedMap, Computed, Status, TaskNode } from '../types';
import { countWorkingDays, maxISO, minISO } from './dates';

export interface FlatRow {
  node: TaskNode;
  computed: Computed;
  visible: boolean;
}

export function childrenOf(nodes: TaskNode[], parentId: string | null): TaskNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

export function roots(nodes: TaskNode[]): TaskNode[] {
  return childrenOf(nodes, null);
}

export function byId(nodes: TaskNode[]): Record<string, TaskNode> {
  const map: Record<string, TaskNode> = {};
  for (const n of nodes) map[n.id] = n;
  return map;
}

/** stato aggregato di un ramo a partire dagli stati dei figli */
function rollupStatus(childStatuses: Status[]): Status {
  const active = childStatuses.filter((s) => s !== 'CANCELLED');
  if (active.length === 0) return childStatuses.length ? 'CANCELLED' : 'TODO';
  if (active.every((s) => s === 'DONE')) return 'DONE';
  if (active.some((s) => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (active.some((s) => s === 'DONE')) return 'IN_PROGRESS';
  return 'TODO';
}

/**
 * Calcola i valori derivati per tutti i nodi.
 * Regole: un nodo con figli eredita
 *   inizio = min(inizio figli non annullati)
 *   fine   = max(fine figli non annullati)
 *   ore    = somma ore figli non annullati
 *   stato  = aggregato dei figli
 * Un nodo foglia usa i propri valori.
 */
export function computeAll(nodes: TaskNode[]): ComputedMap {
  const childMap: Record<string, TaskNode[]> = {};
  for (const n of nodes) {
    const key = n.parentId ?? '__root__';
    (childMap[key] ||= []).push(n);
  }
  const result: ComputedMap = {};
  const onPath = new Set<string>(); // protezione contro strutture cicliche (import corrotti)

  const visit = (node: TaskNode, depth: number, rootId: string): Computed => {
    const kids = onPath.has(node.id) ? [] : childMap[node.id] || [];
    onPath.add(node.id);
    const hasChildren = kids.length > 0;
    let start = node.start;
    let end = node.end;
    let hours = node.hours ?? 0;
    let status = node.status;
    let doneHours = 0;
    let overrun = false;

    if (hasChildren) {
      let cStart: string | null = null;
      let cEnd: string | null = null;
      let cHours = 0;
      const statuses: Status[] = [];
      for (const k of kids) {
        const c = visit(k, depth + 1, rootId);
        statuses.push(c.status);
        if (c.status === 'CANCELLED') continue;
        cStart = minISO(cStart, c.start);
        cEnd = maxISO(cEnd, c.end);
        cHours += c.hours;
        doneHours += c.progress * c.hours;
      }
      start = cStart ?? node.start;
      end = cEnd ?? node.end;
      hours = cHours;
      status = rollupStatus(statuses);
      if (node.end && end && end > node.end) overrun = true;
    } else {
      doneHours = node.status === 'DONE' ? hours : 0;
    }

    const computed: Computed = {
      depth,
      hasChildren,
      start,
      end,
      hours,
      status,
      workDays: countWorkingDays(start, end),
      progress: hours > 0 ? Math.min(1, doneHours / hours) : status === 'DONE' ? 1 : 0,
      overrun,
      rootId,
    };
    result[node.id] = computed;
    onPath.delete(node.id);
    return computed;
  };

  for (const r of childMap['__root__'] || []) visit(r, 0, r.id);
  // nodi orfani (sicurezza)
  for (const n of nodes) {
    if (!result[n.id]) {
      result[n.id] = {
        depth: 0,
        hasChildren: false,
        start: n.start,
        end: n.end,
        hours: n.hours ?? 0,
        status: n.status,
        workDays: countWorkingDays(n.start, n.end),
        progress: n.status === 'DONE' ? 1 : 0,
        overrun: false,
        rootId: n.id,
      };
    }
  }
  return result;
}

/** righe in ordine albero; visible=false se un antenato è compresso */
export function flatten(nodes: TaskNode[], computed: ComputedMap, rootId?: string | null): FlatRow[] {
  const childMap: Record<string, TaskNode[]> = {};
  for (const n of nodes) {
    const key = n.parentId ?? '__root__';
    (childMap[key] ||= []).push(n);
  }
  const out: FlatRow[] = [];
  const seen = new Set<string>();
  const walk = (list: TaskNode[], visible: boolean) => {
    for (const n of list) {
      const c = computed[n.id];
      if (!c || seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, computed: c, visible });
      const kids = childMap[n.id] || [];
      if (kids.length) walk(kids, visible && !n.collapsed);
    }
  };
  const start = rootId ? (nodes.filter((n) => n.id === rootId) as TaskNode[]) : childMap['__root__'] || [];
  walk(start, true);
  return out;
}

export function descendantIds(nodes: TaskNode[], id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const n of nodes) {
      if (n.parentId === pid && !seen.has(n.id)) {
        seen.add(n.id);
        out.push(n.id);
        walk(n.id);
      }
    }
  };
  walk(id);
  return out;
}

export function ancestorIds(nodes: TaskNode[], id: string): string[] {
  const map = byId(nodes);
  const out: string[] = [];
  let cur = map[id]?.parentId ?? null;
  let guard = 0;
  while (cur && guard++ < 100) {
    out.push(cur);
    cur = map[cur]?.parentId ?? null;
  }
  return out;
}

export function rootIdOf(nodes: TaskNode[], id: string): string {
  const anc = ancestorIds(nodes, id);
  return anc.length ? anc[anc.length - 1] : id;
}

export function pathOf(nodes: TaskNode[], id: string): string[] {
  const map = byId(nodes);
  return [...ancestorIds(nodes, id).reverse(), id].map((i) => map[i]?.name ?? '');
}

/**
 * Ripara un elenco di nodi che arriva da un file esterno:
 * id duplicati o vuoti, genitori inesistenti, cicli, date invertite.
 * Serve a garantire che l'app non vada mai in loop su un file corrotto.
 */
export function sanitizeNodes(nodes: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const used = new Set<string>();
  let auto = 0;
  for (const n of nodes) {
    let id = typeof n.id === 'string' ? n.id.trim() : '';
    if (!id || used.has(id)) id = `fix_${Date.now().toString(36)}_${auto++}`;
    used.add(id);
    let start = n.start || null;
    let end = n.end || null;
    if (start && end && end < start) [start, end] = [end, start];
    out.push({ ...n, id, start, end });
  }
  // genitori inesistenti → progetto radice
  for (const n of out) if (n.parentId && !used.has(n.parentId)) n.parentId = null;
  // cicli → si spezza il legame risalendo la catena
  const map = byId(out);
  for (const n of out) {
    const chain = new Set<string>([n.id]);
    let cur = n.parentId;
    let guard = 0;
    while (cur && guard++ < 1000) {
      if (chain.has(cur)) {
        const broken = map[cur];
        if (broken) broken.parentId = null;
        break;
      }
      chain.add(cur);
      cur = map[cur]?.parentId ?? null;
    }
  }
  return out;
}

/** variabili CSS: i valori stanno in styles.css e si possono cambiare dalle impostazioni */
export const STATUS_COLORS: Record<Status, string> = {
  TODO: 'var(--st-todo)',
  IN_PROGRESS: 'var(--st-progress)',
  DONE: 'var(--st-done)',
  CANCELLED: 'var(--st-cancelled)',
};
