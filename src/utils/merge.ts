/**
 * Unione «a tre vie» per l'archivio su GitHub.
 *
 *   base   = la versione del file letta l'ultima volta da GitHub
 *   local  = i dati come sono adesso in questo browser (base + le mie modifiche)
 *   remote = la versione più recente su GitHub (base + le modifiche degli altri)
 *
 * Le mie modifiche si ricavano record per record e campo per campo (diffOps, lo stesso codice
 * del server) e si riportano sopra la versione remota: le modifiche altrui su altri record o
 * su altri campi restano tutte. Sullo stesso campo vince chi salva per ultimo, come
 * nell'archivio condiviso del server.
 */
import type { AppData, Lang } from '../types';
import { translate, type TKey } from '../i18n';
import { KINDS, applyOps, diffOps, keyOf, type Op, type RecordKind } from '../../shared/ops.mjs';

export interface Dropped {
  t: RecordKind;
  id: string;
  label: string;
}

export interface RebaseResult {
  data: AppData;
  /** le mie modifiche (da base a local) */
  mine: Op[];
  /** le modifiche degli altri (da base a remote): servono anche per le istantanee di «annulla» */
  theirs: Op[];
  /** mie modifiche rimaste senza effetto: il record (o quello a cui era agganciato) è stato eliminato da altri */
  dropped: Dropped[];
}

const copy = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData;

export function labelOf(data: AppData, t: RecordKind, id: string): string {
  if (t === 'node') return data.nodes.find((n) => n.id === id)?.name ?? '';
  if (t === 'person') return data.people.find((p) => p.id === id)?.name ?? '';
  if (t === 'note') return data.notes.find((n) => n.id === id)?.title ?? '';
  const a = data.absences.find((x) => x.id === id);
  if (!a) return '';
  const who = a.personId === null ? 'Chiusura aziendale' : (data.people.find((p) => p.id === a.personId)?.name ?? '');
  return `${who} ${a.start}…${a.end}`.trim();
}

/**
 * Riferimenti rotti dopo l'unione (un altro ha eliminato il ramo, la persona o l'attività):
 * - un record che esisteva già torna agganciato dov'era nella versione remota;
 * - un record aggiunto da me sotto qualcosa che non c'è più si toglie (con il suo ramo).
 * Restituisce i record tolti.
 */
function repairRefs(data: AppData, remote: AppData): Array<{ t: RecordKind; id: string }> {
  const gone: Array<{ t: RecordKind; id: string }> = [];
  const remoteNode = new Map(remote.nodes.map((n) => [n.id, n]));
  const remoteNote = new Map(remote.notes.map((n) => [n.id, n]));
  const remoteAbsence = new Map(remote.absences.map((a) => [a.id, a]));

  for (let changed = true; changed; ) {
    changed = false;
    const ids = new Set(data.nodes.map((n) => n.id));
    const next = [];
    for (const n of data.nodes) {
      if (n.parentId === null || ids.has(n.parentId)) {
        next.push(n);
        continue;
      }
      const was = remoteNode.get(n.id);
      if (was && (was.parentId === null || ids.has(was.parentId))) {
        next.push({ ...n, parentId: was.parentId });
      } else {
        gone.push({ t: 'node', id: n.id });
        changed = true;
      }
    }
    data.nodes = next;
  }

  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const personIds = new Set(data.people.map((p) => p.id));
  data.notes = data.notes.flatMap((n) => {
    if (nodeIds.has(n.nodeId)) return [n];
    const was = remoteNote.get(n.id);
    if (was && nodeIds.has(was.nodeId)) return [{ ...n, nodeId: was.nodeId }];
    gone.push({ t: 'note', id: n.id });
    return [];
  });
  data.absences = data.absences.flatMap((a) => {
    // una chiusura aziendale non ha una persona a cui agganciarsi: resta sempre
    if (a.personId === null || personIds.has(a.personId)) return [a];
    const was = remoteAbsence.get(a.id);
    if (was && was.personId !== null && personIds.has(was.personId)) return [{ ...a, personId: was.personId }];
    gone.push({ t: 'absence', id: a.id });
    return [];
  });
  data.nodes = data.nodes.map((n) => (n.assigneeId && !personIds.has(n.assigneeId) ? { ...n, assigneeId: null } : n));
  return gone;
}

export function rebase(base: AppData, local: AppData, remote: AppData): RebaseResult {
  const mine = diffOps(base, local);
  const theirs = diffOps(base, remote);
  const data = copy(remote);
  applyOps(data, mine);

  const dropped: Dropped[] = [];
  const seen = new Set<string>();
  const report = (t: RecordKind, id: string) => {
    if (seen.has(keyOf(t, id))) return;
    seen.add(keyOf(t, id));
    dropped.push({ t, id, label: labelOf(local, t, id) });
  };
  const exists = (t: RecordKind, id: string) => (data[KINDS[t]] as Array<{ id: string }>).some((r) => r.id === id);

  // modifiche a record che un altro ha eliminato: non hanno più dove andare
  for (const o of mine) if (o.op === 'set' && !exists(o.t, o.id)) report(o.t, o.id);
  // record aggiunti o spostati da me sotto qualcosa che un altro ha eliminato
  const touched = new Set(mine.flatMap((o) => (o.op === 'add' ? [keyOf(o.t, o.rec.id)] : o.op === 'set' ? [keyOf(o.t, o.id)] : [])));
  for (const g of repairRefs(data, remote)) if (touched.has(keyOf(g.t, g.id))) report(g.t, g.id);

  return { data, mine, theirs, dropped };
}

// ---------------------------------------------------------------- messaggio del commit

const clip = (s: string, max = 60) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/**
 * Descrizione breve di un salvataggio per la cronologia di GitHub, per esempio
 * «Gantt: Modifica: attività «Montaggio»» oppure «Gantt: Modifiche: 3 attività, 1 nota».
 */
export function describeChanges(ops: Op[], before: AppData, after: AppData, lang: Lang): string {
  const tr = (key: string, vars?: Record<string, string | number>) => translate(lang, key as TKey, vars);
  const touched = new Map<string, { t: RecordKind; id: string; op: 'add' | 'set' | 'del' }>();
  for (const o of ops) {
    if (o.op === 'order' || o.op === 'replace') continue;
    const id = o.op === 'add' ? o.rec.id : o.id;
    if (!touched.has(keyOf(o.t, id))) touched.set(keyOf(o.t, id), { t: o.t, id, op: o.op });
  }
  // i nodi radice sono i progetti
  const kindOf = (t: RecordKind, id: string) => {
    if (t !== 'node') return t;
    const n = after.nodes.find((x) => x.id === id) ?? before.nodes.find((x) => x.id === id);
    return n && n.parentId === null ? 'project' : 'node';
  };
  const list = [...touched.values()];
  if (!list.length) return `Gantt: ${tr('gh.msg.set')}: ${tr('gh.msg.order')}`;
  if (list.length === 1) {
    const x = list[0];
    const label = labelOf(x.op === 'del' ? before : after, x.t, x.id) || '…';
    return `Gantt: ${tr(`gh.msg.${x.op}`)}: ${tr(`gh.kind.${kindOf(x.t, x.id)}.1`)} «${clip(label)}»`;
  }
  const counts = new Map<string, number>();
  for (const x of list) {
    const k = kindOf(x.t, x.id);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = ['project', 'node', 'note', 'person', 'absence']
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${tr(`gh.kind.${k}.${counts.get(k) === 1 ? '1' : 'n'}`)}`);
  return `Gantt: ${tr('gh.msg.many')}: ${parts.join(', ')}`;
}
