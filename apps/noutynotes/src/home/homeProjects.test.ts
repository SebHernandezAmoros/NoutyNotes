import { describe, expect, it } from 'vitest';

import type { WorkspaceId } from '@noutynotes/domain';

import type { RecentProjectEntry } from '../session/recentItems';
import { mergeHomeProjects } from './homeProjects';

const project = (workspaceId: string, folderId: string | null, name = workspaceId): RecentProjectEntry => ({
  id: `web:${folderId ?? 'memory'}:${workspaceId}`,
  workspaceId,
  name,
  backend: folderId ? 'web' : 'memory',
  folderId,
  lastUsedAt: 10,
});

describe('proyectos visibles en Inicio', () => {
  it('fusiona el proyecto de sesión con su entrada reciente usando identidad durable', () => {
    const result = mergeHomeProjects({
      recentProjects: [project('guion', 'carpeta-a', 'Nombre anterior')],
      sessionProjects: [{ id: 'guion' as WorkspaceId, name: 'Guion actual' }],
      currentBackend: 'web', currentFolderId: 'carpeta-a', unexported: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ workspaceId: 'guion', name: 'Guion actual', inCurrentSession: true, canForget: true });
  });

  it('mantiene separados proyectos homónimos de carpetas distintas y añade los de sesión sin historial', () => {
    const result = mergeHomeProjects({
      recentProjects: [project('guion', 'carpeta-a', 'Guion'), project('guion', 'carpeta-b', 'Guion')],
      sessionProjects: [{ id: 'ideas' as WorkspaceId, name: 'Ideas' }],
      currentBackend: 'web', currentFolderId: 'carpeta-c', unexported: ['ideas' as WorkspaceId],
    });

    expect(result.map((entry) => entry.key)).toEqual([
      'web:carpeta-a:guion', 'web:carpeta-b:guion', 'web:carpeta-c:ideas',
    ]);
    expect(result[2]).toMatchObject({ inCurrentSession: true, unexported: true, canForget: false });
  });
});
