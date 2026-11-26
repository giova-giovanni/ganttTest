import React from 'react';
import type { Lang, Note, TaskNode } from '../types';
import { translate, type TKey } from '../i18n';
import { pathOf } from '../utils/tree';
import { formatDate, todayISO } from '../utils/dates';
import { isoDay, plainText, sanitizeHtml } from '../utils/notes';

interface Group {
  key: string;
  title: string;
  notes: Note[];
}

/**
 * Le note con lo stesso titolo finiscono in un unico blocco: il titolo e la data
 * compaiono una volta sola in alto (tipico verbale di riunione con più argomenti)
 * e sotto, a punti, la voce dell'albero a cui ogni nota è agganciata.
 * Le note senza titolo restano ognuna per conto suo.
 */
export function groupNotesByTitle(notes: Note[]): Group[] {
  const groups: Group[] = [];
  const index: Record<string, Group> = {};
  for (const n of notes) {
    const title = n.title.trim();
    const key = title ? title.toLowerCase() : `__senza-titolo__${n.id}`;
    let g = index[key];
    if (!g) {
      g = { key, title, notes: [] };
      index[key] = g;
      groups.push(g);
    }
    g.notes.push(n);
  }
  return groups;
}

/** una data sola se il gruppo è di un giorno, altrimenti il periodo coperto */
function groupDate(group: Group, lang: Lang): string {
  const days = [...new Set(group.notes.map((n) => isoDay(n.createdAt)).filter(Boolean))].sort();
  if (days.length === 0) return '';
  if (days.length === 1) return formatDate(days[0], lang);
  return `${formatDate(days[0], lang)} – ${formatDate(days[days.length - 1], lang)}`;
}

export function NotesPrintDocument({
  notes,
  nodes,
  lang,
  filters,
}: {
  notes: Note[];
  nodes: TaskNode[];
  lang: Lang;
  /** riga che riassume i filtri usati per ottenere questo elenco */
  filters?: string;
}) {
  const t = (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const groups = React.useMemo(() => groupNotesByTitle(notes), [notes]);

  return (
    <div className="print-doc notes-print portrait">
      <section className="psheet">
        <h2 className="ph">{t('notes.title')}</h2>
        <p className="pmeta">
          {t('print.generated', { d: formatDate(todayISO(), lang) })} ·{' '}
          {notes.length === 1 ? t('notes.countOne') : t('notes.count', { n: notes.length })}
          {filters ? ` · ${filters}` : ''}
        </p>

        {groups.length === 0 && <p>{t('print.noData')}</p>}

        {groups.map((g) => {
          const many = g.notes.length > 1;
          return (
            <article key={g.key} className={'ngroup' + (many ? ' multi' : '')}>
              <header className="nghead">
                <h3>{g.title || t('notes.untitled')}</h3>
                <span className="ngdate">{groupDate(g, lang)}</span>
              </header>

              {g.notes.map((n) => {
                const path = pathOf(nodes, n.nodeId).filter(Boolean).join(' › ');
                const body = sanitizeHtml(n.body);
                const empty = !plainText(n.body);
                return (
                  <div key={n.id} className="nitem">
                    <div className="npath">
                      {path || '—'}
                      <span className="nmeta">
                        {n.author ? ` · ${n.author}` : ''}
                        {many ? ` · ${formatDate(isoDay(n.createdAt), lang)}` : ''}
                      </span>
                    </div>
                    {!empty && <div className="nbody" dangerouslySetInnerHTML={{ __html: body }} />}
                    {n.tags.length > 0 && <div className="ntags">{n.tags.map((tag) => `#${tag}`).join('  ')}</div>}
                  </div>
                );
              })}
            </article>
          );
        })}
      </section>
    </div>
  );
}
