import React from 'react';
import { lockLevel, login, logout, unlockLevel, useStore } from '../store';
import { IconLock, Modal, useT } from '../ui';
import type { TKey } from '../i18n';

/**
 * Accesso all'archivio condiviso: compare all'apertura (o quando la sessione scade).
 * Cosa chiede dipende da gantt-utenti.json: solo il nome, nome + password facoltativa
 * (password di livello) oppure nome utente + password personale.
 */
export function AccessDialog() {
  const { auth, ui, sync } = useStore();
  const { t } = useT();
  const [name, setName] = React.useState(ui.userName);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<TKey | null>(null);
  const [busy, setBusy] = React.useState(false);

  const account = auth.mode === 'account';
  const go = async (guest = false) => {
    if (busy) return;
    if (!name.trim()) {
      setError('login.nameRequired');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await login(name, guest ? '' : password);
    setBusy(false);
    setPassword('');
    if (!r.ok) setError(r.error ?? 'auth.wrong');
  };

  const intro: TKey = account ? 'login.introAccount' : auth.mode === 'livelli' ? 'login.introLevels' : 'login.introOpen';

  return (
    <Modal
      title={t('login.title')}
      onClose={() => {}}
      maxWidth={460}
      footer={
        <>
          <button className="btn primary" onClick={() => void go()} disabled={busy}>
            {t('login.enter')}
          </button>
          {account && auth.ospiti && (
            <button className="btn" onClick={() => void go(true)} disabled={busy} title={t('login.guestHint')}>
              {t('login.guest')}
            </button>
          )}
        </>
      }
    >
      {sync.expired && <p className="hint">{t('login.expired')}</p>}
      <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>{t(intro)}</p>
      <div className="field">
        <label>{account ? t('login.user') : t('login.name')}</label>
        <input
          type="text"
          autoFocus
          autoComplete="username"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void go()}
        />
      </div>
      {auth.mode !== 'aperto' && (
        <div className="field">
          <label>{account ? t('auth.password') : t('login.passwordOptional')}</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void go()}
          />
        </div>
      )}
      {error && <div className="io-err">{t(error)}</div>}
    </Modal>
  );
}

/**
 * Livello di accesso (lucchetto in alto): con le password di livello si sblocca admin o
 * modifica per questa sessione; con gli account personali il livello è quello dell'account.
 */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  const { auth, sync } = useStore();
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
  const levels = auth.mode === 'livelli';

  return (
    <Modal
      title={t('auth.title')}
      onClose={onClose}
      maxWidth={520}
      footer={
        <>
          {levels && (
            <button className="btn primary" onClick={() => void go()} disabled={!password || busy}>
              {t('auth.unlock')}
            </button>
          )}
          {levels && auth.level !== auth.autoLevel && (
            <button
              className="btn"
              onClick={() => {
                void lockLevel();
                onClose();
              }}
            >
              {t('auth.lock')}
            </button>
          )}
          {sync.mode === 'shared' && (
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
          <button className="btn" onClick={onClose}>
            {t('btn.close')}
          </button>
        </>
      }
    >
      {sync.session && <p style={{ margin: '0 0 8px' }}>{t('login.signedAs', { user: sync.session.user })}</p>}
      <div className="auth-now">
        <IconLock size={15} open={auth.level === 'admin'} />
        <span>
          {t('auth.current')}: <b>{levelName(auth.level)}</b>
        </span>
        <span className="hint">{t(`auth.desc.${auth.level}` as TKey)}</span>
      </div>

      {!auth.enabled && <p className="hint">{t('auth.disabled')}</p>}
      {auth.mode === 'account' && <p className="hint">{t('login.accountLevel')}</p>}

      {levels && (
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
      {auth.who && (
        <p className="hint">
          {t('auth.thisPc')}: <b className="path">{auth.who}</b>
        </p>
      )}
    </Modal>
  );
}
