import React from 'react';
import { Modal, useT } from '../ui';
import { useStore } from '../store';
import { defaultPrintOptions, type PrintOptions } from './PrintDocument';
import type { TKey } from '../i18n';

const SECTIONS: { key: keyof PrintOptions; label: TKey }[] = [
  { key: 'cover', label: 'print.cover' },
  { key: 'gantt', label: 'print.gantt' },
  { key: 'perProject', label: 'print.perProject' },
  { key: 'table', label: 'print.table' },
  { key: 'load', label: 'print.load' },
  { key: 'people', label: 'print.people' },
  { key: 'absences', label: 'print.absences' },
];

export function PrintDialog({ onClose, onPrint }: { onClose: () => void; onPrint: (o: PrintOptions) => void }) {
  const { ui } = useStore();
  const { t } = useT();
  const [o, setO] = React.useState<PrintOptions>(() => {
    try {
      const raw = localStorage.getItem('gantt.print.v1');
      return raw ? { ...defaultPrintOptions, ...(JSON.parse(raw) as Partial<PrintOptions>) } : defaultPrintOptions;
    } catch {
      return defaultPrintOptions;
    }
  });
  const set = (patch: Partial<PrintOptions>) => setO((prev) => ({ ...prev, ...patch }));
  const anySection = SECTIONS.some((s) => o[s.key]);

  const go = () => {
    if (!anySection) return;
    try {
      localStorage.setItem('gantt.print.v1', JSON.stringify(o));
    } catch {
      /* preferenza non salvata: non è un problema */
    }
    onPrint(o);
  };

  return (
    <Modal title={t('print.title')} onClose={onClose} maxWidth={620}>
      <div className="io-pane">
        <div className="io-label">{t('print.what')}</div>
        <div className="print-sections">
          {SECTIONS.map((s) => (
            <label key={s.key} className="inline">
              <input
                type="checkbox"
                checked={!!o[s.key]}
                onChange={(e) => set({ [s.key]: e.target.checked } as Partial<PrintOptions>)}
              />
              {t(s.label)}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <button onClick={() => set(Object.fromEntries(SECTIONS.map((s) => [s.key, true])) as Partial<PrintOptions>)}>
            {t('print.all')}
          </button>
          <button onClick={() => set(Object.fromEntries(SECTIONS.map((s) => [s.key, false])) as Partial<PrintOptions>)}>
            {t('print.none')}
          </button>
        </div>

        <div className="io-label">{t('print.options')}</div>
        <div className="row wrap">
          <label className="inline">
            {t('print.orientation')}
            <select
              value={o.orientation}
              onChange={(e) => set({ orientation: e.target.value as PrintOptions['orientation'] })}
            >
              <option value="landscape">{t('print.landscape')}</option>
              <option value="portrait">{t('print.portrait')}</option>
            </select>
          </label>
          <label className="inline">
            {t('print.paper')}
            <select value={o.paper} onChange={(e) => set({ paper: e.target.value as PrintOptions['paper'] })}>
              <option value="A4">A4</option>
              <option value="A3">A3 · {t('print.paperBig')}</option>
            </select>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={o.onlyCurrent}
              disabled={!ui.selectedProjectId}
              onChange={(e) => set({ onlyCurrent: e.target.checked })}
            />
            {t('print.onlyProject')}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={o.includeArchived}
              onChange={(e) => set({ includeArchived: e.target.checked })}
            />
            {t('print.includeArchived')}
          </label>
          <label className="inline">
            <input type="checkbox" checked={o.notes} onChange={(e) => set({ notes: e.target.checked })} />
            {t('print.notes')}
          </label>
          <label className="inline">
            {t('print.ganttScope')}
            <select
              value={o.ganttScope}
              onChange={(e) => set({ ganttScope: e.target.value as PrintOptions['ganttScope'] })}
            >
              <option value="visible">{t('print.scopeVisible')}</option>
              <option value="projects">{t('home.depthProjects')}</option>
              <option value="branches">{t('home.depthBranches')}</option>
              <option value="all">{t('home.depthAll')}</option>
            </select>
          </label>
        </div>
        <p className="hint">{t('print.bigHint')}</p>

        <div className="io-label">{t('print.period')}</div>
        <div className="row wrap">
          <label className="inline">
            <input type="checkbox" checked={o.autoPeriod} onChange={(e) => set({ autoPeriod: e.target.checked })} />
            {t('print.auto')}
          </label>
          <label className="inline">
            {t('print.from')}
            <input
              type="date"
              value={o.from}
              disabled={o.autoPeriod}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className="inline">
            {t('print.to')}
            <input type="date" value={o.to} disabled={o.autoPeriod} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>

        <p className="hint">{t('print.hint')}</p>
        {!anySection && <div className="io-err">{t('print.nothing')}</div>}

        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={go} disabled={!anySection}>
            {t('print.go')}
          </button>
          <button onClick={onClose}>{t('btn.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
