import type { Lang } from '../types';
import { LOCALE } from '../i18n';

const pad = (n: number) => (n < 10 ? '0' + n : String(n));

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** giorni di calendario tra due date (b - a) */
export function diffDays(a: string, b: string): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86400000);
}

export function isWeekend(iso: string): boolean {
  const wd = parseISO(iso).getDay();
  return wd === 0 || wd === 6;
}

export function minISO(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function maxISO(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function clampISO(iso: string, min: string, max: string): string {
  return iso < min ? min : iso > max ? max : iso;
}

/** elenco dei giorni lavorativi (lun-ven) compresi tra start ed end inclusi */
export function workingDays(start: string, end: string): string[] {
  const out: string[] = [];
  if (!start || !end || end < start) return out;
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 20000) {
    if (!isWeekend(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function countWorkingDays(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  return workingDays(start, end).length;
}

/** giorno lavorativo più vicino (avanti) */
export function nextWorkday(iso: string): string {
  let cur = iso;
  let guard = 0;
  while (isWeekend(cur) && guard++ < 10) cur = addDays(cur, 1);
  return cur;
}

export function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return lang === 'de'
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateShort(iso: string, lang: Lang): string {
  const d = parseISO(iso);
  return lang === 'de'
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** accetta 28/07/2026 · 28.07.2026 · 28-7-26 · 2026-07-28 · 28/07 (anno corrente) */
export function parseUserDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(s);
  if (m) {
    let year = m[3] ? +m[3] : new Date().getFullYear();
    if (year < 100) year += 2000;
    return build(year, +m[2], +m[1]);
  }
  return null;

  /** rifiuta le date inesistenti (31/02) invece di salvarle e scivolare al mese dopo */
  function build(y: number, month: number, day: number): string | null {
    if (month < 1 || month > 12 || day < 1 || day > 31 || y < 1900 || y > 2200) return null;
    const d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
}

export function monthName(date: Date, lang: Lang, long = true): string {
  return date.toLocaleDateString(LOCALE[lang], { month: long ? 'long' : 'short' });
}

export function weekdayName(date: Date, lang: Lang, style: 'short' | 'narrow' = 'short'): string {
  return date.toLocaleDateString(LOCALE[lang], { weekday: style });
}

/** giovedì della settimana ISO che contiene `d` (determina anno e numero di settimana) */
function isoThursday(d: Date): Date {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
  return t;
}

/** numero settimana ISO 8601 (1..53) */
export function isoWeek(iso: string): number {
  const target = isoThursday(parseISO(iso));
  // giovedì della settimana 1 dell'anno del target: la settimana che contiene il 4 gennaio
  const week1Thursday = isoThursday(new Date(target.getFullYear(), 0, 4));
  const diffDaysExact = Math.round((target.getTime() - week1Thursday.getTime()) / 86400000);
  return 1 + Math.round(diffDaysExact / 7);
}

/** anno ISO 8601 della settimana (può differire dall'anno di calendario a cavallo di dicembre/gennaio) */
export function isoWeekYear(iso: string): number {
  return isoThursday(parseISO(iso)).getFullYear();
}

/** lunedì della settimana di iso */
export function startOfWeek(iso: string): string {
  const d = parseISO(iso);
  const dayNr = (d.getDay() + 6) % 7;
  return addDays(iso, -dayNr);
}

export function startOfMonth(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** primo giorno del mese spostato di n mesi (usata per navigare i calendari) */
export function addMonths(iso: string, n: number): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
