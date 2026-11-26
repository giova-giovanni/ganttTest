/**
 * Dialogo con il server di Gantt Planner (archivio condiviso, più utenti insieme).
 *
 * Se la pagina viene aperta senza server (doppio clic su dist/index.html) le chiamate
 * falliscono e il programma lavora nel browser come le versioni precedenti.
 */
import type { AppData } from '../types';
import type { Op, RecordKind } from '../../shared/ops.mjs';

/** livelli di accesso, dal più basso al più alto */
export type Level = 'lettura' | 'modifica' | 'admin';
/** come si entra: senza controllo, con le password di livello, con account personali */
export type AccessMode = 'aperto' | 'livelli' | 'account';

export interface ServerStatus {
  health: { ok: boolean; error: string | null };
  /** un altro server sta già usando la cartella dati: questo è in sola lettura */
  readOnly: { host: string; url: string; since: string } | null;
}

export interface ServerInfo {
  ok: true;
  version: string;
  mode: 'locale' | 'rete';
  port: number;
  server: string;
  access: { mode: AccessMode; ospiti: boolean; levels: Level[]; autoLevel: Level; auto: boolean; who: string };
  status: ServerStatus;
  /** solo per l'amministratore */
  dataDir?: string;
  appDir?: string;
  configFile?: string;
}

export interface Session {
  id: string;
  user: string;
  level: Level;
  color: string;
  account: boolean;
  guest: boolean;
  expiresAt: string;
}

export interface StateResponse extends ServerStatus {
  ok: boolean;
  rev: number;
  savedAt: string | null;
  savedBy: string | null;
  data: AppData;
}

/** un valore appena scritto da qualcuno e sostituito da un salvataggio successivo */
export interface Overwrite {
  t: RecordKind;
  id: string;
  field: string;
  value: unknown;
  by: string;
  sid: string;
  label: string;
}

export interface Skipped {
  t: RecordKind;
  id: string;
  reason: 'esiste' | 'eliminato' | 'riferimento';
  by?: string;
  at?: string;
  label?: string;
}

export type Fix = { t: RecordKind; rec: Record<string, unknown> & { id: string } } | { t: RecordKind; id: string; deleted: true };

export interface OpsResponse {
  ok: boolean;
  rev: number;
  skipped: Skipped[];
  fix: Fix[];
  overwrote: Overwrite[];
}

export interface BatchEvent {
  rev: number;
  at: string;
  user: string;
  sid: string;
  client: string;
  batch: string;
  ops: Op[];
  overwrote: Overwrite[];
}

export interface Presence {
  client: string;
  sid: string;
  user: string;
  color: string;
  level: Level;
  page: string | null;
  project: string | null;
  node: string | null;
  field: string | null;
  note: string | null;
}

export interface PollResponse {
  ok: boolean;
  rev: number;
  batches: BatchEvent[];
  reload: boolean;
  presence: Presence[];
  server: ServerStatus;
}

export interface LogChange {
  op: 'add' | 'set' | 'del' | 'order' | 'replace';
  t?: RecordKind;
  id?: string | null;
  label?: string;
  root?: string | null;
  fields?: Record<string, [unknown, unknown] | null>;
  count?: number;
}

export interface LogEntry {
  rev: number;
  at: string;
  user: string;
  changes: LogChange[];
}

/** risposta di errore del server (401 = serve l'accesso, 403 = livello insufficiente…) */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const TIMEOUT_MS = 15_000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status, 'risposta non valida dal server');
    }
    if (!res.ok) throw new ApiError(res.status, (json as { error?: string })?.error ?? `HTTP ${res.status}`, json);
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

export const api = {
  info: () => call<ServerInfo>('api/info'),
  session: () => call<{ ok: boolean; session: Session }>('api/sessione'),
  login: (nome: string, password: string) => post<{ ok: boolean; session: Session }>('api/sessione', { nome, password }),
  unlock: (password: string) => post<{ ok: boolean; session: Session }>('api/sessione/livello', { password }),
  baseLevel: () => post<{ ok: boolean; session: Session }>('api/sessione/base', {}),
  logout: () => post<{ ok: boolean }>('api/sessione/esci', {}),
  state: () => call<StateResponse>('api/stato'),
  ops: (body: { client: string; batch: string; ops: Op[] }) => post<OpsResponse>('api/operazioni', body),
  poll: (rev: number, client: string) =>
    call<PollResponse>(`api/eventi?poll=1&rev=${encodeURIComponent(rev)}&client=${encodeURIComponent(client)}`),
  presence: (body: Record<string, string | null>) => post<{ ok: boolean }>('api/presenza', body),
  log: (q: { limit?: number; before?: number; utente?: string; progetto?: string }) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
    return call<{ ok: boolean; entries: LogEntry[] }>(`api/registro?${params}`);
  },
  backup: () => post<{ ok: boolean; file?: string }>('api/backup', {}),
};

/** indirizzo del canale in tempo reale (Server-Sent Events) */
export function eventsUrl(rev: number, client: string): string {
  return `api/eventi?rev=${encodeURIComponent(rev)}&client=${encodeURIComponent(client)}`;
}

/** salvataggio «all'ultimo respiro» alla chiusura della pagina (solo gruppi piccoli) */
export function sendOpsOnUnload(body: { client: string; batch: string; ops: Op[] }): boolean {
  const text = JSON.stringify(body);
  if (text.length > 60_000) return false;
  try {
    void fetch('api/operazioni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
      keepalive: true,
      credentials: 'same-origin',
    });
    return true;
  } catch {
    return false;
  }
}
