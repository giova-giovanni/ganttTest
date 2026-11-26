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
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { exec } from 'node:child_process';
import { loadConfig } from './server/config.mjs';
import { configure, dataPaths } from './server/store.mjs';
import { handleApi } from './server/api.mjs';

const cfg = loadConfig();
configure(cfg);

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

async function handler(req, res) {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (await handleApi(req, res, urlPath)) return;

    let file = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')));
    if (!file.startsWith(ROOT)) file = join(ROOT, 'index.html'); // nessun accesso fuori da dist
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(ROOT, 'index.html'); // ripiego per le rotte dell'applicazione
    }
    await send(res, file);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Errore: ' + (err instanceof Error ? err.message : String(err)));
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

  if (!process.env.NO_OPEN) {
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  }

  const shutdown = () => {
    for (const s of servers) s.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
