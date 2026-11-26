import type { Absence, AppData, Note, Person, Status, TaskNode } from './types';
import { addDays, diffDays, startOfWeek, todayISO } from './utils/dates';

// Dati di esempio, del tutto inventati: servono solo a provare il programma.
// I nomi sono quelli "segnaposto" classici (Mario Rossi, Max Mustermann, ...).

/**
 * Le date qui sotto sono scritte attorno alla settimana di questo lunedì.
 * Al caricamento vengono spostate di un numero intero di settimane, in modo che
 * questa settimana coincida con quella corrente: il Gantt di prova mostra sempre
 * attività concluse, in corso e future, qualunque sia il giorno in cui lo si apre.
 */
const ANCHOR_MONDAY = '2026-07-27';

const P = {
  mec: 'p_mec',
  sw: 'p_sw',
  pro: 'p_pro',
  mon: 'p_mon',
  pm: 'p_pm',
};

const people: Person[] = [
  { id: P.mec, name: 'Mario Rossi', role: 'Progettazione meccanica', color: '#2f7de1', hoursPerDay: 8 },
  { id: P.sw, name: 'Erika Mustermann', role: 'Software / PLC', color: '#8e5bd8', hoursPerDay: 8 },
  { id: P.pro, name: 'Max Mustermann', role: 'Produzione', color: '#2aa76b', hoursPerDay: 8 },
  { id: P.mon, name: 'Laura Bianchi', role: 'Montaggio', color: '#e0873c', hoursPerDay: 8 },
  { id: P.pm, name: 'Luca Verdi', role: 'Project Manager', color: '#d6453d', hoursPerDay: 6 },
];

const absences: Absence[] = [
  { id: 'a1', personId: P.mec, start: '2026-08-10', end: '2026-08-21', type: 'VACATION', note: 'Ferie estive' },
  { id: 'a2', personId: P.sw, start: '2026-08-03', end: '2026-08-04', type: 'SICK', note: '' },
  { id: 'a3', personId: P.mon, start: '2026-10-05', end: '2026-10-06', type: 'OTHER', note: 'Corso sicurezza' },
];

interface Seed {
  id: string;
  parent: string | null;
  name: string;
  status?: Status;
  start?: string;
  end?: string;
  hours?: number;
  who?: string;
  archived?: boolean;
}

const seeds: Seed[] = [
  { id: 'alfa', parent: null, name: 'P-101 Macchina demo', end: '2026-10-16', who: P.pm },

  { id: 'alfa-mec', parent: 'alfa', name: 'Meccanica', who: P.mec },
  { id: 'alfa-mec-ric', parent: 'alfa-mec', name: 'Requisiti', status: 'DONE', start: '2026-07-20', end: '2026-07-24', hours: 24, who: P.mec },
  { id: 'alfa-mec-mod', parent: 'alfa-mec', name: 'Modelli 3D', who: P.mec },
  { id: 'alfa-mec-mod-tel', parent: 'alfa-mec-mod', name: 'Telaio', status: 'IN_PROGRESS', start: '2026-07-28', end: '2026-07-29', hours: 16, who: P.mec },
  { id: 'alfa-mec-mod-gru', parent: 'alfa-mec-mod', name: 'Gruppo motore', status: 'TODO', start: '2026-07-29', end: '2026-08-07', hours: 48, who: P.mec },
  { id: 'alfa-mec-mod-car', parent: 'alfa-mec-mod', name: 'Carter e protezioni', status: 'TODO', start: '2026-08-24', end: '2026-08-28', hours: 32, who: P.mec },
  { id: 'alfa-mec-dis', parent: 'alfa-mec', name: 'Disegni costruttivi', status: 'TODO', start: '2026-08-31', end: '2026-09-11', hours: 60, who: P.mec },
  { id: 'alfa-mec-dib', parent: 'alfa-mec', name: 'Distinta base', status: 'TODO', start: '2026-09-14', end: '2026-09-16', hours: 16, who: P.pm },

  { id: 'alfa-sw', parent: 'alfa', name: 'Software', who: P.sw },
  { id: 'alfa-sw-spec', parent: 'alfa-sw', name: 'Specifica funzionale', status: 'DONE', start: '2026-07-13', end: '2026-07-17', hours: 20, who: P.sw },
  { id: 'alfa-sw-plc', parent: 'alfa-sw', name: 'Programma PLC', status: 'IN_PROGRESS', start: '2026-07-27', end: '2026-08-21', hours: 120, who: P.sw },
  { id: 'alfa-sw-hmi', parent: 'alfa-sw', name: 'Pagine HMI', status: 'TODO', start: '2026-08-24', end: '2026-09-04', hours: 60, who: P.sw },
  { id: 'alfa-sw-sim', parent: 'alfa-sw', name: 'Simulazione e test', status: 'TODO', start: '2026-09-07', end: '2026-09-11', hours: 32, who: P.sw },

  { id: 'alfa-pro', parent: 'alfa', name: 'Produzione', who: P.pro },
  { id: 'alfa-pro-ord', parent: 'alfa-pro', name: 'Ordini materiale', status: 'TODO', start: '2026-09-03', end: '2026-09-08', hours: 12, who: P.pro },
  { id: 'alfa-pro-lav', parent: 'alfa-pro', name: 'Lavorazioni meccaniche', status: 'TODO', start: '2026-09-09', end: '2026-09-25', hours: 90, who: P.pro },
  { id: 'alfa-pro-qua', parent: 'alfa-pro', name: 'Controllo qualità', status: 'TODO', start: '2026-09-28', end: '2026-09-30', hours: 16, who: P.pro },

  { id: 'alfa-mon', parent: 'alfa', name: 'Montaggio', who: P.mon },
  { id: 'alfa-mon-pre', parent: 'alfa-mon', name: 'Premontaggio gruppi', status: 'TODO', start: '2026-10-01', end: '2026-10-07', hours: 40, who: P.mon },
  { id: 'alfa-mon-cab', parent: 'alfa-mon', name: 'Cablaggio quadro', status: 'TODO', start: '2026-10-05', end: '2026-10-09', hours: 32, who: P.mon },
  { id: 'alfa-mon-col', parent: 'alfa-mon', name: 'Collaudo finale', status: 'TODO', start: '2026-10-12', end: '2026-10-16', hours: 40, who: P.pm },
  { id: 'alfa-mon-old', parent: 'alfa-mon', name: 'Verniciatura esterna (annullata)', status: 'CANCELLED', start: '2026-10-19', end: '2026-10-23', hours: 24, who: P.mon },

  { id: 'beta', parent: null, name: 'P-102 Movimentazione', end: '2026-09-18', who: P.pm },
  { id: 'beta-mec', parent: 'beta', name: 'Meccanica', who: P.mec },
  { id: 'beta-mec-lay', parent: 'beta-mec', name: 'Layout impianto', status: 'IN_PROGRESS', start: '2026-07-29', end: '2026-08-04', hours: 24, who: P.mec },
  { id: 'beta-mec-naz', parent: 'beta-mec', name: 'Nastro trasportatore', status: 'TODO', start: '2026-08-05', end: '2026-08-19', hours: 56, who: P.mec },
  { id: 'beta-sw', parent: 'beta', name: 'Software', who: P.sw },
  { id: 'beta-sw-rob', parent: 'beta-sw', name: 'Integrazione robot', status: 'TODO', start: '2026-08-20', end: '2026-09-04', hours: 64, who: P.sw },
  { id: 'beta-mon', parent: 'beta', name: 'Montaggio', who: P.mon },
  { id: 'beta-mon-ass', parent: 'beta-mon', name: 'Assemblaggio', status: 'TODO', start: '2026-09-07', end: '2026-09-18', hours: 60, who: P.mon },

  // progetto già concluso e archiviato (esempio)
  { id: 'gamma', parent: null, name: 'P-090 Banco prova', archived: true, who: P.pm },
  { id: 'gamma-mec', parent: 'gamma', name: 'Meccanica', status: 'DONE', start: '2026-04-06', end: '2026-05-08', hours: 120, who: P.mec },
  { id: 'gamma-sw', parent: 'gamma', name: 'Software', status: 'DONE', start: '2026-05-11', end: '2026-06-05', hours: 90, who: P.sw },
  { id: 'gamma-col', parent: 'gamma', name: 'Collaudo', status: 'DONE', start: '2026-06-08', end: '2026-06-12', hours: 40, who: P.pm },
];

/** qualche nota di esempio, per far vedere subito come funziona l'archivio note */
function demoNotes(): Note[] {
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  return [
    {
      id: 'nt_demo1',
      nodeId: 'alfa',
      title: 'Riunione di avvio con il cliente',
      body:
        '<p>Punti concordati il giorno della riunione:</p><ul><li>Consegna entro <b>metà ottobre</b></li>' +
        '<li>Tensione di alimentazione <b>400 V</b></li><li>Documentazione in <b>due lingue</b></li></ul>',
      tags: ['cliente', 'riunione'],
      author: 'Luca Verdi',
      createdAt: day(-12),
      updatedAt: day(-12),
      pinned: true,
    },
    {
      id: 'nt_demo2',
      nodeId: 'alfa-mec-mod-gru',
      title: 'Fornitore motore',
      body: '<p>Consegna confermata a <b>4 settimane</b>. Contatto: ufficio acquisti.</p>',
      tags: ['acquisti'],
      author: 'Mario Rossi',
      createdAt: day(-4),
      updatedAt: day(-2),
      pinned: false,
    },
    {
      id: 'nt_demo3',
      nodeId: 'beta-sw',
      title: 'Nota tecnica robot',
      body: '<p>Da verificare la compatibilità del bus di campo con la versione firmware installata.</p>',
      tags: ['tecnica', 'da verificare'],
      author: 'Erika Mustermann',
      createdAt: day(-1),
      updatedAt: day(-1),
      pinned: false,
    },
  ];
}

export function demoData(): AppData {
  // spostamento a settimane intere: i giorni della settimana (e quindi i weekend) restano gli stessi
  const shift = diffDays(ANCHOR_MONDAY, startOfWeek(todayISO()));
  const move = (iso: string | undefined) => (iso ? addDays(iso, shift) : null);

  const nodes: TaskNode[] = seeds.map((s) => ({
    id: s.id,
    parentId: s.parent,
    name: s.name,
    status: s.status ?? 'TODO',
    start: move(s.start),
    end: move(s.end),
    hours: s.hours ?? null,
    assigneeId: s.who ?? null,
    notes: '',
    collapsed: false,
    archived: !!s.archived,
  }));
  const movedAbsences: Absence[] = absences.map((a) => ({ ...a, start: move(a.start)!, end: move(a.end)! }));
  return { version: 4, nodes, people, absences: movedAbsences, notes: demoNotes() };
}
