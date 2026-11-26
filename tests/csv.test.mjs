// Lettura CSV (src/utils/csv.ts): separatori, virgolette, date e numeri come li scrive Excel IT/DE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseCsv, parseCsvDate, parseNumber, toCsv } from '../src/utils/csv.ts';

test('«;» riconosciuto anche quando il testo contiene molte virgole (file risalvato da Excel, senza riga sep=)', () => {
  const text = [
    'Attività;Ore;Note',
    'Montaggio, cablaggio e collaudo;16,5;Verificare viti, dadi, rondelle',
    'Progettazione, disegni;8;Note: A, B, C, D',
    'Ordini;2,5;',
  ].join('\r\n');
  assert.equal(detectDelimiter(text), ';');
  const rows = parseCsv(text);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], ['Montaggio, cablaggio e collaudo', '16,5', 'Verificare viti, dadi, rondelle']);
});

test('gli altri separatori continuano a funzionare', () => {
  assert.equal(detectDelimiter('Task,Hours,Start\nAssembly,16.5,2026-03-15\nDesign,8,2026-03-16\n'), ',');
  assert.equal(detectDelimiter('Aufgabe\tStunden\nMontage\t16,5\nKonstruktion\t8\n'), '\t');
  assert.equal(detectDelimiter('Nome|Ruolo\nMario|PM\n'), '|');
  assert.equal(detectDelimiter('Solo una colonna\nRiga\n'), ';');
  // la riga sep= di Excel vince sempre
  assert.deepEqual(parseCsv('sep=,\nA,B\n1;2,3\n'), [['A', 'B'], ['1;2', '3']]);
});

test('virgolette dentro una cella non racchiusa (es. pollici: Tubo 2") non mangiano il resto del file', () => {
  const rows = parseCsv('Attività;Ore\nTubo 2" acciaio;4\nFlangia;2\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['Tubo 2" acciaio', '4']);
  assert.deepEqual(rows[2], ['Flangia', '2']);
});

test('celle tra virgolette con a capo e virgolette raddoppiate (come le scrive Excel)', () => {
  assert.deepEqual(parseCsv('A;B\n"riga 1\nriga 2";"dice ""ciao"""\n')[1], ['riga 1\nriga 2', 'dice "ciao"']);
  // andata e ritorno con toCsv
  const rows = [['Tubo 2" acciaio', 'a;b', ' spazio'], ['x', 'riga\nnuova', '']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows.map((r) => r.map((c) => c)).filter((r) => r.some((c) => c.trim())));
});

test('date: formati italiani, tedeschi, ISO e numero seriale di Excel', () => {
  assert.equal(parseCsvDate('15/03/2026'), '2026-03-15');
  assert.equal(parseCsvDate('15.03.2026'), '2026-03-15');
  assert.equal(parseCsvDate('2026-03-15'), '2026-03-15');
  assert.equal(parseCsvDate('15-3-26'), '2026-03-15');
  assert.equal(parseCsvDate('31/02/2026'), null);
  assert.equal(parseCsvDate('46096'), '2026-03-15');
});

test('numero seriale di Excel con l’ora (46096,75 = 15/03/2026 18:00): resta lo stesso giorno', () => {
  assert.equal(parseCsvDate('46096,75'), '2026-03-15');
  assert.equal(parseCsvDate('46096.5'), '2026-03-15');
});

test('numeri all’italiana e all’inglese', () => {
  assert.equal(parseNumber('16,5'), 16.5);
  assert.equal(parseNumber('16.5'), 16.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('16 h'), 16);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
});
