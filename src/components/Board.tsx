import React from 'react';
import { Gantt, dayWidth, ganttRange, type GanttRow, type Scale } from './Gantt';
import { TreeGrid } from './TreeGrid';
import { NotesPanel } from './Notes';
import { ColorPicker } from './ColorPicker';
import { fmtHours, useCanEdit, useOthers, useT } from '../ui';
import type { Presence } from '../utils/api';
import {
  addNode,
  deleteNode,
  indentNode,
  moveNode,
  outdentNode,
  pageZoom,
  resetColWidths,
  setArchived,
  setCollapsedAll,
  setUi,
  toggleCollapsed,
  updateNode,
  updateNodes,
  useStore,
} from '../store';
import type { Status, TaskNode } from '../types';
import { STATUSES } from '../types';
import { ancestorIds, computeAll, flatten, pathOf } from '../utils/tree';
import { diffDays, todayISO } from '../utils/dates';
import { projectColors } from '../utils/projectColors';
import { translate, type TKey } from '../i18n';

export interface BoardFocus {
  id: string;
  /** cambia a ogni richiesta, anche sulla stessa riga */
  n: number;
}

interface Props {
  /** progetto da mostrare; null = tutti i progetti non archiviati (pagina iniziale) */
  rootId: string | null;
  /** altezza fissa del riquadro: serve quando il tabellone vive dentro una scheda */
  height?: number;
  /** pulsante Archivia: solo nella schermata Progetto */
  showArchive?: boolean;
  /** riga da mettere in evidenza (arriva dal calendario o dalle scadenze) */
  focus?: BoardFocus | null;
}

/**
 * Tabella tipo Excel + Gantt trascinabile.
 * È lo stesso tabellone nella schermata Progetto (un progetto solo) e nella
 * pagina iniziale (tutti i progetti non archiviati, con i rami apribili).
 */
export function Board({ rootId, height, showArchive = false, focus = null }: Props) {
  const { data, ui } = useStore();
  const { t, lang } = useT();
  const canEdit = useCanEdit();
  const [selectedId, setSelectedId] = React.useState<string | null>(rootId);
  const [search, setSearch] = React.useState('');
  const [fStatus, setFStatus] = React.useState<'' | Status>('');
  const [fPerson, setFPerson] = React.useState('');
  const [notesFor, setNotesFor] = React.useState<string | null>(null);
  const { rowHeight, dayWidth: dayFactor } = ui.chart;
  const colorOf = React.useMemo(() => projectColors(data.nodes), [data.nodes]);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const ganttRef = React.useRef<HTMLDivElement | null>(null);
  const lock = React.useRef(false);
  const others = useOthers();
  const editedBy = React.useMemo(() => {
    const m: Record<string, Presence> = {};
    for (const p of others) if (p.node) m[p.node] = p;
    return m;
  }, [others]);

  React.useEffect(() => {
    setSelectedId(rootId);
  }, [rootId]);

  const computed = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const archivedRoots = React.useMemo(
    () => new Set(data.nodes.filter((n) => n.parentId === null && n.archived).map((n) => n.id)),
    [data.nodes],
  );
  const allRows = React.useMemo(() => {
    if (rootId) return flatten(data.nodes, computed, rootId);
    // pagina iniziale: tutti i progetti, tranne quelli archiviati
    return flatten(data.nodes, computed).filter((r) => !archivedRoots.has(r.computed.rootId));
  }, [data.nodes, computed, rootId, archivedRoots]);

  const filterActive = !!(search.trim() || fStatus || fPerson);
  const rows = React.useMemo(() => {
    if (!filterActive) return allRows.filter((r) => r.visible);
    const q = search.trim().toLowerCase();
    const keep = new Set<string>();
    for (const r of allRows) {
      const n = r.node;
      const okText = !q || n.name.toLowerCase().includes(q);
      const okStatus = !fStatus || r.computed.status === fStatus;
      const okPerson = !fPerson || n.assigneeId === fPerson;
      if (okText && okStatus && okPerson) {
        keep.add(n.id);
        for (const a of ancestorIds(data.nodes, n.id)) keep.add(a);
      }
    }
    return allRows.filter((r) => keep.has(r.node.id));
  }, [allRows, filterActive, search, fStatus, fPerson, data.nodes]);

  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;

  const peopleById = React.useMemo(() => Object.fromEntries(data.people.map((p) => [p.id, p])), [data.people]);

  const noteCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of data.notes) m[n.nodeId] = (m[n.nodeId] ?? 0) + 1;
    return m;
  }, [data.notes]);
  const noteCountOf = (id: string) => noteCounts[id] ?? 0;

  // il pannello note segue la riga selezionata, così non serve riaprirlo ogni volta
  React.useEffect(() => {
    setNotesFor((cur) => (cur && selectedId ? selectedId : cur));
  }, [selectedId]);

  const ganttRows: GanttRow[] = React.useMemo(
    () =>
      rows.map((r) => {
        const p = r.node.assigneeId ? peopleById[r.node.assigneeId] : undefined;
        const parts: string[] = [];
        if (r.computed.hours) parts.push(`${fmtHours(r.computed.hours)} h`);
        if (p) parts.push(p.name);
        return {
          id: r.node.id,
          name: r.node.name,
          start: r.computed.start,
          end: r.computed.end,
          status: r.computed.status,
          summary: r.computed.hasChildren,
          progress: r.computed.progress,
          color: r.computed.hasChildren ? undefined : p?.color,
          label: parts.join(' · '),
          editable: !r.computed.hasChildren,
        };
      }),
    [rows, peopleById],
  );

  // ------------------------------------------------------------ scroll sync
  const syncFrom = (from: 'grid' | 'gantt') => (e: React.UIEvent<HTMLDivElement>) => {
    if (lock.current) {
      lock.current = false;
      return;
    }
    const src = e.currentTarget;
    const dst = from === 'grid' ? ganttRef.current : gridRef.current;
    if (dst && dst.scrollTop !== src.scrollTop) {
      lock.current = true;
      dst.scrollTop = src.scrollTop;
    }
  };

  const scrollToToday = React.useCallback(() => {
    const el = ganttRef.current;
    if (!el) return;
    const { start } = ganttRange(ganttRows, ui.scale);
    const x = diffDays(start, todayISO()) * dayWidth(ui.scale, dayFactor);
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 3), behavior: 'smooth' });
    // ganttRows cambia a ogni modifica: la funzione serve solo al click e all'apertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.scale, dayFactor]);

  React.useEffect(() => {
    const id = window.setTimeout(scrollToToday, 60);
    return () => window.clearTimeout(id);
  }, [rootId, ui.scale, scrollToToday]);

  // ------------------------------------------------------------ riga in evidenza
  React.useEffect(() => {
    if (!focus) return;
    const id = focus.id;
    const anc = ancestorIds(data.nodes, id);
    const closed = anc.filter((a) => data.nodes.find((n) => n.id === a)?.collapsed);
    if (closed.length && canEdit) {
      const patches: Record<string, Partial<TaskNode>> = {};
      for (const a of closed) patches[a] = { collapsed: false };
      updateNodes(patches, false);
    }
    setSelectedId(id);
    const timer = window.setTimeout(() => {
      const idx = rowsRef.current.findIndex((r) => r.node.id === id);
      if (idx < 0) return;
      gridRef.current?.scrollTo({ top: Math.max(0, idx * rowHeight - 60), behavior: 'smooth' });
      const start = computed[id]?.start;
      if (start && ganttRef.current) {
        const range = ganttRange(ganttRows, ui.scale);
        const x = diffDays(range.start, start) * dayWidth(ui.scale, dayFactor);
        ganttRef.current.scrollTo({ left: Math.max(0, x - ganttRef.current.clientWidth / 3), behavior: 'smooth' });
      }
    }, 90);
    return () => window.clearTimeout(timer);
    // si reagisce solo alla richiesta di evidenziare, non a ogni modifica dei dati
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // ------------------------------------------------------------ splitter
  const dragSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    // la larghezza vera: su uno schermo stretto può essere minore di quella salvata
    const startW = gridRef.current?.offsetWidth || ui.gridWidth;
    const zoom = pageZoom();
    const move = (ev: PointerEvent) => {
      const w = Math.min(1100, Math.max(220, startW + (ev.clientX - startX) / zoom));
      setUi({ gridWidth: w });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------ azioni
  const sel = selectedId ? data.nodes.find((n) => n.id === selectedId) ?? null : null;
  const root = rootId ? data.nodes.find((n) => n.id === rootId) ?? null : null;

  const addSibling = (id: string) => {
    const node = data.nodes.find((n) => n.id === id);
    if (!node) return;
    const isRoot = node.parentId === null;
    const newId = isRoot
      ? addNode(node.id, translate(lang, 'project.newTask'))
      : addNode(node.parentId, translate(lang, 'project.newTask'), id);
    setSelectedId(newId);
  };

  const addChild = (id: string) => {
    const newId = addNode(id, translate(lang, 'project.newTask'));
    updateNode(id, { collapsed: false }, false);
    setSelectedId(newId);
  };

  const remove = (id: string) => {
    const node = data.nodes.find((n) => n.id === id);
    if (!node) return;
    if (!window.confirm(translate(lang, 'project.deleteConfirm', { name: node.name }))) return;
    const idx = rows.findIndex((r) => r.node.id === id);
    deleteNode(id);
    const next = rows[idx + 1] ?? rows[idx - 1];
    setSelectedId(next ? next.node.id : rootId);
  };

  const patch = (id: string, p: Partial<TaskNode>) => updateNode(id, p);
  const onBarChange = (id: string, start: string, end: string) => updateNode(id, { start, end });

  return (
    <>
      <div className="toolbar">
        {showArchive && root?.archived && (
          <span className="chip" style={{ background: 'var(--muted)' }}>
            {t('archive.archived')}
          </span>
        )}
        <button className="btn sm" onClick={() => sel && addSibling(sel.id)} disabled={!sel || !canEdit}>
          + {t('btn.addSibling')}
        </button>
        <button className="btn sm" onClick={() => sel && addChild(sel.id)} disabled={!sel || !canEdit}>
          + {t('btn.addChild')}
        </button>
        <button
          className="btn sm danger"
          onClick={() => sel && remove(sel.id)}
          disabled={!sel || sel.parentId === null || !canEdit}
        >
          {t('btn.delete')}
        </button>
        <span className="sep" />
        <button
          className="btn sm"
          onClick={() => sel && outdentNode(sel.id)}
          disabled={!sel || !sel.parentId || !canEdit}
          title={t('btn.outdent') + ' (Alt+←)'}
        >
          ←
        </button>
        <button
          className="btn sm"
          onClick={() => sel && indentNode(sel.id)}
          disabled={!sel || !sel.parentId || !canEdit}
          title={t('btn.indent') + ' (Alt+→)'}
        >
          →
        </button>
        <button
          className="btn sm"
          onClick={() => sel && moveNode(sel.id, -1)}
          disabled={!sel || !canEdit}
          title={t('btn.up')}
        >
          ↑
        </button>
        <button
          className="btn sm"
          onClick={() => sel && moveNode(sel.id, 1)}
          disabled={!sel || !canEdit}
          title={t('btn.down')}
        >
          ↓
        </button>
        <span className="sep" />
        <button
          className={'btn sm' + (notesFor ? ' primary' : '')}
          onClick={() => setNotesFor((v) => (v ? null : (selectedId ?? rootId)))}
          disabled={!sel}
          title={t('notes.open')}
        >
          {t('notes.open')}
          {sel && noteCountOf(sel.id) > 0 ? ` (${noteCountOf(sel.id)})` : ''}
        </button>
        <span className="sep" />
        <button className="btn sm" onClick={() => setCollapsedAll(rootId, false)}>
          {t('btn.expandAll')}
        </button>
        <button className="btn sm" onClick={() => setCollapsedAll(rootId, true)}>
          {t('btn.collapseAll')}
        </button>
        <span className="sep" />
        <input
          type="text"
          placeholder={t('project.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 130 }}
        />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value as Status | '')}>
          <option value="">{t('project.filterStatus')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {translate(lang, `status.${s}` as TKey)}
            </option>
          ))}
        </select>
        <select value={fPerson} onChange={(e) => setFPerson(e.target.value)}>
          <option value="">{t('project.filterPerson')}</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn sm" onClick={resetColWidths} title={t('col.resizeHint')}>
          {t('col.resetWidth')}
        </button>
        {showArchive && root && (
          <ColorPicker
            title={t('project.colorOf', { name: root.name })}
            label={t('project.color')}
            value={colorOf[root.id]}
            isCustom={!!root.color}
            disabled={!canEdit}
            onChange={(color) => updateNode(root.id, { color })}
            onReset={() => updateNode(root.id, { color: null })}
          />
        )}
        {showArchive && root && (
          <button
            className="btn sm"
            disabled={!canEdit}
            title={root.archived ? t('btn.restore') : t('archive.hint')}
            onClick={() => setArchived(root.id, !root.archived)}
          >
            {root.archived ? t('btn.restore') : t('btn.archive')}
          </button>
        )}
        <select value={ui.scale} onChange={(e) => setUi({ scale: e.target.value as Scale })}>
          <option value="day">{t('scale.day')}</option>
          <option value="week">{t('scale.week')}</option>
          <option value="month">{t('scale.month')}</option>
        </select>
        <button className="btn sm" onClick={scrollToToday}>
          {t('btn.today')}
        </button>
      </div>

      <div
        className="split"
        style={
          {
            '--row-h': `${rowHeight}px`,
            ...(height ? { height, flex: '0 0 auto' } : null),
          } as React.CSSProperties
        }
      >
        <TreeGrid
          rows={rows}
          people={data.people}
          notes={data.notes}
          lang={lang}
          rowHeight={rowHeight}
          projectColors={colorOf}
          selectedId={selectedId}
          widths={ui.colWidths}
          onSelect={setSelectedId}
          onToggle={toggleCollapsed}
          onPatch={patch}
          onAddSibling={addSibling}
          onAddChild={addChild}
          onIndent={indentNode}
          onOutdent={outdentNode}
          onOpenNotes={(id) => {
            setSelectedId(id);
            setNotesFor(id);
          }}
          scrollRef={gridRef as React.RefObject<HTMLDivElement>}
          onScroll={syncFrom('grid')}
          width={ui.gridWidth}
          editedBy={editedBy}
        />
        <div className="splitter" onPointerDown={dragSplit} />
        <Gantt
          rows={ganttRows}
          scale={ui.scale}
          lang={lang}
          rowHeight={rowHeight}
          dayFactor={dayFactor}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChangeDates={onBarChange}
          scrollRef={ganttRef as React.RefObject<HTMLDivElement>}
          onScroll={syncFrom('gantt')}
        />
        {notesFor && (
          <aside className="notes-drawer">
            <div className="notes-drawer-head">
              <span className="path" title={pathOf(data.nodes, notesFor).filter(Boolean).join(' › ')}>
                {pathOf(data.nodes, notesFor).filter(Boolean).join(' › ')}
              </span>
              <button className="btn sm" onClick={() => setNotesFor(null)} title={t('btn.close')}>
                ✕
              </button>
            </div>
            <NotesPanel nodeId={notesFor} notes={data.notes} nodes={data.nodes} lang={lang} />
          </aside>
        )}
      </div>
      <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
        <span className="hint">{t('gantt.hint')}</span>
        <span style={{ flex: 1 }} />
        <span className="hint">{t('shortcut.title')}</span>
        <span className="hint">
          {rows.length} {t('project.rows')}
        </span>
      </div>
    </>
  );
}
