import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error moduli del server in JavaScript puro (nessun tipo)
import { loadConfig } from './server/config.mjs';
// @ts-expect-error idem
import { configure } from './server/store.mjs';
// @ts-expect-error idem
import { handleApi } from './server/api.mjs';
// @ts-expect-error idem
import { openArchive } from './server/archive.mjs';
// @ts-expect-error idem
import { setTrustProxy, setUsersFile } from './server/users.mjs';

// Stesse rotte /api/* del server di produzione, così `npm run dev` si comporta come il
// programma compilato. Per sicurezza in sviluppo si usa una cartella dati a parte
// (.test-tmp/dati-sviluppo), mai i dati veri: per cambiarla impostare GANTT_DATI.
function localApi(): Plugin {
  return {
    name: 'gantt-api',
    async configureServer(server) {
      if (!process.env.GANTT_DATI) process.env.GANTT_DATI = '.test-tmp/dati-sviluppo';
      const cfg = loadConfig([]);
      configure(cfg);
      setTrustProxy(cfg.proxy);
      setUsersFile(cfg.usersFile);
      await openArchive({ url: 'http://localhost:5180' });
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!urlPath.startsWith('/api/')) return next();
        handleApi(req, res, urlPath).catch(next);
      });
    },
  };
}

// Nella build (GitHub Pages o qualsiasi hosting di file) la pagina porta con sé le stesse regole
// di sicurezza del server, più le API di GitHub per il salvataggio: nessuno script estraneo può
// partire e leggere il token. Solo nella build: in sviluppo Vite usa script in linea.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // le foto dei profili sono indirizzi web scelti dagli utenti (come in server/security.mjs)
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function pageCsp(): Plugin {
  return {
    name: 'gantt-csp',
    apply: 'build',
    // subito dopo il charset: la regola vale per tutto ciò che segue
    transformIndexHtml: (html) =>
      html.replace(
        /(<meta charset="UTF-8" \/>)/i,
        `$1\n    <meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />`,
      ),
  };
}

export default defineConfig({
  plugins: [react(), localApi(), pageCsp()],
  base: './',
  server: { port: 5180, open: true },
  build: { outDir: 'dist' },
});
