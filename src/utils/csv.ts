/**
 * Lettura e scrittura CSV pensate per Excel italiano/tedesco.
 *
 * Excel in IT/DE usa il punto e virgola come separatore di colonna e la virgola
 * come separatore decimale: qui si scrive in quel formato e si legge qualunque
 * combinazione (`;` `,` tab `|`, virgolette, celle su più righe, BOM, riga `sep=`).
 */

export type CsvRow = string[];

/** separatore usato in scrittura: `;` è quello che Excel IT/DE si aspetta */
export const CSV_DELIM = ';';

// ------------------------------------------------------------------ lettura

/** Toglie il BOM iniziale e uniforma i fine riga. */
function normalizeRaw(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Cuore del parser (RFC 4180 con qualche tolleranza in più): virgolette raddoppiate (`""`),
 * valori su più righe. Le virgolette aprono una cella solo se ne sono il primo carattere:
 * in «Tubo 2" acciaio» restano testo e non si mangiano il resto del file.
 */
function parseRecords(raw: string, d: string, limit = Infinity): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = '';
  let inQuotes = false;
  let quoted = false; // la cella corrente è iniziata con le virgolette

  for (let i = 0; i < raw.length && rows.length < limit; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
    } else if (ch === d) {
      row.push(field);
      field = '';
      quoted = false;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      quoted = false;
    } else {
      field += ch;
    }
  }
  if (rows.length < limit && (field !== '' || row.length)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const notBlank = (r: CsvRow) => r.some((c) => c.trim() !== '');

/**
 * Riconosce il separatore: vince quello che divide le prime righe in un numero di colonne
 * costante (e > 1). Contare i caratteri non basta: in un file «;» salvato da Excel le
 * virgole dei decimali e dei testi sono spesso più dei punti e virgola.
 */
export function detectDelimiter(text: string): string {
  const raw = normalizeRaw(text);
  let best = ';';
  let bestScore = 0;
  for (const d of [';', '\t', ',', '|']) {
    const rows = parseRecords(raw, d, 30).filter(notBlank);
    const width = rows[0]?.length ?? 0;
    if (width < 2) continue;
    const consistent = rows.filter((r) => r.length === width).length;
    const score = consistent * 1000 + width; // prima la coerenza tra le righe, poi le colonne
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Legge un CSV: separatore indicato, oppure riga `sep=` di Excel, oppure riconosciuto. */
export function parseCsv(text: string, delimiter?: string): CsvRow[] {
  let raw = normalizeRaw(text);
  // Excel accetta una prima riga "sep=;" per forzare il separatore: la si onora e rimuove
  let forced: string | undefined;
  const sepMatch = /^sep=(.)\n/i.exec(raw);
  if (sepMatch) {
    forced = sepMatch[1];
    raw = raw.slice(sepMatch[0].length);
  }
  const d = delimiter ?? forced ?? detectDelimiter(raw);
  // scarta le righe completamente vuote
  return parseRecords(raw, d).filter(notBlank);
}

// ------------------------------------------------------------------ scrittura

function escapeCell(value: string, delimiter: string): string {
  const v = value ?? '';
  return /["\n\r]|^\s|\s$/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serializza in CSV. `sepHint` scrive la riga `sep=;` che fa aprire il file
 * a Excel già diviso in colonne anche quando l'impostazione locale è diversa.
 */
export function toCsv(rows: CsvRow[], opts: { delimiter?: string; sepHint?: boolean } = {}): string {
  const d = opts.delimiter ?? CSV_DELIM;
  const body = rows.map((r) => r.map((c) => escapeCell(c ?? '', d)).join(d)).join('\r\n');
  const head = opts.sepHint === false ? '' : `sep=${d}\r\n`;
  return head + body + '\r\n';
}

/** Il BOM serve a Excel per leggere gli accenti e le lettere tedesche in UTF-8. */
export function csvBlob(content: string): Blob {
  return new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
}

// ------------------------------------------------------------------ celle

/** Confronta le intestazioni ignorando maiuscole, accenti, punti e spazi. */
export function normalizeHeader(h: string): string {
  return (h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Legge un numero scritto all'italiana o all'inglese.
 * Accetta "12,5", "12.5", "1.234,5", "1,234.5", "16 h", "40%".
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, '').replace(/[hH%]$/, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // l'ultimo separatore che compare è quello decimale
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Scrive un numero con la virgola decimale, come si aspetta Excel IT/DE. */
export function formatNumber(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const fixed = decimals === 0 ? Math.round(n).toString() : n.toFixed(decimals).replace(/\.0+$/, '');
  return fixed.replace('.', ',');
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * Interpreta una data proveniente da un foglio di calcolo.
 * Accetta gg/mm/aaaa, gg.mm.aaaa, aaaa-mm-gg, gg-mm-aa e il numero seriale di Excel.
 */
export function parseCsvDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // numero seriale Excel (1 = 1900-01-01); si accetta un intervallo plausibile 1970..2124
  if (/^\d{4,5}([.,]\d+)?$/.test(s)) {
    const serial = parseNumber(s);
    if (serial !== null && serial > 25000 && serial < 82000) {
      // la parte decimale è l'ora del giorno (0,75 = 18:00): non deve spostare la data
      const d = new Date(EXCEL_EPOCH + Math.floor(serial) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (iso) return mk(+iso[1], +iso[2], +iso[3]);

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (dmy) {
    let y = +dmy[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return mk(y, +dmy[2], +dmy[1]);
  }

  // ultima risorsa: formati locali riconosciuti dal browser (es. "15 Mar 2026")
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return mk(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  return null;

  function mk(y: number, m: number, d: number): string | null {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // es. 31/02
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
}

/** Legge il rientro di una cella ("   Attività", "..Attività", "--Attività"). */
export function indentLevel(raw: string): { level: number; text: string } {
  const s = String(raw ?? '');
  const m = /^([\s.\-–—>*+·• \t]*)/.exec(s);
  const prefix = m ? m[1] : '';
  const text = s.slice(prefix.length).trim();
  if (!prefix) return { level: 0, text };
  const tabs = (prefix.match(/\t/g) || []).length;
  const dots = (prefix.match(/[.\-–—>*+·•]/g) || []).length;
  const spaces = prefix.replace(/[^\s ]/g, '').replace(/\t/g, '').length;
  const level = tabs + dots + Math.floor(spaces / 2);
  return { level, text };
}
