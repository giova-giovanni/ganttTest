import React from 'react';
import type { Note, TaskNode } from '../types';
import { addNote, deleteNote, reportPresence, toggleNotePinned, updateNote } from '../store';
import { useCanEdit, useOthers, useT } from '../ui';
import { formatDateTime, notesOf, parseTags } from '../utils/notes';
import { pathOf } from '../utils/tree';
import { translate } from '../i18n';
import type { Lang } from '../types';

/**
 * Editor di testo formattato, in stile blocco note: grassetto, corsivo,
 * sottolineato ed elenchi. Il contenuto viene ripulito prima di essere salvato.
 */
export function RichText({
  value,
  onChange,
  readOnly,
  placeholder,
  minHeight = 90,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const mine = React.useRef(value); // ultimo valore scritto da noi: evita di riscrivere il campo mentre si digita
  const timer = React.useRef<number | undefined>(undefined);
  const { t } = useT();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== mine.current && el.innerHTML !== value) {
      mine.current = value;
      el.innerHTML = value;
    }
  }, [value]);

  React.useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
    return () => window.clearTimeout(timer.current);
    // solo al montaggio: il resto lo gestisce l'effetto sopra
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const push = (immediate = false) => {
    const html = ref.current?.innerHTML ?? '';
    mine.current = html;
    window.clearTimeout(timer.current);
    if (immediate) onChange(html);
    else timer.current = window.setTimeout(() => onChange(html), 600);
  };

  /** i comandi di formattazione del browser: sono l'unico modo che funziona ovunque senza librerie */
  const cmd = (name: string) => {
    ref.current?.focus();
    document.execCommand(name, false);
    push(true);
  };

  const tools: { cmd: string; label: string; title: string; style?: React.CSSProperties }[] = [
    { cmd: 'bold', label: 'G', title: t('notes.bold'), style: { fontWeight: 800 } },
    { cmd: 'italic', label: 'C', title: t('notes.italic'), style: { fontStyle: 'italic' } },
    { cmd: 'underline', label: 'S', title: t('notes.underline'), style: { textDecoration: 'underline' } },
    { cmd: 'insertUnorderedList', label: '•—', title: t('notes.bullets') },
    { cmd: 'insertOrderedList', label: '1.', title: t('notes.numbers') },
    { cmd: 'removeFormat', label: '⌫', title: t('notes.clearFormat') },
  ];

  return (
    <div className="rt">
      {!readOnly && (
        <div className="rt-tools">
          {tools.map((b) => (
            <button
              key={b.cmd}
              type="button"
              className="rt-btn"
              title={b.title}
              style={b.style}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => cmd(b.cmd)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        className={'rt-body' + (readOnly ? ' ro' : '')}
        style={{ minHeight }}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        onInput={() => push()}
        onFocus={onFocus}
        onBlur={() => {
          push(true);
          onBlur?.();
        }}
        // l'incolla arriva come testo semplice: niente stili o immagini da altre pagine
        onPaste={(e) => {
          if (readOnly) return;
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          push();
        }}
      />
    </div>
  );
}

/** una nota, modificabile sul posto */
export function NoteCard({
  note,
  nodes,
  lang,
  showPath = false,
  pathColor,
  onGoTo,
}: {
  note: Note;
  nodes: TaskNode[];
  lang: Lang;
  showPath?: boolean;
  /** colore del progetto, mostrato accanto al percorso */
  pathColor?: string;
  onGoTo?: (nodeId: string) => void;
}) {
  const { t } = useT();
  const canWrite = useCanEdit();
  const [tagsDraft, setTagsDraft] = React.useState(note.tags.join(', '));
  React.useEffect(() => setTagsDraft(note.tags.join(', ')), [note.id, note.tags]);

  // una nota la scrive una persona alla volta: gli altri la vedono cambiare dal vivo
  const [writingHere, setWritingHere] = React.useState(false);
  const others = useOthers();
  const writer = writingHere ? undefined : others.find((p) => p.note === note.id);
  const canEdit = canWrite && !writer;
  const focusIn = () => {
    setWritingHere(true);
    reportPresence({ note: note.id });
  };
  const focusOut = () => {
    setWritingHere(false);
    reportPresence({ note: null });
  };

  const path = showPath ? pathOf(nodes, note.nodeId).filter(Boolean) : [];

  return (
    <div className={'note' + (note.pinned ? ' pinned' : '')} style={writer ? { boxShadow: `inset 3px 0 0 ${writer.color}` } : undefined}>
      {writer && <div className="hint">{t('presence.writingNote', { user: writer.user })}</div>}
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          readOnly={!canEdit}
          placeholder={t('notes.untitled')}
          onFocus={focusIn}
          onBlur={focusOut}
          onChange={(e) => updateNote(note.id, { title: e.target.value.slice(0, 200) })}
        />
        <button
          className="note-act"
          title={note.pinned ? t('notes.unpin') : t('notes.pin')}
          disabled={!canEdit}
          onClick={() => toggleNotePinned(note.id)}
        >
          {note.pinned ? '★' : '☆'}
        </button>
        <button
          className="note-act danger"
          title={t('notes.delete')}
          disabled={!canEdit}
          onClick={() => window.confirm(translate(lang, 'notes.deleteConfirm')) && deleteNote(note.id)}
        >
          ✕
        </button>
      </div>

      {showPath && path.length > 0 && (
        <button className="note-path" onClick={() => onGoTo?.(note.nodeId)} title={path.join(' › ')}>
          {pathColor && <span className="dot" style={{ background: pathColor }} />}
          {path.join(' › ')}
        </button>
      )}

      <RichText
        value={note.body}
        readOnly={!canEdit}
        placeholder={t('notes.placeholder')}
        onChange={(html) => updateNote(note.id, { body: html })}
        onFocus={focusIn}
        onBlur={focusOut}
      />

      <div className="note-foot">
        <input
          className="note-tags"
          value={tagsDraft}
          readOnly={!canEdit}
          placeholder={t('notes.tags')}
          title={t('notes.tagsHint')}
          onChange={(e) => setTagsDraft(e.target.value)}
          onBlur={() => updateNote(note.id, { tags: parseTags(tagsDraft) })}
        />
        <span className="note-meta">
          {note.author && <b>{note.author}</b>}
          <span title={t('notes.created')}>
            {t('notes.created')} {formatDateTime(note.createdAt)}
          </span>
          {note.updatedAt !== note.createdAt && (
            <span title={t('notes.updated')}>
              · {t('notes.updated')} {formatDateTime(note.updatedAt)}
            </span>
          )}
        </span>
      </div>
      {note.tags.length > 0 && (
        <div className="note-tagline">
          {note.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** elenco delle note di una singola voce (progetto, ramo o attività) */
export function NotesPanel({
  nodeId,
  notes,
  nodes,
  lang,
  title,
}: {
  nodeId: string;
  notes: Note[];
  nodes: TaskNode[];
  lang: Lang;
  title?: string;
}) {
  const { t } = useT();
  const canEdit = useCanEdit();
  const list = notesOf(notes, nodeId);

  return (
    <div className="notes-panel">
      <div className="notes-panel-head">
        <h3 style={{ margin: 0 }}>{title ?? t('notes.open')}</h3>
        <span className="hint">{list.length ? t('notes.count', { n: list.length }) : ''}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm primary" disabled={!canEdit} onClick={() => addNote(nodeId)}>
          + {t('notes.add')}
        </button>
      </div>
      {list.length === 0 && <div className="hint" style={{ padding: '6px 2px' }}>{t('notes.emptyFor')}</div>}
      {list.map((n) => (
        <NoteCard key={n.id} note={n} nodes={nodes} lang={lang} />
      ))}
      {!canEdit && <div className="hint">{t('notes.readOnly')}</div>}
    </div>
  );
}
