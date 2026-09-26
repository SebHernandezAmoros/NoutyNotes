import type { AssetRef, WorkspaceId } from '@noutynotes/domain';

import type { WorkspaceStorage, WorkspaceStorageResult } from './workspace-storage';

/**
 * Assets binarios de un workspace (ADR 0015). Puerto opcional y separado de `WorkspaceStorage`:
 * solo lo implementan los adaptadores que guardan binarios (ZIP/memoria y carpetas).
 */
export interface WorkspaceAssets {
  /** Crea un asset nuevo; nunca sobrescribe: si existe, falla con `asset-conflict`. */
  writeAsset(id: WorkspaceId, ref: AssetRef, bytes: Uint8Array): Promise<WorkspaceStorageResult<null>>;
  readAsset(id: WorkspaceId, ref: AssetRef): Promise<WorkspaceStorageResult<Uint8Array>>;
  removeAsset(id: WorkspaceId, ref: AssetRef): Promise<WorkspaceStorageResult<null>>;
}

/** ¿El almacenamiento también guarda assets? */
export function assetsOf(storage: WorkspaceStorage): WorkspaceAssets | null {
  const candidate = storage as Partial<WorkspaceAssets>;
  return typeof candidate.writeAsset === 'function' && typeof candidate.readAsset === 'function' && typeof candidate.removeAsset === 'function'
    ? (candidate as WorkspaceAssets) : null;
}
