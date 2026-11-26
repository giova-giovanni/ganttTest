// Riepilogo di un file dati di Gantt Planner: serve a confrontare l'archivio prima e dopo la migrazione.
// Legge soltanto, non modifica nulla.
//
//   node tools/verifica-archivio.mjs "D:\Gantt-dati\gantt-dati.json"
//   node tools/verifica-archivio.mjs "D:\Gantt-dati\gantt-dati.pre-v2.json"
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node tools/verifica-archivio.mjs <percorso di gantt-dati.json>');
  process.exit(1);
}
const json = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const data = json.data && typeof json.data === 'object' ? json.data : json;
const nodes = Array.isArray(data.nodes) ? data.nodes : [];
const count = (list) => (Array.isArray(list) ? list.length : 0);

console.log(`file          ${file}`);
console.log(`formato       ${json.format ?? 1}   revisione ${json.rev ?? '-'}   salvato ${json.savedAt ?? '-'} da ${json.savedBy ?? '-'}`);
console.log(`progetti      ${nodes.filter((n) => !n.parentId).length}`);
console.log(`attività      ${nodes.filter((n) => n.parentId).length}`);
console.log(`responsabili  ${count(data.people)}`);
console.log(`assenze       ${count(data.absences)}`);
console.log(`note          ${count(data.notes)}`);
console.log(`ore totali    ${nodes.reduce((s, n) => s + (Number(n.hours) || 0), 0)}`);
