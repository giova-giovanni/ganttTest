// Import con anteprima (src/utils/io.ts): JSON, gerarchie, colonne riconosciute, andata e ritorno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImport, buildAbsencesCsv, buildTasksCsv, defaultExportOptions } from '../src/utils/io.ts';
import { migrate } from '../src/store.ts';
import { node } from './helpers/tmp.mjs';

const empty = migrate({});
const mario = { id: 'p1', name: 'Mario Rossi', role: 'PM', color: '#2f7de1', hoursPerDay: 8 };
const byName = (nodes) => Object.fromEntries(nodes.map((n) => [n.name, n]));

test('import di un file della cartella dati (gantt-dati.json, .bak, versioni/) non risulta «vuoto»', () => {
  const envelope = {
    kind: 'gantt-data',
    rev: 12,
    savedAt: '2026-08-04T14:16:00.000Z',
    savedBy: 'Mario (PC-1)',
    data: { version: 4, nodes: [node('p1', 'Progetto'), node('t1', 'Attività', 'p1')], people: [], absences: [], notes: [] },
  };
  const r = analyzeImport(JSON.stringify(envelope, null, 2), 'gantt-2026-08-04-14-16.json', empty, 'it');
  assert.equal(r.ok, true, r.errorKey);
  assert.equal(r.kind, 'backup');
  assert.equal(r.counts.projects, 1);
  assert.equal(r.counts.tasks, 1);
});

test('backup JSON normale: invariato', () => {
  const data = { version: 4, nodes: [node('p1', 'Progetto')], people: [mario], absences: [], notes: [] };
  const r = analyzeImport(JSON.stringify(data), 'GANTT_backup.json', empty, 'it');
  assert.equal(r.ok, true);
  assert.equal(r.counts.projects, 1);
  assert.equal(r.counts.people, 1);
});

test('export attività → import: stessa struttura (IT e DE)', () => {
  const data = migrate({
    people: [mario],
    nodes: [
      node('p', 'P-199 Beta'),
      node('m', 'Meccanica', 'p'),
      node('a', 'Progettazione', 'm', { hours: 40, start: '2026-03-09', end: '2026-03-20', assigneeId: 'p1', status: 'IN_PROGRESS' }),
      node('s', 'Software', 'p', { hours: 12.5, start: '2026-03-23', end: '2026-03-27' }),
    ],
  });
  for (const lang of ['it', 'de']) {
    const csv = buildTasksCsv(data, lang, { ...defaultExportOptions, dataset: 'tasks' });
    const r = analyzeImport(csv, 'attivita.csv', data, lang);
    assert.equal(r.ok, true);
    const n = byName(r.data.nodes);
    assert.equal(r.counts.projects, 1, lang);
    assert.equal(n['Meccanica'].parentId, n['P-199 Beta'].id);
    assert.equal(n['Progettazione'].parentId, n['Meccanica'].id);
    assert.equal(n['Progettazione'].hours, 40);
    assert.equal(n['Progettazione'].start, '2026-03-09');
    assert.equal(n['Progettazione'].status, 'IN_PROGRESS');
    assert.equal(n['Progettazione'].assigneeId, 'p1');
    assert.equal(n['Software'].hours, 12.5);
  }
});

test('righe aggiunte in Excel senza ID: finiscono nel ramo indicato dal livello, non tra i progetti', () => {
  const csv = [
    'Livello;ID;ID padre;Progetto;Attività;Ore prev. (h)',
    '1;n_p;;P-199;P-199;',
    '2;n_m;n_p;P-199;  Meccanica;',
    '3;n_a;n_m;P-199;    Progettazione;40',
    '3;;;P-199;    Montaggio (nuova riga);16',
    '2;;;P-199;  Software (nuovo ramo);',
    '3;;;P-199;    PLC (nuova riga);24',
  ].join('\n');
  const r = analyzeImport(csv, 'attivita.csv', empty, 'it');
  assert.equal(r.ok, true);
  const n = byName(r.data.nodes);
  assert.equal(r.counts.projects, 1);
  assert.equal(n['Montaggio (nuova riga)'].parentId, n['Meccanica'].id);
  assert.equal(n['Software (nuovo ramo)'].parentId, n['P-199'].id);
  assert.equal(n['PLC (nuova riga)'].parentId, n['Software (nuovo ramo)'].id);
});

test('colonne Livello e Progetto senza ID: il progetto non viene annidato dentro un doppione', () => {
  const csv = [
    'Livello;Progetto;Attività;Ore',
    '1;P-199 Beta;P-199 Beta;',
    '2;P-199 Beta;Meccanica;',
    '3;P-199 Beta;Progettazione;40',
    '1;P-200 Alfa;P-200 Alfa;',
    '2;P-200 Alfa;Software;12',
  ].join('\n');
  const r = analyzeImport(csv, 'x.csv', empty, 'it');
  assert.equal(r.ok, true);
  const roots = r.data.nodes.filter((x) => x.parentId === null).map((x) => x.name);
  assert.deepEqual(roots.sort(), ['P-199 Beta', 'P-200 Alfa']);
  assert.equal(r.data.nodes.length, 5);
  const n = byName(r.data.nodes);
  assert.equal(n['Meccanica'].parentId, n['P-199 Beta'].id);
  assert.equal(n['Software'].parentId, n['P-200 Alfa'].id);
});

test('colonna Progetto con elenco piatto di attività: contenitore per progetto (invariato)', () => {
  const csv = ['Progetto;Attività;Ore', 'P-199;Montaggio;8', 'P-199;Collaudo;4', 'P-200;Disegni;2'].join('\n');
  const r = analyzeImport(csv, 'x.csv', empty, 'it');
  const n = byName(r.data.nodes);
  assert.equal(r.counts.projects, 2);
  assert.equal(n['Montaggio'].parentId, n['P-199'].id);
  assert.equal(n['Disegni'].parentId, n['P-200'].id);
});

test('colonna WBS di MS Project (1 / 1.1 / 1.1.1): diventa la gerarchia', () => {
  const csv = ['WBS;Name;Start', '1;Projekt X;', '1.1;Mechanik;', '1.1.1;Konstruktion;15.03.2026', '1.2;Software;', '2;Projekt Y;'].join('\n');
  const r = analyzeImport(csv, 'plan.csv', empty, 'de');
  assert.equal(r.ok, true);
  const n = byName(r.data.nodes);
  assert.deepEqual(r.data.nodes.filter((x) => x.parentId === null).map((x) => x.name).sort(), ['Projekt X', 'Projekt Y']);
  assert.equal(n['Mechanik'].parentId, n['Projekt X'].id);
  assert.equal(n['Konstruktion'].parentId, n['Mechanik'].id);
  assert.equal(n['Software'].parentId, n['Projekt X'].id);
  assert.equal(n['Konstruktion'].start, '2026-03-15');
});

test('assenze: esporta → reimporta senza perdere la nota (IT e DE)', () => {
  const data = migrate({
    people: [mario],
    absences: [{ id: 'a1', personId: 'p1', start: '2026-03-09', end: '2026-03-13', type: 'VACATION', note: 'Viaggio' }],
  });
  for (const lang of ['it', 'de']) {
    const r = analyzeImport(buildAbsencesCsv(data, lang), 'assenze.csv', data, lang);
    assert.equal(r.kind, 'absences', lang);
    const a = r.data.absences[0];
    assert.equal(a.personId, 'p1');
    assert.equal(a.start, '2026-03-09');
    assert.equal(a.end, '2026-03-13');
    assert.equal(a.type, 'VACATION');
    assert.equal(a.note, 'Viaggio', lang);
  }
});

test('una colonna «Altro» non viene scambiata per la data di fine (Al)', () => {
  const data = migrate({ people: [mario] });
  const csv = ['Responsabile;Dal;Altro;Al;Motivo', 'Mario Rossi;09/03/2026;qualcosa;13/03/2026;Ferie'].join('\n');
  const r = analyzeImport(csv, 'assenze.csv', data, 'it');
  assert.equal(r.kind, 'absences');
  assert.equal(r.data.absences[0].end, '2026-03-13');
  assert.equal(r.columns.find((c) => c.header === 'Altro').field, null);
});
