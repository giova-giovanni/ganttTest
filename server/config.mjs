// Configurazione di Gantt Planner: dove stanno i dati e come si espone il programma.
//
// Ordine di lettura (vince il primo che trova un valore):
//   1. argomenti da riga di comando   --dati <cartella>  --porta <n>  --modo <locale|rete>
//   2. variabili d'ambiente           GANTT_DATI  GANTT_PORTA  GANTT_MODO
//   3. file gantt-config.json accanto al programma
//   4. valori predefiniti
//
// Il file di configurazione è pensato per essere modificato a mano con il blocco note:
//   {
//     "dati": "dati",
//     "porta": 5180,
//     "modo": "locale"
//   }
import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = resolve(APP_DIR, 'gantt-config.json');

const DEFAULT_PORT = 5180;
const DEFAULT_DATA_DIR = 'dati';

/** legge --nome valore oppure --nome=valore dagli argomenti */
function arg(argv, ...names) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    for (const name of names) {
      if (a === `--${name}`) return argv[i + 1] ?? '';
      if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
    }
  }
  return undefined;
}

function readConfigFile() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : {};
  } catch (err) {
    console.error('GANTT_WARN=gantt-config.json non leggibile: ' + (err?.message ?? err));
    return {};
  }
}

/** 'rete' = raggiungibile dagli altri PC; 'locale' = solo questo computer */
function normalizeMode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['rete', 'server', 'lan', 'network', 'netz', '0.0.0.0', 'all'].includes(v)) return 'rete';
  return 'locale';
}

export function loadConfig(argv = process.argv.slice(2)) {
  const file = readConfigFile();

  // la vecchia forma "node server.mjs 5180" resta valida
  const positionalPort = argv.find((a) => /^\d{2,5}$/.test(a));

  const port =
    Number(arg(argv, 'porta', 'port') ?? process.env.GANTT_PORTA ?? process.env.PORT ?? file.porta ?? file.port ?? positionalPort ?? DEFAULT_PORT) ||
    DEFAULT_PORT;

  const mode = normalizeMode(
    arg(argv, 'modo', 'mode') ?? process.env.GANTT_MODO ?? file.modo ?? file.mode ?? 'locale',
  );

  const rawDir = String(
    arg(argv, 'dati', 'data') ?? process.env.GANTT_DATI ?? file.dati ?? file.data ?? DEFAULT_DATA_DIR,
  ).trim();
  const dataDir = isAbsolute(rawDir) || /^\\\\/.test(rawDir) ? resolve(rawDir) : resolve(APP_DIR, rawDir);

  // true quando davanti c'è un proxy HTTPS sullo stesso PC (IIS, nginx, Caddy): solo allora si
  // credono le intestazioni X-Forwarded-For / -Proto / -Host che il proxy aggiunge
  const proxyRaw = arg(argv, 'proxy') ?? process.env.GANTT_PROXY ?? file.proxy;
  const proxy = proxyRaw === true || ['1', 'true', 'si', 'sì', 'ja', 'yes'].includes(String(proxyRaw ?? '').toLowerCase());

  // altri nomi con cui gli utenti raggiungono il server (es. "gantt.azienda.local"), oltre al nome
  // del PC e ai suoi indirizzi: le richieste con un nome diverso vengono rifiutate
  const nomiRaw = arg(argv, 'nomi') ?? process.env.GANTT_NOMI ?? file.nomi ?? [];
  const nomi = (Array.isArray(nomiRaw) ? nomiRaw : String(nomiRaw).split(','))
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean);

  // file degli utenti: di norma accanto al programma, ma si può spostare (es. in una cartella
  // leggibile solo dal servizio) con --utenti, GANTT_UTENTI o "utenti" in gantt-config.json
  const rawUsers = String(arg(argv, 'utenti', 'users') ?? process.env.GANTT_UTENTI ?? file.utenti ?? 'gantt-utenti.json').trim();
  const usersFile = isAbsolute(rawUsers) || /^\\\\/.test(rawUsers) ? resolve(rawUsers) : resolve(APP_DIR, rawUsers);

  return {
    appDir: APP_DIR,
    dataDir,
    usersFile,
    port,
    proxy,
    nomi,
    mode, // 'locale' | 'rete'
    // in modalità locale si ascolta su tutte le interfacce di loopback (IPv4 + IPv6),
    // altrimenti il controllo di avvio su 127.0.0.1 fallisce quando "localhost" è IPv6
    hosts: mode === 'rete' ? ['::'] : ['127.0.0.1', '::1'],
    configFile: CONFIG_FILE,
  };
}
