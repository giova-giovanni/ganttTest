import {
  askForControl,
  dismissLocalData,
  dismissSyncError,
  continueReadOnly,
  giveUpControl,
  reload,
  takeControl,
  uploadLocalData,
  useStore,
} from '../store';
import { Modal, useT } from '../ui';
import { formatDateTime } from '../utils/notes';
import type { TKey } from '../i18n';

/** ora leggibile di quando l'altro utente ha aperto l'archivio */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Barra di stato dell'archivio condiviso: dice sempre se si sta modificando o
 * si sta solo guardando, chi tiene il documento e quando è stato salvato.
 */
export function SyncBar() {
  const { sync, auth } = useStore();
  const { t } = useT();

  const shared = sync.mode === 'shared';
  const writer = sync.role === 'writer';
  // chi ha solo il livello «lettura» non può prendere il documento: inutile mostrargli i pulsanti
  const mayWrite = auth.level !== 'lettura';
  const lock = sync.lock;
  const heldByOther = !!lock && lock.sessionId !== sync.identity?.sessionId && !lock.stale;

  // richieste di modifica arrivate da altri utenti (solo chi sta scrivendo le vede)
  const requests = writer && lock ? lock.requests.filter((r) => r.sessionId !== sync.identity?.sessionId) : [];

  return (
    <>
      <div className={'syncbar' + (writer && shared ? ' write' : '') + (shared && !writer ? ' read' : '')}>
        <span className="sb-state">{shared ? (writer ? t('sync.write') : t('sync.readOnly')) : t('sync.local')}</span>

        {shared && heldByOther && (
          <span className="sb-who">{t('sync.heldBy', { user: lock!.user, host: lock!.host })}</span>
        )}
        {shared && writer && <span className="sb-who">{sync.info ? t(`sync.mode.${sync.info.mode}` as TKey) : ''}</span>}
        {!shared && <span className="sb-who">{t('sync.localHint')}</span>}

        <span className="sb-spacer" />

        {shared && sync.saving && <span className="sb-info">{t('sync.saving')}</span>}
        {shared && !sync.saving && sync.pending && <span className="sb-info warn">{t('sync.pending')}</span>}
        {shared && !sync.saving && !sync.pending && sync.savedAt && (
          <span className="sb-info">{t('sync.saved', { d: formatDateTime(sync.savedAt) })}</span>
        )}

        {!mayWrite && <span className="sb-info">{t('auth.readOnlyLevel')}</span>}

        {shared && !writer && (
          <>
            <button className="btn sm" onClick={() => void reload()}>
              {t('sync.reload')}
            </button>
            {!mayWrite ? null : heldByOther ? (
              <button className="btn sm" onClick={() => void askForControl()}>
                {t('sync.askControl')}
              </button>
            ) : (
              <button className="btn sm primary" onClick={() => void takeControl(true)}>
                {t('sync.takeControl')}
              </button>
            )}
          </>
        )}
        {shared && writer && (
          <button className="btn sm" onClick={() => void giveUpControl()} title={t('sync.giveControl')}>
            {t('sync.giveControl')}
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <div className="syncnote">
          {t('sync.requestFrom', { user: requests.map((r) => r.user).join(', ') })}
          <button className="btn sm" onClick={() => void giveUpControl()}>
            {t('sync.giveControl')}
          </button>
        </div>
      )}

      {sync.conflict && (
        <div className="syncnote danger">
          {t('sync.conflict')}
          <button className="btn sm primary" onClick={() => void reload()}>
            {t('sync.reload')}
          </button>
        </div>
      )}

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
          {t(sync.error as TKey)}
          <button className="ghost" onClick={dismissSyncError} title={t('btn.close')}>
            ✕
          </button>
        </div>
      )}

      {sync.ask && <InUseDialog />}
    </>
  );
}

/** dialogo di apertura quando l'archivio è già in uso da un altro utente */
function InUseDialog() {
  const { sync } = useStore();
  const { t } = useT();
  const lock = sync.lock;
  const stale = !!lock?.stale;

  return (
    <Modal
      title={t('sync.inUseTitle')}
      onClose={continueReadOnly}
      maxWidth={520}
      footer={
        <>
          <button className="btn" onClick={continueReadOnly}>
            {t('sync.openReadOnly')}
          </button>
          {stale ? (
            <button className="btn primary" onClick={() => void takeControl(true)}>
              {t('sync.takeControl')}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => {
                void askForControl();
                continueReadOnly();
              }}
            >
              {t('sync.askControl')}
            </button>
          )}
        </>
      }
    >
      <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
        {t('sync.inUseBody', {
          user: lock?.user ?? '?',
          host: lock?.host ?? '?',
          since: lock ? timeOf(lock.since) : '—',
        })}
      </p>
      {stale && <p className="hint">{t('sync.inUseStale')}</p>}
      {sync.savedBy && <p className="hint">{t('sync.lastSaveBy', { user: sync.savedBy })}</p>}
    </Modal>
  );
}
