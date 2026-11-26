import React from 'react';
import { lockLevel, unlockLevel, useStore } from '../store';
import { IconLock, Modal, useT } from '../ui';
import type { TKey } from '../i18n';

/**
 * Sblocco del livello di accesso: chiunque può diventare amministratore,
 * ma deve conoscere la password scritta in `gantt-utenti.json`.
 */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  const { auth } = useStore();
  const { t } = useT();
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const go = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const r = await unlockLevel(password);
    setBusy(false);
    setPassword('');
    if (r.ok) onClose();
    else setError(r.error ?? 'auth.wrong');
  };

  const levelName = (l: string) => t(`auth.level.${l}` as TKey);

  return (
    <Modal
      title={t('auth.title')}
      onClose={onClose}
      maxWidth={520}
      footer={
        <>
          <button className="btn primary" onClick={() => void go()} disabled={!password || busy}>
            {t('auth.unlock')}
          </button>
          {auth.level !== auth.autoLevel && (
            <button
              className="btn"
              onClick={() => {
                lockLevel();
                onClose();
              }}
            >
              {t('auth.lock')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('btn.close')}
          </button>
        </>
      }
    >
      <div className="auth-now">
        <IconLock size={15} open={auth.level === 'admin'} />
        <span>
          {t('auth.current')}: <b>{levelName(auth.level)}</b>
        </span>
        <span className="hint">{t(`auth.desc.${auth.level}` as TKey)}</span>
      </div>

      {!auth.enabled && <p className="hint">{t('auth.disabled')}</p>}

      {auth.enabled && (
        <>
          <div className="field">
            <label>{t('auth.password')}</label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void go()}
            />
          </div>
          {error && <div className="io-err">{t(error as TKey)}</div>}
          <p className="hint">
            {auth.auto ? t('auth.autoPc') : t('auth.defaultLevel', { level: levelName(auth.autoLevel) })}
          </p>
        </>
      )}

      <div className="io-label">{t('auth.levels')}</div>
      <table className="data settings-table">
        <tbody>
          {(['lettura', 'modifica', 'admin'] as const).map((l) => (
            <tr key={l}>
              <th>{levelName(l)}</th>
              <td className="hint">{t(`auth.desc.${l}` as TKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{t('auth.fileHint')}</p>
      {auth.file && <p className="path hint">{auth.file}</p>}
      {auth.who && (
        <p className="hint">
          {t('auth.thisPc')}: <b className="path">{auth.who}</b>
        </p>
      )}
    </Modal>
  );
}
