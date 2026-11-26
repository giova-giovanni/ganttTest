import React from 'react';
import { addProject, deleteNode, loadDemo, resetAll, setArchived, setUi, useStore } from '../store';
import { IconArchive, IconRestore, useCanAdmin, useCanEdit, useIsAdmin, useT } from '../ui';
import { computeAll, descendantIds, STATUS_COLORS } from '../utils/tree';
import { formatDate } from '../utils/dates';
import { translate } from '../i18n';
import type { TaskNode } from '../types';

export function Sidebar() {
  const { data, ui } = useStore();
  const { t, lang } = useT();
  const canEdit = useCanEdit();
  const canAdmin = useCanAdmin();
  const isAdmin = useIsAdmin();
  const [showArchive, setShowArchive] = React.useState(false);
  const computed = React.useMemo(() => computeAll(data.nodes), [data.nodes]);
  const roots = data.nodes.filter((n) => n.parentId === null);
  const active = roots.filter((n) => !n.archived);
  const archived = roots.filter((n) => n.archived);

  const create = () => {
    const name = window.prompt(translate(lang, 'sidebar.newProject'), translate(lang, 'project.newName'));
    if (name && name.trim()) addProject(name.trim());
  };

  const renderProject = (n: TaskNode) => {
    const c = computed[n.id];
    const count = descendantIds(data.nodes, n.id).length;
    const isActive = ui.selectedProjectId === n.id && ui.page === 'project';
    const finished = c.status === 'DONE' || c.status === 'CANCELLED';
    return (
      <div key={n.id} style={{ position: 'relative' }}>
        <button
          className={'proj' + (isActive ? ' active' : '') + (n.archived ? ' arch' : '')}
          onClick={() => setUi({ page: 'project', selectedProjectId: n.id })}
        >
          <span className="pname">
            <span className="dot" style={{ background: STATUS_COLORS[c.status] }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
          </span>
          <span className="pmeta">
            <span>
              {count} {t('sidebar.tasks')}
            </span>
            <span>{c.end ? formatDate(c.end, lang) : ''}</span>
          </span>
        </button>
        <div className="proj-acts">
          <button
            className={'proj-act' + (!n.archived && finished ? ' suggest' : '')}
            title={n.archived ? t('btn.restore') : finished ? t('archive.suggest') : t('btn.archive')}
            disabled={!canEdit}
            onClick={(e) => {
              e.stopPropagation();
              setArchived(n.id, !n.archived);
            }}
          >
            {n.archived ? <IconRestore /> : <IconArchive />}
          </button>
          <button
            className="proj-act"
            title={isAdmin ? t('btn.delete') : t('auth.needAdmin')}
            disabled={!canAdmin}
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(translate(lang, 'project.deleteConfirm', { name: n.name }))) deleteNode(n.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <h3>{t('sidebar.projects')}</h3>
      <div className="list">
        {active.length === 0 && (
          <div className="hint" style={{ padding: '4px 8px' }}>
            {t('sidebar.empty')}
          </div>
        )}
        {active.map(renderProject)}

        <button className="arch-head" onClick={() => setShowArchive((v) => !v)}>
          <span>{showArchive ? '▼' : '▶'}</span>
          <span>
            {t('sidebar.archived')} ({archived.length})
          </span>
        </button>
        {showArchive && archived.length === 0 && (
          <div className="hint" style={{ padding: '0 8px 6px' }}>
            {t('archive.empty')}
          </div>
        )}
        {showArchive && archived.map(renderProject)}
      </div>
      <div className="foot">
        <button className="btn primary" onClick={create} disabled={!canEdit}>
          + {t('sidebar.newProject')}
        </button>
        {roots.length === 0 && (
          <button className="btn sm" onClick={loadDemo} disabled={!canEdit}>
            {t('btn.demo')}
          </button>
        )}
        <button
          className="btn sm danger"
          disabled={!canAdmin}
          title={isAdmin ? t('btn.reset') : t('auth.needAdmin')}
          onClick={() => window.confirm(translate(lang, 'common.confirmReset')) && resetAll()}
        >
          {t('btn.reset')}
        </button>
      </div>
    </aside>
  );
}
