import React from 'react';
import { setUi, updatePerson, useStore } from '../store';
import { Avatar, Modal, StatusChip, fmtHours, useCanEdit, useT } from '../ui';
import { computeAll } from '../utils/tree';
import { buildAbsenceMap, computeLoad } from '../utils/load';
import { formatDate, todayISO } from '../utils/dates';
import { projectColors } from '../utils/projectColors';
import { isPhotoUrl } from '../../shared/ops.mjs';
import { ColorPicker } from './ColorPicker';
import type { Person } from '../types';

type Draft = Required<Pick<Person, 'name' | 'role' | 'color' | 'hoursPerDay' | 'photo' | 'email' | 'phone' | 'about'>>;

const draftOf = (p: Person): Draft => ({
  name: p.name,
  role: p.role,
  color: p.color,
  hoursPerDay: p.hoursPerDay,
  photo: p.photo ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
  about: p.about ?? '',
});

/** quante attività si elencano nel profilo prima di riassumere le altre */
const MAX_TASKS = 8;

/**
 * Profilo di un responsabile: foto da un indirizzo web, contatti e attività assegnate.
 * Le modifiche si scrivono tutte insieme con «Salva», solo per i campi cambiati: quello
 * che nel frattempo ha modificato un collega negli altri campi resta com'è.
 */
export function PersonProfile({
  personId,
  onClose,
  onAbsences,
}: {
  personId: string;
  onClose: () => void;
  onAbsences?: (personId: string) => void;
}) {
  const { data } = useStore();
  const { t, lang } = useT();
  const canEdit = useCanEdit();
  const person = data.people.find((p) => p.id === personId);
  const [initial] = React.useState<Draft | null>(() => (person ? draftOf(person) : null));
  const [draft, setDraft] = React.useState<Draft | null>(initial);
  const [photoState, setPhotoState] = React.useState<{ url: string; ok: boolean } | null>(null);

  const computed = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const colors = React.useMemo(() => projectColors(data.nodes), [data.nodes]);
  const names = React.useMemo(() => Object.fromEntries(data.nodes.map((n) => [n.id, n.name])), [data.nodes]);
  const archived = React.useMemo(
    () => new Set(data.nodes.filter((n) => n.parentId === null && n.archived).map((n) => n.id)),
    [data.nodes],
  );
  const tasks = React.useMemo(
    () =>
      data.nodes
        .filter((n) => {
          const c = computed[n.id];
          return n.assigneeId === personId && c && !c.hasChildren && c.status !== 'CANCELLED' && !archived.has(c.rootId);
        })
        // prima quelle ancora aperte, per data di fine
        .sort((a, b) => {
          const x = computed[a.id];
          const y = computed[b.id];
          const done = Number(x.status === 'DONE') - Number(y.status === 'DONE');
          return done || (x.end ?? '9999').localeCompare(y.end ?? '9999');
        }),
    [data.nodes, computed, archived, personId],
  );
  const totalHours = React.useMemo(
    () => computeLoad(data.nodes, computed, names, buildAbsenceMap(data.absences), archived).totals[personId] ?? 0,
    [data.nodes, data.absences, computed, names, archived, personId],
  );

  // la persona può essere eliminata da un collega mentre il profilo è aperto
  React.useEffect(() => {
    if (!person) onClose();
  }, [person, onClose]);

  if (!person || !draft || !initial) return null;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const photo = draft.photo.trim();
  const photoValid = photo === '' || isPhotoUrl(photo);
  const changes = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== initial[k]);
  const dirty = changes.length > 0;
  const hoursValid = draft.hoursPerDay > 0 && draft.hoursPerDay <= 24;
  const canSave = canEdit && dirty && photoValid && hoursValid && draft.name.trim() !== '';

  const save = () => {
    if (!canSave) return;
    const patch: Partial<Person> = {};
    for (const key of changes) {
      const value = draft[key];
      (patch as Record<string, unknown>)[key] = typeof value === 'string' ? value.trim() : value;
    }
    updatePerson(person.id, patch);
    onClose();
  };

  const close = () => {
    if (canEdit && dirty && !window.confirm(t('profile.discard'))) return;
    onClose();
  };

  const today = todayISO();
  const open = tasks.filter((n) => computed[n.id].status !== 'DONE');
  const late = open.filter((n) => (computed[n.id].end ?? '9999') < today).length;

  const goTo = (nodeId: string) => {
    if (canEdit && dirty && !window.confirm(t('profile.discard'))) return;
    setUi({ page: 'project', selectedProjectId: computed[nodeId].rootId });
    onClose();
  };

  const preview: Person = { ...person, ...draft, photo: photoValid ? photo : '' };
  const photoFailed = photo !== '' && photoValid && photoState?.url === photo && !photoState.ok;
  const photoLoaded = photo !== '' && photoValid && photoState?.url === photo && photoState.ok;

  return (
    <Modal
      title={t('profile.title')}
      onClose={close}
      maxWidth={680}
      footer={
        <>
          {onAbsences && (
            <button
              type="button"
              className="btn"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                if (canEdit && dirty && !window.confirm(t('profile.discard'))) return;
                onAbsences(person.id);
              }}
            >
              {t('absence.title')}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {canEdit && dirty ? t('btn.cancel') : t('btn.close')}
          </button>
          {canEdit && (
            <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
              {t('btn.save')}
            </button>
          )}
        </>
      }
    >
      <div className="profile">
        <div className="profile-head">
          <Avatar person={preview} size={104} />
          <div className="profile-who">
            <div className="profile-name">{draft.name || '—'}</div>
            <div className="hint">{draft.role || t('profile.noRole')}</div>
            <div className="profile-links">
              {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) && (
                <a href={`mailto:${draft.email.trim()}`}>{draft.email.trim()}</a>
              )}
              {draft.phone.trim() && (
                <a href={`tel:${draft.phone.replace(/[^+0-9]/g, '')}`}>{draft.phone.trim()}</a>
              )}
            </div>
            <div className="profile-stats">
              <span>
                <b>{open.length}</b> {t('profile.openTasks')}
              </span>
              <span className={late ? 'over' : ''}>
                <b>{late}</b> {t('home.late')}
              </span>
              <span>
                <b>{fmtHours(totalHours)} h</b> {t('profile.assigned')}
              </span>
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="profile-photo">{t('profile.photo')}</label>
          <div className="profile-photo-line">
            <input
              id="profile-photo"
              type="text"
              inputMode="url"
              placeholder="https://…/foto.jpg"
              value={draft.photo}
              readOnly={!canEdit}
              aria-invalid={!photoValid || photoFailed}
              onChange={(e) => set({ photo: e.target.value })}
            />
            {canEdit && draft.photo && (
              <button type="button" className="btn sm" onClick={() => set({ photo: '' })}>
                {t('profile.photoRemove')}
              </button>
            )}
          </div>
          {/* prova di caricamento: dice subito se il link porta davvero a un'immagine */}
          {photo !== '' && photoValid && (
            <img
              key={photo}
              src={photo}
              alt=""
              referrerPolicy="no-referrer"
              style={{ display: 'none' }}
              onLoad={() => setPhotoState({ url: photo, ok: true })}
              onError={() => setPhotoState({ url: photo, ok: false })}
            />
          )}
          {!photoValid && <div className="field-error">{t('profile.photoBadUrl')}</div>}
          {photoFailed && <div className="field-error">{t('profile.photoFailed')}</div>}
          {photoLoaded && <div className="field-ok">{t('profile.photoOk')}</div>}
          {canEdit && <div className="hint">{t('profile.photoHint')}</div>}
        </div>

        <div className="profile-grid">
          <div className="field">
            <label htmlFor="profile-name">{t('people.name')}</label>
            <input
              id="profile-name"
              type="text"
              value={draft.name}
              readOnly={!canEdit}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-role">{t('people.role')}</label>
            <input
              id="profile-role"
              type="text"
              list="gantt-profile-roles"
              value={draft.role}
              readOnly={!canEdit}
              onChange={(e) => set({ role: e.target.value })}
            />
            <datalist id="gantt-profile-roles">
              {[...new Set(data.people.map((p) => p.role.trim()).filter(Boolean))].sort().map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="profile-email">{t('profile.email')}</label>
            <input
              id="profile-email"
              type="text"
              inputMode="email"
              maxLength={200}
              value={draft.email}
              readOnly={!canEdit}
              onChange={(e) => set({ email: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-phone">{t('profile.phone')}</label>
            <input
              id="profile-phone"
              type="text"
              inputMode="tel"
              maxLength={60}
              value={draft.phone}
              readOnly={!canEdit}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="profile-hours">{t('people.hoursPerDay')}</label>
            <input
              id="profile-hours"
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={draft.hoursPerDay || ''}
              readOnly={!canEdit}
              onChange={(e) => set({ hoursPerDay: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>{t('people.color')}</label>
            <ColorPicker
              title={t('people.color')}
              label={t('colors.change')}
              value={draft.color}
              disabled={!canEdit}
              onChange={(color) => set({ color })}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="profile-about">{t('profile.about')}</label>
          <textarea
            id="profile-about"
            rows={3}
            maxLength={2000}
            value={draft.about}
            readOnly={!canEdit}
            placeholder={t('profile.aboutHint')}
            onChange={(e) => set({ about: e.target.value })}
          />
        </div>

        <div className="io-label">{t('profile.tasks')}</div>
        {tasks.length === 0 && <div className="hint">{t('profile.noTasks')}</div>}
        {tasks.slice(0, MAX_TASKS).map((n) => {
          const c = computed[n.id];
          return (
            <button type="button" key={n.id} className="profile-task" onClick={() => goTo(n.id)}>
              <span className="dot" style={{ background: colors[c.rootId] }} />
              <span className="profile-task-name">
                {n.name}
                <small>{names[c.rootId]}</small>
              </span>
              <StatusChip status={c.status} lang={lang} />
              <span className={'profile-task-date' + (c.status !== 'DONE' && c.end && c.end < today ? ' over' : '')}>
                {formatDate(c.end, lang)}
              </span>
            </button>
          );
        })}
        {tasks.length > MAX_TASKS && <div className="hint">{t('profile.moreTasks', { n: tasks.length - MAX_TASKS })}</div>}
      </div>
    </Modal>
  );
}
