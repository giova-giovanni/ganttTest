import { defineConfig } from '@playwright/test';

// Test end-to-end nel browser, in due modalità:
//  - "browser": l'app servita come sito statico (vite preview), senza server → dati nel localStorage
//  - "server":  il server vero (server.mjs) con l'archivio su file, su una cartella temporanea
// Prima volta: npx playwright install chromium
// (oppure PW_CHANNEL=msedge / chrome per usare un browser già installato)
const STATIC_PORT = 5198;
const SERVER_PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  // un test alla volta: il test "server" condivide un solo archivio
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1440, height: 900 },
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'off',
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    { name: 'browser', testMatch: /browser\.spec\.ts/, use: { baseURL: `http://127.0.0.1:${STATIC_PORT}/` } },
    { name: 'server', testMatch: /server\.spec\.ts/, use: { baseURL: `http://127.0.0.1:${SERVER_PORT}/` } },
  ],
  webServer: [
    {
      command: `npx vite preview --host 127.0.0.1 --port ${STATIC_PORT} --strictPort`,
      url: `http://127.0.0.1:${STATIC_PORT}/`,
      reuseExistingServer: false,
    },
    {
      command: `node tests/e2e/start-server.mjs ${SERVER_PORT}`,
      url: `http://127.0.0.1:${SERVER_PORT}/api/info`,
      reuseExistingServer: false,
    },
  ],
});
