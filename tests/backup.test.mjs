// Backup settimanale (src/utils/backup.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoBackupDue, runAutoBackup } from '../src/utils/backup.ts';
import { fakeData } from './helpers/tmp.mjs';

test('backup sul server: indirizzo relativo, funziona anche dietro un proxy con sotto-percorso (/gantt/)', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, file: 'GANTT_backup_auto_2026-11-26.json' }), { status: 200 });
  };
  try {
    const r = await runAutoBackup(fakeData(), { force: true, server: true });
    assert.equal(r.done, true);
    assert.equal(calls[0], 'api/backup');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('registro dell’ultimo backup illeggibile: il backup torna «dovuto» invece di fermarsi per sempre', () => {
  const store = new Map([['gantt.autoBackup.v1', '{"lastAt":"non-una-data"}']]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(isAutoBackupDue(), true);
    store.set('gantt.autoBackup.v1', JSON.stringify({ lastAt: new Date().toISOString() }));
    assert.equal(isAutoBackupDue(), false, 'appena fatto: non dovuto');
  } finally {
    delete globalThis.localStorage;
  }
});
