import type { Note, TaskNode } from '../types';

/**
 * Le note sono testo formattato (grassetto, corsivo, elenchi) salvato come HTML.
 * Prima di mostrarlo o di salvarlo si tiene solo un elenco chiuso di tag e attributi:
 * un file di dati modificato a mano o un incolla da una pagina web non possono
 * introdurre script o contenuti esterni.
 */
const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'PRE', 'A',
]);

/** questi tag spariscono con tutto quello che contengono, non solo con l'involucro */
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'FORM']);

function cleanElement(el: Element) {
  if (DROP_TAGS.has(el.tagName)) {
    el.parentNode?.removeChild(el);
    return;
  }

  for (const child of Array.from(el.children)) cleanElement(child);

  if (!ALLOWED_TAGS.has(el.tagName)) {
    // tag non ammesso: si conserva il contenuto e si butta l'involucro
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }

  for (const attr of Array.from(el.attributes)) {
    const keepHref = el.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value.trim());
    if (!keepHref) el.removeAttribute(attr.name);
  }
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const el of Array.from(doc.body.children)) cleanElement(el);
  return doc.body.innerHTML.trim();
}

/** testo semplice: serve per la ricerca, l'anteprima e l'esportazione */
export function plainText(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const doc = new DOMParser().parseFromString(
    `<body>${html.replace(/<\/(p|div|li|h[1-4]|blockquote)>/gi, '$& ').replace(/<br\s*\/?>/gi, ' ')}</body>`,
    'text/html',
  );
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function noteExcerpt(note: Note, max = 160): string {
  const text = plainText(note.body);
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export function notesOf(notes: Note[], nodeId: string): Note[] {
  return notes
    .filter((n) => n.nodeId === nodeId)
    .sort((a, b) => (a.pinned === b.pinned ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.pinned ? -1 : 1));
}

export function noteCounts(notes: Note[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of notes) out[n.nodeId] = (out[n.nodeId] ?? 0) + 1;
  return out;
}

/** conteggio comprensivo delle sotto-attività, per il riepilogo di progetto */
export function noteCountsDeep(notes: Note[], nodes: TaskNode[]): Record<string, number> {
  const direct = noteCounts(notes);
  const parentOf: Record<string, string | null> = {};
  for (const n of nodes) parentOf[n.id] = n.parentId;
  const out: Record<string, number> = {};
  for (const [nodeId, count] of Object.entries(direct)) {
    let cur: string | null = nodeId;
    let guard = 0;
    while (cur && guard++ < 100) {
      out[cur] = (out[cur] ?? 0) + count;
      cur = parentOf[cur] ?? null;
    }
  }
  return out;
}

export function allTags(notes: Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) for (const t of n.tags) if (t.trim()) set.add(t.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]+/)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

/** data e ora leggibili, uguali in italiano e tedesco (gg.mm.aaaa hh:mm) */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** solo la parte data in formato ISO, per i filtri per periodo */
export function isoDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
