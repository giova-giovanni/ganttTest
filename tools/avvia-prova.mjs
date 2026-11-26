// Avvia Gantt Planner su una cartella dati FINTA, per provare il programma senza toccare i dati veri.
// Gantt Planner mit einem TEST-Datenordner starten, ohne die echten Daten zu berühren.
//
//   node tools/avvia-prova.mjs              → http://localhost:5199, dati in .test-tmp/dati-prova
//   node tools/avvia-prova.mjs --account    → come sopra, con account personali di prova:
//        Mario Rossi / prova-mario (amministratore) · Anna Bianchi / prova-anna (modifica) · ospiti ammessi
//
// Non apre il browser; dati e utenti di prova stanno in .test-tmp (esclusa da git).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/users.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(appDir, '.test-tmp');
const dati = join(tmp, 'dati-prova');
mkdirSync(dati, { recursive: true });

process.env.GANTT_DATI = dati;
process.env.GANTT_PORTA = process.env.GANTT_PORTA || '5199';
process.env.GANTT_MODO = 'locale';
process.env.NO_OPEN = '1';

const usersFile = join(tmp, process.argv.includes('--account') ? 'gantt-utenti-prova.json' : 'nessun-file-utenti.json');
if (process.argv.includes('--account') && !existsSync(usersFile)) {
  const utenti = [
    { nome: 'Mario Rossi', livello: 'admin', password: await hashPassword('prova-mario') },
    { nome: 'Anna Bianchi', livello: 'modifica', password: await hashPassword('prova-anna') },
  ];
  writeFileSync(usersFile, JSON.stringify({ _nota: 'SOLO PER PROVE', utenti, ospiti: true }, null, 2), 'utf8');
}
process.env.GANTT_UTENTI = usersFile;

await import('../server.mjs');
