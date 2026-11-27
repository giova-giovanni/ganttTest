import { describe, expect, it } from 'vitest';
import { demoData } from '../../src/demo';
import { migrate } from '../../src/store';
import { startOfWeek, todayISO } from '../../src/utils/dates';

describe('dati di esempio', () => {
  const demo = demoData();

  it('sono coerenti: id unici, genitori e responsabili esistenti, date in ordine', () => {
    const ids = new Set(demo.nodes.map((n) => n.id));
    expect(ids.size).toBe(demo.nodes.length);
    const people = new Set(demo.people.map((p) => p.id));
    for (const n of demo.nodes) {
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
      if (n.assigneeId) expect(people.has(n.assigneeId)).toBe(true);
      if (n.start && n.end) expect(n.start <= n.end).toBe(true);
    }
    for (const note of demo.notes) expect(ids.has(note.nodeId)).toBe(true);
    // una chiusura aziendale non ha persona; le altre assenze puntano a un responsabile esistente
    for (const a of demo.absences) expect(a.personId === null ? a.type === 'CLOSURE' : people.has(a.personId)).toBe(true);
  });

  it('sono spostati sulla settimana corrente', () => {
    const plc = demo.nodes.find((n) => n.id === 'alfa-sw-plc')!;
    expect(plc.start).toBe(startOfWeek(todayISO()));
    expect(plc.status).toBe('IN_PROGRESS');
  });

  it('superano la normalizzazione senza perdere nulla', () => {
    const m = migrate(demo);
    expect(m.nodes).toHaveLength(demo.nodes.length);
    expect(m.people).toHaveLength(5);
    expect(m.absences).toHaveLength(4);
    expect(m.notes).toHaveLength(3);
  });
});

describe('normalizzazione di dati sporchi (migrate)', () => {
  it('sostituisce i valori non validi invece di fallire', () => {
    const m = migrate({
      people: [
        { id: 'p1', name: 'Mario Rossi', role: '', color: 'rosso', hoursPerDay: 30 },
      ],
      nodes: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'n1', parentId: null, name: 'X', status: 'BOH' as any, start: '13/45/2026', end: 'ieri', hours: -5, assigneeId: 'sconosciuto', notes: '', collapsed: false, archived: false },
      ],
      absences: [
        { id: 'a1', personId: 'p1', start: '2026-05-10', end: '2026-05-01', type: 'VACATION', note: '' },
        { id: 'a2', personId: 'nessuno', start: '2026-05-10', end: '2026-05-11', type: 'SICK', note: '' },
      ],
      notes: [
        { id: 'x', nodeId: 'non-esiste', title: 't', body: '', tags: [], author: '', createdAt: '', updatedAt: '', pinned: false },
      ],
    });
    expect(m.people[0].color).toBe('#2f7de1');
    expect(m.people[0].hoursPerDay).toBe(8);
    const n = m.nodes[0];
    expect(n.status).toBe('TODO');
    expect(n.start).toBeNull();
    expect(n.end).toBeNull();
    expect(n.hours).toBe(0);
    expect(n.assigneeId).toBeNull();
    expect(m.absences).toEqual([
      { id: 'a1', personId: 'p1', start: '2026-05-01', end: '2026-05-10', type: 'VACATION', note: '' },
    ]);
    expect(m.notes).toEqual([]);
  });

  it('accetta anche niente', () => {
    expect(migrate(null)).toEqual({ version: 4, people: [], absences: [], nodes: [], notes: [] });
  });
});
