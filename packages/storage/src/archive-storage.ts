import { invalidWorkspaceIdFailure, storageFailure, workspaceIdFromName } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from '@noutynotes/application';
import { isValidId } from '@noutynotes/domain';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { MemoryStorage } from './memory-storage';
import { readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import type { BinaryAssets } from './workspace-archive';
import { serializeWorkspace } from './workspace-codec';

export interface ArchiveImport {
  readonly summary: WorkspaceSummary;
  /** Presente si el ID ya existía y se importó como copia con otro ID. */
  readonly renamedFrom?: WorkspaceId;
}

export interface ArchiveExport {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** Revisión exportada; solo `confirmExported` con esta misma revisión da por conservado el estado. */
  readonly revision: number;
}

/** Resultado de confirmar que el usuario guardó un ZIP exportado. */
export type ExportConfirmation = 'confirmed' | 'changed-since-export';

function copyAssets(assets: BinaryAssets): BinaryAssets {
  return Object.fromEntries(Object.entries(assets).map(([path, bytes]) => [path, bytes.slice()]));
}

/**
 * Espacios del navegador para el fallback ZIP (ADR 0011). Compone un MemoryStorage (documentos
 * v1), los assets binarios de cada workspace y el registro de cambios sin exportar. No persiste
 * nada entre sesiones: el ZIP exportado es la persistencia.
 *
 * Cada cambio incrementa la revisión del workspace. Exportar no confirma nada: la web no puede
 * saber si el usuario guardó el archivo. Solo `confirmExported` con la revisión exportada (tras la
 * confirmación del usuario) marca como conservado ese estado, y nunca una edición posterior.
 */
export class ArchiveStorage implements WorkspaceStorage {
  readonly #memory = new MemoryStorage();
  readonly #assets = new Map<string, BinaryAssets>();
  /** Revisión actual de cada workspace y última revisión cuyo ZIP el usuario confirmó guardar. */
  readonly #revisions = new Map<string, number>();
  readonly #confirmed = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  #nextRevision = 1;

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #isUnexported(id: string): boolean {
    const revision = this.#revisions.get(id);
    return revision !== undefined && this.#confirmed.get(id) !== revision;
  }

  /** Nueva revisión sin confirmar. */
  #markUnexported(id: string): void {
    this.#revisions.set(id, this.#nextRevision);
    this.#nextRevision += 1;
    this.#changed();
  }

  #forget(id: string): void {
    this.#revisions.delete(id);
    this.#confirmed.delete(id);
  }

  /** Avisa de cada cambio en el registro de cambios sin exportar. Devuelve la baja. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  hasUnexportedChanges(id: WorkspaceId): boolean {
    return this.#isUnexported(id);
  }

  unexportedIds(): readonly WorkspaceId[] {
    return [...this.#revisions.keys()].filter((id) => this.#isUnexported(id)).sort() as WorkspaceId[];
  }

  async create(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const created = await this.#memory.create(workspace);
    if (created.ok) this.#markUnexported(created.value.id);
    return created;
  }

  async save(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const saved = await this.#memory.save(workspace);
    if (saved.ok) this.#markUnexported(saved.value.id);
    return saved;
  }

  open(id: WorkspaceId): Promise<WorkspaceStorageResult<Workspace>> {
    return this.#memory.open(id);
  }

  list(): Promise<WorkspaceStorageResult<readonly WorkspaceSummary[]>> {
    return this.#memory.list();
  }

  async rename(from: WorkspaceId, to: WorkspaceId): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const renamed = await this.#memory.rename(from, to);
    if (renamed.ok && from !== to) {
      const assets = this.#assets.get(from);
      this.#assets.delete(from);
      if (assets) this.#assets.set(to, assets);
      this.#forget(from);
      this.#markUnexported(to);
    }
    return renamed;
  }

  async delete(id: WorkspaceId): Promise<WorkspaceStorageResult<null>> {
    const deleted = await this.#memory.delete(id);
    if (deleted.ok) {
      this.#assets.delete(id);
      const wasUnexported = this.#isUnexported(id);
      this.#forget(id);
      if (wasUnexported) this.#changed();
    }
    return deleted;
  }

  /**
   * Importa un ZIP no confiable. Todo se valida y, si hace falta, se renombra antes de guardar:
   * un error no cambia nada y un ID existente nunca se sobrescribe.
   */
  async importArchive(bytes: Uint8Array): Promise<WorkspaceStorageResult<ArchiveImport>> {
    const archive = readWorkspaceArchive(bytes);
    if (!archive.ok) return storageFailure('invalid-workspace', 'archivo', 'El ZIP no contiene un workspace v1 válido.', archive.issues);
    const listed = await this.#memory.list();
    if (!listed.ok) return { ok: false, issues: listed.issues };
    const original = archive.value.workspace.id;
    const taken = listed.value.map((summary) => summary.id);
    let files = archive.value.files;
    let id = original;
    if (taken.includes(original)) {
      id = workspaceIdFromName(original, taken);
      // Solo cambia el manifiesto; el resto de documentos conserva sus bytes (como en rename).
      const renamed = serializeWorkspace({ ...archive.value.workspace, id }, files);
      if (!renamed.ok) return storageFailure('invalid-workspace', 'archivo', 'No se pudo importar el ZIP como copia.', renamed.issues);
      files = renamed.value;
    }
    const imported = this.#memory.importPackage(files);
    if (!imported.ok) return { ok: false, issues: imported.issues };
    this.#assets.set(id, copyAssets(archive.value.assets));
    if (id !== original) {
      this.#markUnexported(id);
      return { ok: true, value: { summary: imported.value, renamedFrom: original } };
    }
    // Sin cambios respecto al ZIP de origen: su estado ya está en un archivo del usuario.
    const revision = this.#nextRevision;
    this.#nextRevision += 1;
    this.#revisions.set(id, revision);
    this.#confirmed.set(id, revision);
    this.#changed();
    return { ok: true, value: { summary: imported.value } };
  }

  /**
   * ZIP determinista del workspace con sus assets y la revisión exportada. No cambia el registro de
   * cambios sin exportar: preparar los bytes no demuestra que el archivo se guardara.
   */
  exportArchive(id: WorkspaceId): WorkspaceStorageResult<ArchiveExport> {
    if (!isValidId(id)) return invalidWorkspaceIdFailure(id, 'id');
    const files = this.#memory.exportPackage(id);
    if (!files.ok) return { ok: false, issues: files.issues };
    const zipped = writeWorkspaceArchive(files.value, this.#assets.get(id) ?? {});
    if (!zipped.ok) return storageFailure('invalid-stored-data', 'id', 'El workspace no se puede exportar como ZIP.', zipped.issues);
    return { ok: true, value: { fileName: `${id}.zip`, bytes: zipped.value, revision: this.#revisions.get(id) ?? 0 } };
  }

  /**
   * El usuario confirma que guardó el ZIP de `revision`. Solo si sigue siendo la revisión actual se
   * da por conservado; si hubo cambios después, siguen pendientes y hay que volver a exportar.
   */
  confirmExported(id: WorkspaceId, revision: number): WorkspaceStorageResult<ExportConfirmation> {
    if (!isValidId(id)) return invalidWorkspaceIdFailure(id, 'id');
    const current = this.#revisions.get(id);
    if (current === undefined) return storageFailure('workspace-not-found', 'id', `No existe el workspace "${id}".`);
    if (current !== revision) return { ok: true, value: 'changed-since-export' };
    if (this.#confirmed.get(id) !== revision) {
      this.#confirmed.set(id, revision);
      this.#changed();
    }
    return { ok: true, value: 'confirmed' };
  }
}
