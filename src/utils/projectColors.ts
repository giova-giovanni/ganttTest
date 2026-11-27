// Colore di ogni progetto: quello scelto dall'utente (salvato nel progetto, quindi uguale
// per tutti) oppure, se non è stato scelto, uno automatico in base alla posizione.
import type { TaskNode } from '../types';
import { isHex } from '../theme';

/** colori automatici: distinti fra loro e leggibili su chiaro e scuro */
export const PROJECT_COLORS = [
  '#2f7de1',
  '#8e5bd8',
  '#2aa76b',
  '#e0873c',
  '#c0398f',
  '#2f9bc9',
  '#b0603a',
  '#5b8c2a',
  '#d6453d',
  '#6b7889',
];

/**
 * id del progetto → colore. La posizione si conta su tutti i progetti, archiviati compresi:
 * così archiviarne uno non cambia il colore degli altri.
 */
export function projectColors(nodes: TaskNode[]): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (const n of nodes) {
    if (n.parentId !== null) continue;
    out[n.id] = isHex(n.color) ? n.color : PROJECT_COLORS[i % PROJECT_COLORS.length];
    i += 1;
  }
  return out;
}
