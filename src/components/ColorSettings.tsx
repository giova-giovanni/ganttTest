import { setUi, useStore } from '../store';
import { useT } from '../ui';
import {
  activePreset,
  contrast,
  DEFAULT_COLORS,
  DEFAULT_STATUS_COLORS,
  emptyColors,
  PRESETS,
  themeVars,
  type ColorKey,
  type ThemeName,
} from '../theme';
import { STATUSES, type SiteColors } from '../types';
import type { TKey } from '../i18n';

const GROUPS: { title: TKey; keys: ColorKey[] }[] = [
  { title: 'colors.group.main', keys: ['accent', 'header', 'headerText'] },
  { title: 'colors.group.surface', keys: ['bg', 'panel', 'text', 'muted', 'today'] },
];

/** sotto-sezione «Colori» delle impostazioni: preferenza personale, salvata in questo browser */
export function ColorSettings() {
  const { ui } = useStore();
  const { t } = useT();
  const theme = ui.theme;
  const colors = ui.colors;
  const mine = colors[theme];
  const preset = activePreset(colors);

  const setColors = (next: SiteColors) => setUi({ colors: next });
  const setOne = (key: ColorKey, value: string | undefined) => {
    const set = { ...mine };
    if (value) set[key] = value;
    else delete set[key];
    setColors({ ...colors, [theme]: set });
  };

  // colori effettivi della modalità in uso: predefiniti + quelli scelti (anche i derivati)
  const vars = themeVars(theme, colors);
  const d = DEFAULT_COLORS[theme];
  const effective: Record<ColorKey, string> = {
    accent: vars['--accent'] ?? d.accent,
    header: vars['--header'] ?? d.header,
    headerText: vars['--header-text'] ?? d.headerText,
    bg: vars['--bg'] ?? d.bg,
    panel: vars['--panel'] ?? d.panel,
    text: vars['--text'] ?? d.text,
    muted: vars['--muted'] ?? d.muted,
    today: vars['--today'] ?? d.today,
  };

  const warnings: TKey[] = [];
  if (contrast(effective.text, effective.panel) < 4.5 || contrast(effective.text, effective.bg) < 4.5) {
    warnings.push('colors.warn.text');
  }
  if (contrast(effective.muted, effective.panel) < 3) warnings.push('colors.warn.muted');
  if (contrast(effective.headerText, effective.header) < 4.5) warnings.push('colors.warn.header');
  if (contrast(effective.accent, effective.panel) < 3) warnings.push('colors.warn.accent');

  const customized =
    Object.keys(colors.light).length + Object.keys(colors.dark).length + Object.keys(colors.status).length > 0;

  return (
    <div className="color-settings">
      <div className="hint">{t('colors.intro')}</div>

      <div className="io-label">{t('colors.mode')}</div>
      <div className="segmented">
        {(['light', 'dark'] as ThemeName[]).map((m) => (
          <button key={m} type="button" className={theme === m ? 'active' : ''} onClick={() => setUi({ theme: m })}>
            {t(m === 'light' ? 'colors.light' : 'colors.dark')}
          </button>
        ))}
      </div>

      <div className="io-label">{t('colors.presets')}</div>
      <div className="presets">
        {PRESETS.map((p) => {
          const set = p[theme];
          return (
            <button
              key={p.id}
              type="button"
              className={'preset' + (preset === p.id ? ' sel' : '')}
              onClick={() => setColors({ light: { ...p.light }, dark: { ...p.dark }, status: colors.status })}
            >
              <span className="preset-sample" style={{ background: set.bg ?? d.bg }}>
                <i style={{ background: set.header ?? d.header }} />
                <i style={{ background: set.panel ?? d.panel }} />
                <i style={{ background: set.accent ?? d.accent }} />
              </span>
              {t(p.label)}
            </button>
          );
        })}
      </div>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="io-label">{t(group.title)}</div>
          <div className="color-grid">
            {group.keys.map((key) => (
              <ColorRow
                key={key}
                label={t(`colors.${key}` as TKey)}
                value={effective[key]}
                changed={!!mine[key]}
                onChange={(v) => setOne(key, v)}
                onReset={() => setOne(key, undefined)}
                resetTitle={t('colors.resetOne')}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="io-label">{t('colors.group.status')}</div>
      <div className="color-grid">
        {STATUSES.map((s) => (
          <ColorRow
            key={s}
            label={t(`status.${s}` as TKey)}
            value={colors.status[s] ?? DEFAULT_STATUS_COLORS[s]}
            changed={!!colors.status[s]}
            onChange={(v) => setColors({ ...colors, status: { ...colors.status, [s]: v } })}
            onReset={() => {
              const status = { ...colors.status };
              delete status[s];
              setColors({ ...colors, status });
            }}
            resetTitle={t('colors.resetOne')}
          />
        ))}
      </div>

      {warnings.length > 0 && (
        // colori fissi e sempre in vista: se la scelta rende illeggibile la finestra,
        // da qui si torna indietro comunque
        <div className="color-warning" role="status">
          {warnings.map((w) => (
            <div key={w}>{t(w)}</div>
          ))}
          <button type="button" onClick={() => setColors(emptyColors())}>
            {t('colors.resetAll')}
          </button>
        </div>
      )}

      <div className="color-foot">
        <button type="button" className="btn" disabled={!customized} onClick={() => setColors(emptyColors())}>
          {t('colors.resetAll')}
        </button>
        <span className="hint">{t('colors.elsewhere')}</span>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  changed,
  onChange,
  onReset,
  resetTitle,
}: {
  label: string;
  value: string;
  changed: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
  resetTitle: string;
}) {
  return (
    <div className="color-row">
      <label>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <span>{label}</span>
      </label>
      <button type="button" className="note-act" disabled={!changed} title={resetTitle} onClick={onReset}>
        ↺
      </button>
    </div>
  );
}
