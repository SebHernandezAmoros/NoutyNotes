import { CURRENT_SCHEMA_VERSION, instantiateTemplate, isValidId, validateWorkspace } from '@noutynotes/domain';
import type { AssetRef, Template, ValidationResult, Workspace, WorkspaceId } from '@noutynotes/domain';

import { invalidWorkspaceIdFailure, storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import type { WorkspaceAssets } from './workspace-assets';

export interface CreateEmptyWorkspaceInput {
  readonly id: WorkspaceId;
  readonly name: string;
}

export interface CreateFromTemplateInput {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly namespace: string;
}

/** Transformación pura del dominio (mover, borrar, relacionar…) sobre una copia del workspace. */
export type WorkspaceTransform = (workspace: Workspace) => ValidationResult<Workspace>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Crea un workspace sin tarjetas, tipos ni boards. El ID lo aporta el llamador. */
export async function createEmptyWorkspace(storage: WorkspaceStorage, input: CreateEmptyWorkspaceInput): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  if (!isObject(input)) return storageFailure('invalid-workspace', 'input', 'Debe indicar ID y nombre.');
  const id: unknown = Object.getOwnPropertyDescriptor(input, 'id')?.value;
  if (!isValidId(id)) return invalidWorkspaceIdFailure(id, 'id');
  const name: unknown = Object.getOwnPropertyDescriptor(input, 'name')?.value;
  // Tipo comprobado por validateWorkspace a continuación; los descriptores evitan ejecutar getters.
  const workspace = {
    schemaVersion: CURRENT_SCHEMA_VERSION, id: id as WorkspaceId, metadata: { name },
    cardTypes: [], relationTypes: [], cards: [], boards: [], layouts: [], relations: [],
  } as unknown as Workspace;
  const checked = validateWorkspace(workspace);
  if (!checked.ok) return storageFailure('invalid-workspace', 'workspace', 'El workspace vacío no es válido.', checked.issues);
  return storage.create(workspace);
}

/** Instancia una plantilla (fase 4) y guarda el workspace resultante como nuevo. */
export async function createWorkspaceFromTemplate(
  storage: WorkspaceStorage,
  template: Template,
  input: CreateFromTemplateInput,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  const instance = instantiateTemplate(template, input);
  if (!instance.ok) return storageFailure('invalid-template', 'template', 'La plantilla no se puede instanciar.', instance.issues);
  return storage.create(instance.value.workspace);
}

/**
 * Instancia una plantilla incorporada (fase 11a, ADR 0033) y, además de guardar el workspace, escribe
 * los assets binarios que declare (`instantiateTemplate` solo aporta las rutas, no los bytes). Un solo
 * intento por asset; si falta uno en `assetBytes` o su escritura falla, se borra el workspace recién
 * creado: o todo o nada, nunca un espacio con una imagen que no existe.
 */
export async function createWorkspaceFromBuiltInTemplate(
  storage: WorkspaceStorage,
  assets: WorkspaceAssets,
  template: Template,
  input: CreateFromTemplateInput,
  assetBytes: ReadonlyMap<AssetRef, Uint8Array>,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  const instance = instantiateTemplate(template, input);
  if (!instance.ok) return storageFailure('invalid-template', 'template', 'La plantilla no se puede instanciar.', instance.issues);
  const created = await storage.create(instance.value.workspace);
  if (!created.ok) return created;
  for (const ref of instance.value.assets) {
    const bytes = assetBytes.get(ref);
    const written = bytes === undefined
      ? storageFailure<null>('invalid-asset', ref, `Falta el archivo «${ref}» de la plantilla.`)
      : await assets.writeAsset(input.workspaceId, ref, bytes);
    if (!written.ok) {
      const removed = await storage.delete(input.workspaceId);
      if (!removed.ok) return { ok: false, issues: [...written.issues, { code: 'io-failure', path: input.workspaceId, message: 'No se pudo deshacer el espacio creado; queda incompleto.' }] };
      return { ok: false, issues: written.issues };
    }
  }
  return created;
}

/**
 * Abre, aplica una transformación pura y guarda. La transformación recibe una copia recién leída.
 * Si falla o intenta cambiar el ID, no se guarda nada; `save` conserva los documentos sin cambios.
 */
export async function modifyWorkspace(
  storage: WorkspaceStorage,
  id: WorkspaceId,
  transform: WorkspaceTransform,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  const opened = await storage.open(id);
  if (!opened.ok) return opened;
  const transformed = transform(opened.value);
  if (!transformed.ok) {
    return storageFailure('invalid-workspace', 'transform', 'La transformación no produjo un workspace válido.', transformed.issues);
  }
  const candidate: unknown = transformed.value;
  // Se lee el ID por su descriptor para no ejecutar un posible getter del resultado.
  if (!isObject(candidate) || Object.getOwnPropertyDescriptor(candidate, 'id')?.value !== id) {
    return storageFailure('invalid-workspace', 'transform', 'La transformación no puede cambiar el ID del workspace; usa rename.');
  }
  return storage.save(transformed.value);
}
