/**
 * Dialogo con il server di Gantt Planner (archivio condiviso).
 *
 * Quando il programma è servito da server.mjs (npm start / npm run dev) queste chiamate rispondono e i dati
 * vivono in un file, eventualmente su una cartella di rete. Se invece la pagina viene
 * aperta senza server (doppio clic su dist/index.html) tutte le chiamate falliscono in
 * silenzio e il programma torna a salvare nel browser: nessuna funzione si rompe.
 */
import type { AppData } from '../types';

export interface LockInfo {
  sessionId: string;
  user: string;
  host: string;
  since: string;
  beat: string;
  requests: { sessionId: string; user: string; host: string; at: string }[];
  yielded: boolean;
  stale: boolean;
  ageMs: number;
}

export interface ServerInfo {
  ok: true;
  version: string;
  mode: 'locale' | 'rete';
  dataDir: string;
  appDir: string;
  configFile: string;
  port: number;
  server: { user: string; host: string };
  heartbeatMs: number;
  lockTtlMs: number;
}

export interface StateResponse {
  ok: boolean;
  rev: number;
  savedAt: string | null;
  savedBy: string | null;
  data: AppData;
  lock: LockInfo | null;
}

export interface StatusResponse {
  ok: boolean;
  rev: number;
  savedAt: string | null;
  savedBy: string | null;
  empty?: boolean;
  lock: LockInfo | null;
}

export interface LockResponse {
  ok: boolean;
  reason?: 'busy' | 'lost';
  lock?: LockInfo | null;
  takenOver?: boolean;
  rev?: number;
}

export interface SaveResponse {
  ok: boolean;
  rev?: number;
  error?: 'conflict' | 'locked' | string;
  lock?: LockInfo | null;
  savedBy?: string | null;
}

const TIMEOUT_MS = 12_000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('risposta non valida dal server');
    }
    // 409 (occupato / conflitto) e 403 (password sbagliata) sono risposte di lavoro,
    // non errori di rete: le legge chi ha fatto la chiamata
    if (!res.ok && res.status !== 409 && res.status !== 403) {
      const msg = (json as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function post<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface Identity {
  sessionId: string;
  user: string;
  host: string;
}

/** livelli di accesso, dal più basso al più alto */
export type Level = 'lettura' | 'modifica' | 'admin';

export interface AuthResponse {
  ok: boolean;
  /** false quando manca gantt-utenti.json: tutti amministratori, come prima */
  enabled: boolean;
  /** livello che spetta a questo computer senza digitare niente */
  level: Level;
  /** true se il livello arriva dall'elenco dei PC e non dal valore predefinito */
  auto: boolean;
  /** livelli che si possono sbloccare con una password */
  levels: Level[];
  /** come il server ha riconosciuto questo computer (da copiare nell'elenco «pc») */
  who: string;
  file: string;
  exists: boolean;
}

export interface LoginResponse {
  ok: boolean;
  level?: Level;
  enabled?: boolean;
  error?: 'password' | 'pausa' | string;
  waitMs?: number;
}

export const api = {
  info: () => call<ServerInfo>('api/info'),
  state: () => call<StateResponse>('api/state'),
  status: () => call<StatusResponse>('api/status'),
  lock: (id: Identity, force = false) => post<LockResponse>('api/lock', { ...id, force }),
  heartbeat: (sessionId: string) => post<LockResponse>('api/heartbeat', { sessionId }),
  unlock: (sessionId: string) => post<{ ok: boolean }>('api/unlock', { sessionId }),
  requestControl: (id: Identity) => post<{ ok: boolean; free?: boolean }>('api/request-control', id),
  yieldControl: (sessionId: string) => post<{ ok: boolean }>('api/yield', { sessionId }),
  save: (id: Identity, baseRev: number, data: AppData) =>
    post<SaveResponse>('api/save', { ...id, baseRev, data }),
  backup: (data: AppData) => post<{ ok: boolean; file?: string; dir?: string }>('api/backup', data),
  auth: () => call<AuthResponse>('api/auth'),
  login: (password: string) => post<LoginResponse>('api/auth', { password }),
};

/** rilascio del blocco alla chiusura della pagina: deve partire anche mentre il browser chiude */
export function releaseOnUnload(sessionId: string) {
  try {
    const body = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('api/unlock', body)) return;
  } catch {
    /* sendBeacon non disponibile */
  }
  // ripiego sincrono: il blocco scade comunque da solo dopo poco più di un minuto
  void api.unlock(sessionId).catch(() => {});
}
