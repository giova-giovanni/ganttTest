import React from 'react';
import { addAbsence, deleteAbsence, useStore } from '../store';
import { Avatar, Modal, useCanAdmin, useIsAdmin, useT } from '../ui';
import { ABSENCE_COLORS, ABSENCE_TYPES, PERSONAL_ABSENCE_TYPES, type AbsenceType } from '../types';
import { translate, type TKey } from '../i18n';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
  isWeekend,
  monthName,
  parseISO,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekdayName,
  workingDays,
} from '../utils/dates';

/** giorni per motivo; le chiusure aziendali sono nel conteggio ma non appartengono a nessuna persona */
const zeroCounts = (): Record<AbsenceType, number> => ({ VACATION: 0, SICK: 0, OTHER: 0, CLOSURE: 0 });

export function AbsenceDialog({ onClose, personId }: { onClose: () => void; personId?: string | null }) {
  const { data } = useStore();
  const { t, lang } = useT();
  const canAdmin = useCanAdmin();
  const isAdmin = useIsAdmin();
  const [month, setMonth] = React.useState(() => startOfMonth(todayISO()));
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  const [form, setForm] = React.useState({
    personId: personId ?? data.people[0]?.id ?? '',
    start: todayISO(),
    end: todayISO(),
    type: 'VACATION' as AbsenceType,
    note: '',
  });
  // una chiusura aziendale (ponte, festività) non riguarda una persona: vale per tutti
  const closure = form.type === 'CLOSURE';

  const peopleById = React.useMemo(() => Object.fromEntries(data.people.map((p) => [p.id, p])), [data.people]);

  const add = () => {
    if (!canAdmin || (!closure && !form.personId) || !form.start || !form.end) return;
    const start = form.start <= form.end ? form.start : form.end;
    const end = form.start <= form.end ? form.end : form.start;
    addAbsence({ personId: closure ? null : form.personId, start, end, type: form.type, note: form.note.trim() });
    setForm({ ...form, note: '' });
  };

  // ------------------------------------------------------------------ anno
  // Il conteggio di ferie e permessi riparte da zero a ogni anno solare:
  // si guarda un anno alla volta e i giorni a cavallo di capodanno finiscono
  // ognuno nell'anno a cui appartengono.
  const years = React.useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const a of data.absences) {
      set.add(Number(a.start.slice(0, 4)));
      set.add(Number(a.end.slice(0, 4)));
    }
    return [...set].filter((y) => Number.isFinite(y) && y > 1990).sort((a, b) => b - a);
  }, [data.absences]);

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  /** giorni lavorativi di un'assenza che cadono dentro l'anno scelto */
  const daysInYear = React.useCallback(
    (start: string, end: string) => {
      const from = start > yearStart ? start : yearStart;
      const to = end < yearEnd ? end : yearEnd;
      return from > to ? 0 : workingDays(from, to).length;
    },
    [yearStart, yearEnd],
  );

  const ofYear = React.useMemo(
    () =>
      [...data.absences]
        .filter((a) => a.end >= yearStart && a.start <= yearEnd)
        .sort((a, b) => (a.start < b.start ? 1 : -1)),
    [data.absences, yearStart, yearEnd],
  );

  /** riepilogo per persona: quanti giorni di ferie, malattia e altro in questo anno */
  const summary = React.useMemo(() => {
    const rows: Record<string, Record<AbsenceType, number>> = {};
    for (const a of ofYear) {
      if (a.personId === null) continue; // le chiusure non sono di nessuno: si contano a parte
      const days = daysInYear(a.start, a.end);
      if (days <= 0) continue;
      const r = (rows[a.personId] ||= zeroCounts());
      r[a.type] += days;
    }
    return data.people
      .filter((p) => rows[p.id])
      .map((p) => ({
        person: p,
        ...rows[p.id],
        total: PERSONAL_ABSENCE_TYPES.reduce((s, ty) => s + rows[p.id][ty], 0),
      }));
  }, [ofYear, daysInYear, data.people]);

  /** giorni lavorativi di chiusura aziendale nell'anno: ogni giorno conta una volta, anche con due chiusure sovrapposte */
  const closureDaysYear = React.useMemo(() => {
    const days = new Set<string>();
    for (const a of ofYear) {
      if (a.type !== 'CLOSURE') continue;
      const from = a.start > yearStart ? a.start : yearStart;
      const to = a.end < yearEnd ? a.end : yearEnd;
      for (const d of workingDays(from, to)) days.add(d);
    }
    return days.size;
  }, [ofYear, yearStart, yearEnd]);

  const changeYear = (y: number) => {
    setYear(y);
    if (parseISO(month).getFullYear() !== y) setMonth(startOfMonth(`${y}-01-01`));
  };

  // calendario del mese
  const first = parseISO(month);
  const gridStart = startOfWeek(month);
  const gridEnd = addDays(startOfWeek(endOfMonth(month)), 6);
  const cells: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);

  const byDay = React.useMemo(() => {
    const m: Record<string, { name: string; type: AbsenceType; color: string }[]> = {};
    for (const a of data.absences) {
      const from = a.start <= a.end ? a.start : a.end;
      const to = a.start <= a.end ? a.end : a.start;
      for (const d of workingDays(from, to)) {
        const item = {
          // una chiusura è una sola voce per giorno; un’assenza personale porta il nome della persona
          name: a.personId === null ? translate(lang, 'absence.closureShort') : (peopleById[a.personId]?.name ?? '?'),
          type: a.type,
          color: ABSENCE_COLORS[a.type],
        };
        const list = (m[d] ||= []);
        // le chiusure per prime: valgono per tutti, anche quando il giorno ha molte assenze
        if (a.personId === null) list.unshift(item);
        else list.push(item);
      }
    }
    return m;
  }, [data.absences, peopleById, lang]);

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--border-strong)',
    background: 'var(--panel-2)',
    borderRadius: 6,
    padding: '5px 7px',
  };

  return (
    <Modal
      title={t('absence.title')}
      onClose={onClose}
      maxWidth={920}
      footer={
        <button className="btn" onClick={onClose}>
          {t('btn.close')}
        </button>
      }
    >
      <div style={{ minWidth: 660 }}>
        <div className="hint" style={{ marginBottom: 10 }}>
          {t('absence.hint')}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('absence.person')}</label>
            <select
              style={inputStyle}
              value={closure ? '' : form.personId}
              disabled={closure}
              onChange={(e) => setForm({ ...form, personId: e.target.value })}
            >
              {closure ? (
                <option value="">{t('absence.everyone')}</option>
              ) : (
                data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('absence.from')}</label>
            <input
              type="date"
              style={inputStyle}
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value, end: e.target.value > form.end ? e.target.value : form.end })}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('absence.to')}</label>
            <input type="date" style={inputStyle} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('absence.type')}</label>
            <select
              style={inputStyle}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AbsenceType })}
            >
              {ABSENCE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {translate(lang, `absence.${ty}` as TKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 120 }}>
            <label>{t('absence.note')}</label>
            <input
              type="text"
              style={{ ...inputStyle, width: '100%' }}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <button className="btn primary" onClick={add} disabled={(!closure && !form.personId) || !canAdmin}>
            + {t('btn.add')}
          </button>
        </div>
        {closure && (
          <div className="hint" style={{ marginBottom: 10 }}>
            {t('absence.closureHint')}
          </div>
        )}
        {!isAdmin && <div className="hint" style={{ marginBottom: 10 }}>{t('auth.needAdmin')}</div>}

        <div className="cal-head">
          <h3 style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>
            {t('absence.calendar')}
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn sm" onClick={() => setMonth(addMonths(month, -1))}>
              ‹
            </button>
            <span className="cal-title">
              {monthName(first, lang)} {first.getFullYear()}
            </span>
            <button className="btn sm" onClick={() => setMonth(addMonths(month, 1))}>
              ›
            </button>
          </div>
        </div>
        <div className="cal-grid" style={{ marginBottom: 14 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="cal-dow">
              {weekdayName(parseISO(addDays(gridStart, i)), lang, 'narrow')}
            </div>
          ))}
          {cells.map((d) => {
            const list = byDay[d] ?? [];
            return (
              <div
                key={d}
                className={
                  'cal-day' +
                  (parseISO(d).getMonth() === first.getMonth() ? '' : ' out') +
                  (isWeekend(d) ? ' we' : '') +
                  (d === todayISO() ? ' today' : '')
                }
                style={{ minHeight: 48 }}
              >
                <div className="d">{parseISO(d).getDate()}</div>
                {list.slice(0, 3).map((x, i) => (
                  <span key={i} className="abs-chip" style={{ background: x.color }} title={x.name}>
                    {x.name.split(' ')[0]}
                  </span>
                ))}
                {list.length > 3 && <div className="d">+{list.length - 3}</div>}
              </div>
            );
          })}
        </div>

        <div className="cal-head" style={{ marginTop: 4 }}>
          <h3 style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>
            {t('absence.yearSummary')}
          </h3>
          <label className="inline">
            {t('absence.year')}
            <select style={inputStyle} value={year} onChange={(e) => changeYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hint" style={{ margin: '4px 0 8px' }}>
          {t('absence.yearHint')}
        </div>
        {closureDaysYear > 0 && (
          <div className="hint" style={{ margin: '0 0 8px' }}>
            {t('absence.closureYear', { y: year, d: closureDaysYear })}
          </div>
        )}

        {summary.length > 0 && (
          <table className="data" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>{t('absence.person')}</th>
                {PERSONAL_ABSENCE_TYPES.map((ty) => (
                  <th key={ty} className="num">
                    {translate(lang, `absence.${ty}` as TKey)}
                  </th>
                ))}
                <th className="num">{t('absence.totalYear')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={r.person.id}>
                  <td>
                    <span className="person-line">
                      <Avatar person={r.person} size={18} />
                      <span>{r.person.name}</span>
                    </span>
                  </td>
                  {PERSONAL_ABSENCE_TYPES.map((ty) => (
                    <td key={ty} className="num">
                      {r[ty] || '—'}
                    </td>
                  ))}
                  <td className="num">
                    <b>{r.total}</b> {t('absence.workDaysShort')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {ofYear.length === 0 && <div className="hint">{t('absence.emptyYear', { y: year })}</div>}
        {ofYear.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>{t('absence.person')}</th>
                <th>{t('absence.from')}</th>
                <th>{t('absence.to')}</th>
                <th>{t('absence.type')}</th>
                <th>{t('absence.note')}</th>
                <th className="num">{t('common.days')}</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {ofYear.map((a) => {
                const p = a.personId === null ? undefined : peopleById[a.personId];
                return (
                  <tr key={a.id}>
                    <td>
                      {a.personId === null ? (
                        <span>{t('absence.everyone')}</span>
                      ) : (
                        <span className="person-line">
                          <Avatar person={p} size={18} />
                          <span>{p?.name ?? '—'}</span>
                        </span>
                      )}
                    </td>
                    <td>{formatDate(a.start, lang)}</td>
                    <td>{formatDate(a.end, lang)}</td>
                    <td>
                      <span className="chip" style={{ background: ABSENCE_COLORS[a.type] }}>
                        {translate(lang, `absence.${a.type}` as TKey)}
                      </span>
                    </td>
                    <td className="hint">{a.note}</td>
                    <td className="num" title={t('absence.daysInYear', { y: year })}>
                      {daysInYear(a.start, a.end)}
                    </td>
                    <td>
                      <button
                        className="btn sm danger"
                        disabled={!canAdmin}
                        title={isAdmin ? t('absence.deleteConfirm') : t('auth.needAdmin')}
                        onClick={() => window.confirm(t('absence.deleteConfirm')) && deleteAbsence(a.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
