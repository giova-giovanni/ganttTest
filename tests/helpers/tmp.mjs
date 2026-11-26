// Cartelle temporanee per i test: mai la cartella dati vera del programma.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = [];

/** crea <tmp>/gantt-test-xxxx/dati e restituisce { root, dataDir } */
export async function tempDataDir() {
  const root = await mkdtemp(join(tmpdir(), 'gantt-test-'));
  const dataDir = join(root, 'dati');
  await mkdir(dataDir, { recursive: true });
  created.push(root);
  return { root, dataDir };
}

export async function cleanupTemp() {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

/** archivio finto minimo */
export const fakeData = (nodes = []) => ({ version: 4, nodes, people: [], absences: [], notes: [] });

export const node = (id, name, parentId = null, extra = {}) => ({
  id,
  parentId,
  name,
  status: 'TODO',
  start: null,
  end: null,
  hours: null,
  assigneeId: null,
  notes: '',
  collapsed: false,
  archived: false,
  ...extra,
});
