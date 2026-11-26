import { describe, expect, it } from 'vitest';
import { computeAll, flatten, sanitizeNodes } from '../../src/utils/tree';
import { node } from './helpers';

describe('calcolo dei rami (roll-up)', () => {
  const nodes = [
    node('p', null, { name: 'Progetto' }),
    node('a', 'p', { name: 'Ramo A' }),
    node('a1', 'a', { status: 'DONE', start: '2026-03-02', end: '2026-03-06', hours: 20 }),
    node('a2', 'a', { status: 'TODO', start: '2026-03-09', end: '2026-03-20', hours: 60 }),
    node('b', 'p', { name: 'Ramo B' }),
    node('b1', 'b', { status: 'CANCELLED', start: '2026-01-05', end: '2026-12-18', hours: 500 }),
    node('b2', 'b', { status: 'IN_PROGRESS', start: '2026-03-16', end: '2026-04-03', hours: 40 }),
  ];
  const c = computeAll(nodes);

  it('inizio = minimo, fine = massimo, ore = somma dei figli', () => {
    expect(c.a.start).toBe('2026-03-02');
    expect(c.a.end).toBe('2026-03-20');
    expect(c.a.hours).toBe(80);
    expect(c.p.start).toBe('2026-03-02');
    expect(c.p.end).toBe('2026-04-03');
    expect(c.p.hours).toBe(120);
  });

  it('le attività annullate restano fuori da date e ore', () => {
    expect(c.b.start).toBe('2026-03-16');
    expect(c.b.end).toBe('2026-04-03');
    expect(c.b.hours).toBe(40);
  });

  it('lo stato del ramo deriva da quello dei figli', () => {
    expect(c.a.status).toBe('IN_PROGRESS'); // una finita + una da fare = in corso
    expect(c.b.status).toBe('IN_PROGRESS');
    const allDone = computeAll([node('x', null), node('x1', 'x', { status: 'DONE' }), node('x2', 'x', { status: 'DONE' })]);
    expect(allDone.x.status).toBe('DONE');
    const allCancelled = computeAll([node('y', null), node('y1', 'y', { status: 'CANCELLED' })]);
    expect(allCancelled.y.status).toBe('CANCELLED');
  });

  it('avanzamento = ore finite / ore totali e giorni lavorativi', () => {
    expect(c.a.progress).toBeCloseTo(20 / 80);
    expect(c.a1.progress).toBe(1);
    expect(c.a1.workDays).toBe(5);
    expect(c.a.depth).toBe(1);
    expect(c.a1.rootId).toBe('p');
  });

  it('segnala lo sforamento quando i figli finiscono dopo la data fissata sul ramo', () => {
    const over = computeAll([
      node('r', null, { end: '2026-03-10' }),
      node('r1', 'r', { start: '2026-03-02', end: '2026-03-20', hours: 8 }),
    ]);
    expect(over.r.overrun).toBe(true);
  });

  it('l’ordine ad albero rispetta i rami compressi', () => {
    const tree = [...nodes];
    tree[1] = { ...tree[1], collapsed: true };
    const rows = flatten(tree, computeAll(tree), 'p');
    const visible = rows.filter((r) => r.visible).map((r) => r.node.id);
    expect(visible).toEqual(['p', 'a', 'b', 'b1', 'b2']);
  });
});

describe('riparazione di dati corrotti', () => {
  it('id duplicati, genitori inesistenti, date invertite e cicli', () => {
    const fixed = sanitizeNodes([
      node('a', null),
      node('a', null), // duplicato
      node('orfano', 'non-esiste'),
      node('inv', null, { start: '2026-05-10', end: '2026-05-01' }),
      node('c1', 'c2'),
      node('c2', 'c1'), // ciclo
    ]);
    const ids = fixed.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fixed.find((n) => n.id === 'orfano')?.parentId).toBeNull();
    const inv = fixed.find((n) => n.id === 'inv')!;
    expect([inv.start, inv.end]).toEqual(['2026-05-01', '2026-05-10']);
    const c1 = fixed.find((n) => n.id === 'c1')!;
    const c2 = fixed.find((n) => n.id === 'c2')!;
    expect(c1.parentId === null || c2.parentId === null).toBe(true);
    // e il calcolo non va in loop
    expect(() => computeAll(fixed)).not.toThrow();
  });
});
