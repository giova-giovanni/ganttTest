import type { AppData, Person, Status, TaskNode } from '../../src/types';

/** crea un nodo dell'albero con valori predefiniti sensati */
export function node(
  id: string,
  parentId: string | null,
  extra: Partial<Omit<TaskNode, 'id' | 'parentId'>> & { status?: Status } = {},
): TaskNode {
  return {
    id,
    parentId,
    name: extra.name ?? id,
    status: extra.status ?? 'TODO',
    start: extra.start ?? null,
    end: extra.end ?? null,
    hours: extra.hours ?? null,
    assigneeId: extra.assigneeId ?? null,
    notes: extra.notes ?? '',
    collapsed: extra.collapsed ?? false,
    archived: extra.archived ?? false,
  };
}

export function person(id: string, name: string, hoursPerDay = 8): Person {
  return { id, name, role: 'Test', color: '#2f7de1', hoursPerDay };
}

export function data(nodes: TaskNode[], people: Person[] = []): AppData {
  return { version: 4, nodes, people, absences: [], notes: [] };
}
