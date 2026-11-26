import { describe, expect, it } from 'vitest';
import { buildAbsenceMap, capacityOf, computeLoad, loadPercent, UNASSIGNED } from '../../src/utils/load';
import { computeAll } from '../../src/utils/tree';
import type { Absence } from '../../src/types';
import { node, person } from './helpers';

const week = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];

function load(nodes: ReturnType<typeof node>[], absences: Absence[] = [], exclude: string[] = []) {
  return computeLoad(nodes, computeAll(nodes), { p: 'Progetto' }, buildAbsenceMap(absences), new Set(exclude));
}

describe('carico di lavoro', () => {
  it('le ore si distribuiscono sui giorni lavorativi dell’attività', () => {
    const r = load([
      node('p', null),
      node('t', 'p', { start: '2026-03-02', end: '2026-03-08', hours: 40, assigneeId: 'mario' }),
    ]);
    for (const d of week) expect(r.map.mario[d].hours).toBe(8);
    expect(r.map.mario['2026-03-07']).toBeUndefined(); // sabato
    expect(r.totals.mario).toBe(40);
  });

  it('i giorni di assenza del responsabile vengono saltati', () => {
    const ferie: Absence = { id: 'f', personId: 'mario', start: '2026-03-04', end: '2026-03-04', type: 'VACATION', note: '' };
    const r = load(
      [node('p', null), node('t', 'p', { start: '2026-03-02', end: '2026-03-06', hours: 40, assigneeId: 'mario' })],
      [ferie],
    );
    expect(r.map.mario['2026-03-04']).toBeUndefined();
    expect(r.map.mario['2026-03-02'].hours).toBe(10);
    expect(r.conflicts).toEqual([]);
  });

  it('un’attività tutta dentro un’assenza viene segnalata come conflitto', () => {
    const ferie: Absence = { id: 'f', personId: 'mario', start: '2026-03-02', end: '2026-03-06', type: 'VACATION', note: '' };
    const r = load(
      [node('p', null), node('t', 'p', { start: '2026-03-02', end: '2026-03-06', hours: 10, assigneeId: 'mario' })],
      [ferie],
    );
    expect(r.conflicts).toEqual(['t']);
    expect(r.map.mario['2026-03-02'].hours).toBe(2);
  });

  it('si sommano più attività nello stesso giorno; i rami padre non contano', () => {
    const r = load([
      node('p', null),
      node('ramo', 'p', { hours: 999, start: '2026-03-02', end: '2026-03-06', assigneeId: 'mario' }),
      node('t1', 'ramo', { start: '2026-03-02', end: '2026-03-06', hours: 20, assigneeId: 'mario' }),
      node('t2', 'ramo', { start: '2026-03-02', end: '2026-03-03', hours: 8, assigneeId: 'mario' }),
    ]);
    expect(r.map.mario['2026-03-02'].hours).toBe(8);
    expect(r.map.mario['2026-03-02'].tasks.map((x) => x.nodeId).sort()).toEqual(['t1', 't2']);
    expect(r.totals.mario).toBe(28);
  });

  it('annullate, progetti esclusi e attività senza responsabile', () => {
    const r = load(
      [
        node('p', null),
        node('annullata', 'p', { status: 'CANCELLED', start: '2026-03-02', end: '2026-03-06', hours: 40, assigneeId: 'mario' }),
        node('libera', 'p', { start: '2026-03-02', end: '2026-03-02', hours: 4 }),
        node('q', null),
        node('archiviata', 'q', { start: '2026-03-02', end: '2026-03-06', hours: 40, assigneeId: 'mario' }),
      ],
      [],
      ['q'],
    );
    expect(r.map.mario).toBeUndefined();
    expect(r.map[UNASSIGNED]['2026-03-02'].hours).toBe(4);
  });

  it('percentuale rispetto alle ore/giorno della persona', () => {
    expect(capacityOf(person('pm', 'Luca Verdi', 6))).toBe(6);
    expect(capacityOf(undefined)).toBe(8);
    expect(loadPercent(6, 6)).toBe(100);
    expect(loadPercent(12, 8)).toBe(150);
  });
});
