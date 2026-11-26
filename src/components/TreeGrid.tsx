import React from 'react';
import type { ColKey, Lang, Note, Person, Status, TaskNode } from '../types';
import { STATUSES } from '../types';
import type { FlatRow } from '../utils/tree';
import { STATUS_COLORS } from '../utils/tree';
import { formatDate, parseUserDate } from '../utils/dates';
import { translate, type TKey } from '../i18n';
import { Avatar, fmtHours } from '../ui';
import { reportPresence, setColWidth } from '../store';
import type { Presence } from '../utils/api';

interface Col {
  key: ColKey;
  label: TKey;
  width: number;
  align?: 'right';
  min: number;
}

export const COLS: Col[] = [
  { key: 'name', label: 'col.name', width: 270, min: 120 },
  { key: 'status', label: 'col.status', width: 104, min: 70 },
  { key: 'start', label: 'col.start', width: 88, min: 64 },
  { key: 'end', label: 'col.end', width: 88, min: 64 },
  { key: 'hours', label: 'col.hours', width: 70, align: 'right', min: 52 },
  { key: 'days', label: 'col.days', width: 56, align: 'right', min: 44 },
  { key: 'assignee', label: 'col.assignee', width: 132, min: 80 },
  { key: 'notes', label: 'col.notes', width: 58, align: 'right', min: 44 },
];

export const GRID_TOTAL_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

/** misura il testo con lo stesso carattere della tabella: serve per adattare le colonne */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

interface Props {
  rows: FlatRow[];
  people: Person[];
  notes: Note[];
  lang: Lang;
  rowHeight: number;
  selectedId: string | null;
  widths: Partial<Record<ColKey, number>>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onPatch: (id: string, patch: Partial<TaskNode>) => void;
  onAddSibling: (id: string) => void;
  onAddChild: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onOpenNotes: (id: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  width: number;
  /** righe che altri utenti stanno modificando in questo momento */
  editedBy?: Record<string, Presence>;
}

export function TreeGrid({
  rows,
  people,
  notes,
  lang,
  rowHeight,
  selectedId,
  widths,
  onSelect,
  onToggle,
  onPatch,
  onAddSibling,
  onAddChild,
  onIndent,
  onOutdent,
  onOpenNotes,
  scrollRef,
  onScroll,
  width,
  editedBy = {},
}: Props) {
  const [col, setCol] = React.useState<ColKey>('name');
  const [editing, setEditing] = React.useState<{ id: string; col: ColKey } | null>(null);

  // gli altri vedono quale riga si sta modificando (bordo colorato con il nome)
  React.useEffect(() => {
    reportPresence({ node: editing?.id ?? null, field: editing?.col ?? null });
  }, [editing?.id, editing?.col]);
  const [draft, setDraft] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const tableRef = React.useRef<HTMLTableElement | null>(null);

  const t = (k: TKey) => translate(lang, k);
  const rowIndex = rows.findIndex((r) => r.node.id === selectedId);
  const peopleById = React.useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const noteCount = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) m[n.nodeId] = (m[n.nodeId] ?? 0) + 1;
    return m;
  }, [notes]);

  const widthOf = (c: Col) => widths[c.key] ?? c.width;
  const totalWidth = COLS.reduce((s, c) => s + widthOf(c), 0);

  // ------------------------------------------------------------ larghezza colonne
  const dragWidth = (c: Col) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const move = (ev: PointerEvent) => setColWidth(c.key, Math.max(c.min, startW + ev.clientX - startX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** doppio clic sul bordo: la colonna prende la larghezza del contenuto più lungo */
  const autoFit = (c: Col) => {
    const table = tableRef.current;
    if (!table) return;
    const font = getComputedStyle(table).font || '13px Segoe UI';
    let max = textWidth(t(c.label), font) + 8;
    for (const row of rows) {
      const text = cellText(row, c.key, lang, peopleById, noteCount);
      const indent = c.key === 'name' ? row.computed.depth * 14 + 30 : 0;
      max = Math.max(max, textWidth(text, font) + indent);
    }
    setColWidth(c.key, Math.min(600, Math.ceil(max) + 20));
  };

  // ------------------------------------------------------------ modifica celle
  const isEditable = (row: FlatRow, c: ColKey): boolean => {
    if (c === 'days' || c === 'notes') return false;
    if (row.computed.hasChildren && (c === 'status' || c === 'start' || c === 'end' || c === 'hours')) return false;
    return true;
  };

  const startEdit = (row: FlatRow, c: ColKey) => {
    if (!isEditable(row, c)) return;
    const n = row.node;
    let value = '';
    switch (c) {
      case 'name':
        value = n.name;
        break;
      case 'start':
        value = n.start ? formatDate(n.start, lang) : '';
        break;
      case 'end':
        value = n.end ? formatDate(n.end, lang) : '';
        break;
      case 'hours':
        // si modifica con la virgola, come viene mostrato (in scrittura si accetta anche il punto)
        value = n.hours != null ? String(n.hours).replace('.', ',') : '';
        break;
      default:
        value = '';
    }
    setDraft(value);
    setEditing({ id: n.id, col: c });
  };

  const commit = (row: FlatRow, c: ColKey, raw: string) => {
    const n = row.node;
    const patch: Partial<TaskNode> = {};
    switch (c) {
      case 'name':
        patch.name = raw.trim() || n.name;
        break;
      case 'hours': {
        const v = raw.replace(',', '.').trim();
        if (v === '') {
          patch.hours = null;
          break;
        }
        const num = Number(v);
        if (!Number.isFinite(num)) break; // testo non numerico: si tiene il valore precedente
        patch.hours = Math.max(0, num);
        break;
      }
      case 'start': {
        const iso = parseUserDate(raw);
        // testo non vuoto ma non interpretabile: si tiene il valore precedente
        if (!iso && raw.trim() !== '') break;
        patch.start = iso;
        if (iso) {
          if (!n.end) patch.end = iso;
          else if (n.end < iso) patch.end = iso;
        }
        break;
      }
      case 'end': {
        const iso = parseUserDate(raw);
        if (!iso && raw.trim() !== '') break;
        patch.end = iso;
        if (iso) {
          if (!n.start) patch.start = iso;
          else if (n.start > iso) patch.start = iso;
        }
        break;
      }
      default:
        break;
    }
    setEditing(null);
    if (Object.keys(patch).length) onPatch(n.id, patch);
    containerRef.current?.focus();
  };

  const moveSel = (dRow: number, dCol: number) => {
    const ci = COLS.findIndex((c) => c.key === col);
    if (dCol) {
      const next = Math.min(COLS.length - 1, Math.max(0, ci + dCol));
      setCol(COLS[next].key);
    }
    if (dRow) {
      const ri = Math.min(rows.length - 1, Math.max(0, (rowIndex < 0 ? 0 : rowIndex) + dRow));
      if (rows[ri]) onSelect(rows[ri].node.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    const row = rows[rowIndex];
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveSel(1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSel(-1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.altKey && row) onIndent(row.node.id);
        else moveSel(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.altKey && row) onOutdent(row.node.id);
        else moveSel(0, -1);
        break;
      case 'Tab':
        e.preventDefault();
        moveSel(0, e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (!row) break;
        if (mod && e.shiftKey) onAddChild(row.node.id);
        else if (mod) onAddSibling(row.node.id);
        else startEdit(row, col);
        break;
      case 'F2':
        e.preventDefault();
        if (row) startEdit(row, col);
        break;
      case 'Delete':
      case 'Backspace':
        if (row && isEditable(row, col)) {
          e.preventDefault();
          if (col === 'start') onPatch(row.node.id, { start: null });
          else if (col === 'end') onPatch(row.node.id, { end: null });
          else if (col === 'hours') onPatch(row.node.id, { hours: null });
          else if (col === 'assignee') onPatch(row.node.id, { assigneeId: null });
        }
        break;
      default:
        if (row && e.key.length === 1 && !mod && !e.altKey && isEditable(row, col)) {
          if (col === 'name' || col === 'hours' || col === 'start' || col === 'end') {
            e.preventDefault();
            setDraft(e.key);
            setEditing({ id: row.node.id, col });
          }
        }
    }
  };

  const editKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: FlatRow, c: ColKey) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(row, c, (e.target as HTMLInputElement).value);
      moveSel(1, 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
      containerRef.current?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit(row, c, (e.target as HTMLInputElement).value);
      moveSel(0, e.shiftKey ? -1 : 1);
    }
  };

  const renderCell = (row: FlatRow, c: ColKey) => {
    const n = row.node;
    const cp = row.computed;
    const editingHere = editing && editing.id === n.id && editing.col === c;
    const derived = cp.hasChildren && (c === 'start' || c === 'end' || c === 'hours' || c === 'status' || c === 'days');

    if (editingHere && c !== 'status' && c !== 'assignee') {
      return (
        <input
          className="cell-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(row, c, e.target.value)}
          onKeyDown={(e) => editKeyDown(e, row, c)}
        />
      );
    }

    switch (c) {
      case 'name':
        return (
          <div className="name-wrap" style={{ paddingLeft: cp.depth * 14 }}>
            {cp.hasChildren ? (
              <button
                className="twisty"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onToggle(n.id);
                }}
                title={n.collapsed ? '+' : '−'}
              >
                {n.collapsed ? '▶' : '▼'}
              </button>
            ) : (
              <span style={{ width: 14, flex: '0 0 14px' }} />
            )}
            <span className="dot" style={{ background: STATUS_COLORS[cp.status] }} />
            <span className="name-text" onDoubleClick={() => startEdit(row, 'name')}>
              {n.name}
            </span>
            {cp.overrun && (
              <span className="warn" title={translate(lang, 'project.overrun')}>
                !
              </span>
            )}
          </div>
        );
      case 'status':
        if (derived)
          return (
            <span className="chip" style={{ background: STATUS_COLORS[cp.status], opacity: 0.75 }}>
              {translate(lang, `status.${cp.status}` as TKey)}
            </span>
          );
        return (
          <select
            className="cell-select"
            value={n.status}
            onChange={(e) => onPatch(n.id, { status: e.target.value as Status })}
            onClick={(e) => e.stopPropagation()}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {translate(lang, `status.${s}` as TKey)}
              </option>
            ))}
          </select>
        );
      case 'start':
        return formatDate(cp.start, lang);
      case 'end':
        return formatDate(cp.end, lang);
      case 'hours':
        return cp.hours ? fmtHours(cp.hours) : derived ? '' : n.hours != null ? fmtHours(n.hours) : '';
      case 'days':
        return cp.workDays || '';
      case 'notes': {
        const count = noteCount[n.id] ?? 0;
        return (
          <button
            className={'note-badge' + (count ? ' has' : '')}
            title={translate(lang, 'notes.open')}
            onClick={(e) => {
              e.stopPropagation();
              onOpenNotes(n.id);
            }}
          >
            {count || '+'}
          </button>
        );
      }
      case 'assignee': {
        const p = n.assigneeId ? peopleById[n.assigneeId] : undefined;
        return (
          <select
            className="cell-select"
            value={n.assigneeId ?? ''}
            onChange={(e) => onPatch(n.id, { assigneeId: e.target.value || null })}
            onClick={(e) => e.stopPropagation()}
            style={{ color: p ? undefined : 'var(--muted)' }}
          >
            <option value="">{t('common.none')}</option>
            {people.map((pp) => (
              <option key={pp.id} value={pp.id}>
                {pp.name}
              </option>
            ))}
          </select>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div
      className="grid-pane"
      style={{ width, flexBasis: width }}
      ref={(el) => {
        containerRef.current = el;
        if (scrollRef) (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      onScroll={onScroll}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <table className="grid" style={{ width: totalWidth }} ref={tableRef}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left' }} title={t(c.label)}>
                <span className="th-label">{t(c.label)}</span>
                <span
                  className="col-resize"
                  title={translate(lang, 'col.resizeHint')}
                  onPointerDown={dragWidth(c)}
                  onDoubleClick={() => autoFit(c)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sel = row.node.id === selectedId;
            const cp = row.computed;
            const other = editedBy[row.node.id];
            return (
              <tr
                key={row.node.id}
                className={
                  `lvl${Math.min(cp.depth, 2)}` +
                  (sel ? ' sel-row' : '') +
                  (cp.status === 'CANCELLED' ? ' cancelled' : '')
                }
                style={{ height: rowHeight, boxShadow: other ? `inset 3px 0 0 ${other.color}` : undefined }}
                title={other ? translate(lang, 'presence.editingRow', { user: other.user }) : undefined}
                onMouseDown={() => onSelect(row.node.id)}
              >
                {COLS.map((c) => {
                  const derived =
                    cp.hasChildren && (c.key === 'start' || c.key === 'end' || c.key === 'hours' || c.key === 'status');
                  return (
                    <td
                      key={c.key}
                      className={
                        (c.align === 'right' || c.key === 'days' ? 'num ' : '') +
                        (derived ? 'derived ' : '') +
                        (c.key === 'name' ? 'name-cell ' : '') +
                        (sel && col === c.key ? 'sel' : '')
                      }
                      title={derived ? translate(lang, 'project.derived') : undefined}
                      onMouseDown={() => setCol(c.key)}
                      onDoubleClick={() => startEdit(row, c.key)}
                    >
                      {renderCell(row, c.key)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLS.length} style={{ color: 'var(--muted)', padding: 12 }}>
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** testo mostrato in una cella: usato per adattare la larghezza delle colonne */
function cellText(
  row: FlatRow,
  key: ColKey,
  lang: Lang,
  peopleById: Record<string, Person>,
  noteCount: Record<string, number>,
): string {
  const { node, computed } = row;
  switch (key) {
    case 'name':
      return node.name;
    case 'status':
      return translate(lang, `status.${computed.status}` as TKey);
    case 'start':
      return formatDate(computed.start, lang);
    case 'end':
      return formatDate(computed.end, lang);
    case 'hours':
      return computed.hours ? fmtHours(computed.hours) : '';
    case 'days':
      return String(computed.workDays || '');
    case 'assignee':
      return node.assigneeId ? (peopleById[node.assigneeId]?.name ?? '') : '';
    case 'notes':
      return String(noteCount[node.id] ?? '');
    default:
      return '';
  }
}

/** avatar riutilizzabile per la colonna responsabile in altre viste */
export function PersonCell({ person }: { person?: Person }) {
  return (
    <span className="person-line">
      <Avatar person={person} size={18} />
      <span>{person?.name ?? '—'}</span>
    </span>
  );
}
