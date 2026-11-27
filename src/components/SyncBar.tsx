import React from 'react';
import {
  dismissLocalData,
  dismissNotice,
  dismissSyncError,
  restoreValue,
  syncGitHubNow,
  uploadLocalData,
  useStore,
  type Notice,
} from '../store';
import { PresenceDots, useOthers, useT } from '../ui';
import { formatDateTime } from '../utils/notes';
import { fieldLabel, fieldValue } from '../utils/fields';
import type { TKey } from '../i18n';
import { ChangeLogDialog } from './ChangeLogDialog';
import { GitHubDialog } from './GitHubDialog';

/**
 * Barra di stato dell'archivio: chi è collegato, se le modifiche sono salvate, avvisi (valore
 * sostituito da un altro utente, record eliminato) e registro delle modifiche. Con l'archivio
 * su GitHub: repository, salvataggio, «Aggiorna» e la cronologia del file su GitHub.
 */
export function SyncBar() {
  const { sync, auth, data } = useStore();
  const { t } = useT();
  const others = useOthers();
  const [showLog, setShowLog] = React.useState(false);
  const [showGh, setShowGh] = React.useState(false);

  const shared = sync.mode === 'shared';
  const github = sync.mode === 'github' ? sync.github : null;
  const local = !shared && !github;
  const readOnlyServer = sync.server?.readOnly ?? null;
  const mayWrite = auth.level !== 'lettura' && !readOnlyServer;
  const ghTone = github ? (mayWrite && github.canWrite ? ' write' : ' read') : '';
  const projectName = (id: string | null) => (id ? data.nodes.find((n) => n.id === id)?.name ?? '' : '');
  const whoTitle = others
    .map((p) => (p.project ? t('presence.onProject', { user: p.user, project: projectName(p.project) }) : p.user))
    .join('\n');

  return (
    <>
      <div className={'syncbar' + (shared ? (mayWrite ? ' write' : ' read') : ghTone)}>
        <span className="sb-state">
          {shared
            ? sync.online
              ? t('sync.online')
              : t('sync.reconnecting')
            : github
              ? sync.online
                ? t('gh.stateOnline')
                : t('gh.stateOffline')
              : t('sync.local')}
        </span>
        {shared && sync.session && (
          <span className="sb-who">
            {sync.session.user}
            {sync.session.guest ? ` (${t('login.guestBadge')})` : ''} · {t(`auth.level.${auth.level}` as TKey)}
          </span>
        )}
        {local && <span className="sb-who">{t('sync.localHint')}</span>}
        {local && (
          <button className="btn sm primary" onClick={() => setShowGh(true)}>
            {t('gh.connect')}
          </button>
        )}
        {github && (
          <span className="sb-who" title={`${github.repo}/${github.path}`}>
            {github.repo}
            {github.user ? ` · @${github.user}` : ''}
            {!github.canWrite || !mayWrite ? ` · ${t('gh.readOnly')}` : ''}
          </span>
        )}
        {shared && others.length > 0 && (
          <span className="sb-who" title={whoTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {t('sync.others')}: <PresenceDots people={others} />
          </span>
        )}

        <span className="sb-spacer" />

        {shared && sync.saving && <span className="sb-info">{t('sync.saving')}</span>}
        {shared && !sync.saving && sync.pending > 0 && (
          <span className="sb-info warn">{t('sync.waiting', { n: sync.pending })}</span>
        )}
        {shared && !sync.saving && sync.pending === 0 && (
          <span className="sb-info">{sync.savedAt ? t('sync.saved', { d: formatDateTime(sync.savedAt) }) : t('sync.allSaved')}</span>
        )}
        {shared && auth.level === 'lettura' && <span className="sb-info">{t('auth.readOnlyLevel')}</span>}
        {shared && (
          <button className="btn sm" onClick={() => setShowLog(true)}>
            {t('sync.log')}
          </button>
        )}

        {github && sync.saving && <span className="sb-info">{t('sync.saving')}</span>}
        {github && !sync.saving && sync.pending > 0 && <span className="sb-info warn">{t('sync.pending')}</span>}
        {github && !sync.saving && sync.pending === 0 && (
          <span className="sb-info">{sync.savedAt ? t('sync.saved', { d: formatDateTime(sync.savedAt) }) : t('sync.allSaved')}</span>
        )}
        {github && (
          <button className="btn sm" onClick={() => void syncGitHubNow()} title={t('gh.syncNowTitle')}>
            ↻ {t('gh.syncNow')}
          </button>
        )}
        {github && (
          <a className="btn sm" href={github.historyUrl} target="_blank" rel="noopener noreferrer" title={t('gh.historyTitle')}>
            {t('gh.history')} ↗
          </a>
        )}
        {github && (
          <button className="btn sm" onClick={() => setShowGh(true)}>
            {t('gh.manage')}
          </button>
        )}
      </div>

      {readOnlyServer && (
        <div className="syncnote danger">
          {t('sync.readOnlyServer', { host: readOnlyServer.host, url: readOnlyServer.url || '—' })}
        </div>
      )}
      {sync.server && !sync.server.health.ok && (
        <div className="syncnote danger">{t('sync.diskError', { error: sync.server.health.error ?? '?' })}</div>
      )}

      {sync.notices.map((n) => (
        <NoticeRow key={n.id} notice={n} />
      ))}

      {sync.localOnly && (
        <div className="syncnote">
          {t('sync.uploadLocal')}
          <button className="btn sm primary" onClick={() => void uploadLocalData()}>
            {t('sync.uploadNow')}
          </button>
          <button className="btn sm" onClick={dismissLocalData}>
            {t('sync.uploadSkip')}
          </button>
        </div>
      )}

      {sync.error && (
        <div className="toast err">
          {t(sync.error)}
          <button className="ghost" onClick={dismissSyncError} title={t('btn.close')}>
            ✕
          </button>
        </div>
      )}

      {showLog && <ChangeLogDialog onClose={() => setShowLog(false)} />}
      {showGh && <GitHubDialog onClose={() => setShowGh(false)} />}
    </>
  );
}

/** un avviso: testo, eventuale «Rimetti il mio valore», chiusura */
function NoticeRow({ notice }: { notice: Notice }) {
  const { data } = useStore();
  const { t, lang } = useT();
  const vars: Record<string, string | number> = { ...notice.vars };
  if (notice.field) {
    const f = notice.field;
    vars.field = fieldLabel(lang, f.t, f.name);
    vars.mine = fieldValue(lang, data, f.t, f.name, f.mine);
    vars.theirs = fieldValue(lang, data, f.t, f.name, f.theirs);
  }
  return (
    <div className="syncnote">
      {t(notice.text, vars)}
      {notice.restore && (
        <button className="btn sm primary" onClick={() => restoreValue(notice)}>
          {t('notice.restore')}
        </button>
      )}
      <button className="btn sm" onClick={() => dismissNotice(notice.id)} title={t('btn.close')}>
        ✕
      </button>
    </div>
  );
}
