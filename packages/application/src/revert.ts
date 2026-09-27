/**
 * Deshacer o rehacer un paso del historial (ADR 0026): guarda la instantánea `target` solo si lo que
 * hay guardado sigue siendo `expected`. Si otra app o ventana cambió el proyecto, no toca nada.
 */
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { sameWorkspace } from './history';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';

export async function revertWorkspace(
  storage: WorkspaceStorage, id: WorkspaceId, { expected, target }: { readonly expected: Workspace; readonly target: Workspace },
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  if (target.id !== id) return storageFailure('invalid-workspace', 'target', 'La instantánea es de otro proyecto.');
  const opened = await storage.open(id);
  if (!opened.ok) return opened;
  if (!sameWorkspace(opened.value, expected)) {
    return storageFailure('external-change', 'history', 'El proyecto cambió fuera de esta sesión: no se deshizo nada.');
  }
  return storage.save(target);
}
