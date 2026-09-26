import type { IssueLike, ValidationResult, Workspace, WorkspaceId } from '@noutynotes/domain';

/** Errores tipados del puerto (ADR 0008). La lógica depende del código, no del mensaje. */
export type WorkspaceStorageErrorCode =
  | 'workspace-not-found'
  | 'workspace-already-exists'
  | 'invalid-workspace-id'
  | 'invalid-workspace'
  | 'invalid-template'
  | 'invalid-stored-data'
  | 'permission-denied'
  | 'external-change'
  | 'io-failure'
  /** Assets (ADR 0015): ya existe un archivo en esa ruta; nunca se sobrescribe. */
  | 'asset-conflict'
  /** Assets (ADR 0015): formato no admitido, vacío o demasiado grande. */
  | 'invalid-asset';

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

/**
 * Descripción segura de un valor no validado para mensajes de error. No ejecuta toString,
 * valueOf, Symbol.toPrimitive ni getters: los textos se citan con JSON.stringify (que no llama a
 * métodos de un string) y el resto se describe solo por su tipo.
 */
export function describeUntrustedValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'una lista';
  return `un valor de tipo ${typeof value}`;
}

/** Incidencia `invalid-workspace-id` para un argumento que no es un ID válido. */
export function invalidWorkspaceIdFailure<T>(value: unknown, path: string): WorkspaceStorageResult<T> {
  return storageFailure('invalid-workspace-id', path, `${describeUntrustedValue(value)} no es un ID de workspace válido.`);
}

export function storageFailure<T>(
  code: WorkspaceStorageErrorCode,
  path: string,
  message: string,
  details?: readonly IssueLike[],
): WorkspaceStorageResult<T> {
  return { ok: false, issues: [details === undefined ? { code, path, message } : { code, path, message, details }] };
}
