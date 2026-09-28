/**
 * Tipo y rótulo de conexión editables (ADR 0034): elegir un tipo existente o escribir uno nuevo, como
 * las etiquetas. `resolveRelationType` es pura; los casos de uso la combinan con el guardado.
 */
import { updateRelation } from '@noutynotes/domain';
import type { RelationArrow, RelationId, RelationTypeDefinition, RelationTypeId, Workspace, WorkspaceId } from '@noutynotes/domain';

import { fold } from './search';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

/** Nombre de tipo a ID válido: «Depende de» → `depende-de`; con colisión de otro tipo, se numera. */
function relationTypeSlug(label: string, taken: ReadonlySet<string>): RelationTypeId {
  const base = fold(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tipo';
  if (!taken.has(base)) return base as RelationTypeId;
  let attempt = 2;
  while (taken.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}` as RelationTypeId;
}

/**
 * El tipo de relación para ese nombre: uno existente con la misma etiqueta (sin distinguir mayúsculas
 * ni acentos), o uno nuevo añadido a `relationTypes`. No guarda nada; el llamador decide la transacción.
 */
export function resolveRelationType(workspace: Workspace, label: string): { readonly workspace: Workspace; readonly typeId: RelationTypeId } {
  const trimmed = label.trim();
  const existing = workspace.relationTypes.find((type) => fold(type.label) === fold(trimmed));
  if (existing) return { workspace, typeId: existing.id };
  const taken = new Set(workspace.relationTypes.map((type) => type.id as string));
  const type: RelationTypeDefinition = { id: relationTypeSlug(trimmed, taken), label: trimmed };
  return { workspace: { ...workspace, relationTypes: [...workspace.relationTypes, type] }, typeId: type.id };
}

export interface UpdateConnectionInput {
  /** Nombre del tipo: uno existente (se reutiliza) o uno nuevo (se crea). */
  readonly typeLabel?: string;
  readonly label?: string;
  readonly arrow?: RelationArrow;
}

/** Cambia tipo, rótulo o flecha de una conexión existente, en una sola escritura. */
export function updateConnection(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, relationId: RelationId, input: UpdateConnectionInput,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  if (typeof input !== 'object' || input === null) return Promise.resolve(storageFailure('invalid-workspace', 'input', 'Debe indicar al menos un cambio.'));
  if (input.typeLabel !== undefined && input.typeLabel.trim() === '') {
    return Promise.resolve(storageFailure('invalid-workspace', 'typeLabel', 'Escribe un nombre para el tipo de conexión.'));
  }
  return modifyWorkspace(storage, workspaceId, (workspace) => {
    const { workspace: typed, typeId } = input.typeLabel === undefined ? { workspace, typeId: undefined } : resolveRelationType(workspace, input.typeLabel);
    return updateRelation(typed, relationId, {
      ...(typeId === undefined ? {} : { typeId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.arrow === undefined ? {} : { arrow: input.arrow }),
    });
  });
}
