import { useEffect, useState } from 'react';

import {
  forgetFolder, forgetProject, orderedFolders, orderedProjects,
  parseRegistry, serializeRegistry, upsertFolder, upsertProject,
} from '../session/recentItems';
import type {
  RecentFolderBackend, RecentFolderEntry, RecentFolderOrigin, RecentProjectBackend, RecentProjectEntry, RecentRegistry,
} from '../session/recentItems';
import { loadRecentItems, saveRecentItems } from '../session/recentItemsStore';

export interface RecentItemsApi {
  /** Ya ordenados por última apertura (más reciente primero). */
  readonly folders: readonly RecentFolderEntry[];
  readonly projects: readonly RecentProjectEntry[];
  /** Registra o confirma una carpeta por su `id` exacto (UX7-E2A): quien llama decide si es una
   * conexión nueva (id recién generado, `origin:'created'`) o la confirmación de una entrada conocida
   * (mismo id, tras verificar evidencia real — ver `reconnectFolderEntry` en `HomeScreen.tsx`). Este
   * hook no inventa esa identidad, solo la almacena. */
  recordFolderUse(input: { readonly id: string; readonly backend: RecentFolderBackend; readonly name: string; readonly origin: RecentFolderOrigin; readonly androidUri: string | null }): void;
  recordProjectUse(input: { readonly workspaceId: string; readonly name: string; readonly backend: RecentProjectBackend; readonly folderId: string | null }): void;
  forgetFolderEntry(id: string): void;
  forgetProjectEntry(id: string): void;
}

/** Identificador local opaco para una conexión de carpeta reconocida (UX7-E2A) — nunca derivado del
 * nombre, para que dos carpetas reales homónimas nunca compartan identidad (E2A-01). */
export function newFolderId(backend: RecentFolderBackend): string {
  return `${backend}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Historial local de recientes (UX7-E1, identidad corregida en UX7-E2A): mismo patrón de
 * inicialización perezosa que `ViewPreferences` en `WorkspaceScreen.tsx`
 * (`useState(() => parsePreferences(loadViewPreferences()))`). Cada mutación persiste de inmediato;
 * nunca se registra un intento fallido ni un render repetido.
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
