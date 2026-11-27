import React from 'react';
import { createPortal } from 'react-dom';
import { addNote, setUi, useStore } from '../store';
import { useCanEdit, useT } from '../ui';
import { NoteCard } from '../components/Notes';
import { NotesPrintDocument } from '../components/NotesPrint';
import { allTags, isoDay, plainText } from '../utils/notes';
import { byId, rootIdOf } from '../utils/tree';
import { addDays, formatDate, todayISO } from '../utils/dates';
import { exportNotesList } from '../utils/io';
import { pageRule, usePrintWhenReady } from '../utils/print';
import { projectColors } from '../utils/projectColors';
import type { Note } from '../types';

type SortKey = 'new' | 'old' | 'updated' | 'project';
type DateField = 'createdAt' | 'updatedAt';

/**
 * Archivio di tutte le note, con i filtri chiesti più spesso:
 * testo, progetto, autore, etichetta e periodo di creazione (o di modifica).
 */
export function NotesPage() {
  const { data, ui } = useStore();
  const { t, lang } = useT();
  const canEdit = useCanEdit();

  const [q, setQ] = React.useState('');
  const [project, setProject] = React.useState('');
  const [author, setAuthor] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [field, setField] = React.useState<DateField>('createdAt');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('new');
  const [printing, setPrinting] = React.useState(false);

  // la stampa parte quando il documento è pronto e si richiude da sola
  usePrintWhenReady(printing, () => setPrinting(false));

  const nodes = data.nodes;
  const nodeMap = React.useMemo(() => byId(nodes), [nodes]);
  const roots = nodes.filter((n) => n.parentId === null);
  const colorOf = React.useMemo(() => projectColors(nodes), [nodes]);
  const rootNameOf = React.useCallback(
    (nodeId: string) => nodeMap[rootIdOf(nodes, nodeId)]?.name ?? '',
    [nodeMap, nodes],
  );

  const authors = React.useMemo(
    () => [...new Set(data.notes.map((n) => n.author.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [data.notes],
  );
  const tags = React.useMemo(() => allTags(data.notes), [data.notes]);

  // testo cercabile calcolato una volta sola per nota
  const searchable = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of data.notes) {
      m[n.id] = `${n.title} ${plainText(n.body)} ${n.tags.join(' ')} ${n.author}`.toLowerCase();
    }
    return m;
  }, [data.notes]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = data.notes.filter((n) => {
      if (!nodeMap[n.nodeId]) return false;
      if (needle && !(searchable[n.id] ?? '').includes(needle)) return false;
      if (project && rootIdOf(nodes, n.nodeId) !== project) return false;
      if (author && n.author.trim() !== author) return false;
      if (tag && !n.tags.includes(tag)) return false;
      const day = isoDay(n[field]);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });

    const byDate = (a: Note, b: Note, key: DateField, dir: number) =>
      (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir;

    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sort) {
        case 'old':
          return byDate(a, b, 'createdAt', 1);
        case 'updated':
          return byDate(a, b, 'updatedAt', -1);
        case 'project': {
          const cmp = rootNameOf(a.nodeId).localeCompare(rootNameOf(b.nodeId));
          return cmp !== 0 ? cmp : byDate(a, b, 'createdAt', -1);
        }
        default:
          return byDate(a, b, 'createdAt', -1);
      }
    });
  }, [data.notes, nodeMap, nodes, searchable, q, project, author, tag, field, from, to, sort, rootNameOf]);

  const clear = () => {
    setQ('');
    setProject('');
    setAuthor('');
    setTag('');
    setFrom('');
    setTo('');
    setField('createdAt');
    setSort('new');
  };

  const last30 = () => {
    setField('createdAt');
    setFrom(addDays(todayISO(), -30));
    setTo('');
  };

  const goTo = (nodeId: string) => setUi({ page: 'project', selectedProjectId: rootIdOf(nodes, nodeId) });

  const target = ui.selectedProjectId ?? roots[0]?.id ?? null;

  /** riga con i filtri usati: finisce in cima al documento stampato */
  const filterLabel = React.useMemo(() => {
    const parts: string[] = [];
    if (q.trim()) parts.push(`«${q.trim()}»`);
    if (project) parts.push(nodeMap[project]?.name ?? '');
    if (author) parts.push(author);
    if (tag) parts.push(`#${tag}`);
    if (from || to) {
      const label = field === 'createdAt' ? t('notes.dateCreated') : t('notes.dateUpdated');
      parts.push(`${label} ${from ? formatDate(from, lang) : '…'} – ${to ? formatDate(to, lang) : '…'}`);
    }
    return parts.join(' · ');
  }, [q, project, author, tag, from, to, field, nodeMap, t, lang]);

  return (
    <div className="page">
      <div className="notes-head">
        <h2>{t('notes.title')}</h2>
        <span className="hint">
          {filtered.length === 1 ? t('notes.countOne') : t('notes.count', { n: filtered.length })}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          disabled={filtered.length === 0}
          title={t('notes.printHint')}
          onClick={() => setPrinting(true)}
        >
          ⎙ {t('notes.print')}
        </button>
        <button
          className="btn"
          disabled={filtered.length === 0}
          title={t('notes.exportHint')}
          onClick={() => exportNotesList(filtered, nodes, lang)}
        >
          {t('notes.export')}
        </button>
        <button
          className="btn primary"
          disabled={!canEdit || !target}
          title={target ? t('notes.addFor', { name: nodeMap[target]?.name ?? '' }) : ''}
          onClick={() => target && addNote(target)}
        >
          + {t('notes.add')}
        </button>
      </div>

      <div className="card notes-filters">
        <input type="text" placeholder={t('notes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">{t('notes.filterProject')}</option>
          {roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">{t('notes.filterAuthor')}</option>
          {authors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">{t('notes.filterTag')}</option>
          {tags.map((tg) => (
            <option key={tg} value={tg}>
              {tg}
            </option>
          ))}
        </select>

        <select value={field} onChange={(e) => setField(e.target.value as DateField)}>
          <option value="createdAt">{t('notes.dateCreated')}</option>
          <option value="updatedAt">{t('notes.dateUpdated')}</option>
        </select>
        <label className="inline">
          {t('notes.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline">
          {t('notes.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title={t('notes.sort')}>
          <option value="new">{t('notes.sortNew')}</option>
          <option value="old">{t('notes.sortOld')}</option>
          <option value="updated">{t('notes.sortUpdated')}</option>
          <option value="project">{t('notes.sortProject')}</option>
        </select>

        <button className="btn sm" onClick={last30}>
          {t('notes.quick')}
        </button>
        <button className="btn sm" onClick={clear}>
          {t('notes.clearFilters')}
        </button>
      </div>

      {filtered.length === 0 && <div className="empty">{t('notes.empty')}</div>}

      <div className="notes-list">
        {filtered.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            nodes={nodes}
            lang={lang}
            showPath
            pathColor={colorOf[rootIdOf(nodes, n.nodeId)]}
            onGoTo={goTo}
          />
        ))}
      </div>

      {printing &&
        createPortal(
          <>
            <style>{pageRule('A4', 'portrait', '14mm 12mm')}</style>
            <NotesPrintDocument notes={filtered} nodes={nodes} lang={lang} filters={filterLabel} />
          </>,
          document.body,
        )}
    </div>
  );
}
