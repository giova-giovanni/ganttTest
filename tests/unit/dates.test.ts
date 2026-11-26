import { describe, expect, it } from 'vitest';
import {
  addDays,
  countWorkingDays,
  diffDays,
  isoWeek,
  isoWeekYear,
  isWeekend,
  nextWorkday,
  parseUserDate,
  startOfWeek,
  workingDays,
} from '../../src/utils/dates';

describe('date e giorni lavorativi', () => {
  it('conta solo i giorni da lunedì a venerdì', () => {
    // 2 marzo 2026 è un lunedì
    expect(workingDays('2026-03-02', '2026-03-08')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
    expect(countWorkingDays('2026-03-02', '2026-03-13')).toBe(10);
    expect(countWorkingDays('2026-03-07', '2026-03-08')).toBe(0); // solo weekend
    expect(countWorkingDays(null, '2026-03-08')).toBe(0);
  });

  it('riconosce il weekend e salta al primo giorno lavorativo', () => {
    expect(isWeekend('2026-03-07')).toBe(true);
    expect(isWeekend('2026-03-09')).toBe(false);
    expect(nextWorkday('2026-03-07')).toBe('2026-03-09');
  });

  it('somma e differenze di giorni attraverso mesi, anni e cambio dell’ora legale', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2); // fine settimana del cambio d'ora
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('settimana ISO e lunedì della settimana', () => {
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-23')).toBe('2026-11-23');
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23'); // la domenica appartiene alla settimana che finisce
    expect(isoWeek('2026-01-01')).toBe(1);
    // il 2026 ha 53 settimane ISO: il 1° gennaio 2027 è ancora nella 53 del 2026
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeekYear('2027-01-01')).toBe(2026);
  });

  it('legge le date scritte a mano e rifiuta quelle inesistenti', () => {
    expect(parseUserDate('28/07/2026')).toBe('2026-07-28');
    expect(parseUserDate('28.07.2026')).toBe('2026-07-28');
    expect(parseUserDate('28-7-26')).toBe('2026-07-28');
    expect(parseUserDate('2026-07-28')).toBe('2026-07-28');
    expect(parseUserDate('31/02/2026')).toBeNull();
    expect(parseUserDate('domani')).toBeNull();
    expect(parseUserDate('   ')).toBeNull();
  });
});
