import React from 'react';
import { useStore } from '../store';
import { Modal, useT } from '../ui';
import { api, type LogChange, type LogEntry } from '../utils/api';
import { formatDateTime } from '../utils/notes';
import { fieldLabel, fieldValue } from '../utils/fields';
import type { TKey } from '../i18n';

const PAGE = 100;

/** Registro delle modifiche: chi ha cambiato cosa e quando (dati dal server, dal più recente). */
export function ChangeLogDialog({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const { t, lang } = useT();
  const [entries, setEntries] = React.useState<LogEntry[]>([]);
  const [project, setProject] = React.useState('');
  const [user, setUser] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const seenUsers = React.useRef(new Set<string>());

  const load = React.useCallback(
    async (before?: number) => {
      setLoading(true);
      setError(false);
      try {
        const r = await api.log({ limit: PAGE, before, utente: user, progetto: project });
        for (const e of r.entries) seenUsers.current.add(e.user);
        setEntries((prev) => (before ? [...prev, ...r.entries] : r.entries));
        setMore(r.entries.length === PAGE);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [user, project],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const projects = data.nodes.filter((n) => n.parentId === null);
  const users = [...seenUsers.current].sort((a, b) => a.localeCompare(b));

  const describe = (c: LogChange): string => {
    if (c.op === 'replace') return t('log.replace', { n: c.count ?? 0 });
    if (c.op === 'order') return t('log.order');
    const kind = c.t ? t(`log.kind.${c.t}` as TKey) : '';
    const head = `${t(`log.${c.op}` as TKey)} ${kind} «${c.label || '…'}»`;
    if (c.op !== 'set' || !c.fields || !c.t) return head;
    const parts = Object.entries(c.fields).map(([f, v]) => {
      const label = fieldLabel(lang, c.t!, f);
      if (!v) return `${label}: ${t('log.textChanged')}`;
      return `${label}: ${fieldValue(lang, data, c.t!, f, v[0])} → ${fieldValue(lang, data, c.t!, f, v[1])}`;
    });
    return `${head}: ${parts.join(' · ')}`;
  };

  return (
    <Modal
      title={t('log.title')}
      onClose={onClose}
      maxWidth={900}
      footer={
        <button className="btn primary" onClick={onClose}>
          {t('btn.close')}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {t('log.hint')}
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">{t('log.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">{t('log.allUsers')}</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="io-err">{t('log.error')}</div>}
      {!error && !loading && entries.length === 0 && <div className="hint">{t('log.empty')}</div>}
      {entries.length > 0 && (
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 130 }}>{t('log.when')}</th>
                <th style={{ width: 150 }}>{t('log.who')}</th>
                <th>{t('log.what')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.rev}>
                  <td>{formatDateTime(e.at)}</td>
                  <td>{e.user}</td>
                  <td>
                    {e.changes.slice(0, 12).map((c, i) => (
                      <div key={i}>{describe(c)}</div>
                    ))}
                    {e.changes.length > 12 && <div className="hint">… +{e.changes.length - 12}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button className="btn sm" disabled={loading} onClick={() => void load(entries[entries.length - 1]?.rev)}>
          {t('log.more')}
        </button>
      )}
    </Modal>
  );
}
