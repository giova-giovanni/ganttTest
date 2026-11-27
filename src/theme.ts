// Colori del sito: valori predefiniti, combinazioni pronte e personalizzazione.
// Le variabili CSS di styles.css sono la base; qui si calcolano solo quelle cambiate dall'utente
// (più le sfumature che ne derivano, così una combinazione scelta a mano resta coerente).
import type { ColorSet, SiteColors, Status } from './types';
import type { TKey } from './i18n';

export type ThemeName = 'light' | 'dark';
export type ColorKey = keyof ColorSet;

export const COLOR_KEYS: ColorKey[] = ['accent', 'header', 'headerText', 'bg', 'panel', 'text', 'muted', 'today'];

/** devono coincidere con :root e [data-theme='dark'] di styles.css (c'è un test) */
export const DEFAULT_COLORS: Record<ThemeName, Required<ColorSet>> = {
  light: {
    accent: '#2f7de1',
    header: '#1f2a37',
    headerText: '#e8edf3',
    bg: '#f4f6f9',
    panel: '#ffffff',
    text: '#1c2530',
    muted: '#5f6b7c',
    today: '#e0453d',
  },
  dark: {
    accent: '#4b93ea',
    header: '#0c1118',
    headerText: '#dbe3ec',
    bg: '#10151c',
    panel: '#18202a',
    text: '#dde5ee',
    muted: '#95a1b2',
    today: '#e0453d',
  },
};

export const DEFAULT_STATUS_COLORS: Record<Status, string> = {
  TODO: '#6e788a',
  IN_PROGRESS: '#2a74d4',
  DONE: '#1f8a56',
  CANCELLED: '#c0392b',
};

/** nome della variabile CSS di ogni stato */
export const STATUS_VAR: Record<Status, string> = {
  TODO: '--st-todo',
  IN_PROGRESS: '--st-progress',
  DONE: '--st-done',
  CANCELLED: '--st-cancelled',
};

export const emptyColors = (): SiteColors => ({ light: {}, dark: {}, status: {} });

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** miscela due colori: `ratio` = quanto pesa il primo (0 = tutto b, 1 = tutto a) */
export function mix(a: string, b: string, ratio: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const part = (i: number) =>
    Math.round(x[i] * ratio + y[i] * (1 - ratio))
      .toString(16)
      .padStart(2, '0');
  return `#${part(0)}${part(1)}${part(2)}`;
}

/** luminosità percepita (formula WCAG) */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** rapporto di contrasto fra due colori: da 1 (uguali) a 21 (bianco e nero) */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const LIGHT_INK = '#ffffff';
const DARK_INK = '#141b24';

/**
 * Colore della scritta da usare sopra uno sfondo: bianco finché si legge, altrimenti scuro.
 * Accetta anche le variabili degli stati («var(--st-done)» → «var(--st-done-text)»).
 */
export function textOn(background: string): string {
  const v = /^var\((--st-[a-z]+)\)$/.exec(background);
  if (v) return `var(${v[1]}-text)`;
  if (!isHex(background)) return LIGHT_INK;
  return contrast(background, LIGHT_INK) >= 2.9 ? LIGHT_INK : DARK_INK;
}

/** fra bianco e scuro quello che si legge meglio */
const bestInk = (background: string) =>
  contrast(background, LIGHT_INK) >= contrast(background, DARK_INK) ? LIGHT_INK : DARK_INK;

/**
 * Variabili CSS da impostare per il tema scelto: solo quelle che l'utente ha cambiato.
 * Senza personalizzazioni il risultato è vuoto e valgono i valori di styles.css.
 */
export function themeVars(theme: ThemeName, colors: SiteColors): Record<string, string> {
  const mine = colors[theme] ?? {};
  const c: Required<ColorSet> = { ...DEFAULT_COLORS[theme] };
  for (const key of COLOR_KEYS) {
    const v = mine[key];
    if (isHex(v)) c[key] = v;
  }
  const has = (key: ColorKey) => isHex(mine[key]);
  const light = theme === 'light';
  const vars: Record<string, string> = {};

  if (has('accent') || has('panel')) {
    vars['--accent'] = c.accent;
    vars['--accent-soft'] = mix(c.accent, c.panel, light ? 0.13 : 0.2);
    vars['--row-sel'] = mix(c.accent, c.panel, light ? 0.19 : 0.27);
    vars['--row-hover'] = mix(c.accent, c.panel, light ? 0.08 : 0.11);
  }
  if (has('accent')) {
    vars['--accent-fill'] = c.accent;
    vars['--accent-text'] = textOn(c.accent);
  }
  if (has('panel')) vars['--panel'] = c.panel;
  if (has('text')) vars['--text'] = c.text;
  if (has('panel') || has('text')) {
    vars['--panel-2'] = mix(c.text, c.panel, light ? 0.025 : 0.035);
    vars['--border'] = mix(c.text, c.panel, 0.16);
    vars['--border-strong'] = mix(c.text, c.panel, 0.3);
    vars['--weekend'] = light ? mix(c.text, c.panel, 0.07) : mix('#000000', c.panel, 0.2);
    vars['--muted'] = mix(c.text, c.panel, 0.72);
  }
  if (has('muted')) vars['--muted'] = c.muted;
  if (has('bg')) vars['--bg'] = c.bg;
  if (has('header')) {
    vars['--header'] = c.header;
    vars['--header-text'] = bestInk(c.header);
  }
  if (has('headerText')) vars['--header-text'] = c.headerText;
  if (has('today')) vars['--today'] = c.today;

  for (const status of Object.keys(STATUS_VAR) as Status[]) {
    const v = colors.status?.[status];
    if (!isHex(v)) continue;
    vars[STATUS_VAR[status]] = v;
    vars[`${STATUS_VAR[status]}-text`] = textOn(v);
  }
  return vars;
}

/** tutte le variabili che la personalizzazione può toccare: vanno tolte prima di riapplicare */
const THEME_VARS = [
  '--accent',
  '--accent-soft',
  '--accent-fill',
  '--accent-text',
  '--row-sel',
  '--row-hover',
  '--panel',
  '--panel-2',
  '--text',
  '--muted',
  '--border',
  '--border-strong',
  '--weekend',
  '--bg',
  '--header',
  '--header-text',
  '--today',
  ...Object.values(STATUS_VAR).flatMap((v) => [v, `${v}-text`]),
];

export function applyTheme(root: HTMLElement, theme: ThemeName, colors: SiteColors) {
  root.setAttribute('data-theme', theme);
  for (const name of THEME_VARS) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(themeVars(theme, colors))) root.style.setProperty(name, value);
}

export interface Preset {
  id: string;
  label: TKey;
  light: ColorSet;
  dark: ColorSet;
}

/** combinazioni pronte: ognuna vale sia per la modalità chiara sia per quella scura */
export const PRESETS: Preset[] = [
  { id: 'default', label: 'colors.preset.default', light: {}, dark: {} },
  {
    id: 'ocean',
    label: 'colors.preset.ocean',
    light: { accent: '#0b7285', header: '#0b3b4a', bg: '#eef6f8' },
    dark: { accent: '#3bc9db', header: '#06222c', bg: '#0b161b', panel: '#11232a' },
  },
  {
    id: 'forest',
    label: 'colors.preset.forest',
    light: { accent: '#2b7a3d', header: '#1e3a2b', bg: '#f1f6f0' },
    dark: { accent: '#51cf66', header: '#0f1f16', bg: '#0d1410', panel: '#16211a' },
  },
  {
    id: 'sunset',
    label: 'colors.preset.sunset',
    light: { accent: '#b4500f', header: '#43281a', bg: '#fbf5ef' },
    dark: { accent: '#ff922b', header: '#1f140c', bg: '#151110', panel: '#211a16' },
  },
  {
    id: 'violet',
    label: 'colors.preset.violet',
    light: { accent: '#6741d9', header: '#2b1f4d', bg: '#f5f3fb' },
    dark: { accent: '#9775fa', header: '#171026', bg: '#110f18', panel: '#1c1828' },
  },
  {
    id: 'graphite',
    label: 'colors.preset.graphite',
    light: { accent: '#475569', header: '#212529', bg: '#f1f3f5' },
    dark: { accent: '#a8b3c1', header: '#101113', bg: '#131416', panel: '#1c1e21', text: '#e9ecef' },
  },
  {
    id: 'contrast',
    label: 'colors.preset.contrast',
    light: { accent: '#0043a8', header: '#000000', headerText: '#ffffff', bg: '#ffffff', panel: '#ffffff', text: '#000000', muted: '#262626' },
    dark: { accent: '#ffd43b', header: '#000000', headerText: '#ffffff', bg: '#000000', panel: '#0a0a0a', text: '#ffffff', muted: '#e0e0e0' },
  },
];

/** nome della combinazione in uso, oppure null se i colori sono stati scelti a mano */
export function activePreset(colors: SiteColors): string | null {
  const norm = (set: ColorSet) => JSON.stringify(COLOR_KEYS.map((k) => set[k]?.toLowerCase() ?? ''));
  return PRESETS.find((p) => norm(p.light) === norm(colors.light) && norm(p.dark) === norm(colors.dark))?.id ?? null;
}

/** ripulisce i colori salvati nel browser: si accettano solo valori «#rrggbb» */
export function sanitizeColors(raw: unknown): SiteColors {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const set = (value: unknown): ColorSet => {
    const src = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const out: ColorSet = {};
    for (const key of COLOR_KEYS) {
      const v = src[key];
      if (isHex(v)) out[key] = v.toLowerCase();
    }
    return out;
  };
  const status: SiteColors['status'] = {};
  const src = (obj.status && typeof obj.status === 'object' ? obj.status : {}) as Record<string, unknown>;
  for (const key of Object.keys(STATUS_VAR) as Status[]) {
    const v = src[key];
    if (isHex(v)) status[key] = v.toLowerCase();
  }
  return { light: set(obj.light), dark: set(obj.dark), status };
}
