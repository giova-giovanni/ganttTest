export type Lang = 'it' | 'de';

export type Status = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export const STATUSES: Status[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export type AbsenceType = 'VACATION' | 'SICK' | 'OTHER';

export const ABSENCE_TYPES: AbsenceType[] = ['VACATION', 'SICK', 'OTHER'];

export const ABSENCE_COLORS: Record<AbsenceType, string> = {
  VACATION: '#2f9bc9',
  SICK: '#c0398f',
  OTHER: '#7a8697',
};

export interface Person {
  id: string;
  name: string;
  role: string;
  color: string;
  /** Ore lavorative al giorno (default 8) */
  hoursPerDay: number;
}

/** Giorni in cui la persona non è disponibile (ferie, malattia, altro) */
export interface Absence {
  id: string;
  personId: string;
  start: string; // ISO yyyy-mm-dd
  end: string; // ISO yyyy-mm-dd
  type: AbsenceType;
  note: string;
}

/**
 * Un nodo dell'albero. I progetti "madre" sono i nodi con parentId === null.
 * Date / ore / stato dei nodi con sotto-attività sono calcolati automaticamente
 * (min data inizio, max data fine, somma ore, stato aggregato).
 * I valori memorizzati sui nodi superiori restano come "baseline" (pianificato).
 */
export interface TaskNode {
  id: string;
  parentId: string | null;
  name: string;
  status: Status;
  start: string | null; // ISO yyyy-mm-dd
  end: string | null; // ISO yyyy-mm-dd
  hours: number | null;
  assigneeId: string | null;
  /** nota breve su una riga, usata da CSV e stampa (le note estese stanno in AppData.notes) */
  notes: string;
  collapsed: boolean;
  /** solo sui progetti (nodi radice): progetto archiviato */
  archived: boolean;
}

/**
 * Nota estesa agganciata a un progetto, a un ramo o a una singola attività.
 * Il testo è HTML semplificato (grassetto, corsivo, elenchi): viene ripulito
 * sia in scrittura sia in lettura, così un file manomesso non può iniettare codice.
 */
export interface Note {
  id: string;
  nodeId: string;
  title: string;
  body: string;
  tags: string[];
  author: string;
  createdAt: string; // ISO completo con ora
  updatedAt: string;
  pinned: boolean;
}

export interface AppData {
  version: number;
  nodes: TaskNode[];
  people: Person[];
  absences: Absence[];
  notes: Note[];
}

/** Valori calcolati (rollup) per ogni nodo */
export interface Computed {
  depth: number;
  hasChildren: boolean;
  start: string | null;
  end: string | null;
  hours: number;
  status: Status;
  /** giorni lavorativi (lun-ven) tra start ed end inclusi */
  workDays: number;
  /** avanzamento 0..1 stimato sulle ore delle foglie completate */
  progress: number;
  /** true se la data di fine calcolata supera la baseline impostata a mano */
  overrun: boolean;
  rootId: string;
}

export type ComputedMap = Record<string, Computed>;

export type Page = 'home' | 'project' | 'load' | 'people' | 'notes';

export type ColKey = 'name' | 'status' | 'start' | 'end' | 'hours' | 'days' | 'assignee' | 'notes';

/** Come l'utente ha personalizzato la pagina iniziale (preferenza personale, non condivisa) */
export interface HomeLayout {
  showKpi: boolean;
  showCalendar: boolean;
  showDeadlines: boolean;
  showOverview: boolean;
  showTable: boolean;
  /** cosa disegnare nel calendario: durate dei progetti, scadenze, o entrambi */
  calMode: 'spans' | 'deadlines' | 'both';
  /** altezza di una casella-giorno del calendario, in pixel */
  calDayHeight: number;
  /** larghezza della colonna calendario rispetto alle scadenze (0.3 – 0.8) */
  calRatio: number;
  /** altezza dei riquadri con scorrimento, in pixel */
  deadlinesHeight: number;
  overviewHeight: number;
  /** giorni mostrati nell'elenco delle prossime scadenze */
  deadlineDays: number;
}

export interface UiState {
  lang: Lang;
  theme: 'light' | 'dark';
  page: Page;
  selectedProjectId: string | null;
  scale: 'day' | 'week' | 'month';
  gridWidth: number;
  /** larghezza personalizzata delle colonne della tabella attività */
  colWidths: Partial<Record<ColKey, number>>;
  home: HomeLayout;
  /** nome mostrato agli altri utenti quando si sta modificando l'archivio condiviso */
  userName: string;
}
