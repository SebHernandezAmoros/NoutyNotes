import type { IssueLike, ValidationResult, Workspace, WorkspaceId } from '@noutynotes/domain';

/** Errores tipados del puerto (ADR 0008). La lógica depende del código, no del mensaje. */
export type WorkspaceStorageErrorCode =
  | 'workspace-not-found'
  | 'workspace-already-exists'
  | 'invalid-workspace-id'
  | 'invalid-workspace'
  | 'invalid-template'
  | 'invalid-stored-data';

export interface WorkspaceStorageIssue {
  readonly code: WorkspaceStorageErrorCode;
  /** Argumento afectado: `workspace`, `id`, `from`, `to`… */
  readonly path: string;
  readonly message: string;
  /** Incidencias originales del dominio o del formato, sin perder código ni ruta. */
  readonly details?: readonly IssueLike[];
}

export type WorkspaceStorageResult<T> = ValidationResult<T, WorkspaceStorageIssue>;

export interface WorkspaceSummary {
  readonly id: WorkspaceId;
  readonly name: string;
}

/**
 * Almacenamiento de workspaces completos. Ninguna operación rechaza la promesa por datos
 * inválidos, deja cambios parciales tras un error ni comparte referencias mutables con el llamador.
 */
export interface WorkspaceStorage {
  /** Guarda un workspace nuevo. Falla si su ID ya existe; nunca sobrescribe. */
  create(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>>;
  /** Sustituye un workspace existente por esta instantánea, conservando los documentos sin cambios. */
  save(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>>;
  /** Lee y valida un workspace; cada llamada devuelve objetos nuevos. */
  open(id: WorkspaceId): Promise<WorkspaceStorageResult<Workspace>>;
  /** Resúmenes ordenados por ID. */
  list(): Promise<WorkspaceStorageResult<readonly WorkspaceSummary[]>>;
  /** Cambia el identificador de almacenamiento. `from === to` no cambia nada. */
  rename(from: WorkspaceId, to: WorkspaceId): Promise<WorkspaceStorageResult<WorkspaceSummary>>;
  /** Elimina un workspace existente. */
  delete(id: WorkspaceId): Promise<WorkspaceStorageResult<null>>;
}

export function storageFailure<T>(
  code: WorkspaceStorageErrorCode,
  path: string,
  message: string,
  details?: readonly IssueLike[],
): WorkspaceStorageResult<T> {
  return { ok: false, issues: [details === undefined ? { code, path, message } : { code, path, message, details }] };
}
