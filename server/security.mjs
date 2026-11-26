// Protezioni HTTP di base, uguali per l'interfaccia e per /api/*.
//
// - Intestazioni di sicurezza: il browser non deve interpretare i file in modo diverso,
//   non deve mostrare Gantt Planner dentro pagine altrui, né eseguire script che non arrivano dal server.
// - Nomi del server ammessi (contro il «DNS rebinding»: una pagina esterna che fa puntare il
//   proprio nome a 127.0.0.1 per parlare con Gantt Planner). Dietro un proxy HTTPS il controllo lo fa
//   il proxy, che è l'unico a poter raggiungere Gantt Planner.
// - Nessuna intestazione CORS: un altro sito non può leggere le risposte di Gantt Planner.
import { hostname, networkInterfaces } from 'node:os';
import { viaHttps } from './users.mjs';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // stili in linea di React e della stampa
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(req) {
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (viaHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** nomi e indirizzi con cui si può raggiungere questo server */
export function allowedHosts(cfg) {
  const names = new Set(LOOPBACK);
  for (const n of cfg.nomi ?? []) names.add(String(n).trim().toLowerCase());
  if (cfg.mode === 'rete') {
    const host = hostname().toLowerCase();
    names.add(host);
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) if (!net.internal) names.add(net.address.toLowerCase());
    }
  }
  return names;
}

/** «gantt.azienda.local:5180» → «gantt.azienda.local»; «[::1]:5180» → «::1» */
export function hostOnly(header) {
  const h = String(header ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  const i = h.lastIndexOf(':');
  return i > 0 && h.indexOf(':') === i ? h.slice(0, i) : h;
}

const warned = new Set();

/** false se la richiesta arriva con un nome di server non previsto */
export function hostAllowed(req, cfg, allowed = allowedHosts(cfg)) {
  if (cfg.proxy) return true; // dietro il proxy HTTPS: Gantt Planner ascolta solo su localhost
  const host = hostOnly(req.headers.host);
  if (!host || allowed.has(host)) return true;
  // nomi «.localhost» (es. gantt.localhost) puntano sempre a questo PC
  if (host.endsWith('.localhost')) return true;
  if (!warned.has(host)) {
    warned.add(host);
    console.error(`GANTT_WARN=richiesta rifiutata per il nome «${host}»: aggiungilo a "nomi" in gantt-config.json se è corretto`);
  }
  return false;
}
