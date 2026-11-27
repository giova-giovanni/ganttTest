import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * Un GitHub finto, in memoria, per i test: risponde alle stesse chiamate REST che usa Gantt Planner
 * (utente, repository, lettura e scrittura del file con controllo dello sha). Più pagine e più
 * contesti del browser lo condividono: è così che si provano due persone sullo stesso archivio.
 */
export class FakeGitHub {
  owner = 'prova';
  name = 'gantt-dati';
  private = true;
  defaultBranch = 'main';
  /** token → utente */
  users: Record<string, { login: string; name: string }> = {
    'tok-mario': { login: 'mario', name: 'Mario Rossi' },
    'tok-anna': { login: 'anna', name: 'Anna Bianchi' },
  };
  files = new Map<string, { sha: string; text: string }>();
  commits: Array<{ message: string; user: string; sha: string }> = [];
  /** scritture rifiutate perché basate su una versione vecchia (409) */
  conflicts = 0;
  /** rete assente: ogni chiamata fallisce come senza connessione */
  offline = false;

  get full() {
    return `${this.owner}/${this.name}`;
  }

  file(path = 'gantt-dati.json') {
    const f = this.files.get(path);
    return f ? (JSON.parse(f.text) as { kind: string; savedBy: string; data: { nodes: Array<{ id: string; name: string; hours: number | null; parentId: string | null }> } }) : null;
  }

  seed(data: unknown, path = 'gantt-dati.json') {
    const text = JSON.stringify({ kind: 'gantt-data', format: 2, savedAt: '2026-03-01T08:00:00.000Z', savedBy: 'prova', data }, null, 2);
    this.files.set(path, { sha: sha(text), text });
  }

  async install(target: Page | BrowserContext) {
    await target.route('https://api.github.com/**', (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, X-GitHub-Api-Version',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Expose-Headers': 'ETag',
    };
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: body === null ? '' : JSON.stringify(body) });
    if (this.offline) return route.abort('internetdisconnected');
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    const token = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
    const user = this.users[token];
    if (!user) return send(401, { message: 'Bad credentials' });

    const path = url.pathname;
    if (path === '/user') return send(200, { login: user.login, name: user.name });
    const base = `/repos/${this.owner}/${this.name}`;
    if (path === base) {
      return send(200, {
        full_name: this.full,
        private: this.private,
        default_branch: this.defaultBranch,
        html_url: `https://github.com/${this.full}`,
        permissions: { admin: false, push: true, pull: true },
      });
    }
    if (!path.startsWith(`${base}/contents/`)) return send(404, { message: 'Not Found' });
    const file = decodeURIComponent(path.slice(`${base}/contents/`.length));

    if (method === 'GET') {
      const f = this.files.get(file);
      if (!f) return send(404, { message: 'Not Found' });
      const etag = `W/"${f.sha}"`;
      if (req.headers()['if-none-match'] === etag) return route.fulfill({ status: 304, headers: { ...cors, ETag: etag } });
      return send(
        200,
        { type: 'file', sha: f.sha, size: Buffer.byteLength(f.text), encoding: 'base64', content: Buffer.from(f.text).toString('base64') },
        { ETag: etag },
      );
    }
    if (method === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}') as { message: string; content: string; sha?: string };
      const cur = this.files.get(file);
      if (cur && !body.sha) return send(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) {
        this.conflicts += 1;
        return send(409, { message: `${file} does not match ${body.sha}` });
      }
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      const next = { sha: sha(text), text };
      this.files.set(file, next);
      this.commits.push({ message: body.message, user: user.login, sha: next.sha });
      return send(cur ? 200 : 201, {
        content: { sha: next.sha },
        commit: { html_url: `https://github.com/${this.full}/commit/${next.sha}`, committer: { date: new Date().toISOString() } },
      });
    }
    return send(405, { message: 'Method not allowed' });
  }
}

const sha = (text: string) => createHash('sha1').update(text).digest('hex');

/** configurazione già salvata nel browser (come dopo il dialogo «Salva su GitHub») */
export async function preconnect(target: Page | BrowserContext, token: string, repo = 'prova/gantt-dati') {
  const [owner, name] = repo.split('/');
  await target.addInitScript(
    (cfg) => {
      if (!localStorage.getItem('gantt.github.v1')) localStorage.setItem('gantt.github.v1', JSON.stringify(cfg));
    },
    { owner, repo: name, branch: '', path: 'gantt-dati.json', token },
  );
}
