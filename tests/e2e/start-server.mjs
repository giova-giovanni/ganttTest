// Avvia il server vero (server.mjs) su una cartella dati temporanea e vuota:
// i test non toccano mai la cartella dati/ del programma e ripartono sempre da zero.
//   node tests/e2e/start-server.mjs [porta]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] ?? '5199';
const dir = mkdtempSync(join(tmpdir(), 'gantt-e2e-'));

process.argv.splice(2, process.argv.length, '--porta', port, '--dati', dir);
process.env.NO_OPEN = '1'; // niente browser aperto dal server
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

await import('../../server.mjs');
