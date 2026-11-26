// Ambiente per provare lo stato del browser (src/store.ts) contro il server vero, in-process,
// su una cartella dati temporanea. Il fetch del «browser» ha un suo cookie di sessione;
// `responseDelay` rallenta le risposte (la richiesta arriva subito, la risposta torna dopo).
import { startApi } from './http.mjs';

export async function startClientEnv(options = {}) {
  const api = await startApi(options);
  const env = { ...api, responseDelay: {}, requests: [], cookie: '' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), api.base + '/');
    const { cache: _c, credentials: _cr, keepalive: _k, ...rest } = init; // opzioni del browser che qui non servono
    const headers = { ...(rest.headers ?? {}), ...(env.cookie ? { Cookie: env.cookie } : {}) };
    env.requests.push(url.pathname);
    const res = await realFetch(url, { ...rest, headers });
    const set = res.headers.get('set-cookie');
    if (set) env.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const delay = env.responseDelay[url.pathname] ?? 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return res;
  };

  // finestra minima per store.ts e api.ts; i timer non tengono vivo il processo dei test
  const unref = (t) => (t?.unref?.(), t);
  globalThis.window = {
    setTimeout: (fn, ms) => unref(setTimeout(fn, ms)),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms) => unref(setInterval(fn, ms)),
    clearInterval: (t) => clearInterval(t),
    addEventListener() {},
    removeEventListener() {},
  };

  const close = env.close;
  env.close = async () => {
    globalThis.fetch = realFetch;
    await close();
  };
  return env;
}

export async function until(cond, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condizione non raggiunta in tempo');
    await new Promise((r) => setTimeout(r, 15));
  }
}
