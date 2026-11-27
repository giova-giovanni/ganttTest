import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubError,
  cleanPath,
  decodeData,
  encodeData,
  fromBase64,
  pagesSite,
  parseRepo,
  readFile,
  toBase64,
  writeFile,
  type GitHubConfig,
} from '../../src/utils/github';
import { describeChanges, rebase } from '../../src/utils/merge';
import type { AppData, Note } from '../../src/types';
import { data, node, person } from './helpers';

const cfg: GitHubConfig = { owner: 'prova', repo: 'gantt-dati', branch: '', path: 'gantt-dati.json', token: 'tok' };

const clone = (d: AppData): AppData => JSON.parse(JSON.stringify(d));

function note(id: string, nodeId: string, title: string): Note {
  return { id, nodeId, title, body: '', tags: [], author: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', pinned: false };
}

/** progetto P con un ramo R e due attività A, B; una persona */
function sample(): AppData {
  return data(
    [
      node('P', null, { name: 'Progetto' }),
      node('R', 'P', { name: 'Ramo' }),
      node('A', 'R', { name: 'Progettazione', hours: 16, start: '2026-03-02', end: '2026-03-06' }),
      node('B', 'R', { name: 'Montaggio', hours: 8, start: '2026-03-09', end: '2026-03-10' }),
    ],
    [person('u1', 'Mario Rossi')],
  );
}

const find = (d: AppData, id: string) => d.nodes.find((n) => n.id === id);

// ------------------------------------------------------------------ testo e nomi

describe('testo, nomi e percorsi', () => {
  it('base64 UTF-8 andata e ritorno: accenti, ß, €, emoji e testi lunghi', () => {
    const text = 'Città àèìòù — Größe ß € 🚀\n'.repeat(5000);
    expect(fromBase64(toBase64(text))).toBe(text);
    // GitHub manda il contenuto spezzato su più righe
    const wrapped = toBase64('Perché sì').replace(/(.{4})/g, '$1\n');
    expect(fromBase64(wrapped)).toBe('Perché sì');
  });

  it('repository scritto in modi diversi', () => {
    expect(parseRepo('prova/gantt-dati')).toEqual({ owner: 'prova', repo: 'gantt-dati' });
    expect(parseRepo(' https://github.com/prova/gantt-dati.git ')).toEqual({ owner: 'prova', repo: 'gantt-dati' });
    expect(parseRepo('github.com/prova/gantt.dati/')).toEqual({ owner: 'prova', repo: 'gantt.dati' });
    expect(parseRepo('solo-nome')).toBeNull();
    expect(parseRepo('a/b/c')).toBeNull();
    expect(parseRepo('prova/..')).toBeNull();
  });

  it('percorso del file ripulito, mai fuori dal repository', () => {
    expect(cleanPath('/dati//gantt.json')).toBe('dati/gantt.json');
    expect(cleanPath('..\\..\\x.json')).toBe('x.json');
    expect(cleanPath('  ')).toBe('gantt-dati.json');
  });

  it('sito su GitHub Pages: proprietario e repository dall’indirizzo', () => {
    expect(pagesSite({ hostname: 'giova.github.io', pathname: '/ganttTest/' })).toEqual({ owner: 'giova', repo: 'ganttTest' });
    expect(pagesSite({ hostname: 'localhost', pathname: '/' })).toBeNull();
    expect(pagesSite(undefined)).toBeNull();
  });

  it('file dei dati: busta leggibile anche dall’import e dal server; file rovinati rifiutati', () => {
    const d = sample();
    const text = encodeData(d, 'Mario Rossi', '2026-03-01T10:00:00.000Z');
    const json = JSON.parse(text);
    expect(json).toMatchObject({ kind: 'gantt-data', format: 2, savedBy: 'Mario Rossi', savedAt: '2026-03-01T10:00:00.000Z' });
    expect(decodeData(text).nodes).toHaveLength(4);
    expect(decodeData('﻿' + JSON.stringify(d)).nodes).toHaveLength(4); // backup JSON semplice, con BOM
    expect(() => decodeData('{ rotto')).toThrow(GitHubError);
    expect(() => decodeData('[]')).toThrow(GitHubError);
    expect(() => decodeData('{"ciao": 1}')).toThrow(/archivio/);
  });
});

// ------------------------------------------------------------------ unione a tre vie

describe('unione delle modifiche (base → mie, base → altrui)', () => {
  it('campi diversi della stessa attività: restano entrambe le modifiche', () => {
    const base = sample();
    const mine = clone(base);
    find(mine, 'A')!.hours = 20;
    const theirs = clone(base);
    find(theirs, 'A')!.end = '2026-03-13';
    const r = rebase(base, mine, theirs);
    expect(find(r.data, 'A')).toMatchObject({ hours: 20, end: '2026-03-13' });
    expect(r.dropped).toEqual([]);
  });

  it('stesso campo: vince chi salva per ultimo (cioè questo browser)', () => {
    const base = sample();
    const mine = clone(base);
    find(mine, 'B')!.name = 'Montaggio (mio)';
    const theirs = clone(base);
    find(theirs, 'B')!.name = 'Montaggio (altrui)';
    expect(find(rebase(base, mine, theirs).data, 'B')!.name).toBe('Montaggio (mio)');
  });

  it('record aggiunti da entrambi: ci sono tutti, nel ramo giusto', () => {
    const base = sample();
    const mine = clone(base);
    mine.nodes.push(node('M', 'R', { name: 'Collaudo (mio)' }));
    const theirs = clone(base);
    theirs.nodes.push(node('T', 'R', { name: 'Consegna (altrui)' }));
    theirs.notes.push(note('n1', 'A', 'Nota altrui'));
    const r = rebase(base, mine, theirs);
    const children = r.data.nodes.filter((n) => n.parentId === 'R').map((n) => n.id);
    expect(children).toEqual(['A', 'B', 'T', 'M']);
    expect(r.data.notes.map((n) => n.id)).toEqual(['n1']);
  });

  it('modifica su un’attività eliminata da un altro: resta eliminata e lo si dice', () => {
    const base = sample();
    const mine = clone(base);
    find(mine, 'B')!.hours = 12;
    const theirs = clone(base);
    theirs.nodes = theirs.nodes.filter((n) => n.id !== 'B');
    const r = rebase(base, mine, theirs);
    expect(find(r.data, 'B')).toBeUndefined();
    expect(r.dropped).toEqual([{ t: 'node', id: 'B', label: 'Montaggio' }]);
  });

  it('sotto-attività aggiunta in un ramo eliminato da un altro: niente attività orfane', () => {
    const base = sample();
    const mine = clone(base);
    mine.nodes.push(node('X', 'B', { name: 'Dettaglio' }));
    mine.notes.push(note('nx', 'X', 'Nota sul dettaglio'));
    const theirs = clone(base);
    theirs.nodes = theirs.nodes.filter((n) => n.id !== 'B');
    const r = rebase(base, mine, theirs);
    expect(r.data.nodes.map((n) => n.id)).toEqual(['P', 'R', 'A']);
    expect(r.data.notes).toEqual([]);
    expect(r.dropped.map((d) => d.id).sort()).toEqual(['X', 'nx']);
  });

  it('attività spostata sotto un ramo eliminato da un altro: resta dov’era', () => {
    const base = sample();
    base.nodes.push(node('R2', 'P', { name: 'Ramo 2' }));
    const mine = clone(base);
    find(mine, 'A')!.parentId = 'R2';
    const theirs = clone(base);
    theirs.nodes = theirs.nodes.filter((n) => n.id !== 'R2');
    const r = rebase(base, mine, theirs);
    expect(find(r.data, 'A')!.parentId).toBe('R');
  });

  it('persona eliminata da un altro: le mie assegnazioni a lei si svuotano', () => {
    const base = sample();
    const mine = clone(base);
    find(mine, 'A')!.assigneeId = 'u1';
    const theirs = clone(base);
    theirs.people = [];
    expect(find(rebase(base, mine, theirs).data, 'A')!.assigneeId).toBeNull();
  });

  it('le modifiche altrui sono restituite a parte (per le istantanee di «annulla»)', () => {
    const base = sample();
    const theirs = clone(base);
    find(theirs, 'A')!.hours = 99;
    const r = rebase(base, clone(base), theirs);
    expect(r.mine).toEqual([]);
    expect(r.theirs).toEqual([{ op: 'set', t: 'node', id: 'A', set: { hours: 99 }, prev: { hours: 16 } }]);
  });
});

describe('messaggio del commit', () => {
  it('un solo record: tipo e nome; più record: conteggi', () => {
    const before = sample();
    const after = clone(before);
    find(after, 'A')!.hours = 20;
    const one = describeChanges([{ op: 'set', t: 'node', id: 'A', set: { hours: 20 } }], before, after, 'it');
    expect(one).toBe('Gantt: Modifica: attività «Progettazione»');

    const more = clone(before);
    more.nodes.push(node('Q', null, { name: 'Nuovo progetto' }));
    more.notes.push(note('n1', 'A', 'Appunti'));
    find(more, 'B')!.hours = 1;
    const ops = [
      { op: 'add', t: 'node', rec: find(more, 'Q')! },
      { op: 'set', t: 'node', id: 'B', set: { hours: 1 } },
      { op: 'add', t: 'note', rec: more.notes[0] },
    ] as Parameters<typeof describeChanges>[0];
    expect(describeChanges(ops, before, more, 'it')).toBe('Gantt: Modifiche: 1 progetto, 1 attività, 1 nota');
    expect(describeChanges(ops, before, more, 'de')).toBe('Gantt: Änderungen: 1 Projekt, 1 Aufgabe, 1 Notiz');

    const gone = describeChanges([{ op: 'del', t: 'node', id: 'B' }], before, after, 'it');
    expect(gone).toBe('Gantt: Eliminazione: attività «Montaggio»');
  });
});

// ------------------------------------------------------------------ API di GitHub (fetch finto)

describe('API di GitHub', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  it('lettura: file mancante, invariato (ETag), contenuto UTF-8, file grande dal blob', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const answers = [
      reply(404, { message: 'Not Found' }),
      new Response(null, { status: 304 }),
      reply(200, { type: 'file', sha: 's1', encoding: 'base64', size: 9, content: toBase64('{"città":1}') }, { ETag: 'W/"e1"' }),
      reply(200, { type: 'file', sha: 's2', encoding: 'none', size: 2_000_000, content: '' }),
      reply(200, { sha: 's2', content: toBase64('grande') }),
    ];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answers.shift()!;
    });
    expect(await readFile(cfg)).toBeNull();
    expect(await readFile({ ...cfg, branch: 'dati' }, 'W/"e0"')).toBe('unchanged');
    expect(await readFile(cfg)).toEqual({ sha: 's1', etag: 'W/"e1"', text: '{"città":1}' });
    expect((await readFile(cfg)) as { text: string }).toMatchObject({ sha: 's2', text: 'grande' });

    expect(calls[0].url).toBe('https://api.github.com/repos/prova/gantt-dati/contents/gantt-dati.json');
    expect(calls[1].url).toBe('https://api.github.com/repos/prova/gantt-dati/contents/gantt-dati.json?ref=dati');
    const h = calls[1].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['If-None-Match']).toBe('W/"e0"');
    expect(calls[1].init.cache).toBe('no-store');
    expect(calls[4].url).toBe('https://api.github.com/repos/prova/gantt-dati/git/blobs/s2');
  });

  it('scrittura: manda sha e ramo; i rifiuti di GitHub diventano errori chiari', async () => {
    let sent: Record<string, string> = {};
    const answers = [
      reply(200, { content: { sha: 'nuovo' }, commit: { html_url: 'https://github.com/c/1', committer: { date: '2026-03-01T10:00:00Z' } } }),
      reply(409, { message: 'gantt-dati.json does not match abc' }),
      reply(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }),
      reply(401, { message: 'Bad credentials' }),
      reply(403, { message: 'Resource not accessible by personal access token' }),
      reply(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
      reply(502, { message: 'Bad gateway' }),
    ];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return answers.shift()!;
    });
    const ok = await writeFile({ ...cfg, branch: 'dati' }, 'testo è', 'vecchio', 'Gantt: prova');
    expect(ok).toEqual({ sha: 'nuovo', commitUrl: 'https://github.com/c/1', at: '2026-03-01T10:00:00Z' });
    expect(sent).toEqual({ message: 'Gantt: prova', content: toBase64('testo è'), sha: 'vecchio', branch: 'dati' });

    const kind = async () => {
      try {
        await writeFile(cfg, 'x', null, 'm');
      } catch (e) {
        return (e as GitHubError).kind;
      }
      return 'ok';
    };
    expect(await kind()).toBe('conflict');
    expect(sent.sha).toBeUndefined(); // file nuovo: nessuno sha
    expect(await kind()).toBe('conflict');
    expect(await kind()).toBe('auth');
    expect(await kind()).toBe('forbidden');
    expect(await kind()).toBe('rateLimit');
    expect(await kind()).toBe('network');
  });

  it('rete assente: errore «network», da riprovare', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(readFile(cfg)).rejects.toMatchObject({ kind: 'network' });
  });
});
