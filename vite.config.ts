import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error moduli del server in JavaScript puro (nessun tipo)
import { loadConfig } from './server/config.mjs';
// @ts-expect-error idem
import { configure } from './server/store.mjs';
// @ts-expect-error idem
import { handleApi } from './server/api.mjs';

// Stesse rotte /api/* del server di produzione, così `npm run dev` si comporta
// esattamente come il programma compilato (archivio dati, blocco, backup).
function localApi(): Plugin {
  return {
    name: 'gantt-api',
    configureServer(server) {
      configure(loadConfig([]));
      server.middlewares.use((req, res, next) => {
        const urlPath = (req.url ?? '').split('?')[0];
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
