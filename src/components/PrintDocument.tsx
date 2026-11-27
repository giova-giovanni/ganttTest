import React from 'react';
import type { AppData, ComputedMap, Lang, TaskNode } from '../types';
import { translate, type TKey } from '../i18n';
import { computeAll, flatten, roots, STATUS_COLORS } from '../utils/tree';
import { textOn } from '../theme';
import { plainText } from '../utils/notes';
import {
  addDays,
  addMonths,
  countWorkingDays,
  diffDays,
  formatDate,
  isoWeek,
  monthName,
  startOfMonth,
  startOfWeek,
  todayISO,
  workingDays,
} from '../utils/dates';
import { buildAbsenceMap, capacityOf, computeLoad, loadColor, loadPercent, UNASSIGNED } from '../utils/load';
import { fmtHours } from '../ui';

export interface PrintOptions {
  cover: boolean;
  gantt: boolean;
  perProject: boolean;
  table: boolean;
  load: boolean;
  people: boolean;
  absences: boolean;
  orientation: 'landscape' | 'portrait';
  /** formato del foglio: A3 serve per stampare il Gantt in grande */
  paper: 'A4' | 'A3';
  /** quanto dettaglio nel Gantt generale; 'visible' = come si vede in Home */
  ganttScope: 'visible' | 'projects' | 'branches' | 'all';
  autoPeriod: boolean;
  from: string;
  to: string;
  includeArchived: boolean;
  onlyCurrent: boolean;
  notes: boolean;
}

export const defaultPrintOptions: PrintOptions = {
  cover: true,
  gantt: true,
  perProject: false,
  table: true,
  load: true,
  people: false,
  absences: false,
  orientation: 'landscape',
  paper: 'A4',
  ganttScope: 'visible',
  autoPeriod: true,
  from: '',
  to: '',
  includeArchived: false,
  onlyCurrent: false,
  notes: false,
};

/**
 * Quante righe di Gantt stanno in una pagina: dipende dal foglio e
 * dall'orientamento. Se le righe sono di più il Gantt continua sulla pagina
 * successiva con la stessa intestazione dei periodi.
 */
function ganttRowsPerPage(opts: PrintOptions): number {
  if (opts.paper === 'A3') return opts.orientation === 'portrait' ? 76 : 50;
  return opts.orientation === 'portrait' ? 50 : 34;
}

function chunk<T>(list: T[], size: number): T[][] {
  if (list.length <= size) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Period {
  key: string;
  label: string;
  sub?: string;
  days: string[];
  span: number;
}

/** suddivide l'intervallo in settimane o mesi, scegliendo il passo che sta in pagina */
function buildPeriods(
  start: string,
  end: string,
  lang: Lang,
  force?: 'week' | 'month',
): { periods: Period[]; mode: 'week' | 'month' } {
  const total = diffDays(start, end) + 1;
  const mode = force ?? (total <= 120 ? 'week' : 'month');
  const periods: Period[] = [];
  if (mode === 'week') {
    let cur = startOfWeek(start);
    while (cur <= end && periods.length < 200) {
      periods.push({
        key: cur,
        label: String(isoWeek(cur)),
        sub: cur.slice(8, 10) + '/' + cur.slice(5, 7),
        days: workingDays(cur, addDays(cur, 6)),
        span: 7,
      });
      cur = addDays(cur, 7);
    }
  } else {
    let cur = startOfMonth(start);
    while (cur <= end && periods.length < 200) {
      const next = addMonths(cur, 1);
      periods.push({
        key: cur,
        label: monthName(new Date(cur + 'T00:00:00'), lang, false),
        sub: cur.slice(0, 4),
        days: workingDays(cur, addDays(next, -1)),
        span: diffDays(cur, next),
      });
      cur = next;
    }
  }
  return { periods, mode };
}

function Bar({
  start,
  end,
  rangeStart,
  totalDays,
  color,
  progress,
}: {
  start: string | null;
  end: string | null;
  rangeStart: string;
  totalDays: number;
  color: string;
  progress?: number;
}) {
  if (!start || !end) return null;
  const from = Math.max(0, diffDays(rangeStart, start));
  const to = Math.min(totalDays, diffDays(rangeStart, end) + 1);
  if (to <= from) return null;
  const left = (from / totalDays) * 100;
  const width = Math.max(0.4, ((to - from) / totalDays) * 100);
  return (
    <div className="pbar" style={{ left: `${left}%`, width: `${width}%`, background: color }}>
      {progress !== undefined && progress > 0 && (
        <span className="pbar-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      )}
    </div>
  );
}

interface GanttPrintRow {
  node: TaskNode;
  depth: number;
  start: string | null;
  end: string | null;
  hours: number;
  progress: number;
  status: string;
}

function GanttBlock({
  rows,
  rangeStart,
  rangeEnd,
  lang,
  people,
  showTasks,
}: {
  rows: GanttPrintRow[];
  rangeStart: string;
  rangeEnd: string;
  lang: Lang;
  people: Record<string, string>;
  showTasks: boolean;
}) {
  const totalDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
  const { periods } = buildPeriods(rangeStart, rangeEnd, lang);
  const today = todayISO();
  const todayPct = ((diffDays(rangeStart, today) + 0.5) / totalDays) * 100;

  return (
    <div className="pgantt">
      <div className="pgantt-head">
        <div className="pgantt-left">
          <span className="c-name">{translate(lang, 'col.name')}</span>
          <span className="c-date">{translate(lang, 'col.start')}</span>
          <span className="c-date">{translate(lang, 'col.end')}</span>
          <span className="c-h">h</span>
        </div>
        <div className="pgantt-right">
          {periods.map((p) => (
            <div key={p.key} className="pcol" style={{ width: `${(p.span / totalDays) * 100}%` }}>
              <b>{p.label}</b>
              <small>{p.sub}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="pgantt-body">
        {rows.map((r) => (
          <div key={r.node.id} className={`prow${r.depth === 0 ? ' proot' : ''}`}>
            <div className="pgantt-left">
              <span className="c-name" style={{ paddingLeft: r.depth * 10 }}>
                {r.node.name}
                {showTasks && r.node.assigneeId && people[r.node.assigneeId] ? (
                  <em> · {people[r.node.assigneeId]}</em>
                ) : null}
              </span>
              <span className="c-date">{formatDate(r.start, lang)}</span>
              <span className="c-date">{formatDate(r.end, lang)}</span>
              <span className="c-h">{r.hours ? fmtHours(r.hours) : ''}</span>
            </div>
            <div className="pgantt-right">
              {periods.map((p) => (
                <div key={p.key} className="pcol-bg" style={{ width: `${(p.span / totalDays) * 100}%` }} />
              ))}
              <Bar
                start={r.start}
                end={r.end}
                rangeStart={rangeStart}
                totalDays={totalDays}
                color={STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#2f7de1'}
                progress={r.progress}
              />
              {todayPct >= 0 && todayPct <= 100 && <div className="ptoday" style={{ left: `${todayPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** un Gantt che continua su più pagine, ripetendo l'intestazione dei periodi */
function GanttPages({
  rows,
  rangeStart,
  rangeEnd,
  lang,
  people,
  showTasks,
  title,
  meta,
  perPage,
  legend,
}: {
  rows: GanttPrintRow[];
  rangeStart: string;
  rangeEnd: string;
  lang: Lang;
  people: Record<string, string>;
  showTasks: boolean;
  title: string;
  meta: string;
  perPage: number;
  legend?: boolean;
}) {
  const pages = chunk(rows, perPage);
  return (
    <>
      {pages.map((page, i) => (
        <section className="psheet" key={i}>
          <h2 className="ph">
            {title}
            {pages.length > 1 ? ` (${i + 1}/${pages.length})` : ''}
          </h2>
          <p className="pmeta">{meta}</p>
          <GanttBlock
            rows={page}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            lang={lang}
            people={people}
            showTasks={showTasks}
          />
          {legend && i === pages.length - 1 && <Legend lang={lang} />}
        </section>
      ))}
    </>
  );
}

export function PrintDocument({
  data,
  lang,
  opts,
  currentProjectId,
}: {
  data: AppData;
  lang: Lang;
  opts: PrintOptions;
  currentProjectId: string | null;
}) {
  const computed: ComputedMap = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const t = (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v);

  let projects = roots(data.nodes);
  if (!opts.includeArchived) projects = projects.filter((p) => !p.archived);
  if (opts.onlyCurrent && currentProjectId) projects = projects.filter((p) => p.id === currentProjectId);
  const projectIds = new Set(projects.map((p) => p.id));
  const excluded = new Set(roots(data.nodes).filter((r) => !projectIds.has(r.id)).map((r) => r.id));

  const peopleNames = Object.fromEntries(data.people.map((p) => [p.id, p.name]));
  const rootNames = Object.fromEntries(roots(data.nodes).map((r) => [r.id, r.name]));

  /** nella colonna note finiscono la nota breve e, se manca, le note dell'archivio */
  const noteTextOf = (node: TaskNode): string => {
    const inline = (node.notes ?? '').trim();
    const archive = data.notes
      .filter((n) => n.nodeId === node.id)
      .map((n) => (n.title ? n.title + ': ' : '') + plainText(n.body))
      .join(' · ');
    return [inline, archive].filter(Boolean).join(' · ');
  };

  // ---- intervallo di stampa
  let min: string | null = null;
  let max: string | null = null;
  for (const p of projects) {
    const c = computed[p.id];
    if (c?.start && (!min || c.start < min)) min = c.start;
    if (c?.end && (!max || c.end > max)) max = c.end;
  }
  const today = todayISO();
  let rangeStart = opts.autoPeriod || !opts.from ? startOfWeek(addDays(min ?? today, -7)) : opts.from;
  let rangeEnd = opts.autoPeriod || !opts.to ? addDays(max ?? addDays(today, 60), 7) : opts.to;
  if (rangeEnd < rangeStart) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];

  // ---- righe del Gantt generale.
  // 'visible' segue i rami aperti e chiusi nella pagina iniziale: si stampa quello che si vede.
  const depthLimit = opts.ganttScope === 'projects' ? 0 : opts.ganttScope === 'branches' ? 1 : 99;
  const generalRows: GanttPrintRow[] = projects.flatMap((p) => {
    const rows = flatten(data.nodes, computed, p.id).filter((r) =>
      opts.ganttScope === 'visible' ? r.visible : r.computed.depth <= depthLimit,
    );
    return rows.map((r) => ({
      node: r.node,
      depth: r.computed.depth,
      start: r.computed.start,
      end: r.computed.end,
      hours: r.computed.hours,
      progress: r.computed.progress,
      status: r.computed.status,
    }));
  });
  const perPage = ganttRowsPerPage(opts);

  // ---- KPI
  const allRows = projects.flatMap((p) => flatten(data.nodes, computed, p.id));
  const leafRows = allRows.filter((r) => !r.computed.hasChildren);
  const totalHours = projects.reduce((s, p) => s + (computed[p.id]?.hours ?? 0), 0);
  const inProgress = leafRows.filter((r) => r.computed.status === 'IN_PROGRESS').length;
  const late = leafRows.filter(
    (r) => r.computed.end && r.computed.end < today && r.computed.status !== 'DONE' && r.computed.status !== 'CANCELLED',
  ).length;

  // ---- carico
  const absMap = buildAbsenceMap(data.absences);
  const { map: loadMap, totals } = computeLoad(data.nodes, computed, rootNames, absMap, excluded);
  const { periods: loadPeriods } = buildPeriods(rangeStart, rangeEnd, lang);
  const loadPeople = [
    ...data.people.filter((p) => loadMap[p.id]),
    ...(loadMap[UNASSIGNED] ? [{ id: UNASSIGNED, name: t('load.unassigned'), role: '', color: '#9aa5b3', hoursPerDay: 8 }] : []),
  ];

  const stampDate = formatDate(today, lang);

  return (
    <div className={`print-doc ${opts.orientation}`}>
      {opts.cover && (
        <section className="psheet">
          <div className="pcover">
            <h1>{t('app.title')}</h1>
            <h2>{t('app.subtitle')}</h2>
            <p className="pmeta">{t('print.generated', { d: stampDate })}</p>
            <div className="pkpi">
              <div>
                <b>{projects.length}</b>
                <span>{t('home.kpi.projects')}</span>
              </div>
              <div>
                <b>{leafRows.length}</b>
                <span>{t('home.kpi.tasks')}</span>
              </div>
              <div>
                <b>{inProgress}</b>
                <span>{t('home.kpi.inProgress')}</span>
              </div>
              <div className={late ? 'bad' : ''}>
                <b>{late}</b>
                <span>{t('home.kpi.late')}</span>
              </div>
              <div>
                <b>{fmtHours(totalHours)} h</b>
                <span>{t('home.kpi.hours')}</span>
              </div>
            </div>
            <h3>{t('home.overview')}</h3>
            <table className="ptable">
              <thead>
                <tr>
                  <th>{t('sidebar.projects')}</th>
                  <th>{t('col.start')}</th>
                  <th>{t('col.end')}</th>
                  <th className="num">{t('col.hours')} (h)</th>
                  <th className="num">{t('col.days')}</th>
                  <th className="num">{t('col.progress')} (%)</th>
                  <th>{t('col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const c = computed[p.id];
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{formatDate(c?.start ?? null, lang)}</td>
                      <td>{formatDate(c?.end ?? null, lang)}</td>
                      <td className="num">{c?.hours ? fmtHours(c.hours) : '—'}</td>
                      <td className="num">{c?.workDays || '—'}</td>
                      <td className="num">{Math.round((c?.progress ?? 0) * 100)}</td>
                      <td>
                        <span
                          className="pchip"
                          style={{
                            background: STATUS_COLORS[c?.status ?? 'TODO'],
                            color: textOn(STATUS_COLORS[c?.status ?? 'TODO']),
                          }}
                        >
                          {t(`status.${c?.status ?? 'TODO'}` as TKey)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={7}>{t('print.noData')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {opts.gantt && generalRows.length > 0 && (
        <GanttPages
          rows={generalRows}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          lang={lang}
          people={peopleNames}
          showTasks={false}
          title={t('print.gantt')}
          meta={`${formatDate(rangeStart, lang)} — ${formatDate(rangeEnd, lang)}`}
          perPage={perPage}
          legend
        />
      )}

      {opts.perProject &&
        projects.map((p) => {
          const rows: GanttPrintRow[] = flatten(data.nodes, computed, p.id).map((r) => ({
            node: r.node,
            depth: r.computed.depth,
            start: r.computed.start,
            end: r.computed.end,
            hours: r.computed.hours,
            progress: r.computed.progress,
            status: r.computed.status,
          }));
          const c = computed[p.id];
          const ps = c?.start ?? rangeStart;
          const pe = c?.end ?? rangeEnd;
          return (
            <GanttPages
              key={p.id}
              rows={rows}
              rangeStart={startOfWeek(addDays(ps, -3))}
              rangeEnd={addDays(pe, 3)}
              lang={lang}
              people={peopleNames}
              showTasks
              title={p.name}
              meta={`${formatDate(c?.start ?? null, lang)} — ${formatDate(c?.end ?? null, lang)} · ${fmtHours(
                c?.hours ?? 0,
              )} h · ${Math.round((c?.progress ?? 0) * 100)} %`}
              perPage={perPage}
            />
          );
        })}

      {opts.table && (
        <section className="psheet">
          <h2 className="ph">{t('print.table')}</h2>
          <table className="ptable">
            <thead>
              <tr>
                <th>{t('col.name')}</th>
                <th>{t('col.status')}</th>
                <th>{t('col.start')}</th>
                <th>{t('col.end')}</th>
                <th className="num">{t('col.hours')} (h)</th>
                <th className="num">{t('col.days')}</th>
                <th>{t('col.assignee')}</th>
                {opts.notes && <th>{t('col.notes')}</th>}
              </tr>
            </thead>
            <tbody>
              {allRows.map((r) => (
                <tr key={r.node.id} className={r.computed.depth === 0 ? 'lvl0' : r.computed.depth === 1 ? 'lvl1' : ''}>
                  <td style={{ paddingLeft: 4 + r.computed.depth * 12 }}>{r.node.name}</td>
                  <td>
                    <span
                      className="pchip"
                      style={{
                        background: STATUS_COLORS[r.computed.status],
                        color: textOn(STATUS_COLORS[r.computed.status]),
                      }}
                    >
                      {t(`status.${r.computed.status}` as TKey)}
                    </span>
                  </td>
                  <td>{formatDate(r.computed.start, lang)}</td>
                  <td>{formatDate(r.computed.end, lang)}</td>
                  <td className="num">{r.computed.hours ? fmtHours(r.computed.hours) : ''}</td>
                  <td className="num">{r.computed.workDays || ''}</td>
                  <td>{r.node.assigneeId ? peopleNames[r.node.assigneeId] ?? '' : ''}</td>
                  {opts.notes && <td className="pnote">{noteTextOf(r.node)}</td>}
                </tr>
              ))}
              {allRows.length === 0 && (
                <tr>
                  <td colSpan={opts.notes ? 8 : 7}>{t('print.noData')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {opts.load && loadPeople.length > 0 && (
        <section className="psheet">
          <h2 className="ph">{t('print.load')}</h2>
          <p className="pmeta">
            {t('load.hint')} · {formatDate(rangeStart, lang)} — {formatDate(rangeEnd, lang)}
          </p>
          <table className="ptable pload">
            <thead>
              <tr>
                <th className="sticky">{t('load.person')}</th>
                {loadPeriods.map((p) => (
                  <th key={p.key} className="num">
                    {p.label}
                    <small>{p.sub}</small>
                  </th>
                ))}
                <th className="num">{t('load.total')}</th>
              </tr>
            </thead>
            <tbody>
              {loadPeople.map((person) => {
                const byDay = loadMap[person.id] ?? {};
                const cap = capacityOf(person.id === UNASSIGNED ? undefined : data.people.find((x) => x.id === person.id));
                return (
                  <tr key={person.id}>
                    <td className="sticky">
                      {person.name}
                      {person.role ? <em> · {person.role}</em> : null}
                    </td>
                    {loadPeriods.map((p) => {
                      const hours = p.days.reduce((s, d) => s + (byDay[d]?.hours ?? 0), 0);
                      const pct = loadPercent(hours, cap * Math.max(1, p.days.length));
                      return (
                        <td key={p.key} className="num cell" style={{ background: hours ? loadColor(pct) : undefined }}>
                          {hours ? Math.round(pct) : ''}
                        </td>
                      );
                    })}
                    <td className="num">{fmtHours(totals[person.id] ?? 0)} h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pmeta">
            {t('print.legend')}: ≤ 60 % {t('load.free')} · ≤ 100 % {t('load.ok')} · ≤ 150 % {t('load.full')} · &gt; 150 %{' '}
            {t('load.over')}
          </p>
        </section>
      )}

      {opts.people && data.people.length > 0 && (
        <section className="psheet">
          <h2 className="ph">{t('print.people')}</h2>
          <table className="ptable">
            <thead>
              <tr>
                <th>{t('people.name')}</th>
                <th>{t('people.role')}</th>
                <th className="num">{t('people.hoursPerDay')}</th>
                <th className="num">{t('people.tasks')}</th>
                <th className="num">{t('people.hours')} (h)</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const own = leafRows.filter((r) => r.node.assigneeId === p.id && r.computed.status !== 'CANCELLED');
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="pdot" style={{ background: p.color }} /> {p.name}
                    </td>
                    <td>{p.role}</td>
                    <td className="num">{fmtHours(capacityOf(p))} h</td>
                    <td className="num">{own.length}</td>
                    <td className="num">{fmtHours(own.reduce((s, r) => s + (r.node.hours ?? 0), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {opts.absences && data.absences.length > 0 && (
        <section className="psheet">
          <h2 className="ph">{t('print.absences')}</h2>
          <table className="ptable">
            <thead>
              <tr>
                <th>{t('absence.person')}</th>
                <th>{t('absence.from')}</th>
                <th>{t('absence.to')}</th>
                <th>{t('absence.type')}</th>
                <th className="num">{t('col.days')}</th>
                <th>{t('absence.note')}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.absences]
                .sort((a, b) => (a.start < b.start ? -1 : 1))
                .map((a) => (
                  <tr key={a.id}>
                    <td>{a.personId === null ? t('absence.everyone') : (peopleNames[a.personId] ?? '')}</td>
                    <td>{formatDate(a.start, lang)}</td>
                    <td>{formatDate(a.end, lang)}</td>
                    <td>{t(`absence.${a.type}` as TKey)}</td>
                    <td className="num">{countWorkingDays(a.start, a.end)}</td>
                    <td>{a.note}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Legend({ lang }: { lang: Lang }) {
  const t = (k: TKey) => translate(lang, k);
  return (
    <div className="plegend">
      <b>{t('print.legend')}:</b>
      {(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const).map((s) => (
        <span key={s}>
          <i style={{ background: STATUS_COLORS[s] }} /> {t(`status.${s}` as TKey)}
        </span>
      ))}
    </div>
  );
}
