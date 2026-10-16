import { useEffect, useState } from 'react';

import {
  forgetFolder, forgetProject, orderedFolders, orderedProjects,
  parseRegistry, serializeRegistry, upsertFolder, upsertProject,
} from '../session/recentItems';
import type { RecentFolderBackend, RecentFolderEntry, RecentProjectBackend, RecentProjectEntry, RecentRegistry } from '../session/recentItems';
import { loadRecentItems, saveRecentItems } from '../session/recentItemsStore';

export interface RecentItemsApi {
  /** Ya ordenados por última apertura (más reciente primero). */
  readonly folders: readonly RecentFolderEntry[];
  readonly projects: readonly RecentProjectEntry[];
  recordFolderUse(input: { readonly backend: RecentFolderBackend; readonly key: string; readonly name: string }): void;
  recordProjectUse(input: { readonly workspaceId: string; readonly name: string; readonly backend: RecentProjectBackend; readonly folderKey: string | null }): void;
  forgetFolderEntry(id: string): void;
  forgetProjectEntry(id: string): void;
}

/**
 * Historial local de recientes (UX7-E1): mismo patrón de inicialización perezosa que
 * `ViewPreferences` en `WorkspaceScreen.tsx` (`useState(() => parsePreferences(loadViewPreferences()))`).
 * Cada mutación persiste de inmediato; nunca se registra un intento fallido ni un render repetido.
 */
export function useRecentItems(): RecentItemsApi {
  const [registry, setRegistry] = useState<RecentRegistry>(() => parseRegistry(loadRecentItems()));
  useEffect(() => { saveRecentItems(serializeRegistry(registry)); }, [registry]);

  return {
    folders: orderedFolders(registry),
    projects: orderedProjects(registry),
    recordFolderUse: (input) => setRegistry((current) => upsertFolder(current, input, Date.now())),
    recordProjectUse: (input) => setRegistry((current) => upsertProject(current, input, Date.now())),
    forgetFolderEntry: (id) => setRegistry((current) => forgetFolder(current, id)),
    forgetProjectEntry: (id) => setRegistry((current) => forgetProject(current, id)),
  };
}
