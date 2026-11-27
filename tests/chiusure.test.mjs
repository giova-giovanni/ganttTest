// Chiusure aziendali: regole di validazione (condivise da browser e server) e andata e ritorno nel CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidOps } from '../shared/ops.mjs';
import { analyzeImport, buildAbsencesCsv } from '../src/utils/io.ts';
import { migrate } from '../src/store.ts';

const base = { id: 'a1', start: '2026-03-04', end: '2026-03-04', note: '' };
const addAbsence = (rec) => invalidOps([{ op: 'add', t: 'absence', rec }]);

test('regole: una chiusura non ha persona, ogni altra assenza ha una persona', () => {
  assert.equal(addAbsence({ ...base, personId: null, type: 'CLOSURE' }), null);
  assert.equal(addAbsence({ ...base, personId: 'p1', type: 'VACATION' }), null);
  assert.notEqual(addAbsence({ ...base, personId: null, type: 'VACATION' }), null, 'ferie senza persona');
  assert.notEqual(addAbsence({ ...base, personId: 'p1', type: 'CLOSURE' }), null, 'chiusura con una persona');
  assert.notEqual(addAbsence({ ...base, personId: 'p1', type: 'MALATTIA' }), null, 'motivo sconosciuto');
});

test('persona e motivo di un’assenza non si cambiano con una modifica: si elimina e si reinserisce', () => {
  assert.notEqual(invalidOps([{ op: 'set', t: 'absence', id: 'a1', set: { personId: 'p2' } }]), null);
  assert.notEqual(invalidOps([{ op: 'set', t: 'absence', id: 'a1', set: { type: 'CLOSURE' } }]), null);
  assert.equal(invalidOps([{ op: 'set', t: 'absence', id: 'a1', set: { note: 'ok' } }]), null);
});

test('CSV: una chiusura resta senza persona e non crea responsabili (IT e DE)', () => {
  const data = migrate({
    people: [{ id: 'p1', name: 'Mario Rossi', role: 'PM', color: '#2f7de1', hoursPerDay: 8 }],
    absences: [{ id: 'c1', personId: null, start: '2026-03-09', end: '2026-03-10', type: 'CLOSURE', note: 'Ponte' }],
  });
  for (const lang of ['it', 'de']) {
    const r = analyzeImport(buildAbsencesCsv(data, lang), 'assenze.csv', data, lang);
    assert.equal(r.kind, 'absences', lang);
    assert.equal(r.data.absences.length, 1, lang);
    const a = r.data.absences[0];
    assert.equal(a.personId, null, lang);
    assert.equal(a.type, 'CLOSURE', lang);
    assert.equal(a.note, 'Ponte', lang);
    assert.equal(r.data.people.length, 0, 'la colonna del responsabile non crea nessuna persona: ' + lang);
  }
});
