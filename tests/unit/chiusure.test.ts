// Chiusure aziendali (ponti, festività): un’assenza senza persona che vale per tutti i responsabili.
import { describe, expect, it } from 'vitest';
import { absentDays, buildAbsenceMap, closureDays, computeLoad, isAbsent, UNASSIGNED } from '../../src/utils/load';
import { computeAll } from '../../src/utils/tree';
import { migrate } from '../../src/store';
import { rebase } from '../../src/utils/merge';
import type { Absence, AppData } from '../../src/types';
import { node, person } from './helpers';

/** mercoledì 4 marzo 2026: chiusura per il ponte */
const ponte: Absence = { id: 'c', personId: null, start: '2026-03-04', end: '2026-03-04', type: 'CLOSURE', note: 'Ponte' };

function load(nodes: ReturnType<typeof node>[], absences: Absence[] = []) {
  return computeLoad(nodes, computeAll(nodes), { p: 'Progetto' }, buildAbsenceMap(absences), new Set());
}

describe('chiusure aziendali nel carico di lavoro', () => {
  it('vale per tutti: nessun responsabile riceve carico quel giorno e le ore passano agli altri giorni', () => {
    const r = load(
      [
        node('p', null),
        node('t1', 'p', { start: '2026-03-02', end: '2026-03-06', hours: 40, assigneeId: 'mario' }),
        node('t2', 'p', { start: '2026-03-02', end: '2026-03-06', hours: 40, assigneeId: 'luigi' }),
      ],
      [ponte],
    );
    expect(r.map.mario['2026-03-04']).toBeUndefined();
    expect(r.map.luigi['2026-03-04']).toBeUndefined();
    expect(r.map.mario['2026-03-02'].hours).toBe(10); // 40 h su 4 giorni invece di 5
    expect(r.totals).toEqual({ mario: 40, luigi: 40 }); // nessuna ora persa
    expect(r.conflicts).toEqual([]);
  });

  it('vale anche per le attività non assegnate', () => {
    const r = load([node('p', null), node('t', 'p', { start: '2026-03-02', end: '2026-03-06', hours: 40 })], [ponte]);
    expect(r.map[UNASSIGNED]['2026-03-04']).toBeUndefined();
    expect(r.map[UNASSIGNED]['2026-03-02'].hours).toBe(10);
  });

  it('un’attività tutta dentro una chiusura viene segnalata come conflitto, come per le assenze personali', () => {
    const r = load(
      [node('p', null), node('t', 'p', { start: '2026-03-04', end: '2026-03-04', hours: 8, assigneeId: 'mario' })],
      [ponte],
    );
    expect(r.conflicts).toEqual(['t']);
  });
});

describe('chiusure aziendali: chi è assente e quando', () => {
  it('isAbsent e absentDays: la chiusura copre tutti; l’assenza personale ha la precedenza', () => {
    const ferie: Absence = { id: 'f', personId: 'mario', start: '2026-03-04', end: '2026-03-04', type: 'VACATION', note: '' };
    const map = buildAbsenceMap([ponte, ferie]);
    expect(isAbsent(map, 'mario', '2026-03-04')?.type).toBe('VACATION');
    expect(isAbsent(map, 'luigi', '2026-03-04')?.type).toBe('CLOSURE');
    expect(isAbsent(map, null, '2026-03-04')?.type).toBe('CLOSURE');
    expect(isAbsent(map, 'luigi', '2026-03-05')).toBeUndefined();
    expect([...absentDays(map, 'luigi')]).toEqual(['2026-03-04']);
  });

  it('closureDays conta solo i giorni lavorativi delle chiusure, non quelli delle assenze personali', () => {
    const sabatoLunedi: Absence = { id: 'w', personId: null, start: '2026-03-07', end: '2026-03-09', type: 'CLOSURE', note: '' };
    const ferie: Absence = { id: 'f', personId: 'mario', start: '2026-03-10', end: '2026-03-10', type: 'VACATION', note: '' };
    expect([...closureDays([ponte, sabatoLunedi, ferie])].sort()).toEqual(['2026-03-04', '2026-03-09']);
  });
});

describe('chiusure aziendali nei dati', () => {
  it('normalizzazione: una chiusura non ha persona, anche se il file ne indica una; un’assenza senza persona valida si scarta', () => {
    const m = migrate({
      people: [person('p1', 'Mario Rossi')],
      absences: [
        { id: 'c1', personId: 'p1', start: '2026-03-04', end: '2026-03-04', type: 'CLOSURE', note: '' },
        { id: 'c2', personId: null, start: '2026-03-05', end: '2026-03-05', type: 'CLOSURE', note: '' },
        { id: 'v1', personId: null, start: '2026-03-06', end: '2026-03-06', type: 'VACATION', note: '' },
        { id: 'v2', personId: 'p1', start: '2026-03-06', end: '2026-03-06', type: 'VACATION', note: '' },
      ],
    });
    expect(m.absences.map((a) => [a.id, a.personId, a.type])).toEqual([
      ['c1', null, 'CLOSURE'],
      ['c2', null, 'CLOSURE'],
      ['v2', 'p1', 'VACATION'],
    ]);
  });

  it('unione tra utenti: se un altro elimina il responsabile, la chiusura resta e le sue assenze personali no', () => {
    const mario = person('p1', 'Mario Rossi');
    const ferie: Absence = { id: 'f', personId: 'p1', start: '2026-03-09', end: '2026-03-09', type: 'VACATION', note: '' };
    const base: AppData = { version: 4, nodes: [], people: [mario], absences: [ponte, ferie], notes: [] };
    // l’altro utente ha eliminato il responsabile con le sue assenze; la chiusura è rimasta
    const theirs: AppData = { ...base, people: [], absences: [ponte] };
    const r = rebase(base, base, theirs);
    expect(r.data.absences.map((a) => a.id)).toEqual(['c']);
  });
});
