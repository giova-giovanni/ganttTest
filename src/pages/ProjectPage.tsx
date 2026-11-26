import { Board } from '../components/Board';
import { useT } from '../ui';
import { useStore } from '../store';

export { ROW_H } from '../components/Board';

/** Un solo progetto: la stessa tabella + Gantt della pagina iniziale, ristretta al progetto scelto. */
export function ProjectPage() {
  const { data, ui } = useStore();
  const { t } = useT();
  // dopo un annulla o un import il progetto selezionato può non esistere più
  const rootId =
    ui.selectedProjectId && data.nodes.some((n) => n.id === ui.selectedProjectId) ? ui.selectedProjectId : null;

  if (!rootId) return <div className="empty">{t('project.empty')}</div>;

  return <Board rootId={rootId} showArchive />;
}
