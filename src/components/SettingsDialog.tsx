import { setUserName, useStore } from '../store';
import { Modal, useT } from '../ui';
import { formatDateTime } from '../utils/notes';
import type { TKey } from '../i18n';

/** Impostazioni personali e informazioni sull'archivio (dove sono i dati, chi li sta usando). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { ui, sync, auth } = useStore();
  const { t } = useT();
  const info = sync.info;

  return (
    <Modal
      title={t('settings.title')}
      onClose={onClose}
      maxWidth={560}
      footer={
        <button className="btn primary" onClick={onClose}>
          {t('btn.close')}
        </button>
      }
    >
      <div className="field">
        <label>{t('sync.user')}</label>
        <input type="text" value={ui.userName} onChange={(e) => setUserName(e.target.value)} />
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
              {sync.mode === 'shared' ? t('sync.shared') : t('sync.local')}
              {info && ` · ${t(`sync.mode.${info.mode}` as TKey)}`}
            </td>
          </tr>
          {info && (
            <tr>
              <th>{t('sync.folder')}</th>
              <td className="path">{info.dataDir}</td>
            </tr>
          )}
          {info && (
            <tr>
              <th>gantt-config.json</th>
              <td className="path">{info.configFile}</td>
            </tr>
          )}
          <tr>
            <th>{sync.role === 'writer' ? t('sync.write') : t('sync.readOnly')}</th>
            <td>
              {sync.lock && sync.lock.sessionId !== sync.identity?.sessionId
                ? t('sync.heldBy', { user: sync.lock.user, host: sync.lock.host })
                : t('sync.free')}
            </td>
          </tr>
          <tr>
            <th>{t('sync.lastSave')}</th>
            <td>
              {sync.savedAt ? formatDateTime(sync.savedAt) : t('sync.never')}
              {sync.savedBy ? ` · ${sync.savedBy}` : ''}
            </td>
          </tr>
        </tbody>
      </table>

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
          <tr>
            <th>{t('auth.thisPc')}</th>
            <td className="path">{auth.who || '—'}</td>
          </tr>
          <tr>
            <th>gantt-utenti.json</th>
            <td className="path">
              {auth.file || '—'}
              {auth.file && !auth.exists ? ` · ${t('auth.fileMissing')}` : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
