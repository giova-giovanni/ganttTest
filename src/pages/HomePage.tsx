import React from 'react';
import { defaultHome, setHome, updateNode, useStore } from '../store';
import { useT, useCanEdit, StatusChip, fmtHours } from '../ui';
import { computeAll, flatten, STATUS_COLORS } from '../utils/tree';
import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  formatDate,
  isWeekend,
  monthName,
  parseISO,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekdayName,
} from '../utils/dates';
import { projectColors } from '../utils/projectColors';
import { textOn } from '../theme';
import { Board, type BoardFocus } from '../components/Board';
import { ColorPicker } from '../components/ColorPicker';
import type { HomeLayout } from '../types';
import type { TKey } from '../i18n';

/** altezza di una corsia delle barre dei progetti e di un'etichetta di scadenza nel calendario */
const LANE_H = 15;
const CHIP_H = 15;
/** riga con il numero del giorno */
const DATE_H = 17;

interface Segment {
  projectId: string;
  name: string;
  color: string;
  col: number; // 0..6
  span: number; // 1..7
  openLeft: boolean; // la barra continua nella settimana precedente
  openRight: boolean;
  lane: number;
}

export function HomePage() {
  const { data, ui } = useStore();
  const { t, lang } = useT();
  const canEdit = useCanEdit();
  const today = todayISO();
  const [month, setMonth] = React.useState(() => startOfMonth(todayISO()));
  const [showSetup, setShowSetup] = React.useState(false);
  const [focus, setFocus] = React.useState<BoardFocus | null>(null);
  const focusSeq = React.useRef(0);
  const boardRef = React.useRef<HTMLDivElement | null>(null);
  const home = ui.home;

  const computed = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const archivedRoots = React.useMemo(
    () => new Set(data.nodes.filter((n) => n.parentId === null && n.archived).map((n) => n.id)),
    [data.nodes],
  );
  const rows = React.useMemo(
    () => flatten(data.nodes, computed).filter((r) => !archivedRoots.has(r.computed.rootId)),
    [data.nodes, computed, archivedRoots],
  );
  const roots = React.useMemo(
    () => data.nodes.filter((n) => n.parentId === null && !n.archived),
    [data.nodes],
  );
  const peopleById = React.useMemo(() => Object.fromEntries(data.people.map((p) => [p.id, p])), [data.people]);
  const colorOf = React.useMemo(() => projectColors(data.nodes), [data.nodes]);

  const leaves = rows.filter((r) => !r.computed.hasChildren);
  const kpi = {
    projects: roots.length,
    tasks: leaves.length,
    inProgress: leaves.filter((r) => r.computed.status === 'IN_PROGRESS').length,
    late: leaves.filter(
      (r) =>
        r.computed.end && r.computed.end < today && r.computed.status !== 'DONE' && r.computed.status !== 'CANCELLED',
    ).length,
    hours: rows
      .filter((r) => !r.computed.hasChildren && r.computed.status !== 'CANCELLED')
      .reduce((s, r) => s + r.computed.hours, 0),
  };

  /**
   * Dal calendario, dalle scadenze e dalla tabella si va alla riga nel tabellone
   * qui sotto: si lavora nella pagina iniziale, senza saltare alla schermata Progetto.
   */
  const open = (nodeId: string) => {
    if (!home.showOverview) setHome({ showOverview: true });
    focusSeq.current += 1;
    setFocus({ id: nodeId, n: focusSeq.current });
    window.setTimeout(() => boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
  };

  // --------------------------------------------------------------- calendario
  const first = parseISO(month);
  const gridStart = startOfWeek(month);
  const gridEnd = addDays(startOfWeek(endOfMonth(month)), 6);
  const weeks: string[][] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }

  /** barre dei progetti: una riga per settimana, corsie impilate senza sovrapposizioni */
  const weekSegments = React.useMemo(() => {
    if (home.calMode === 'deadlines') return weeks.map(() => [] as Segment[]);
    const spans = roots
      .map((r) => ({ node: r, c: computed[r.id] }))
      .filter((x) => x.c?.start && x.c?.end)
      .sort((a, b) => (a.c.start! < b.c.start! ? -1 : 1));

    return weeks.map((week) => {
      const wStart = week[0];
      const wEnd = week[6];
      const lanes: string[] = []; // per ogni corsia, l'ultimo giorno occupato
      const out: Segment[] = [];
      for (const s of spans) {
        const start = s.c.start!;
        const end = s.c.end!;
        if (end < wStart || start > wEnd) continue;
        const from = start < wStart ? wStart : start;
        const to = end > wEnd ? wEnd : end;
        const col = diffDays(wStart, from);
        const span = diffDays(from, to) + 1;
        let lane = lanes.findIndex((busy) => busy < from);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(to);
        } else {
          lanes[lane] = to;
        }
        out.push({
          projectId: s.node.id,
          name: s.node.name,
          color: colorOf[s.node.id],
          col,
          span,
          openLeft: start < wStart,
          openRight: end > wEnd,
          lane,
        });
      }
      return out;
    });
    // `weeks` deriva da month: la dipendenza esplicita è month
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, roots, computed, colorOf, home.calMode]);

  const endsByDay = React.useMemo(() => {
    const m: Record<string, { id: string; name: string; color: string; project: boolean }[]> = {};
    if (home.calMode === 'spans') return m;
    for (const r of rows) {
      const end = r.computed.end;
      if (!end) continue;
      if (r.computed.status === 'CANCELLED') continue;
      const isRoot = r.node.parentId === null;
      if (!isRoot && r.computed.hasChildren) continue; // progetti e attività finali
      (m[end] ||= []).push({
        id: r.node.id,
        name: r.node.name,
        color: isRoot ? colorOf[r.node.id] : STATUS_COLORS[r.computed.status],
        project: isRoot,
      });
    }
    return m;
  }, [rows, colorOf, home.calMode]);

  // --------------------------------------------------------------- scadenze
  const upcoming = React.useMemo(() => {
    const limit = addDays(today, home.deadlineDays);
    return rows
      .filter(
        (r) =>
          !r.computed.hasChildren &&
          r.computed.end &&
          r.computed.status !== 'DONE' &&
          r.computed.status !== 'CANCELLED' &&
          r.computed.end <= limit,
      )
      .sort((a, b) => (a.computed.end! < b.computed.end! ? -1 : 1))
      .slice(0, 200);
  }, [rows, today, home.deadlineDays]);

  const whenLabel = (end: string) => {
    const d = diffDays(today, end);
    if (d < 0) return t('home.late');
    if (d === 0) return t('home.today');
    return t('home.inDays', { n: d });
  };

  const twoCols = home.showCalendar && home.showDeadlines;

  return (
    <div className="home-layout">
      <div className="page home-main">
        <div className="home-bar">
          <h2>{t('nav.home')}</h2>
          <span style={{ flex: 1 }} />
          <button
            className={'btn sm' + (showSetup ? ' primary' : '')}
            aria-expanded={showSetup}
            onClick={() => setShowSetup((v) => !v)}
          >
            ⚙ {t('home.customize')}
          </button>
        </div>

        {home.showKpi && (
          <div className="kpis">
            <div className="card kpi">
              <div className="v">{kpi.projects}</div>
              <div className="l">{t('home.kpi.projects')}</div>
            </div>
            <div className="card kpi">
              <div className="v">{kpi.tasks}</div>
              <div className="l">{t('home.kpi.tasks')}</div>
            </div>
            <div className="card kpi">
              <div className="v">{kpi.inProgress}</div>
              <div className="l">{t('home.kpi.inProgress')}</div>
            </div>
            <div className={'card kpi' + (kpi.late ? ' alert' : '')}>
              <div className="v">{kpi.late}</div>
              <div className="l">{t('home.kpi.late')}</div>
            </div>
            <div className="card kpi">
              <div className="v">{fmtHours(kpi.hours)}</div>
              <div className="l">{t('home.kpi.hours')}</div>
            </div>
          </div>
        )}

        {(home.showCalendar || home.showDeadlines) && (
          <div
            className={'home-cols' + (twoCols ? ' two' : '')}
            // le proporzioni passano come variabili: così sugli schermi stretti il CSS può impilarle
            style={{ '--cal-fr': `${home.calRatio}fr`, '--dl-fr': `${1 - home.calRatio}fr` } as React.CSSProperties}
          >
            {home.showCalendar && (
              <div className="card cal">
                <div className="cal-head">
                  <h3 style={{ margin: 0 }}>{t('home.calendar')}</h3>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn sm" onClick={() => setMonth(addMonths(month, -1))} title={t('scale.month')}>
                      ‹
                    </button>
                    <span className="cal-title">
                      {monthName(first, lang)} {first.getFullYear()}
                    </span>
                    <button className="btn sm" onClick={() => setMonth(addMonths(month, 1))} title={t('scale.month')}>
                      ›
                    </button>
                    <button className="btn sm" onClick={() => setMonth(startOfMonth(todayISO()))}>
                      {t('btn.today')}
                    </button>
                  </div>
                </div>

                <div className="cal-dows">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="cal-dow">
                      {weekdayName(parseISO(addDays(gridStart, i)), lang, 'short')}
                    </div>
                  ))}
                </div>

                {weeks.map((week, wi) => {
                  const segments = weekSegments[wi] ?? [];
                  const barsHeight = segments.reduce((h, s) => Math.max(h, (s.lane + 1) * LANE_H), 0);
                  // la settimana si alza quando serve: le barre non devono finire su quella dopo
                  const hasEvents = week.some((d) => endsByDay[d]?.length);
                  const height = Math.max(home.calDayHeight, DATE_H + barsHeight + (hasEvents ? CHIP_H + 2 : 4));
                  const room = Math.max(0, Math.floor((height - DATE_H - barsHeight - 1) / CHIP_H));
                  return (
                    <div key={week[0]} className="cal-week" style={{ height }}>
                      {week.map((d) => {
                        const inMonth = parseISO(d).getMonth() === first.getMonth();
                        const evs = endsByDay[d] ?? [];
                        // se non ci stanno tutte, l'ultima riga dice quante ne mancano
                        const shown = evs.length > room ? Math.max(0, room - 1) : evs.length;
                        return (
                          <div
                            key={d}
                            className={
                              'cal-day' +
                              (inMonth ? '' : ' out') +
                              (isWeekend(d) ? ' we' : '') +
                              (d === today ? ' today' : '')
                            }
                          >
                            <div className="d">{parseISO(d).getDate()}</div>
                            <div style={{ height: barsHeight }} />
                            {evs.slice(0, shown).map((e) => (
                              <div
                                key={e.id}
                                className={'cal-ev' + (e.project ? ' proj' : '')}
                                style={{ background: e.color, color: textOn(e.color) }}
                                title={e.name}
                                onClick={() => open(e.id)}
                              >
                                {e.name}
                              </div>
                            ))}
                            {evs.length > shown && (
                              <div className="cal-more" title={evs.map((e) => e.name).join('\n')}>
                                {t('home.more', { n: evs.length - shown })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* barre dei progetti sopra le caselle */}
                      {segments.map((s) => (
                        <div
                          key={s.projectId + s.col}
                          className={'cal-span' + (s.openLeft ? ' ol' : '') + (s.openRight ? ' or' : '')}
                          style={{
                            left: `calc(${(s.col / 7) * 100}% + 2px)`,
                            width: `calc(${(s.span / 7) * 100}% - 4px)`,
                            top: DATE_H + s.lane * LANE_H,
                            background: s.color,
                            color: textOn(s.color),
                          }}
                          title={s.name}
                          onClick={() => open(s.projectId)}
                        >
                          {!s.openLeft && s.name}
                        </div>
                      ))}
                    </div>
                  );
                })}

                {home.calMode !== 'deadlines' && roots.length > 0 && (
                  <div className="legend" style={{ marginTop: 8 }}>
                    {roots.map((r) => (
                      <span key={r.id} role="button" onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                        <i className="sw" style={{ background: colorOf[r.id] }} />
                        {r.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {home.showDeadlines && (
              <div className="card deadlines" style={{ maxHeight: home.deadlinesHeight }}>
                <h3>{t('home.upcomingN', { n: home.deadlineDays })}</h3>
                {upcoming.length === 0 && (
                  <div className="hint">{t('home.noUpcoming', { n: home.deadlineDays })}</div>
                )}
                {upcoming.map((r) => (
                  <div
                    key={r.node.id}
                    className={'dl' + (r.computed.end! < today ? ' late' : '')}
                    onClick={() => open(r.node.id)}
                  >
                    <span className="dl-date">{formatDate(r.computed.end, lang)}</span>
                    <span className="dot" style={{ background: STATUS_COLORS[r.computed.status] }} />
                    <span className="dl-name" title={r.node.name}>
                      {r.node.name}
                    </span>
                    <span className="dl-when">{whenLabel(r.computed.end!)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {home.showOverview && (
          <div className="card home-board" ref={boardRef} style={{ overflow: 'hidden' }}>
            <div className="cal-head" style={{ padding: '10px 12px', marginBottom: 0 }}>
              <h3 style={{ margin: 0 }}>{t('home.overview')}</h3>
              <span className="hint">{t('home.boardHint')}</span>
            </div>
            <Board rootId={null} height={Math.max(160, home.overviewHeight)} focus={focus} />
          </div>
        )}

        {home.showTable && roots.length > 0 && (
          <div className="card table-scroll" style={{ padding: 12 }}>
            <h3>{t('sidebar.projects')}</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>{t('col.name')}</th>
                  <th>{t('col.status')}</th>
                  <th>{t('col.start')}</th>
                  <th>{t('col.end')}</th>
                  <th className="num">{t('col.hours')}</th>
                  <th className="num">{t('col.progress')}</th>
                  <th>{t('col.assignee')}</th>
                </tr>
              </thead>
              <tbody>
                {roots.map((n) => {
                  const c = computed[n.id];
                  const p = n.assigneeId ? peopleById[n.assigneeId] : undefined;
                  return (
                    <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => open(n.id)}>
                      <td style={{ fontWeight: 600 }}>
                        <ColorPicker
                          className="inline-dot"
                          title={t('project.colorOf', { name: n.name })}
                          value={colorOf[n.id]}
                          isCustom={!!n.color}
                          disabled={!canEdit}
                          onChange={(color) => updateNode(n.id, { color })}
                          onReset={() => updateNode(n.id, { color: null })}
                        />
                        {n.name}
                      </td>
                      <td>
                        <StatusChip status={c.status} lang={lang} />
                      </td>
                      <td>{formatDate(c.start, lang)}</td>
                      <td>{formatDate(c.end, lang)}</td>
                      <td className="num">{fmtHours(c.hours)}</td>
                      <td className="num">{Math.round(c.progress * 100)}%</td>
                      <td>{p?.name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSetup && <HomeSetup home={home} onClose={() => setShowSetup(false)} />}
    </div>
  );
}

type BoolKey = 'showKpi' | 'showCalendar' | 'showDeadlines' | 'showOverview' | 'showTable';
type NumKey = 'calDayHeight' | 'calRatio' | 'deadlinesHeight' | 'overviewHeight' | 'deadlineDays';

const SECTIONS: { key: BoolKey; label: TKey }[] = [
  { key: 'showKpi', label: 'home.kpiBox' },
  { key: 'showCalendar', label: 'home.calendar' },
  { key: 'showDeadlines', label: 'home.upcoming' },
  { key: 'showOverview', label: 'home.overview' },
  { key: 'showTable', label: 'sidebar.projects' },
];

const CAL_MODES: { value: HomeLayout['calMode']; label: TKey }[] = [
  { value: 'both', label: 'home.calBoth' },
  { value: 'spans', label: 'home.calSpans' },
  { value: 'deadlines', label: 'home.calDeadlines' },
];

/**
 * Pannello di personalizzazione della pagina iniziale: sta di lato, così mentre si
 * regola si vede subito il risultato. Le opzioni dei riquadri nascosti sono spente.
 */
function HomeSetup({ home, onClose }: { home: HomeLayout; onClose: () => void }) {
  const { t } = useT();

  const slider = (key: NumKey, label: string, min: number, max: number, step: number, text: string, off = false) => (
    <label className={'slider' + (off ? ' off' : '')}>
      <span>
        {label}
        <b>{text}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={home[key]}
        disabled={off}
        onChange={(e) => setHome({ [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <aside className="home-drawer" aria-label={t('home.customize')}>
      <div className="drawer-head">
        <h3>{t('home.customize')}</h3>
        <button className="btn sm" onClick={onClose} title={t('btn.close')} aria-label={t('btn.close')}>
          ✕
        </button>
      </div>
      <div className="hint">{t('home.customizeHint')}</div>

      <section>
        <div className="io-label">{t('home.sections')}</div>
        {SECTIONS.map((s) => (
          <label className="switch" key={s.key}>
            <span>{t(s.label)}</span>
            <input type="checkbox" checked={home[s.key]} onChange={(e) => setHome({ [s.key]: e.target.checked })} />
          </label>
        ))}
      </section>

      <fieldset disabled={!home.showCalendar}>
        <div className="io-label">{t('home.calendar')}</div>
        <div className="drawer-sub">{t('home.calMode')}</div>
        <div className="segmented vertical">
          {CAL_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={home.calMode === m.value ? 'active' : ''}
              aria-pressed={home.calMode === m.value}
              onClick={() => setHome({ calMode: m.value })}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
        {slider('calDayHeight', t('home.calHeight'), 46, 220, 2, `${home.calDayHeight} px`)}
        {slider(
          'calRatio',
          t('home.calWidth'),
          0.3,
          0.8,
          0.02,
          `${Math.round(home.calRatio * 100)} %`,
          !home.showDeadlines,
        )}
      </fieldset>

      <fieldset disabled={!home.showDeadlines}>
        <div className="io-label">{t('home.upcoming')}</div>
        {slider('deadlineDays', t('home.deadlineDays'), 7, 365, 1, `${home.deadlineDays} ${t('common.days')}`)}
        {slider('deadlinesHeight', t('home.deadlinesHeight'), 160, 900, 10, `${home.deadlinesHeight} px`)}
      </fieldset>

      <fieldset disabled={!home.showOverview}>
        <div className="io-label">{t('home.overview')}</div>
        {slider('overviewHeight', t('home.overviewHeight'), 160, 1200, 10, `${home.overviewHeight} px`)}
      </fieldset>

      <div className="drawer-foot">
        <button className="btn sm" onClick={() => setHome(defaultHome)}>
          {t('home.resetLayout')}
        </button>
        <div className="hint">{t('home.zoomHint')}</div>
      </div>
    </aside>
  );
}
