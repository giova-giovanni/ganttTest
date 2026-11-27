import React from 'react';
import { connectGitHub, disconnectGitHub, hasUnsavedChanges, useStore } from '../store';
import { Modal, useT } from '../ui';
import type { TKey } from '../i18n';
import {
  DEFAULT_PATH,
  GitHubError,
  TOKEN_URL,
  cleanPath,
  pagesSite,
  parseRepo,
  readGitHubConfig,
  testConnection,
  type GitHubConfig,
} from '../utils/github';

/**
 * Collega l'archivio a un file in un repository GitHub: repository, file, ramo e token personale.
 * Prima di collegare si verifica tutto (token, accesso, file leggibile) e, se il repository è
 * pubblico, si chiede una conferma esplicita: i dati sarebbero visibili a tutti.
 */
export function GitHubDialog({ onClose }: { onClose: () => void }) {
  const { sync } = useStore();
  const { t } = useT();
  const saved = React.useMemo(() => readGitHubConfig(), []);
  const site = React.useMemo(() => pagesSite(), []);
  const example = site ? `${site.owner}/${site.repo}-dati` : 'utente/gantt-dati';
  const [repo, setRepo] = React.useState(saved ? `${saved.owner}/${saved.repo}` : site ? example : '');
  const [path, setPath] = React.useState(saved?.path ?? DEFAULT_PATH);
  const [branch, setBranch] = React.useState(saved?.branch ?? '');
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** repository pubblico: si collega solo dopo una seconda conferma */
  const [publicCheck, setPublicCheck] = React.useState<{ repo: string; user: string; fileExists: boolean } | null>(null);
  const connected = sync.mode === 'github';

  const changed = (fn: () => void) => {
    fn();
    setPublicCheck(null);
    setError(null);
  };

  const connect = async (acceptPublic: boolean) => {
    setError(null);
    const r = parseRepo(repo);
    if (!r) {
      setError(t('gh.badRepo'));
      return;
    }
    const tok = token.trim() || saved?.token || '';
    if (!tok) {
      setError(t('gh.tokenMissing'));
      return;
    }
    const cfg: GitHubConfig = { owner: r.owner, repo: r.repo, branch: branch.trim(), path: cleanPath(path), token: tok };
    setBusy(true);
    try {
      const check = await testConnection(cfg);
      if (!check.repo.private && !acceptPublic) {
        setPublicCheck({ repo: check.repo.fullName, user: check.user.login, fileExists: check.fileExists });
        return;
      }
      await connectGitHub(cfg);
      onClose();
    } catch (err) {
      setError(t(`gh.err.${err instanceof GitHubError ? err.kind : 'network'}` as TKey));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    if (hasUnsavedChanges() && !window.confirm(t('gh.disconnectConfirm'))) return;
    disconnectGitHub();
    onClose();
  };

  return (
    <Modal
      title={t('gh.title')}
      onClose={onClose}
      maxWidth={600}
      footer={
        <>
          {connected && (
            <button className="btn danger" onClick={disconnect}>
              {t('gh.disconnect')}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('btn.cancel')}
          </button>
          {publicCheck ? (
            <button className="btn primary" disabled={busy} onClick={() => void connect(true)}>
              {t('gh.connectAnyway')}
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void connect(false)}>
              {busy ? t('gh.connecting') : t('gh.connectBtn')}
            </button>
          )}
        </>
      }
    >
      <p className="hint gh-intro">{t('gh.intro')}</p>

      <div className="field">
        <label htmlFor="gh-repo">{t('gh.repo')}</label>
        <input
          id="gh-repo"
          type="text"
          value={repo}
          placeholder={example}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => changed(() => setRepo(e.target.value))}
        />
        <div className="hint">{t('gh.repoHint', { example })}</div>
      </div>

      <div className="gh-two">
        <div className="field">
          <label htmlFor="gh-path">{t('gh.path')}</label>
          <input
            id="gh-path"
            type="text"
            value={path}
            placeholder={DEFAULT_PATH}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => changed(() => setPath(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="gh-branch">{t('gh.branch')}</label>
          <input
            id="gh-branch"
            type="text"
            value={branch}
            placeholder={t('gh.branchHint')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => changed(() => setBranch(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="gh-token">{t('gh.token')}</label>
        <input
          id="gh-token"
          type="password"
          value={token}
          placeholder={saved ? '••••••••••••' : 'github_pat_…'}
          autoComplete="off"
          onChange={(e) => changed(() => setToken(e.target.value))}
        />
        <div className="hint">
          {saved && <>{t('gh.tokenSaved')} </>}
          {t('gh.tokenHint')}{' '}
          <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {t('gh.createToken')}
          </a>
        </div>
      </div>

      {publicCheck && (
        <div className="gh-msg caution" role="alert">
          <div>{t('gh.checkOk', { user: '@' + publicCheck.user, visibility: t('gh.public') })}</div>
          <div>{t(publicCheck.fileExists ? 'gh.fileFound' : 'gh.fileNew')}</div>
          <b>{t('gh.publicWarn', { repo: publicCheck.repo })}</b>
        </div>
      )}
      {error && (
        <div className="gh-msg err" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
