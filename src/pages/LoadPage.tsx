import React from 'react';
import { setUi, updateNode, useStore } from '../store';
import { Avatar, Modal, fmtHours, useT } from '../ui';
import { computeAll } from '../utils/tree';
import {
  buildAbsenceMap,
  capacityOf,
  computeLoad,
  isAbsent,
  loadColor,
  loadPercent,
  UNASSIGNED,
  type DayLoad,
} from '../utils/load';
import {
  addDays,
  formatDate,
  formatDateShort,
  isoWeek,
  isWeekend,
  parseISO,
  startOfWeek,
  todayISO,
  weekdayName,
} from '../utils/dates';
import { translate, type TKey } from '../i18n';
import { ABSENCE_COLORS, type AbsenceType } from '../types';
import { AbsenceDialog } from '../components/AbsenceDialog';
import { Gantt, type GanttRow, type Scale } from '../components/Gantt';
import { ROW_H } from './ProjectPage';

type Gran = 'day' | 'week';

export function LoadPage() {
  const { data } = useStore();
  const { t, lang } = useT();
  const today = todayISO();
  const [gran, setGran] = React.useState<Gran>('day');
  const [anchor, setAnchor] = React.useState(() => startOfWeek(todayISO()));
  const [detail, setDetail] = React.useState<{ personId: string; days: string[] } | null>(null);
  const [selPerson, setSelPerson] = React.useState<string | null>(null);
  const [absOpen, setAbsOpen] = React.useState(false);
  const [miniScale, setMiniScale] = React.useState<Scale>('week');
  const [fRole, setFRole] = React.useState('');
  const [byRole, setByRole] = React.useState(false);

  const computed = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const rootNames = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of data.nodes) if (n.parentId === null) m[n.id] = n.name;
    return m;
  }, [data.nodes]);
  const archivedRoots = React.useMemo(
    () => new Set(data.nodes.filter((n) => n.parentId === null && n.archived).map((n) => n.id)),
    [data.nodes],
  );
  const absMap = React.useMemo(() => buildAbsenceMap(data.absences), [data.absences]);
  const { map, totals, conflicts } = React.useMemo(
    () => computeLoad(data.nodes, computed, rootNames, absMap, archivedRoots),
    [data.nodes, computed, rootNames, absMap, archivedRoots],
  );
  const conflictSet = React.useMemo(() => new Set(conflicts), [conflicts]);

  const nDays = gran === 'day' ? 28 : 7 * 16;
  const days = React.useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < nDays; i++) out.push(addDays(anchor, i));
    return out;
  }, [anchor, nDays]);

  interface Column {
    key: string;
    label: string;
    sub: string;
    days: string[];
    weekend: boolean;
    isToday: boolean;
  }

  const columns: Column[] = React.useMemo(() => {
    if (gran === 'day') {
      return days.map((d) => ({
        key: d,
        label: String(parseISO(d).getDate()),
        sub: weekdayName(parseISO(d), lang, 'narrow'),
        days: [d],
        weekend: isWeekend(d),
        isToday: d === today,
      }));
    }
    const out: Column[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const block = days.slice(i, i + 7);
      out.push({
        key: block[0],
        label: `${t('load.week')} ${isoWeek(block[0])}`,
        sub: formatDateShort(block[0], lang),
        days: block,
        weekend: false,
        isToday: block.includes(today),
      });
    }
    return out;
  }, [days, gran, lang, today, t]);

  const roles = React.useMemo(
    () => [...new Set(data.people.map((p) => p.role.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [data.people],
  );

  const peopleRows = React.useMemo(() => {
    const people = data.people.filter((p) => !fRole || p.role.trim() === fRole);
    const sorted = byRole
      ? [...people].sort((a, b) => a.role.trim().localeCompare(b.role.trim()) || a.name.localeCompare(b.name))
      : people;
    const list: { id: string; person?: (typeof data.people)[number] }[] = sorted.map((p) => ({ id: p.id, person: p }));
    // la riga «non assegnato» non ha ruolo: compare solo senza filtro
    if (map[UNASSIGNED] && !fRole) list.push({ id: UNASSIGNED });
    return list;
  }, [data.people, map, fRole, byRole]);

  /** valore di una cella: ore, % sulla capacità disponibile, giorni di assenza */
  const cellValue = (personId: string, col: Column) => {
    const byDay = map[personId] ?? {};
    const cap = capacityOf(data.people.find((p) => p.id === personId));
    let hours = 0;
    let workdays = 0;
    let absentDays = 0;
    let conflict = false;
    let absType: AbsenceType | null = null;
    for (const d of col.days) {
      const cell = byDay[d];
      hours += cell?.hours ?? 0;
      if (cell?.tasks.some((x) => conflictSet.has(x.nodeId))) conflict = true;
      if (isWeekend(d)) continue;
      const abs = isAbsent(absMap, personId, d);
      if (abs) {
        absentDays += 1;
        absType = absType ?? abs.type;
      } else workdays += 1;
    }
    const pct = workdays > 0 ? loadPercent(hours, cap * workdays) : hours > 0 ? Infinity : 0;
    const allAbsent = workdays === 0 && absentDays > 0;
    return { hours, pct, allAbsent, absentDays, conflict, absType };
  };

  const periodStats = (personId: string) => {
    const byDay = map[personId] ?? {};
    const cap = capacityOf(data.people.find((p) => p.id === personId));
    let hours = 0;
    let peak = 0;
    let over = 0;
    let available = 0;
    let absent = 0;
    for (const d of days) {
      const h = byDay[d] ?? { hours: 0 };
      hours += h.hours;
      if (!isWeekend(d)) {
        if (isAbsent(absMap, personId, d)) absent += 1;
        else available += 1;
      }
      const pct = loadPercent(h.hours, cap);
      if (pct > peak) peak = pct;
      if (pct > 100) over += 1;
    }
    return { hours, peak, over, absent, avg: available > 0 ? loadPercent(hours, cap * available) : 0 };
  };

  const detailTasks = React.useMemo(() => {
    if (!detail) return [];
    const byDay = map[detail.personId] ?? {};
    const agg: Record<string, { name: string; hours: number; root: string }> = {};
    for (const d of detail.days) {
      const cell: DayLoad | undefined = byDay[d];
      if (!cell) continue;
      for (const task of cell.tasks) {
        const e = (agg[task.nodeId] ||= { name: task.name, hours: 0, root: task.rootName });
        e.hours += task.hours;
      }
    }
    return Object.entries(agg).map(([id, v]) => ({ id, ...v }));
  }, [detail, map]);

  // ---------------------------------------------------------------- mini gantt
  const personRows: GanttRow[] = React.useMemo(() => {
    if (!selPerson) return [];
    const person = data.people.find((p) => p.id === selPerson);
    return data.nodes
      .filter(
        (n) =>
          n.assigneeId === selPerson &&
          computed[n.id] &&
          !computed[n.id].hasChildren &&
          computed[n.id].status !== 'CANCELLED' && // coerente con il calcolo del carico
          !archivedRoots.has(computed[n.id].rootId),
      )
      .sort((a, b) => ((computed[a.id].start ?? '9999') < (computed[b.id].start ?? '9999') ? -1 : 1))
      .map((n) => {
        const c = computed[n.id];
        return {
          id: n.id,
          name: n.name,
          start: c.start,
          end: c.end,
          status: c.status,
          summary: false,
          progress: c.progress,
          color: person?.color,
          label: `${fmtHours(c.hours)} h · ${c.workDays} ${t('common.days')}`,
          editable: true,
        };
      });
  }, [selPerson, data.nodes, data.people, computed, archivedRoots, t]);

  const personBlocked = React.useMemo(() => {
    if (!selPerson) return undefined;
    return new Set(Object.keys(absMap[selPerson] ?? {}));
  }, [selPerson, absMap]);

  const shift = (n: number) => setAnchor(addDays(anchor, n * (gran === 'day' ? 7 : 28)));
  const personName = (id: string) =>
    id === UNASSIGNED ? t('load.unassigned') : data.people.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2>{t('load.title')}</h2>
        <span style={{ flex: 1 }} />
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className="btn sm" title={t('people.role')}>
          <option value="">{t('people.filterRole')}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="inline" title={t('people.sortRole')}>
          <input type="checkbox" checked={byRole} onChange={(e) => setByRole(e.target.checked)} />
          {t('people.groupRole')}
        </label>
        <button className="btn sm" onClick={() => setAbsOpen(true)}>
          {t('absence.open')}
        </button>
        <select value={gran} onChange={(e) => setGran(e.target.value as Gran)} className="btn sm">
          <option value="day">{t('load.byDay')}</option>
          <option value="week">{t('load.byWeek')}</option>
        </select>
        <button className="btn sm" onClick={() => shift(-1)}>
          ‹
        </button>
        <button className="btn sm" onClick={() => setAnchor(startOfWeek(todayISO()))}>
          {t('btn.today')}
        </button>
        <button className="btn sm" onClick={() => shift(1)}>
          ›
        </button>
        <span className="hint">
          {formatDate(days[0], lang)} – {formatDate(days[days.length - 1], lang)}
        </span>
      </div>

      <div className="hint">{t('load.hint')}</div>

      <div className="card" style={{ padding: 0 }}>
        <div className="heat-wrap">
          <table className="heat">
            <thead>
              <tr>
                <th className="person">{t('load.person')}</th>
                {columns.map((c) => (
                  <th key={c.key} className={(c.weekend ? 'we' : '') + (c.isToday ? ' today' : '')}>
                    <div>{c.label}</div>
                    <div style={{ fontWeight: 400, opacity: 0.7 }}>{c.sub}</div>
                  </th>
                ))}
                <th className="num" style={{ minWidth: 68 }}>
                  {t('load.total')}
                </th>
                <th className="num" style={{ minWidth: 68 }}>
                  {t('load.avg')}
                </th>
                <th className="num" style={{ minWidth: 68 }}>
                  {t('load.peak')}
                </th>
              </tr>
            </thead>
            <tbody>
              {peopleRows.map((row) => {
                const stats = periodStats(row.id);
                const isUnassigned = row.id === UNASSIGNED;
                return (
                  <tr key={row.id} className={selPerson === row.id ? 'selected' : ''}>
                    <td
                      className="person"
                      onClick={() => setSelPerson(isUnassigned ? null : selPerson === row.id ? null : row.id)}
                      style={{ cursor: isUnassigned ? 'default' : 'pointer' }}
                    >
                      <span className="person-line">
                        <Avatar person={row.person} size={20} />
                        <span>
                          <div style={{ fontWeight: 600 }}>{isUnassigned ? t('load.unassigned') : row.person!.name}</div>
                          {/* niente conteggio delle assenze qui: sta solo in Ferie e permessi */}
                          <div className="role">
                            {isUnassigned
                              ? ''
                              : `${row.person!.role} · ${capacityOf(row.person)} h/${t('common.days').slice(0, 1)}`}
                          </div>
                        </span>
                      </span>
                    </td>
                    {columns.map((c) => {
                      const { hours, pct, allAbsent, absentDays, conflict, absType } = cellValue(row.id, c);
                      const absHere = !isUnassigned && absentDays > 0;
                      const title =
                        `${fmtHours(hours)} h` +
                        (Number.isFinite(pct) ? ` · ${Math.round(pct)} %` : '') +
                        (absHere && absType
                          ? ` · ${translate(lang, `absence.${absType}` as TKey)} (${absentDays} ${t('common.days')})`
                          : '') +
                        (conflict ? ` · ${t('load.conflict')}` : '');
                      return (
                        <td
                          key={c.key}
                          className={
                            'cell' +
                            (c.weekend ? ' we' : '') +
                            (allAbsent || (absHere && c.days.length === 1) ? ' absent' : '') +
                            (conflict ? ' conflict' : '')
                          }
                          style={{
                            background: pct > 0 && Number.isFinite(pct) && !allAbsent ? loadColor(pct) : undefined,
                            color: pct > 0 && Number.isFinite(pct) && !allAbsent ? '#16202b' : undefined,
                            fontWeight: pct > 100 ? 700 : 400,
                          }}
                          title={title}
                          onClick={() => hours > 0 && setDetail({ personId: row.id, days: c.days })}
                        >
                          {allAbsent
                            ? absType
                              ? translate(lang, `absence.${absType}` as TKey).slice(0, 1)
                              : '–'
                            : pct > 0
                              ? Number.isFinite(pct)
                                ? `${Math.round(pct)} %`
                                : '!'
                              : ''}
                        </td>
                      );
                    })}
                    <td className="tot">{fmtHours(stats.hours)} h</td>
                    <td className="tot">{Math.round(stats.avg)} %</td>
                    <td className="tot" style={{ color: stats.peak > 100 ? '#d6453d' : undefined }}>
                      {Math.round(stats.peak)} %
                    </td>
                  </tr>
                );
              })}
              {peopleRows.length === 0 && (
                <tr>
                  <td className="person" colSpan={columns.length + 4} style={{ padding: 14, color: 'var(--muted)' }}>
                    {t('people.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ padding: '8px 12px' }}>
          <span>{t('load.legend')}:</span>
          <span>
            <i className="sw" style={{ background: loadColor(40) }} /> ≤ 60 % {t('load.free')}
          </span>
          <span>
            <i className="sw" style={{ background: loadColor(90) }} /> ≤ 100 % {t('load.ok')}
          </span>
          <span>
            <i className="sw" style={{ background: loadColor(140) }} /> ≤ 150 %
          </span>
          <span>
            <i className="sw" style={{ background: loadColor(190) }} /> ≤ 200 %
          </span>
          <span>
            <i className="sw" style={{ background: loadColor(260) }} /> &gt; 200 % {t('load.over')}
          </span>
          <span>
            <i
              className="sw"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(120,132,148,.42) 0 3px, rgba(120,132,148,.12) 3px 7px)',
              }}
            />{' '}
            {t('load.absent')}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------ gantt personale */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>
            {t('load.tasksOf')} {selPerson ? personName(selPerson) : '—'}
          </h3>
          {selPerson && <span className="hint">{t('load.miniHint')}</span>}
          <span style={{ flex: 1 }} />
          {selPerson && (
            <>
              <button className="btn sm" onClick={() => setAbsOpen(true)}>
                + {t('absence.open')}
              </button>
              <select className="btn sm" value={miniScale} onChange={(e) => setMiniScale(e.target.value as Scale)}>
                <option value="day">{t('scale.day')}</option>
                <option value="week">{t('scale.week')}</option>
                <option value="month">{t('scale.month')}</option>
              </select>
            </>
          )}
        </div>
        {!selPerson && (
          <div className="hint" style={{ padding: '0 12px 14px' }}>
            {t('load.selectPerson')}
          </div>
        )}
        {selPerson && personRows.length === 0 && (
          <div className="hint" style={{ padding: '0 12px 14px' }}>
            {t('load.noTasks')}
          </div>
        )}
        {selPerson && personRows.length > 0 && (
          <div style={{ display: 'flex', height: 30 + personRows.length * ROW_H }}>
            <div style={{ width: 260, flex: '0 0 260px', borderRight: '1px solid var(--border-strong)' }}>
              <div
                style={{ height: 30, borderBottom: '1px solid var(--border-strong)', background: 'var(--panel-2)' }}
              />
              {personRows.map((r) => (
                <div
                  key={r.id}
                  style={{
                    height: ROW_H,
                    lineHeight: `${ROW_H}px`,
                    padding: '0 8px',
                    borderBottom: '1px solid var(--border)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 6,
                  }}
                  title={`${r.name} · ${rootNames[computed[r.id].rootId] ?? ''}`}
                  onClick={() => setUi({ page: 'project', selectedProjectId: computed[r.id].rootId })}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span className="hint" style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                    {fmtHours(computed[r.id].hours)} h
                  </span>
                </div>
              ))}
            </div>
            <Gantt
              rows={personRows}
              scale={miniScale}
              lang={lang}
              rowHeight={ROW_H}
              onChangeDates={(id, start, end) => updateNode(id, { start, end })}
              blockedDays={personBlocked}
            />
          </div>
        )}
      </div>

      {detail && (
        <Modal
          title={`${t('load.detail')} · ${personName(detail.personId)} · ${
            detail.days.length === 1
              ? formatDate(detail.days[0], lang)
              : `${formatDate(detail.days[0], lang)} – ${formatDate(detail.days[detail.days.length - 1], lang)}`
          }`}
          onClose={() => setDetail(null)}
          footer={
            <button className="btn" onClick={() => setDetail(null)}>
              {t('btn.close')}
            </button>
          }
        >
          <table className="data">
            <thead>
              <tr>
                <th>{t('col.name')}</th>
                <th>{t('nav.project')}</th>
                <th className="num">{t('common.hours')}</th>
              </tr>
            </thead>
            <tbody>
              {detailTasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.name}</td>
                  <td className="hint">{task.root}</td>
                  <td className="num">{fmtHours(task.hours)} h</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>
                  {t('load.total')}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmtHours(detailTasks.reduce((s, x) => s + x.hours, 0))} h
                </td>
              </tr>
            </tbody>
          </table>
        </Modal>
      )}

      {absOpen && <AbsenceDialog onClose={() => setAbsOpen(false)} personId={selPerson} />}

      <div className="legend">
        <span>
          {t('load.total')}: {fmtHours(Object.values(totals).reduce((s, v) => s + v, 0))} h
        </span>
        {Object.entries(ABSENCE_COLORS).map(([k, color]) => (
          <span key={k}>
            <i className="sw" style={{ background: color }} /> {translate(lang, `absence.${k}` as TKey)}
          </span>
        ))}
      </div>
    </div>
  );
}
