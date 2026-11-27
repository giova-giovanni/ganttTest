import React from 'react';
import { logout, setUserName, useStore } from '../store';
import { Modal, useT } from '../ui';
import { formatDateTime } from '../utils/notes';
import type { TKey } from '../i18n';
import { GitHubDialog } from './GitHubDialog';

/** Impostazioni personali e informazioni sull'archivio (dove sono i dati, chi li sta usando). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { ui, sync, auth } = useStore();
  const { t } = useT();
  const info = sync.info;
  const shared = sync.mode === 'shared';
  const github = sync.mode === 'github' ? sync.github : null;
  const [showGh, setShowGh] = React.useState(false);

  // una finestra alla volta: le impostazioni lasciano il posto a quella di GitHub
  if (showGh) return <GitHubDialog onClose={() => setShowGh(false)} />;

  return (
    <Modal
      title={t('settings.title')}
      onClose={onClose}
      maxWidth={560}
      footer={
        <>
          {shared && (
            <button
              className="btn"
              onClick={() => {
                void logout();
                onClose();
              }}
            >
              {t('login.switch')}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            {t('btn.close')}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t('sync.user')}</label>
        {shared ? (
          // nell'archivio condiviso il nome è quello dell'accesso (compare nel registro)
          <input type="text" value={sync.session?.user ?? ''} readOnly />
        ) : (
          <input type="text" value={ui.userName} onChange={(e) => setUserName(e.target.value)} />
        )}
        <div className="hint" style={{ marginTop: 4 }}>
          {t('sync.userHint')}
        </div>
      </div>

      <div className="io-label">{t('sync.title')}</div>
      <table className="data settings-table">
        <tbody>
          <tr>
            <th>{t('sync.modeLabel')}</th>
            <td>
              {shared ? t('sync.shared') : github ? t('gh.title') : t('sync.local')}
              {info && ` · ${t(`sync.mode.${info.mode}` as TKey)}`}
            </td>
          </tr>
          {info && (
            <tr>
              <th>{t('sync.folder')}</th>
              <td className="path">{info.dataDir ?? t('settings.pathsAdmin')}</td>
            </tr>
          )}
          {info?.configFile && (
            <tr>
              <th>gantt-config.json</th>
              <td className="path">{info.configFile}</td>
            </tr>
          )}
          <tr>
            <th>{t('sync.lastSave')}</th>
            <td>{sync.savedAt ? formatDateTime(sync.savedAt) : t('sync.never')}</td>
          </tr>
        </tbody>
      </table>

      {!shared && (
        <>
          <div className="io-label">{t('gh.title')}</div>
          {github ? (
            <table className="data settings-table">
              <tbody>
                <tr>
                  <th>{t('gh.where')}</th>
                  <td className="path">
                    {github.repo}
                    {github.private === null ? '' : ` (${github.private ? t('gh.private') : t('gh.public')})`}
                  </td>
                </tr>
                <tr>
                  <th>{t('gh.file')}</th>
                  <td className="path">
                    {github.path}
                    {github.branch ? ` @ ${github.branch}` : ''}
                  </td>
                </tr>
                <tr>
                  <th>{t('gh.user')}</th>
                  <td>{github.user ? `@${github.user}` : '…'}</td>
                </tr>
                <tr>
                  <th>{t('gh.checkedAt')}</th>
                  <td>{github.checkedAt ? formatDateTime(github.checkedAt) : t('sync.never')}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="hint">{t('gh.localHint')}</p>
          )}
          <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <button className="btn" onClick={() => setShowGh(true)}>
              {github ? t('gh.manage') : t('gh.connect')}
            </button>
          </div>
        </>
      )}

      <div className="io-label">{t('auth.title')}</div>
      <table className="data settings-table">
        <tbody>
          <tr>
            <th>{t('auth.current')}</th>
            <td>
              {t(`auth.level.${auth.level}` as TKey)}
              {auth.enabled ? '' : ` · ${t('auth.off')}`}
            </td>
          </tr>
          {shared && (
            <tr>
              <th>{t('auth.thisPc')}</th>
              <td className="path">{auth.who || '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}
