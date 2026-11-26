import { describe, expect, it } from 'vitest';
import { formatNumber, parseCsv, parseCsvDate, parseNumber, toCsv } from '../../src/utils/csv';
import { analyzeImport, buildTasksCsv, defaultExportOptions, parseImport } from '../../src/utils/io';
import { demoData } from '../../src/demo';
import { migrate } from '../../src/store';
import { data } from './helpers';

describe('CSV in stile Excel IT/DE', () => {
  it('numeri con virgola o punto decimale', () => {
    expect(parseNumber('16,5')).toBe(16.5);
    expect(parseNumber('16.5')).toBe(16.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('40%')).toBe(40);
    expect(parseNumber('8 h')).toBe(8);
    expect(parseNumber('abc')).toBeNull();
    expect(formatNumber(16.5)).toBe('16,5');
  });

  it('date in tutti i formati comuni, compreso il numero seriale di Excel', () => {
    expect(parseCsvDate('15/03/2026')).toBe('2026-03-15');
    expect(parseCsvDate('15.03.2026')).toBe('2026-03-15');
    expect(parseCsvDate('2026-03-15')).toBe('2026-03-15');
    expect(parseCsvDate('46096')).toBe('2026-03-15');
    expect(parseCsvDate('31/02/2026')).toBeNull();
  });

  it('virgolette, separatori e a capo dentro le celle', () => {
    const text = 'Attività;Note\n"Riga ""uno""";"prima riga\nseconda riga"\nDue;"a;b"\n';
    expect(parseCsv(text)).toEqual([
      ['Attività', 'Note'],
      ['Riga "uno"', 'prima riga\nseconda riga'],
      ['Due', 'a;b'],
    ]);
    const rows = [['a;b', 'c"d', 'e']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('esportazione e reimportazione', () => {
  it('il CSV delle attività si reimporta con la stessa struttura', () => {
    const demo = demoData();
    const csv = buildTasksCsv(demo, 'it', { ...defaultExportOptions, dataset: 'tasks' });
    const preview = analyzeImport(csv, 'attivita.csv', data([]), 'it');
    expect(preview.ok).toBe(true);
    expect(preview.kind).toBe('tasks');
    // i progetti archiviati non vengono esportati di default
    expect(preview.counts.projects).toBe(2);
    const exportedRows = demo.nodes.filter((n) => !['gamma', 'gamma-mec', 'gamma-sw', 'gamma-col'].includes(n.id));
    expect(preview.counts.projects + preview.counts.tasks).toBe(exportedRows.length);
    // i responsabili vengono riconosciuti per nome
    expect(preview.data.people.map((p) => p.name).sort()).toEqual(demo.people.map((p) => p.name).sort());
  });

  it('il backup JSON completo si rilegge identico', () => {
    const demo = demoData();
    const back = parseImport(JSON.stringify(demo));
    expect(back).not.toBeNull();
    expect(back).toEqual(migrate(demo));
    expect(parseImport('non è json')).toBeNull();
  });

  it('un CSV scritto a mano con colonne in tedesco', () => {
    const csv = [
      'Ebene;Aufgabe;Beginn;Ende;Stunden;Verantwortlich;Status',
      '1;Projekt X;;;;;',
      '2;Planung;02.03.2026;06.03.2026;16,5;Max Mustermann;IN ARBEIT',
      '2;Montage;09.03.2026;13.03.2026;40;Erika Mustermann;OFFEN',
    ].join('\n');
    const preview = analyzeImport(csv, 'aufgaben.csv', data([]), 'de');
    expect(preview.ok).toBe(true);
    const planung = preview.data.nodes.find((n) => n.name === 'Planung')!;
    expect(planung.start).toBe('2026-03-02');
    expect(planung.hours).toBe(16.5);
    expect(planung.status).toBe('IN_PROGRESS');
    const root = preview.data.nodes.find((n) => n.name === 'Projekt X')!;
    expect(planung.parentId).toBe(root.id);
    expect(preview.data.people).toHaveLength(2);
  });
});
