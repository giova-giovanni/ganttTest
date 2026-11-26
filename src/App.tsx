import React from 'react';
import { createPortal } from 'react-dom';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { LoadPage } from './pages/LoadPage';
import { PeoplePage } from './pages/PeoplePage';
import { NotesPage } from './pages/NotesPage';
import { IoDialog } from './components/IoDialog';
import { PrintDialog } from './components/PrintDialog';
import { PrintDocument, type PrintOptions } from './components/PrintDocument';
import { SyncBar } from './components/SyncBar';
import { SettingsDialog } from './components/SettingsDialog';
import { LoginDialog } from './components/LoginDialog';
import { canRedo, canUndo, redo, setUi, undo, useStore } from './store';
import { IconLock, useT } from './ui';
import { runAutoBackup, runAutoBackupIfDue } from './utils/backup';
import { pageRule, usePrintWhenReady } from './utils/print';
import { translate, type TKey } from './i18n';
import type { Lang, Page } from './types';

export default function App() {
  const { data, ui, auth } = useStore();
  const { t, lang } = useT();
  const [showIo, setShowIo] = React.useState(false);
  const [showPrint, setShowPrint] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showLogin, setShowLogin] = React.useState(false);
  const [printOpts, setPrintOpts] = React.useState<PrintOptions | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [needsGrant, setNeedsGrant] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', ui.theme);
    document.documentElement.lang = ui.lang;
  }, [ui.theme, ui.lang]);

  // backup automatico settimanale: si controlla all'avvio e poi una volta al giorno
  const latest = React.useRef({ data, lang });
  latest.current = { data, lang };
  React.useEffect(() => {
    let alive = true;
    const check = () => {
      runAutoBackupIfDue(latest.current.data).then((r) => {
        if (!alive) return;
        if (r.needsPermission) {
          // il permesso sulla cartella si può chiedere solo da un click dell'utente
          setNeedsGrant(true);
          return;
        }
        if (!r.done || !r.file) return;
        setToast(translate(latest.current.lang, 'backup.autoDone', { file: r.file }));
        window.setTimeout(() => alive && setToast(null), 6000);
      });
    };
    const first = window.setTimeout(check, 4000); // dopo il caricamento, senza rallentare l'avvio
    const daily = window.setInterval(check, 24 * 3600 * 1000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(daily);
    };
  }, []);

  const grantBackup = async () => {
    const r = await runAutoBackup(latest.current.data, { force: true, interactive: true });
    setNeedsGrant(false);
    if (r.done && r.file) {
      setToast(translate(latest.current.lang, 'backup.autoDone', { file: r.file }));
      window.setTimeout(() => setToast(null), 6000);
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === 'p' && !typing) {
        e.preventDefault();
        setShowPrint(true);
        return;
      }
      if (typing) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // la stampa parte solo dopo che il documento è stato disegnato
  usePrintWhenReady(!!printOpts, () => setPrintOpts(null));

  const nav: { page: Page; label: string }[] = [
    { page: 'home', label: t('nav.home') },
    { page: 'project', label: t('nav.project') },
    { page: 'load', label: t('nav.load') },
    { page: 'people', label: t('nav.people') },
    { page: 'notes', label: t('nav.notes') },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {t('app.title')}
          <small>{t('app.subtitle')}</small>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <button
              key={n.page}
              className={ui.page === n.page ? 'active' : ''}
              onClick={() => setUi({ page: n.page })}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button className="tool" onClick={undo} disabled={!canUndo()} title={t('btn.undo')}>
          ↶
        </button>
        <button className="tool" onClick={redo} disabled={!canRedo()} title={t('btn.redo')}>
          ↷
        </button>
        <button className="tool" onClick={() => setShowPrint(true)} title={`${t('print.title')} (Ctrl+P)`}>
          ⎙ {t('print.open')}
        </button>
        <button className="tool" onClick={() => setShowIo(true)} title={t('io.title')}>
          ⇅ {t('io.title')}
        </button>
        <button className="tool" onClick={() => setShowSettings(true)} title={t('settings.title')}>
          ⚙
        </button>
        {auth.enabled && (
          <button
            className={'tool level-btn' + (auth.level === 'admin' ? ' admin' : '')}
            onClick={() => setShowLogin(true)}
            title={t('auth.title')}
          >
            <IconLock open={auth.level === 'admin'} />
            {t(`auth.level.${auth.level}` as TKey)}
          </button>
        )}
        <select
          className="tool"
          value={ui.lang}
          onChange={(e) => setUi({ lang: e.target.value as Lang })}
          title={t('lang.label')}
        >
          <option value="it">IT · Italiano</option>
          <option value="de">DE · Deutsch</option>
        </select>
        <button
          className="tool"
          onClick={() => setUi({ theme: ui.theme === 'light' ? 'dark' : 'light' })}
          title={t('theme.label')}
        >
          {ui.theme === 'light' ? '☾' : '☀'}
        </button>
      </header>

      <SyncBar />

      <div className="body">
        <Sidebar />
        <main className="main">
          {ui.page === 'home' && <HomePage />}
          {ui.page === 'project' && <ProjectPage />}
          {ui.page === 'load' && <LoadPage />}
          {ui.page === 'people' && <PeoplePage />}
          {ui.page === 'notes' && <NotesPage />}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
      {needsGrant && (
        <div className="toast ask">
          {t('backup.needPermission')}
          <button onClick={grantBackup}>{t('backup.grant')}</button>
          <button className="ghost" onClick={() => setNeedsGrant(false)}>
            ✕
          </button>
        </div>
      )}

      {showIo && <IoDialog onClose={() => setShowIo(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showLogin && <LoginDialog onClose={() => setShowLogin(false)} />}
      {showPrint && (
        <PrintDialog
          onClose={() => setShowPrint(false)}
          onPrint={(o) => {
            setShowPrint(false);
            setPrintOpts(o);
          }}
        />
      )}
      {/* il foglio da stampare vive fuori da .app: mentre si stampa il programma sparisce */}
      {printOpts &&
        createPortal(
          <>
            <style>{pageRule(printOpts.paper, printOpts.orientation)}</style>
            <PrintDocument data={data} lang={lang} opts={printOpts} currentProjectId={ui.selectedProjectId} />
          </>,
          document.body,
        )}
    </div>
  );
}
