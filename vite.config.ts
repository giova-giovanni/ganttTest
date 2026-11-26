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

export default defineConfig({
  plugins: [react(), localApi()],
  base: './',
  server: { port: 5180, open: true },
  build: { outDir: 'dist' },
});
