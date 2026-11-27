// Nomi e valori dei campi in forma leggibile: servono agli avvisi («Anna ha cambiato le ore…»)
// e al registro delle modifiche.
import type { AppData, Lang } from '../types';
import { translate, type TKey } from '../i18n';
import { formatDate } from './dates';
import type { RecordKind } from '../../shared/ops.mjs';

const LABELS: Record<RecordKind, Record<string, TKey>> = {
  node: {
    name: 'col.name',
    status: 'col.status',
    start: 'col.start',
    end: 'col.end',
    hours: 'col.hours',
    assigneeId: 'col.assignee',
    notes: 'col.notes',
    archived: 'archive.archived',
    color: 'project.color',
  },
  person: {
    name: 'people.name',
    role: 'people.role',
    color: 'people.color',
    hoursPerDay: 'people.hoursPerDay',
    photo: 'profile.photoColumn',
    email: 'profile.email',
    phone: 'profile.phone',
    about: 'profile.about',
  },
  absence: { personId: 'absence.person', start: 'absence.from', end: 'absence.to', type: 'absence.type', note: 'absence.note' },
  note: { title: 'notes.noteTitle', body: 'notes.body', tags: 'notes.tags', pinned: 'notes.pin' },
};

export function fieldLabel(lang: Lang, t: RecordKind, field: string): string {
  const key = LABELS[t]?.[field];
  return key ? translate(lang, key) : field;
}

export function fieldValue(lang: Lang, data: AppData, t: RecordKind, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return translate(lang, 'notice.empty');
  if (typeof value === 'boolean') return translate(lang, value ? 'notice.yes' : 'notice.no');
  if ((field === 'start' || field === 'end') && typeof value === 'string') return formatDate(value, lang);
  if (field === 'status') return translate(lang, `status.${String(value)}` as TKey);
  if (t === 'absence' && field === 'type') return translate(lang, `absence.${String(value)}` as TKey);
  if (field === 'assigneeId' || field === 'personId') return data.people.find((p) => p.id === value)?.name ?? '?';
  if (field === 'body') return translate(lang, 'log.textChanged');
  if (typeof value === 'number') return String(Math.round(value * 100) / 100).replace('.', ',');
  if (Array.isArray(value)) return value.join(', ');
  const text = String(value);
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}
