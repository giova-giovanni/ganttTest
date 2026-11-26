import { defineConfig } from 'vitest/config';

// Configurazione separata da vite.config.ts: i test unitari non devono avviare
// il plugin con le rotte /api/* né toccare la cartella dati.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
