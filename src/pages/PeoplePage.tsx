import React from 'react';
import { addPerson, deletePerson, setUi, updatePerson, useStore } from '../store';
import { Avatar, fmtHours, useCanAdmin, useCanEdit, useIsAdmin, useT } from '../ui';
import { computeAll } from '../utils/tree';
import { buildAbsenceMap, computeLoad, capacityOf, isAbsent, loadColor, loadPercent } from '../utils/load';
import { addDays, isWeekend, startOfWeek, todayISO } from '../utils/dates';
import { AbsenceDialog } from '../components/AbsenceDialog';
import { PersonProfile } from '../components/PersonProfile';
import { ColorPicker } from '../components/ColorPicker';
import type { Person } from '../types';

const PALETTE = ['#2f7de1', '#8e5bd8', '#2aa76b', '#e0873c', '#d6453d', '#0f9bb4', '#c0398f', '#6a7d8c'];

type SortKey = 'name' | 'role' | 'hours' | 'load';

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-strong)',
  background: 'var(--panel-2)',
  borderRadius: 6,
  padding: '6px 9px',
  minWidth: 180,
};

export function PeoplePage() {
  const { data } = useStore();
  const { t } = useT();
  const canEdit = useCanEdit();
  const canAdmin = useCanAdmin();
  const isAdmin = useIsAdmin();
  const [newName, setNewName] = React.useState('');
  const [newRole, setNewRole] = React.useState('');
  const [absOpen, setAbsOpen] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<string | null>(null);
  const [fRole, setFRole] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('name');

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
  const { map, totals } = React.useMemo(
    () => computeLoad(data.nodes, computed, rootNames, absMap, archivedRoots),
    [data.nodes, computed, rootNames, absMap, archivedRoots],
  );

  // carico delle prossime 4 settimane come indicatore rapido
  const horizon = React.useMemo(() => {
    const start = startOfWeek(todayISO());
    return Array.from({ length: 28 }, (_, i) => addDays(start, i));
  }, []);

  const stats = (personId: string) => {
    const byDay = map[personId] ?? {};
    const cap = capacityOf(data.people.find((p) => p.id === personId));
    let hours = 0;
    let over = 0;
    let available = 0;
    let absent = 0;
    for (const d of horizon) {
      const h = byDay[d]?.hours ?? 0;
      hours += h;
      if (loadPercent(h, cap) > 100) over += 1;
      if (isWeekend(d)) continue;
      if (isAbsent(absMap, personId, d)) absent += 1;
      else available += 1;
    }
    return { hours, over, absent, avg: available > 0 ? loadPercent(hours, cap * available) : 0 };
  };

  // stesso perimetro del carico: niente attività annullate né progetti archiviati
  const taskCount = (personId: string) =>
    data.nodes.filter((n) => {
      const c = computed[n.id];
      return (
        n.assigneeId === personId && c && !c.hasChildren && c.status !== 'CANCELLED' && !archivedRoots.has(c.rootId)
      );
    }).length;

  /** ruoli già usati: servono al filtro e ai suggerimenti mentre si scrive */
  const roles = React.useMemo(
    () => [...new Set(data.people.map((p) => p.role.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [data.people],
  );

  const shown = React.useMemo(() => {
    const list = data.people.filter((p) => !fRole || p.role.trim() === fRole);
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'role': {
          const cmp = a.role.trim().localeCompare(b.role.trim());
          return cmp !== 0 ? cmp : byName(a, b);
        }
        case 'hours':
          return (totals[b.id] ?? 0) - (totals[a.id] ?? 0) || byName(a, b);
        case 'load':
          return stats(b.id).avg - stats(a.id).avg || byName(a, b);
        default:
          return byName(a, b);
      }
    });
    // stats e totals derivano dai dati già nelle dipendenze
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.people, fRole, sort, totals, map, absMap]);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    addPerson({
      name,
      role: newRole.trim() || fRole,
      color: PALETTE[data.people.length % PALETTE.length],
      hoursPerDay: 8,
    });
    setNewName('');
    setNewRole('');
  };

  return (
    <div className="page">
      <h2>{t('people.title')}</h2>
      <div className="card" style={{ padding: 12 }}>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t('people.privacyHint')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={t('people.add')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={inputStyle}
          />
          <input
            type="text"
            list="gantt-roles"
            placeholder={t('people.role')}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={{ ...inputStyle, minWidth: 150 }}
          />
          <button className="btn primary" onClick={add} disabled={!canAdmin || !newName.trim()}>
            + {t('btn.add')}
          </button>
          <span style={{ flex: 1 }} />
          <select value={fRole} onChange={(e) => setFRole(e.target.value)} style={inputStyle}>
            <option value="">{t('people.filterRole')}</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={inputStyle} title={t('notes.sort')}>
            <option value="name">{t('people.sortName')}</option>
            <option value="role">{t('people.sortRole')}</option>
            <option value="hours">{t('people.sortHours')}</option>
            <option value="load">{t('people.sortLoad')}</option>
          </select>
          <button className="btn" onClick={() => setAbsOpen('')}>
            {t('absence.title')}
          </button>
        </div>

        <datalist id="gantt-roles">
          {roles.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        {data.people.length === 0 && <div className="hint">{t('people.empty')}</div>}
        {data.people.length > 0 && shown.length === 0 && <div className="hint">{t('people.noneWithRole')}</div>}

        {shown.length > 0 && (
          <div className="table-scroll">
            <table className="data people-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }} />
                  <th style={{ width: '17%', minWidth: 160 }}>{t('people.name')}</th>
                  <th style={{ width: '22%', minWidth: 190 }}>{t('people.role')}</th>
                  <th style={{ width: 90 }}>{t('people.hoursPerDay')}</th>
                  <th style={{ width: 60 }}>{t('people.color')}</th>
                  <th className="num">{t('people.tasks')}</th>
                  <th className="num">{t('people.hours')}</th>
                  <th style={{ width: 170 }}>{t('load.avg')} (4 {t('load.week')})</th>
                  <th />
                  <th style={{ width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const s = stats(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <button
                          type="button"
                          className="avatar-btn"
                          title={t('profile.openFor', { name: p.name })}
                          aria-label={t('profile.openFor', { name: p.name })}
                          onClick={() => setProfile(p.id)}
                        >
                          <Avatar person={p} size={32} />
                        </button>
                      </td>
                      <td>
                        <input
                          value={p.name}
                          readOnly={!canEdit}
                          onChange={(e) => updatePerson(p.id, { name: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          value={p.role}
                          list="gantt-roles"
                          readOnly={!canEdit}
                          placeholder={t('people.role')}
                          onChange={(e) => updatePerson(p.id, { role: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={24}
                          step={0.5}
                          disabled={!canEdit}
                          value={p.hoursPerDay}
                          onChange={(e) => updatePerson(p.id, { hoursPerDay: Number(e.target.value) || 8 })}
                        />
                      </td>
                      <td>
                        <ColorPicker
                          title={t('people.colorOf', { name: p.name })}
                          value={p.color}
                          disabled={!canEdit}
                          onChange={(color) => updatePerson(p.id, { color })}
                        />
                      </td>
                      <td className="num">{taskCount(p.id)}</td>
                      <td className="num">{fmtHours(totals[p.id] ?? 0)} h</td>
                      <td>
                        {/* il numero sta fuori dalla barra: sopra il riempimento chiaro non si leggeva */}
                        <div className="loadbar" title={`${Math.round(s.avg)}% · ${s.over} ${t('load.overloadDays')}`}>
                          <div className="loadbar-track">
                            <div
                              className="loadbar-fill"
                              style={{ width: `${Math.min(100, s.avg / 2)}%`, background: loadColor(s.avg) }}
                            />
                            {/* la linea a metà è il 100 % */}
                            <div className="loadbar-mark" />
                          </div>
                          <span>{Math.round(s.avg)} %</span>
                        </div>
                      </td>
                      <td className="row-actions">
                        <button className="btn sm" onClick={() => setProfile(p.id)}>
                          {t('profile.title')}
                        </button>
                        <button className="btn sm" onClick={() => setAbsOpen(p.id)} title={t('absence.title')}>
                          {t('absence.open')}
                        </button>
                      </td>
                      <td>
                        <button
                          className="btn sm danger"
                          disabled={!canAdmin}
                          title={isAdmin ? t('people.deleteConfirm') : t('auth.needAdmin')}
                          onClick={() => window.confirm(t('people.deleteConfirm')) && deletePerson(p.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="hint">
        {t('load.hint')}{' '}
        <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setUi({ page: 'load' })}>
          {t('nav.load')} →
        </button>
      </div>

      {profile && (
        <PersonProfile
          key={profile}
          personId={profile}
          onClose={() => setProfile(null)}
          onAbsences={(id) => {
            setProfile(null);
            setAbsOpen(id);
          }}
        />
      )}
      {absOpen !== null && <AbsenceDialog onClose={() => setAbsOpen(null)} personId={absOpen || null} />}
    </div>
  );
}
