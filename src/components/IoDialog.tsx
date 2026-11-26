import React from 'react';
import { Modal, useCanAdmin, useIsAdmin, useT } from '../ui';
import { mergeData, replaceData, useStore } from '../store';
import {
  analyzeImport,
  defaultExportOptions,
  downloadTemplate,
  runExport,
  type Dataset,
  type ExportOptions,
  type ImportPreview,
} from '../utils/io';
import {
  backupFolderName,
  chooseBackupFolder,
  forgetBackupFolder,
  lastAutoBackupAt,
  runAutoBackup,
  supportsFolderBackup,
} from '../utils/backup';
import { LOCALE, type TKey } from '../i18n';

const DATASETS: { id: Dataset; label: TKey; desc: TKey }[] = [
  { id: 'backup', label: 'io.ds.backup', desc: 'io.ds.backupDesc' },
  { id: 'tasks', label: 'io.ds.tasks', desc: 'io.ds.tasksDesc' },
  { id: 'load', label: 'io.ds.load', desc: 'io.ds.loadDesc' },
  { id: 'people', label: 'io.ds.people', desc: 'io.ds.peopleDesc' },
  { id: 'absences', label: 'io.ds.absences', desc: 'io.ds.absencesDesc' },
  { id: 'notes', label: 'io.ds.notes', desc: 'io.ds.notesDesc' },
];

export function IoDialog({ onClose }: { onClose: () => void }) {
  const { data, ui } = useStore();
  const { t, lang } = useT();
  const canAdmin = useCanAdmin();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = React.useState<'export' | 'import'>('export');
  const [opts, setOpts] = React.useState<ExportOptions>({ ...defaultExportOptions, projectId: ui.selectedProjectId });
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [fileLabel, setFileLabel] = React.useState('');
  const [mode, setMode] = React.useState<'merge' | 'replace'>('merge');
  const [done, setDone] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [lastBackup, setLastBackup] = React.useState(() => lastAutoBackupAt());
  const [folder, setFolder] = React.useState<string | null>(null);
  const [backupMsg, setBackupMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    backupFolderName().then(setFolder);
  }, []);

  const pickFolder = async () => {
    const name = await chooseBackupFolder();
    if (!name) return;
    setFolder(name);
    // il permesso è appena stato dato: si scrive subito la prima copia nella nuova cartella
    const res = await runAutoBackup(data, { force: true, interactive: true });
    setBackupMsg(res.done && res.file ? t('backup.autoDone', { file: res.file }) : null);
    setLastBackup(lastAutoBackupAt());
  };

  const backupNow = async () => {
    // senza cartella scelta: l'amministratore fa scrivere al server una copia in dati/backups
    const res = await runAutoBackup(data, { force: true, interactive: true, server: isAdmin });
    setBackupMsg(res.done && res.file ? t('backup.autoDone', { file: res.file }) : t('backup.failed'));
    setLastBackup(lastAutoBackupAt());
  };

  React.useEffect(() => setOpts((o) => ({ ...o, projectId: ui.selectedProjectId })), [ui.selectedProjectId]);

  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const readFile = (file: File) => {
    setDone(null);
    const reader = new FileReader();
    reader.onload = () => {
      setFileLabel(file.name);
      setPreview(analyzeImport(String(reader.result ?? ''), file.name, data, lang));
    };
    reader.onerror = () => setPreview(null);
    reader.readAsText(file, 'utf-8');
  };

  const confirmImport = () => {
    if (!preview?.ok) return;
    if (mode === 'replace' && !canAdmin) return;
    if (mode === 'replace') {
      if (!window.confirm(t('io.modeReplaceDesc'))) return;
      const c = preview.counts;
      replaceData(preview.data);
      setDone(t('io.result', { p: c.projects, t: c.tasks, u: c.people, a: c.absences, n: c.notes }));
    } else {
      const res = mergeData(preview.data);
      setDone(t('io.result', { p: res.projects, t: res.tasks, u: res.people, a: res.absences, n: res.notes }));
    }
    setPreview(null);
    setFileLabel('');
  };

  const needsScope = opts.dataset === 'tasks' || opts.dataset === 'load' || opts.dataset === 'notes';

  return (
    <Modal title={t('io.title')} onClose={onClose} maxWidth={720}>
      <div className="tabs">
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
          {t('io.tabExport')}
        </button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          {t('io.tabImport')}
        </button>
      </div>

      {tab === 'export' && (
        <div className="io-pane">
          <div className="io-label">{t('io.dataset')}</div>
          <div className="io-list">
            {DATASETS.map((d) => (
              <label key={d.id} className={`io-option${opts.dataset === d.id ? ' sel' : ''}`}>
                <input
                  type="radio"
                  name="dataset"
                  checked={opts.dataset === d.id}
                  onChange={() => set({ dataset: d.id })}
                />
                <span>
                  <b>{t(d.label)}</b>
                  <small>{t(d.desc)}</small>
                </span>
              </label>
            ))}
          </div>

          {needsScope && (
            <>
              <div className="io-label">{t('io.scope')}</div>
              <div className="row wrap">
                <label className="inline">
                  <input
                    type="radio"
                    name="scope"
                    checked={opts.scope === 'all'}
                    onChange={() => set({ scope: 'all' })}
                  />
                  {t('io.scopeAll')}
                </label>
                <label className="inline">
                  <input
                    type="radio"
                    name="scope"
                    checked={opts.scope === 'current'}
                    disabled={!ui.selectedProjectId}
                    onChange={() => set({ scope: 'current' })}
                  />
                  {t('io.scopeCurrent')}
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={opts.includeArchived}
                    onChange={(e) => set({ includeArchived: e.target.checked })}
                  />
                  {t('io.includeArchived')}
                </label>
              </div>
            </>
          )}

          {opts.dataset === 'load' && (
            <div className="row wrap">
              <label className="inline">
                {t('io.unit')}
                <select value={opts.unit} onChange={(e) => set({ unit: e.target.value as ExportOptions['unit'] })}>
                  <option value="hours">{t('io.unitHours')}</option>
                  <option value="percent">{t('io.unitPercent')}</option>
                </select>
              </label>
              <label className="inline">
                {t('load.granularity')}
                <select
                  value={opts.granularity}
                  onChange={(e) => set({ granularity: e.target.value as ExportOptions['granularity'] })}
                >
                  <option value="day">{t('load.byDay')}</option>
                  <option value="week">{t('load.byWeek')}</option>
                </select>
              </label>
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" onClick={() => runExport(data, lang, opts)}>
              {t('btn.export')}
            </button>
            <button onClick={() => downloadTemplate(lang)}>{t('io.templateBtn')}</button>
          </div>
          <p className="hint">{t('io.templateHint')}</p>

          <div className="io-label">{t('io.autoBackup')}</div>
          <p className="hint">
            {folder
              ? t('backup.folderSet', { name: folder })
              : supportsFolderBackup()
                ? t('backup.folderNone')
                : t('backup.unsupported')}
          </p>
          <div className="row">
            {supportsFolderBackup() && (
              <button onClick={pickFolder}>{folder ? t('backup.change') : t('backup.choose')}</button>
            )}
            {folder && (
              <button
                onClick={async () => {
                  await forgetBackupFolder();
                  setFolder(null);
                }}
              >
                {t('backup.remove')}
              </button>
            )}
            <button onClick={backupNow}>{t('backup.now')}</button>
          </div>
          <p className="hint">
            {backupMsg ??
              (lastBackup
                ? t('io.autoBackupLast', { d: new Date(lastBackup).toLocaleString(LOCALE[lang]) })
                : t('io.autoBackupNever'))}
          </p>
        </div>
      )}

      {tab === 'import' && (
        <div className="io-pane">
          <div
            className={`io-drop${dragging ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) readFile(f);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <b>{fileLabel || t('io.dropHint')}</b>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
            >
              {t('io.chooseFile')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = '';
            }}
          />

          {done && <div className="io-ok">{done}</div>}

          {preview && !preview.ok && <div className="io-err">{preview.errorKey ? t(preview.errorKey) : t('io.errorParse')}</div>}

          {preview?.ok && (
            <>
              <div className="io-summary">
                <div>
                  <b>{t('io.detected')}:</b> {t(`io.ds.${preview.kind === 'backup' ? 'backup' : preview.kind}` as TKey)} ·{' '}
                  {t('io.rowsFound', { n: preview.rowCount })}
                </div>
                <div className="io-counts">
                  <span>
                    {preview.counts.projects} {t('home.kpi.projects')}
                  </span>
                  <span>
                    {preview.counts.tasks} {t('home.kpi.tasks')}
                  </span>
                  <span>
                    {preview.counts.people} {t('people.title')}
                  </span>
                  <span>
                    {preview.counts.absences} {t('absence.open')}
                  </span>
                </div>
              </div>

              {preview.columns.length > 0 && (
                <>
                  <div className="io-label">{t('io.columns')}</div>
                  <div className="io-chips">
                    {preview.columns.map((c, i) => (
                      <span key={i} className={c.field ? 'ok' : 'off'} title={c.field ?? t('io.ignored')}>
                        {c.header || '—'}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {preview.warnings.length > 0 && (
                <>
                  <div className="io-label">{t('io.warnings')}</div>
                  <ul className="io-warn">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="io-label">{t('io.mode')}</div>
              <div className="io-list">
                <label className={`io-option${mode === 'merge' ? ' sel' : ''}`}>
                  <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  <span>
                    <b>{t('io.modeMerge')}</b>
                    <small>{t('io.modeMergeDesc')}</small>
                  </span>
                </label>
                <label
                  className={`io-option${mode === 'replace' ? ' sel danger' : ' danger'}${canAdmin ? '' : ' off'}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'replace'}
                    disabled={!canAdmin}
                    onChange={() => setMode('replace')}
                  />
                  <span>
                    <b>{t('io.modeReplace')}</b>
                    <small>{isAdmin ? t('io.modeReplaceDesc') : t('auth.needAdmin')}</small>
                  </span>
                </label>
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" onClick={confirmImport}>
                  {t('io.confirm')}
                </button>
                <button
                  onClick={() => {
                    setPreview(null);
                    setFileLabel('');
                  }}
                >
                  {t('btn.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
