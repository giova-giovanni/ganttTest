// Operazioni sui dati di Gantt Planner: lo STESSO codice nel browser (src/) e nel server (server/),
// così i due lati applicano le modifiche nello stesso identico modo.
//
// Un'operazione descrive una modifica a un record:
//   { op: 'add',     t: 'node', rec: {...} }                    nuovo record (un nodo va in fondo al suo genitore)
//   { op: 'set',     t: 'node', id, set: {hours: 20}, prev: {hours: 16} }   campi cambiati (prev = valori visti prima)
//   { op: 'del',     t: 'node', id }                            record eliminato
//   { op: 'order',   t: 'node', parent: id|null, ids: [...] }   ordine dei figli di un genitore
//   { op: 'replace', data: {...} }                              tutto l'archivio (solo amministratore)
//
// Tipi di record: node (progetti/rami/attività), person, absence, note.

export const KINDS = { node: 'nodes', person: 'people', absence: 'absences', note: 'notes' };

/** campi condivisi; quelli non elencati restano nel browser (es. «collapsed»: rami aperti/chiusi) */
export const FIELDS = {
  node: ['parentId', 'name', 'status', 'start', 'end', 'hours', 'assigneeId', 'notes', 'archived'],
  person: ['name', 'role', 'color', 'hoursPerDay'],
  absence: ['personId', 'start', 'end', 'type', 'note'],
  note: ['nodeId', 'title', 'body', 'tags', 'author', 'createdAt', 'updatedAt', 'pinned'],
};

export const keyOf = (t, id) => `${t}:${id}`;

const listOf = (data, t) => data[KINDS[t]];
const parentOf = (n) => n.parentId ?? null;

export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return (a ?? null) === (b ?? null);
}

/** solo i campi condivisi di un record (più l'id) */
export function pick(t, rec) {
  const out = { id: rec.id };
  for (const f of FIELDS[t]) out[f] = rec[f] ?? (f === 'tags' ? [] : null);
  return out;
}

/** posizione subito dopo l'ultimo discendente di `parentId`: lì va un nuovo ultimo figlio */
function endOfBranch(nodes, parentId) {
  if (parentId === null) return nodes.length;
  let last = nodes.findIndex((n) => n.id === parentId);
  if (last < 0) return nodes.length;
  const branch = new Set([parentId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nodes) {
      if (!branch.has(n.id) && n.parentId && branch.has(n.parentId)) {
        branch.add(n.id);
        grew = true;
      }
    }
  }
  nodes.forEach((n, i) => {
    if (branch.has(n.id)) last = Math.max(last, i);
  });
  return last + 1;
}

/** riordina i figli di un genitore secondo `ids`; i figli non elencati restano in coda */
function reorder(nodes, parentId, ids) {
  const slots = [];
  const children = [];
  nodes.forEach((n, i) => {
    if (parentOf(n) === parentId) {
      slots.push(i);
      children.push(n);
    }
  });
  const byId = new Map(children.map((n) => [n.id, n]));
  const seen = new Set();
  const ordered = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n && !seen.has(id)) {
      ordered.push(n);
      seen.add(id);
    }
  }
  for (const n of children) if (!seen.has(n.id)) ordered.push(n);
  slots.forEach((slot, k) => {
    nodes[slot] = ordered[k];
  });
}

/**
 * Applica operazioni (già controllate) ai dati, modificando le liste sul posto.
 * `keep(t, id)` può restituire i campi da NON toccare: sono le modifiche locali non ancora
 * confermate dal server, che arriveranno dopo e vinceranno comunque.
 * Restituisce le chiavi dei record toccati.
 * @param {any} data
 * @param {any[]} ops
 * @param {{ keep?: (t: string, id: string) => Set<string> | undefined }} [opts]
 */
export function applyOps(data, ops, opts = {}) {
  const keep = opts.keep;
  const touched = [];
  for (const o of ops) {
    if (o.op === 'replace') {
      for (const list of Object.values(KINDS)) data[list] = [...(o.data?.[list] ?? [])];
      touched.push('*');
      continue;
    }
    const list = listOf(data, o.t);
    if (!list) continue;
    if (o.op === 'add') {
      if (list.some((r) => r.id === o.rec.id)) continue;
      const rec = { ...o.rec };
      if (o.t === 'node') {
        if (rec.collapsed === undefined) rec.collapsed = false;
        list.splice(endOfBranch(list, parentOf(rec)), 0, rec);
      } else {
        list.push(rec);
      }
      touched.push(keyOf(o.t, rec.id));
    } else if (o.op === 'set') {
      const i = list.findIndex((r) => r.id === o.id);
      if (i < 0) continue;
      const kept = keep?.(o.t, o.id);
      const next = { ...list[i] };
      let moved = false;
      for (const [f, v] of Object.entries(o.set ?? {})) {
        if (kept?.has(f)) continue;
        if (f === 'parentId' && !same(next.parentId, v)) moved = true;
        next[f] = v;
      }
      if (moved) {
        // cambio di genitore: il nodo diventa l'ultimo figlio del nuovo genitore
        list.splice(i, 1);
        list.splice(endOfBranch(list, parentOf(next)), 0, next);
      } else {
        list[i] = next;
      }
      touched.push(keyOf(o.t, o.id));
    } else if (o.op === 'del') {
      const i = list.findIndex((r) => r.id === o.id);
      if (i >= 0) {
        list.splice(i, 1);
        touched.push(keyOf(o.t, o.id));
      }
    } else if (o.op === 'order' && o.t === 'node') {
      reorder(list, o.parent ?? null, Array.isArray(o.ids) ? o.ids : []);
    }
  }
  return touched;
}

const cloneLists = (data) => ({
  nodes: data.nodes.map((n) => ({ ...n })),
  people: data.people.map((p) => ({ ...p })),
  absences: data.absences.map((a) => ({ ...a })),
  notes: data.notes.map((n) => ({ ...n })),
});

const childIds = (nodes, parentId) => nodes.filter((n) => parentOf(n) === parentId).map((n) => n.id);

/**
 * Confronta due versioni dei dati e restituisce le operazioni che portano dalla prima
 * alla seconda: è così che il browser trasforma ogni modifica in un salvataggio «per record».
 */
export function diffOps(before, after) {
  const ops = [];
  for (const t of Object.keys(KINDS)) {
    const prev = new Map(listOf(before, t).map((r) => [r.id, r]));
    const next = new Map(listOf(after, t).map((r) => [r.id, r]));
    for (const id of prev.keys()) if (!next.has(id)) ops.push({ op: 'del', t, id });
    for (const [id, rec] of next) {
      const old = prev.get(id);
      if (!old) {
        ops.push({ op: 'add', t, rec: pick(t, rec) });
        continue;
      }
      const set = {};
      const was = {};
      for (const f of FIELDS[t]) {
        if (!same(old[f], rec[f])) {
          set[f] = rec[f] ?? null;
          was[f] = old[f] ?? null;
        }
      }
      if (Object.keys(set).length) ops.push({ op: 'set', t, id, set, prev: was });
    }
  }
  // l'ordine dei figli: si simula cosa farà il server e si corregge dove non coincide
  const sim = cloneLists(before);
  applyOps(sim, ops);
  const parents = new Set(after.nodes.map(parentOf));
  for (const p of parents) {
    const want = childIds(after.nodes, p);
    if (!same(want, childIds(sim.nodes, p))) ops.push({ op: 'order', t: 'node', parent: p, ids: want });
  }
  return ops;
}

// ------------------------------------------------------------------ controlli (lato server)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 120 && !CONTROL.test(v);
const text = (max) => (v) => typeof v === 'string' && v.length <= max;
const orNull = (check) => (v) => v === null || check(v);
const oneOf = (...values) => (v) => values.includes(v);
const day = (v) => typeof v === 'string' && ISO_DAY.test(v);
const time = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const num = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const bool = (v) => typeof v === 'boolean';

const RULES = {
  node: {
    parentId: orNull(isId),
    name: text(500),
    status: oneOf('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'),
    start: orNull(day),
    end: orNull(day),
    hours: orNull(num(0, 1e6)),
    assigneeId: orNull(isId),
    notes: text(5000),
    archived: bool,
  },
  person: {
    name: text(200),
    role: text(200),
    color: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
    hoursPerDay: num(0.1, 24),
  },
  absence: {
    personId: isId,
    start: day,
    end: day,
    type: oneOf('VACATION', 'SICK', 'OTHER'),
    note: text(1000),
  },
  note: {
    nodeId: isId,
    title: text(200),
    body: text(500_000),
    tags: (v) => Array.isArray(v) && v.length <= 12 && v.every(text(60)),
    author: text(200),
    createdAt: time,
    updatedAt: time,
    pinned: bool,
  },
};

function badRecord(t, rec) {
  if (!rec || typeof rec !== 'object' || !isId(rec.id)) return 'id';
  for (const [f, ok] of Object.entries(RULES[t])) if (!ok(rec[f])) return f;
  return null;
}

/** Controlla forma e limiti di un gruppo di operazioni. null = tutto in regola. */
export function invalidOps(ops) {
  if (!Array.isArray(ops) || ops.length === 0) return 'nessuna operazione';
  if (ops.length > 50_000) return 'troppe operazioni';
  for (const o of ops) {
    if (!o || typeof o !== 'object') return 'operazione non valida';
    if (o.op === 'replace') {
      const d = o.data;
      if (!d || typeof d !== 'object') return 'replace: dati mancanti';
      for (const [t, list] of Object.entries(KINDS)) {
        if (!Array.isArray(d[list])) return `replace: ${list}`;
        for (const rec of d[list]) {
          const bad = badRecord(t, rec);
          if (bad) return `replace: ${t}.${bad}`;
        }
      }
      continue;
    }
    if (!(o.t in KINDS)) return 'tipo di record sconosciuto';
    if (o.op === 'add') {
      const bad = badRecord(o.t, o.rec);
      if (bad) return `add: ${o.t}.${bad}`;
    } else if (o.op === 'set') {
      if (!isId(o.id) || !o.set || typeof o.set !== 'object') return 'set: id o campi mancanti';
      const fields = Object.keys(o.set);
      if (!fields.length) return 'set: nessun campo';
      for (const f of fields) if (!(f in RULES[o.t]) || !RULES[o.t][f](o.set[f])) return `set: ${o.t}.${f}`;
      if (o.prev !== undefined && (typeof o.prev !== 'object' || o.prev === null)) return 'set: prev';
    } else if (o.op === 'del') {
      if (!isId(o.id)) return 'del: id';
    } else if (o.op === 'order') {
      if (o.t !== 'node' || !(o.parent === null || isId(o.parent))) return 'order: genitore';
      if (!Array.isArray(o.ids) || o.ids.length > 50_000 || !o.ids.every(isId)) return 'order: ids';
    } else {
      return 'operazione sconosciuta';
    }
  }
  return null;
}
