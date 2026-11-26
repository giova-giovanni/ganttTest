// Password per gantt-utenti.json, salvate come hash scrypt (chi legge il file non le ricava).
// Passwörter für gantt-utenti.json als scrypt-Hash.
//
//   node tools/password.mjs "nuova-password"
//       stampa l'hash da incollare nel campo "password" di un utente
//
//   node tools/password.mjs --converti [percorso\gantt-utenti.json]
//       sostituisce nel file tutte le password ancora in chiaro con il loro hash;
//       prima fa una copia del file originale (gantt-utenti.prima-hash.json) accanto
//
// Nessuna dipendenza: usa il modulo crypto di Node.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/users.mjs';

const args = process.argv.slice(2);

if (!args.length || args[0] === '--help' || args[0] === '-h') {
  console.log('Uso / Verwendung:');
  console.log('  node tools/password.mjs "password"            → hash da incollare in gantt-utenti.json');
  console.log('  node tools/password.mjs --converti [file]     → converte le password in chiaro del file');
  process.exit(0);
}

if (args[0] !== '--converti') {
  console.log(await hashPassword(args[0]));
  process.exit(0);
}

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(args[1] ?? join(appDir, 'gantt-utenti.json'));
if (!existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(1);
}
const json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
let converted = 0;
const convert = async (holder) => {
  if (holder && typeof holder.password === 'string' && holder.password && !holder.password.startsWith('scrypt$')) {
    holder.password = await hashPassword(holder.password);
    converted += 1;
  }
};
await convert(json.admin);
await convert(json.modifica);
for (const u of Array.isArray(json.utenti) ? json.utenti : []) await convert(u);

if (!converted) {
  console.log('Nessuna password in chiaro: il file resta com’era.');
  process.exit(0);
}
const backup = join(dirname(file), 'gantt-utenti.prima-hash.json');
copyFileSync(file, backup);
writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log(`Convertite ${converted} password. Copia dell'originale: ${backup}`);
console.log('Controlla che l’accesso funzioni, poi cancella la copia: contiene ancora le password in chiaro.');
