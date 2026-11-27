/**
 * Archivio su GitHub: i dati stanno in un file JSON di un repository e si leggono e scrivono
 * con le API REST di GitHub (Contents API), direttamente dal browser. Nessun server da installare:
 * basta il sito su GitHub Pages (o qualsiasi hosting di file) e un token personale.
 *
 * - Ogni salvataggio è un commit: la cronologia del file dice chi ha cambiato cosa e quando,
 *   e ogni versione si può ripristinare da GitHub.
 * - Scrittura «a confronto»: si manda lo sha della versione letta; se nel frattempo qualcun
 *   altro ha salvato, GitHub rifiuta (409) e il programma unisce le modifiche prima di riprovare.
 * - Il token resta solo nel browser di chi lo inserisce (localStorage), mai nel repository.
 */
import type { AppData } from '../types';

export interface GitHubConfig {
  owner: string;
  repo: string;
  /** ramo; vuoto = ramo principale del repository */
  branch: string;
  /** percorso del file nel repository */
  path: string;
  token: string;
}

export const DEFAULT_PATH = 'gantt-dati.json';
const API = 'https://api.github.com';
const CONFIG_KEY = 'gantt.github.v1';
const TIMEOUT_MS = 20_000;

/** tipo di errore, per decidere se riprovare da soli o chiedere qualcosa all'utente */
export type GhErrorKind = 'auth' | 'forbidden' | 'notFound' | 'conflict' | 'rateLimit' | 'network' | 'invalid';

export class GitHubError extends Error {
  kind: GhErrorKind;
  status: number;
  constructor(kind: GhErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** l'utente del token può scrivere (il token potrebbe comunque avere meno permessi) */
  canPush: boolean;
  htmlUrl: string;
}

export interface GhUser {
  login: string;
  name: string | null;
}

export interface RemoteFile {
  /** sha del contenuto: serve per la scrittura successiva */
  sha: string;
  /** per chiedere a GitHub «è cambiato qualcosa?» senza scaricare di nuovo il file */
  etag: string | null;
  text: string;
}

export interface WriteResult {
  sha: string;
  commitUrl: string | null;
  at: string;
}

// ---------------------------------------------------------------- configurazione nel browser

export function readGitHubConfig(): GitHubConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<GitHubConfig>;
    if (!c.owner || !c.repo || !c.token) return null;
    return {
      owner: String(c.owner),
      repo: String(c.repo),
      branch: typeof c.branch === 'string' ? c.branch : '',
      path: typeof c.path === 'string' && c.path.trim() ? c.path : DEFAULT_PATH,
      token: String(c.token),
    };
  } catch {
    return null;
  }
}

export function saveGitHubConfig(cfg: GitHubConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearGitHubConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* niente da togliere */
  }
}

/** «proprietario/nome», «https://github.com/proprietario/nome(.git)» → { owner, repo } */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2] };
}

/** percorso del file pulito: niente barre iniziali, niente «..» */
export function cleanPath(path: string): string {
  const parts = path
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || DEFAULT_PATH;
}

/** sito su GitHub Pages (proprietario.github.io/repository/): da qui si propongono i nomi */
export function pagesSite(
  loc: { hostname?: string; pathname?: string } | undefined = typeof window !== 'undefined' ? window.location : undefined,
): { owner: string; repo: string } | null {
  if (!loc?.hostname) return null;
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return null;
  const first = (loc.pathname ?? '').split('/').filter(Boolean)[0];
  return { owner: m[1], repo: first && !first.includes('.') ? first : `${m[1]}.github.io` };
}

// ---------------------------------------------------------------- testo ↔ base64 (UTF-8)

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- file dei dati

/**
 * Stessa «busta» dell'archivio del server: il file si può anche importare (⇅) o aprire con
 * il server Node. Una riga per campo: nella cronologia di GitHub si vede cosa è cambiato.
 */
export function encodeData(data: AppData, savedBy: string, savedAt = new Date().toISOString()): string {
  return JSON.stringify({ kind: 'gantt-data', format: 2, savedAt, savedBy, data }, null, 2) + '\n';
}

/** il contenuto del file: busta { kind, data } oppure i dati semplici (backup JSON) */
export function decodeData(text: string): Partial<AppData> {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new GitHubError('invalid', 0, 'il file non è JSON valido');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new GitHubError('invalid', 0, 'il file non contiene un archivio');
  const obj = json as Record<string, unknown>;
  const d = !Array.isArray(obj.nodes) && obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : obj;
  if (!Array.isArray(d.nodes)) throw new GitHubError('invalid', 0, 'il file non contiene un archivio di Gantt Planner');
  return d as Partial<AppData>;
}

// ---------------------------------------------------------------- chiamate alle API

const enc = encodeURIComponent;
const repoUrl = (cfg: GitHubConfig) => `${API}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}`;
const contentsUrl = (cfg: GitHubConfig) => `${repoUrl(cfg)}/contents/${cleanPath(cfg.path).split('/').map(enc).join('/')}`;

async function request(
  cfg: GitHubConfig,
  url: string,
  init: { method?: string; body?: unknown; etag?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.etag) headers['If-None-Match'] = init.etag;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // no-store: senza, il browser terrebbe per 60 s una copia vecchia del file
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    throw new GitHubError('network', 0, 'GitHub non raggiungibile');
  } finally {
    clearTimeout(timer);
  }
}

/** traduce una risposta di errore di GitHub in un GitHubError */
async function fail(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) message = body.message;
  } catch {
    /* corpo non JSON */
  }
  const s = res.status;
  if (s === 401) throw new GitHubError('auth', s, message);
  if (s === 429 || (s === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(message)))) {
    throw new GitHubError('rateLimit', s, message);
  }
  if (s === 403) throw new GitHubError('forbidden', s, message);
  if (s === 404) throw new GitHubError('notFound', s, message);
  // 409: lo sha mandato non è più quello attuale; 422 «sha wasn't supplied»: il file esiste già
  if (s === 409 || (s === 422 && /sha/i.test(message))) throw new GitHubError('conflict', s, message);
  if (s >= 500) throw new GitHubError('network', s, message);
  throw new GitHubError('invalid', s, message);
}

export async function getUser(cfg: GitHubConfig): Promise<GhUser> {
  const res = await request(cfg, `${API}/user`);
  if (!res.ok) await fail(res);
  const u = (await res.json()) as { login: string; name?: string | null };
  return { login: u.login, name: u.name ?? null };
}

export async function getRepo(cfg: GitHubConfig): Promise<RepoInfo> {
  const res = await request(cfg, repoUrl(cfg));
  if (!res.ok) await fail(res);
  const r = (await res.json()) as {
    full_name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
    permissions?: { push?: boolean; admin?: boolean; maintain?: boolean };
  };
  const p = r.permissions;
  return {
    fullName: r.full_name,
    private: !!r.private,
    defaultBranch: r.default_branch,
    canPush: p ? !!(p.push || p.admin || p.maintain) : true,
    htmlUrl: r.html_url,
  };
}

/**
 * Legge il file dei dati.
 * null = il file non esiste ancora (repository nuovo); 'unchanged' = uguale alla versione `etag`.
 */
export async function readFile(cfg: GitHubConfig, etag?: string | null): Promise<RemoteFile | null | 'unchanged'> {
  const ref = cfg.branch ? `?ref=${enc(cfg.branch)}` : '';
  const res = await request(cfg, contentsUrl(cfg) + ref, { etag });
  if (res.status === 304) return 'unchanged';
  if (res.status === 404) return null;
  if (!res.ok) await fail(res);
  const body = (await res.json()) as { type?: string; sha: string; content?: string; encoding?: string; size?: number };
  if (Array.isArray(body) || body.type !== 'file') throw new GitHubError('invalid', 200, `${cfg.path} non è un file`);
  let content = body.encoding === 'base64' ? body.content ?? '' : '';
  if (!content && (body.size ?? 0) > 0) {
    // oltre 1 MB la Contents API non manda il contenuto: si legge il blob (fino a 100 MB)
    const blob = await request(cfg, `${repoUrl(cfg)}/git/blobs/${enc(body.sha)}`);
    if (!blob.ok) await fail(blob);
    content = ((await blob.json()) as { content: string }).content;
  }
  return { sha: body.sha, etag: res.headers.get('etag'), text: content ? fromBase64(content) : '' };
}

/** scrive il file: `sha` = versione su cui si basano le modifiche (null = file nuovo) */
export async function writeFile(cfg: GitHubConfig, text: string, sha: string | null, message: string): Promise<WriteResult> {
  const body: Record<string, string> = { message, content: toBase64(text) };
  if (sha) body.sha = sha;
  if (cfg.branch) body.branch = cfg.branch;
  const res = await request(cfg, contentsUrl(cfg), { method: 'PUT', body });
  if (!res.ok) await fail(res);
  const r = (await res.json()) as {
    content: { sha: string };
    commit?: { html_url?: string; committer?: { date?: string } };
  };
  return {
    sha: r.content.sha,
    commitUrl: r.commit?.html_url ?? null,
    at: r.commit?.committer?.date ?? new Date().toISOString(),
  };
}

/** controllo completo prima di collegarsi: token, repository, file */
export async function testConnection(cfg: GitHubConfig): Promise<{ user: GhUser; repo: RepoInfo; fileExists: boolean }> {
  const user = await getUser(cfg);
  const repo = await getRepo(cfg);
  const file = await readFile(cfg);
  if (file && file !== 'unchanged') decodeData(file.text); // un file illeggibile si segnala subito
  return { user, repo, fileExists: !!file };
}

// ---------------------------------------------------------------- indirizzi per le persone

/** pagina di GitHub con tutte le versioni del file (chi, quando, cosa) */
export function historyUrl(cfg: GitHubConfig, branch: string): string {
  return `https://github.com/${enc(cfg.owner)}/${enc(cfg.repo)}/commits/${enc(branch || 'HEAD')}/${cleanPath(cfg.path)
    .split('/')
    .map(enc)
    .join('/')}`;
}

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
