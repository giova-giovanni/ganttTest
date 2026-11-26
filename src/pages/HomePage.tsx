import React from 'react';
import { setHome, useStore } from '../store';
import { useT, StatusChip, fmtHours } from '../ui';
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
import { Board, type BoardFocus } from '../components/Board';
import type { HomeLayout } from '../types';

/** colori dei progetti nel calendario: distinti fra loro e leggibili su chiaro e scuro */
const PROJECT_COLORS = [
  '#2f7de1',
  '#8e5bd8',
  '#2aa76b',
  '#e0873c',
  '#c0398f',
  '#2f9bc9',
  '#b0603a',
  '#5b8c2a',
  '#d6453d',
  '#6b7889',
];

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
  const today = todayISO();
  const [month, setMonth] = React.useState(() => startOfMonth(todayISO()));
  const [showSetup, setShowSetup] = React.useState(false);
  const [focus, setFocus] = React.useState<BoardFocus | null>(null);
  const focusSeq = React.useRef(0);
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
  const colorOf = React.useMemo(() => {
    const m: Record<string, string> = {};
    roots.forEach((r, i) => (m[r.id] = PROJECT_COLORS[i % PROJECT_COLORS.length]));
    return m;
  }, [roots]);

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
          color: colorOf[s.node.id] ?? PROJECT_COLORS[0],
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

  const maxLanes = weekSegments.reduce((m, segs) => Math.max(m, segs.reduce((l, s) => Math.max(l, s.lane + 1), 0)), 0);
  const LANE_H = 15;
  const barsHeight = home.calMode === 'deadlines' ? 0 : maxLanes * LANE_H;

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
        color: isRoot ? (colorOf[r.node.id] ?? '#1f2a37') : STATUS_COLORS[r.computed.status],
        project: isRoot,
      });
    }
    return m;
  }, [rows, colorOf, home.calMode]);

  // quante scadenze ci stanno in una casella, in base all'altezza scelta
  const chipRoom = Math.max(0, Math.floor((home.calDayHeight - barsHeight - 18) / 15));

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
    <div className="page">
      <div className="home-bar">
        <h2>{t('nav.home')}</h2>
        <span style={{ flex: 1 }} />
        <button className={'btn sm' + (showSetup ? ' primary' : '')} onClick={() => setShowSetup((v) => !v)}>
          ⚙ {t('home.customize')}
        </button>
      </div>

      {showSetup && <HomeSetup home={home} onClose={() => setShowSetup(false)} />}

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
          className="home-cols"
          style={
            twoCols
              ? { gridTemplateColumns: `minmax(320px, ${home.calRatio}fr) minmax(260px, ${1 - home.calRatio}fr)` }
              : { gridTemplateColumns: '1fr' }
          }
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

              {weeks.map((week, wi) => (
                <div key={week[0]} className="cal-week" style={{ height: home.calDayHeight }}>
                  {week.map((d) => {
                    const inMonth = parseISO(d).getMonth() === first.getMonth();
                    const evs = endsByDay[d] ?? [];
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
                        {evs.slice(0, chipRoom).map((e) => (
                          <div
                            key={e.id}
                            className={'cal-ev' + (e.project ? ' proj' : '')}
                            style={{ background: e.color }}
                            title={e.name}
                            onClick={() => open(e.id)}
                          >
                            {e.name}
                          </div>
                        ))}
                        {evs.length > chipRoom && (
                          <div className="cal-more" title={evs.map((e) => e.name).join('\n')}>
                            {t('home.more', { n: evs.length - chipRoom })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* barre dei progetti sopra le caselle */}
                  {weekSegments[wi]?.map((s) => (
                    <div
                      key={s.projectId + s.col}
                      className={'cal-span' + (s.openLeft ? ' ol' : '') + (s.openRight ? ' or' : '')}
                      style={{
                        left: `calc(${(s.col / 7) * 100}% + 2px)`,
                        width: `calc(${(s.span / 7) * 100}% - 4px)`,
                        top: 17 + s.lane * LANE_H,
                        background: s.color,
                      }}
                      title={s.name}
                      onClick={() => open(s.projectId)}
                    >
                      {!s.openLeft && s.name}
                    </div>
                  ))}
                </div>
              ))}

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
              {upcoming.length === 0 && <div className="hint">{t('home.noUpcoming')}</div>}
              {upcoming.map((r) => (
                <div
                  key={r.node.id}
                  className={'dl' + (r.computed.end! < today ? ' late' : '')}
                  onClick={() => open(r.node.id)}
                >
                  <span className="dl-date">{formatDate(r.computed.end, lang)}</span>
                  <span className="dot" style={{ background: STATUS_COLORS[r.computed.status] }} />
                  <span className="dl-name">{r.node.name}</span>
                  <span className="dl-when">{whenLabel(r.computed.end!)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {home.showOverview && (
        <div className="card home-board" style={{ overflow: 'hidden' }}>
          <div className="cal-head" style={{ padding: '10px 12px', marginBottom: 0 }}>
            <h3 style={{ margin: 0 }}>{t('home.overview')}</h3>
            <span className="hint">{t('home.boardHint')}</span>
          </div>
          <Board rootId={null} height={Math.max(160, home.overviewHeight)} focus={focus} />
        </div>
      )}

      {home.showTable && roots.length > 0 && (
        <div className="card" style={{ padding: 12 }}>
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
                      <span className="dot" style={{ background: colorOf[n.id], marginRight: 6 }} />
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
  );
}

type BoolKey = 'showKpi' | 'showCalendar' | 'showDeadlines' | 'showOverview' | 'showTable';
type NumKey = 'calDayHeight' | 'calRatio' | 'deadlinesHeight' | 'overviewHeight' | 'deadlineDays';

const DEFAULT_HOME: HomeLayout = {
  showKpi: true,
  showCalendar: true,
  showDeadlines: true,
  showOverview: true,
  showTable: true,
  calMode: 'both',
  calDayHeight: 78,
  calRatio: 0.58,
  deadlinesHeight: 420,
  overviewHeight: 420,
  deadlineDays: 30,
};

/** pannello di personalizzazione della pagina iniziale */
function HomeSetup({ home, onClose }: { home: HomeLayout; onClose: () => void }) {
  const { t } = useT();

  const toggle = (key: BoolKey, label: string) => (
    <label className="inline" key={key}>
      <input type="checkbox" checked={home[key]} onChange={(e) => setHome({ [key]: e.target.checked })} />
      {label}
    </label>
  );

  const slider = (key: NumKey, label: string, min: number, max: number, step = 1, unit = 'px') => (
    <label className="setup-row" key={key}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={home[key]}
        onChange={(e) => setHome({ [key]: Number(e.target.value) })}
      />
      <b>{unit === '%' ? `${Math.round(home[key] * 100)} %` : `${home[key]} ${unit}`}</b>
    </label>
  );

  return (
    <div className="card home-setup">
      <div className="setup-block">
        <div className="io-label">{t('home.sections')}</div>
        <div className="setup-toggles">
          {toggle('showKpi', t('home.kpiBox'))}
          {toggle('showCalendar', t('home.calendar'))}
          {toggle('showDeadlines', t('home.upcoming'))}
          {toggle('showOverview', t('home.overview'))}
          {toggle('showTable', t('sidebar.projects'))}
        </div>
      </div>

      <div className="setup-block">
        <div className="io-label">{t('home.sizes')}</div>
        {slider('calDayHeight', t('home.calHeight'), 46, 220)}
        {slider('calRatio', t('home.calWidth'), 0.3, 0.8, 0.02, '%')}
        {slider('deadlinesHeight', t('home.deadlinesHeight'), 160, 900, 10)}
        {slider('overviewHeight', t('home.overviewHeight'), 160, 1200, 10)}
        {slider('deadlineDays', t('home.deadlineDays'), 7, 180, 1, 'gg')}
      </div>

      <div className="setup-block">
        <div className="io-label">{t('home.calMode')}</div>
        <select value={home.calMode} onChange={(e) => setHome({ calMode: e.target.value as HomeLayout['calMode'] })}>
          <option value="both">{t('home.calBoth')}</option>
          <option value="spans">{t('home.calSpans')}</option>
          <option value="deadlines">{t('home.calDeadlines')}</option>
        </select>

        <div className="row" style={{ marginTop: 12, gap: 8, display: 'flex' }}>
          <button className="btn sm" onClick={() => setHome(DEFAULT_HOME)}>
            {t('home.resetLayout')}
          </button>
          <button className="btn sm" onClick={onClose}>
            {t('btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
