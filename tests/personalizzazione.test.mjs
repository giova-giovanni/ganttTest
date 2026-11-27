// Colori del sito, colori dei progetti, profili dei responsabili e preferenze di ingrandimento.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activePreset,
  contrast,
  DEFAULT_COLORS,
  DEFAULT_STATUS_COLORS,
  emptyColors,
  PRESETS,
  sanitizeColors,
  STATUS_VAR,
  textOn,
  themeVars,
} from '../src/theme.ts';
import { projectColors, PROJECT_COLORS } from '../src/utils/projectColors.ts';
import { addPerson, getState, migrate, replaceData, sanitizeUi, updateNode, updatePerson } from '../src/store.ts';
import { analyzeImport, buildPeopleCsv } from '../src/utils/io.ts';
import { applyOps, diffOps, invalidOps, isPhotoUrl } from '../shared/ops.mjs';
import { CSP } from '../server/security.mjs';
import { node } from './helpers/tmp.mjs';

const clone = (d) => JSON.parse(JSON.stringify(d));

// ------------------------------------------------------------------ colori del sito

test('senza personalizzazioni non si imposta nessuna variabile: vale styles.css', () => {
  assert.deepEqual(themeVars('light', emptyColors()), {});
  assert.deepEqual(themeVars('dark', emptyColors()), {});
});

test('i colori predefiniti di theme.ts sono gli stessi di styles.css', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const from = css.indexOf(`${selector} {`);
    return css.slice(from, css.indexOf('\n}', from));
  };
  const value = (text, name) => new RegExp(`\\s${name}:\\s*(#[0-9a-f]{6});`).exec(text)?.[1];
  const root = block(':root');
  const dark = block("[data-theme='dark']");
  const names = {
    accent: '--accent',
    header: '--header',
    headerText: '--header-text',
    bg: '--bg',
    panel: '--panel',
    text: '--text',
    muted: '--muted',
    today: '--today',
  };
  for (const [key, name] of Object.entries(names)) {
    assert.equal(value(root, name), DEFAULT_COLORS.light[key], `chiaro ${name}`);
    assert.equal(value(dark, name) ?? value(root, name), DEFAULT_COLORS.dark[key], `scuro ${name}`);
  }
  for (const [status, name] of Object.entries(STATUS_VAR)) {
    assert.equal(value(root, name), DEFAULT_STATUS_COLORS[status], name);
  }
});

test('un colore scelto aggiorna anche le sfumature che ne derivano, solo nella sua modalità', () => {
  const colors = { ...emptyColors(), light: { accent: '#800080' } };
  const light = themeVars('light', colors);
  assert.equal(light['--accent'], '#800080');
  assert.equal(light['--accent-fill'], '#800080');
  assert.ok(light['--accent-soft'] && light['--row-sel'] && light['--row-hover']);
  assert.equal(light['--panel'], undefined, 'lo sfondo non è stato toccato');
  assert.deepEqual(themeVars('dark', colors), {});
});

test('barra in alto chiara: la scritta diventa scura da sola, se non la si sceglie', () => {
  const auto = themeVars('light', { ...emptyColors(), light: { header: '#ffffff' } });
  assert.ok(contrast(auto['--header-text'], '#ffffff') > 7);
  const chosen = themeVars('light', { ...emptyColors(), light: { header: '#ffffff', headerText: '#aa0000' } });
  assert.equal(chosen['--header-text'], '#aa0000');
});

test('scritte sopra un colore: bianche sugli scuri, scure sui chiari; gli stati usano la loro variabile', () => {
  assert.equal(textOn('#1f2a37'), '#ffffff');
  assert.equal(textOn('#fff3a0'), '#141b24');
  assert.equal(textOn('var(--st-done)'), 'var(--st-done-text)');
  const vars = themeVars('dark', { ...emptyColors(), status: { DONE: '#d8f5a2' } });
  assert.equal(vars['--st-done'], '#d8f5a2');
  assert.equal(vars['--st-done-text'], '#141b24');
});

test('tutte le combinazioni pronte si leggono, in chiaro e in scuro', () => {
  for (const preset of PRESETS) {
    for (const theme of ['light', 'dark']) {
      const c = { ...DEFAULT_COLORS[theme], ...preset[theme] };
      const vars = themeVars(theme, { ...emptyColors(), [theme]: preset[theme] });
      const where = `${preset.id} ${theme}`;
      assert.ok(contrast(c.text, c.panel) >= 7, `${where}: testo sui riquadri`);
      assert.ok(contrast(c.text, c.bg) >= 7, `${where}: testo sullo sfondo`);
      assert.ok(contrast(vars['--muted'] ?? c.muted, c.panel) >= 4, `${where}: testo secondario`);
      assert.ok(contrast(vars['--header-text'] ?? c.headerText, c.header) >= 7, `${where}: barra in alto`);
      assert.ok(contrast(c.accent, c.panel) >= 3, `${where}: colore principale`);
    }
  }
});

test('colori salvati nel browser: passano solo valori «#rrggbb» e si riconosce la combinazione in uso', () => {
  const dirty = sanitizeColors({
    light: { accent: 'red', bg: '#ABCDEF', panel: 'url(javascript:alert(1))', altro: '#000000' },
    dark: null,
    status: { DONE: '#00ff00', TODO: '#12', PIPPO: '#000000' },
  });
  assert.deepEqual(dirty, { light: { bg: '#abcdef' }, dark: {}, status: { DONE: '#00ff00' } });
  assert.equal(activePreset(emptyColors()), 'default');
  const ocean = PRESETS.find((p) => p.id === 'ocean');
  assert.equal(activePreset({ light: { ...ocean.light }, dark: { ...ocean.dark }, status: {} }), 'ocean');
  assert.equal(activePreset(dirty), null);
});

test('preferenze vecchie o rovinate: ingrandimento e grafico tornano entro i limiti', () => {
  const old = sanitizeUi({ theme: 'dark' }); // salvate prima di queste funzioni
  assert.equal(old.zoom.notes, 1);
  assert.equal(old.menuZoom, 1);
  assert.deepEqual(old.chart, { rowHeight: 28, dayWidth: 1 });
  assert.deepEqual(old.colors, emptyColors());
  const bad = sanitizeUi({ zoom: { home: 50, people: 'molto' }, menuZoom: -3, chart: { rowHeight: 999, dayWidth: 0 } });
  assert.equal(bad.zoom.home, 2);
  assert.equal(bad.zoom.people, 1);
  assert.equal(bad.menuZoom, 0.9);
  assert.deepEqual(bad.chart, { rowHeight: 52, dayWidth: 0.5 });
});

// ------------------------------------------------------------------ colori dei progetti

test('colore del progetto: quello scelto vince; archiviarne uno non cambia il colore degli altri', () => {
  const nodes = [node('a', 'A'), node('a1', 'figlio', 'a'), node('b', 'B', null, { color: '#123456' }), node('c', 'C')];
  const before = projectColors(nodes);
  assert.equal(before.a, PROJECT_COLORS[0]);
  assert.equal(before.b, '#123456');
  assert.equal(before.c, PROJECT_COLORS[2]);
  assert.equal(before.a1, undefined, 'solo i progetti hanno un colore');
  nodes[0] = { ...nodes[0], archived: true };
  assert.deepEqual(projectColors(nodes), before);
});

test('il colore del progetto è un dato condiviso: operazione sul server, e si può tornare automatico', () => {
  replaceData({ nodes: [node('p', 'Commessa')] });
  const before = clone(getState().data);
  updateNode('p', { color: '#8e5bd8' });
  const ops = diffOps(before, getState().data);
  assert.deepEqual(ops, [{ op: 'set', t: 'node', id: 'p', set: { color: '#8e5bd8' }, prev: { color: null } }]);
  assert.equal(invalidOps(ops), null);
  assert.equal(invalidOps([{ op: 'set', t: 'node', id: 'p', set: { color: null } }]), null);
  assert.match(invalidOps([{ op: 'set', t: 'node', id: 'p', set: { color: 'red;background:url(x)' } }]), /color/);
});

// ------------------------------------------------------------------ profili

test('foto del profilo: solo indirizzi http/https senza spazi', () => {
  for (const ok of ['https://esempio.it/foto.jpg', 'http://intranet/persone/mr.png?v=2', 'https://x.y/a%20b.webp']) {
    assert.equal(isPhotoUrl(ok), true, ok);
  }
  for (const bad of [
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///C:/foto.jpg',
    'https://x.y/a b.jpg',
    'https://x.y/"onerror=alert(1)',
    '//esempio.it/foto.jpg',
    'foto.jpg',
    'https://' + 'a'.repeat(2100),
    '',
  ]) {
    assert.equal(isPhotoUrl(bad), false, bad.slice(0, 40));
  }
});

test('il server rifiuta foto non valide e accetta ancora i salvataggi senza i campi nuovi', () => {
  const rec = { id: 'x', name: 'Anna', role: '', color: '#2f7de1', hoursPerDay: 8 };
  assert.equal(invalidOps([{ op: 'add', t: 'person', rec }]), null, 'scheda aperta con la versione precedente');
  const { color: _c, ...oldNode } = node('n', 'N', null, { color: null });
  assert.equal(invalidOps([{ op: 'add', t: 'node', rec: oldNode }]), null);
  assert.equal(invalidOps([{ op: 'set', t: 'person', id: 'x', set: { photo: '' } }]), null);
  assert.equal(invalidOps([{ op: 'set', t: 'person', id: 'x', set: { photo: 'https://e.it/a.jpg' } }]), null);
  assert.match(invalidOps([{ op: 'set', t: 'person', id: 'x', set: { photo: 'javascript:alert(1)' } }]), /photo/);
  assert.match(invalidOps([{ op: 'set', t: 'person', id: 'x', set: { about: 'a'.repeat(2001) } }]), /about/);
});

test('file importati: foto non valide scartate, il resto del profilo resta', () => {
  const d = migrate({
    people: [
      { id: 'a', name: 'A', photo: 'javascript:alert(1)', email: 'a@e.it', phone: '123', about: 'ciao' },
      { id: 'b', name: 'B', photo: '  https://e.it/b.jpg  ' },
      { id: 'c', name: 'C' },
    ],
    nodes: [node('p', 'P', null, { color: 'verde' }), node('q', 'Q', null, { color: '#00AA00' })],
  });
  assert.equal(d.people[0].photo, '');
  assert.equal(d.people[0].email, 'a@e.it');
  assert.equal(d.people[1].photo, 'https://e.it/b.jpg');
  assert.deepEqual([d.people[2].photo, d.people[2].email, d.people[2].about], ['', '', '']);
  assert.deepEqual(
    d.nodes.map((n) => n.color),
    [null, '#00AA00'],
  );
});

test('modifiche al profilo: il server ricostruisce gli stessi dati', () => {
  replaceData({});
  const before = clone(getState().data);
  const id = addPerson({ name: 'Anna', role: 'PLC', color: '#2f7de1', hoursPerDay: 8 });
  updatePerson(id, { photo: 'https://e.it/anna.jpg', email: 'anna@e.it', about: 'Software' });
  const ops = diffOps(before, getState().data);
  assert.equal(invalidOps(ops), null);
  const server = clone(before);
  applyOps(server, ops);
  assert.deepEqual(server.people, getState().data.people);
});

test('CSV Responsabili: e-mail, telefono e foto si esportano e si reimportano', () => {
  const data = migrate({
    people: [
      {
        id: 'p1',
        name: 'Mario Rossi',
        role: 'PM',
        color: '#2f7de1',
        hoursPerDay: 6,
        email: 'mario@e.it',
        phone: '+39 000 000 000',
        photo: 'https://e.it/mario.jpg',
      },
    ],
  });
  for (const lang of ['it', 'de']) {
    const preview = analyzeImport(buildPeopleCsv(data, lang), 'responsabili.csv', migrate({}), lang);
    assert.equal(preview.kind, 'people', lang);
    const p = preview.data.people[0];
    assert.deepEqual(
      [p.name, p.role, p.hoursPerDay, p.color, p.email, p.phone, p.photo],
      ['Mario Rossi', 'PM', 6, '#2f7de1', 'mario@e.it', '+39 000 000 000', 'https://e.it/mario.jpg'],
      lang,
    );
  }
});

test('intestazioni di sicurezza: immagini anche dal web, script e connessioni solo dal server', () => {
  assert.match(CSP, /img-src 'self' data: blob: https: http:(;|$)/);
  assert.match(CSP, /script-src 'self'(;|$)/);
  assert.match(CSP, /connect-src 'self'(;|$)/);
  assert.match(CSP, /default-src 'self'(;|$)/);
});
