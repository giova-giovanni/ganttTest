// Server di Gantt Planner: serve l'interfaccia (cartella dist) e l'archivio dati condiviso.
// Nessuna dipendenza esterna: bastano Node.js e questa cartella.
//
//   node server.mjs                      programma locale (solo questo PC)
//   node server.mjs --modo rete          raggiungibile dagli altri PC della rete
//   node server.mjs --dati "<cartella>"  dati in un'altra cartella (anche condivisa)
//
// Le righe "GANTT_*=" stampate all'avvio possono essere lette da uno script di avvio.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createWriteStream, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { exec } from 'node:child_process';
import { loadConfig } from './server/config.mjs';
import { configure, dataPaths } from './server/store.mjs';
import { handleApi } from './server/api.mjs';
import { staticPath } from './server/static.mjs';
import { closeArchive, openArchive, setArchiveUrl } from './server/archive.mjs';
import { closeStreams } from './server/events.mjs';
import { setTrustProxy, setUsersFile } from './server/users.mjs';
import { allowedHosts, hostAllowed, securityHeaders } from './server/security.mjs';

const cfg = loadConfig();
configure(cfg);
setTrustProxy(cfg.proxy);
setUsersFile(cfg.usersFile);

// --log: come servizio non c'è una finestra; i messaggi vanno anche in dati\gantt-server.log
// (unico posto in cui il programma scrive, insieme all'archivio). Oltre 5 MB si ricomincia.
if (process.argv.includes('--log')) {
  const file = join(cfg.dataDir, 'gantt-server.log');
  try {
    mkdirSync(cfg.dataDir, { recursive: true });
    if (statSync(file, { throwIfNoEntry: false })?.size > 5 * 1024 * 1024) renameSync(file, file + '.1');
    const stream = createWriteStream(file, { flags: 'a' });
    for (const level of ['log', 'warn', 'error']) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        stream.write(`${new Date().toISOString()} ${args.map(String).join(' ')}\n`);
      };
    }
  } catch (err) {
    console.error('GANTT_WARN=registro di avvio non scrivibile: ' + (err?.message ?? err));
  }
}

const MAX_TRIES = 40;
const ROOT = join(cfg.appDir, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function send(res, file, code = 200) {
  const body = await readFile(file);
  res.writeHead(code, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

// nomi ammessi del server (gli indirizzi di rete possono cambiare: si ricalcolano ogni minuto)
let hosts = { at: 0, set: new Set() };
const currentHosts = () => {
  if (Date.now() - hosts.at > 60_000) hosts = { at: Date.now(), set: allowedHosts(cfg) };
  return hosts.set;
};

async function handler(req, res) {
  try {
    for (const [k, v] of Object.entries(securityHeaders(req))) res.setHeader(k, v);
    if (!hostAllowed(req, cfg, currentHosts())) {
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nome del server non riconosciuto / Servername nicht erkannt');
      return;
    }
    const rawPath = (req.url ?? '/').split('?')[0];
    let file = staticPath(ROOT, rawPath);
    if (!file) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Indirizzo non valido');
      return;
    }

    if (await handleApi(req, res, decodeURIComponent(rawPath))) return;

    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(ROOT, 'index.html'); // ripiego per le rotte dell'applicazione
    }
    await send(res, file);
  } catch (err) {
    console.error('GANTT_WARN=' + (err instanceof Error ? err.message : String(err)));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Errore interno');
  }
}

/** prova ad ascoltare su una porta/indirizzo, senza lanciare eccezioni non gestite */
function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    if (host) server.listen(port, host);
    else server.listen(port);
  });
}

function lanUrls(port) {
  const out = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}

async function start() {
  const servers = [];
  let port = cfg.port;
  let bound = null;

  // prima l'archivio, poi le richieste: un archivio illeggibile ferma l'avvio
  // (meglio un errore chiaro che un programma che riparte da vuoto)
  try {
    const opened = await openArchive();
    if (opened.readOnly) {
      console.error(
        `GANTT_WARN=la cartella dati è già usata dal server Gantt Planner su ${opened.readOnly.host} ` +
          `(${opened.readOnly.url || 'indirizzo sconosciuto'}): questo si apre in sola lettura`,
      );
    }
  } catch (err) {
    console.error('GANTT_ERROR=' + (err?.message ?? String(err)));
    process.exit(1);
  }

  // in modalità locale si ascolta su 127.0.0.1 e ::1: "localhost" su Windows
  // può risolvere in IPv6 e il controllo di avvio su IPv4 fallirebbe.
  const primaryHost = cfg.mode === 'rete' ? null : '127.0.0.1';

  for (let attempt = 0; attempt <= MAX_TRIES; attempt += 1) {
    const server = createServer(handler);
    try {
      bound = await listenOn(server, port + attempt, primaryHost);
      servers.push(server);
      break;
    } catch (err) {
      server.close();
      if (err.code !== 'EADDRINUSE' || attempt === MAX_TRIES) {
        console.error('GANTT_ERROR=' + (err?.message ?? String(err)));
        process.exit(1);
      }
    }
  }

  let ipv6 = false;
  if (cfg.mode !== 'rete') {
    const second = createServer(handler);
    try {
      await listenOn(second, bound, '::1');
      servers.push(second);
      ipv6 = true;
    } catch {
      second.close(); // niente IPv6 su questo PC: si continua solo con 127.0.0.1
    }
  }

  const url = cfg.mode === 'rete' || ipv6 ? `http://localhost:${bound}` : `http://127.0.0.1:${bound}`;
  setArchiveUrl(cfg.mode === 'rete' ? (lanUrls(bound)[0] ?? url) : url);

  console.log('GANTT_PORT=' + bound);
  console.log('GANTT_URL=' + url);
  console.log('GANTT_MODE=' + cfg.mode);
  console.log('GANTT_DATA=' + dataPaths().dir);
  if (cfg.mode === 'rete') for (const u of lanUrls(bound)) console.log('GANTT_LAN=' + u);

  console.log(`\n  Gantt Planner attivo su ${url}`);
  console.log(`  Dati: ${dataPaths().dir}`);
  if (cfg.mode === 'rete') {
    console.log('  Gli altri PC possono collegarsi a:');
    for (const u of lanUrls(bound)) console.log('    ' + u);
  }
  console.log('  Chiudere questa finestra per terminare il programma.\n');

  // come servizio (o con --senza-browser) non si apre nessun browser
  if (!process.env.NO_OPEN && !process.argv.includes('--senza-browser')) {
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  }

  // chiusura ordinata: si scrive gantt-dati.json e si libera la cartella dati.
  // (Anche senza, nulla si perde: ogni modifica è già nel registro e viene riapplicata all'avvio.)
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    closeStreams();
    for (const s of servers) s.close();
    await closeArchive().catch((err) => console.error('GANTT_WARN=' + (err?.message ?? err)));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown); // Windows: chiusura della finestra
}

start();
