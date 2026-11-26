// Le «5 regole di calcolo» del README: rollup dell'albero (tree.ts) e distribuzione del carico (load.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../src/utils/tree.ts';
import { buildAbsenceMap, computeLoad, UNASSIGNED } from '../src/utils/load.ts';
import { countWorkingDays, isoWeek, parseUserDate, workingDays } from '../src/utils/dates.ts';
import { node } from './helpers/tmp.mjs';

const tree = () => [
  node('p', 'Progetto', null, { start: '2026-01-01', end: '2026-03-31' }), // date «baseline» del progetto
  node('m', 'Meccanica', 'p'),
  node('m1', 'Progettazione', 'm', { start: '2026-03-02', end: '2026-03-06', hours: 20, status: 'DONE' }),
  node('m2', 'Montaggio', 'm', { start: '2026-03-09', end: '2026-03-13', hours: 20, status: 'TODO' }),
  node('x', 'Annullata', 'p', { start: '2026-02-01', end: '2026-06-30', hours: 500, status: 'CANCELLED' }),
  node('s', 'Software', 'p', { start: '2026-03-16', end: '2026-04-10', hours: 40, status: 'IN_PROGRESS' }),
];

test('un padre: inizio = minimo, fine = massimo, ore = somma (le annullate non contano)', () => {
  const c = computeAll(tree());
  assert.equal(c.m.start, '2026-03-02');
  assert.equal(c.m.end, '2026-03-13');
  assert.equal(c.m.hours, 40);
  assert.equal(c.p.start, '2026-03-02');
  assert.equal(c.p.end, '2026-04-10');
  assert.equal(c.p.hours, 80);
  assert.equal(c.m.status, 'IN_PROGRESS');
  assert.equal(c.m.progress, 0.5);
  assert.equal(c.p.progress, 0.25);
  assert.equal(c.p.overrun, true, 'la fine calcolata supera la fine pianificata a mano');
  assert.equal(c.m2.workDays, 5);
});

test('rami tutti annullati / tutti finiti', () => {
  const c = computeAll([
    node('a', 'A'),
    node('a1', 'x', 'a', { status: 'CANCELLED' }),
    node('b', 'B'),
    node('b1', 'y', 'b', { status: 'DONE' }),
    node('b2', 'z', 'b', { status: 'CANCELLED' }),
  ]);
  assert.equal(c.a.status, 'CANCELLED');
  assert.equal(c.b.status, 'DONE');
  assert.equal(c.b.progress, 1);
});

test('ore spalmate sui giorni lavorativi, saltando le assenze del responsabile', () => {
  const nodes = [
    node('p', 'P'),
    node('t', 'T', 'p', { start: '2026-03-09', end: '2026-03-13', hours: 32, assigneeId: 'mario' }), // lun–ven
  ];
  const abs = buildAbsenceMap([{ id: 'a', personId: 'mario', start: '2026-03-11', end: '2026-03-11', type: 'SICK', note: '' }]);
  const { map, totals, conflicts } = computeLoad(nodes, computeAll(nodes), { p: 'P' }, abs);
  assert.equal(map.mario['2026-03-11'], undefined, 'nessuna ora nel giorno di malattia');
  assert.equal(map.mario['2026-03-09'].hours, 8);
  assert.equal(Object.keys(map.mario).length, 4);
  assert.equal(totals.mario, 32);
  assert.deepEqual(conflicts, []);
});

test('attività tutta in giorni di assenza: segnalata come conflitto e comunque conteggiata', () => {
  const nodes = [node('p', 'P'), node('t', 'T', 'p', { start: '2026-03-09', end: '2026-03-10', hours: 10, assigneeId: 'mario' })];
  const abs = buildAbsenceMap([{ id: 'a', personId: 'mario', start: '2026-03-02', end: '2026-03-20', type: 'VACATION', note: '' }]);
  const { map, conflicts } = computeLoad(nodes, computeAll(nodes), { p: 'P' }, abs);
  assert.deepEqual(conflicts, ['t']);
  assert.equal(map.mario['2026-03-09'].hours, 5);
});

test('progetti archiviati e attività annullate fuori dal carico; non assegnate a parte', () => {
  const nodes = [
    node('p', 'P'),
    node('t', 'T', 'p', { start: '2026-03-09', end: '2026-03-09', hours: 4 }),
    node('c', 'C', 'p', { start: '2026-03-09', end: '2026-03-09', hours: 4, status: 'CANCELLED', assigneeId: 'mario' }),
    node('q', 'Q', null, { archived: true }),
    node('q1', 'Q1', 'q', { start: '2026-03-09', end: '2026-03-09', hours: 4, assigneeId: 'mario' }),
  ];
  const { map } = computeLoad(nodes, computeAll(nodes), {}, {}, new Set(['q']));
  assert.equal(map[UNASSIGNED]['2026-03-09'].hours, 4);
  assert.equal(map.mario, undefined);
});

test('date: giorni lavorativi, settimana ISO, date scritte a mano', () => {
  assert.equal(countWorkingDays('2026-03-06', '2026-03-09'), 2); // ven + lun
  assert.deepEqual(workingDays('2026-03-07', '2026-03-08'), []); // sab + dom
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2027-01-01'), 53);
  assert.equal(parseUserDate('29/02/2026'), null);
  assert.equal(parseUserDate('28.02.26'), '2026-02-28');
});
