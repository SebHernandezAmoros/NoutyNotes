import { invalidWorkspaceIdFailure, storageFailure } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from '@noutynotes/application';
import { isValidId } from '@noutynotes/domain';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { parseWorkspace, serializeWorkspace } from './workspace-codec';
import type { TextFiles } from './text-files';

/** Acceso de bajo nivel a un paquete, apto para File System Access y dobles de prueba. */
export interface WorkspaceDirectory {
  listPaths(): Promise<readonly string[]>;
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface FolderPort {
  permission(): Promise<boolean>;
  folders(): Promise<readonly { readonly key: string; readonly folder: WorkspaceDirectory }[]>;
  createFolder(key: string): Promise<WorkspaceDirectory>;
}

const MANIFEST = '.nouty/workspace.yaml';
const TRANSACTION = '.nouty-transaction.json';
const DELETED = '.nouty-deleted';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const managedPath = (path: string): boolean => path === MANIFEST || path === '.nouty/layout.yaml'
  || path === '.nouty/relations.yaml' || /^cards\/[a-z0-9_-]+\.md$/.test(path)
  || /^boards\/[a-z0-9_-]+\.md$/.test(path);

interface Transaction {
  readonly version: 1;
  readonly committed: boolean;
  readonly old: Readonly<Record<string, string | null>>;
}

type Package = { readonly folder: WorkspaceDirectory; readonly files: TextFiles; readonly workspace: Workspace; readonly fingerprint: string };

function success<T>(value: T): WorkspaceStorageResult<T> { return { ok: true, value }; }
function error<T>(code: 'invalid-stored-data' | 'permission-denied' | 'external-change' | 'io-failure', path: string, message: string): WorkspaceStorageResult<T> {
  return storageFailure(code, path, message);
}
function fingerprint(files: TextFiles): string { return JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))); }
function summary(workspace: Workspace): WorkspaceSummary { return { id: workspace.id, name: workspace.metadata.name }; }

/**
 * Puerto de workspaces sobre una carpeta elegida por el usuario. Solo reescribe documentos de texto
 * gestionados; los bytes bajo assets/ nunca se leen ni modifican. La transacción guarda una copia
 * recuperable de los documentos que cambiarán antes de tocarlos.
 */
export class FolderStorage implements WorkspaceStorage {
  readonly #baseline = new Map<string, string>();
  constructor(readonly port: FolderPort) {}

  async #allowed<T>(): Promise<WorkspaceStorageResult<T> | null> {
    try { return await this.port.permission() ? null : error('permission-denied', 'folder', 'El navegador no concedió acceso de lectura y escritura a la carpeta.'); }
    catch { return error('permission-denied', 'folder', 'No se pudo comprobar el permiso de la carpeta.'); }
  }

  async #recover(folder: WorkspaceDirectory): Promise<void> {
    const bytes = await folder.read(TRANSACTION);
    if (!bytes) return;
    const marker: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) throw new Error('Marcador de recuperación inválido.');
    const transaction = marker as Transaction;
    if (transaction.version !== 1 || typeof transaction.committed !== 'boolean' || typeof transaction.old !== 'object' || transaction.old === null || Array.isArray(transaction.old)) {
      throw new Error('Marcador de recuperación inválido.');
    }
    if (!transaction.committed) {
      for (const [path, old] of Object.entries(transaction.old)) {
        if (!managedPath(path) || (typeof old !== 'string' && old !== null)) throw new Error('Marcador de recuperación inválido.');
        if (old === null) await folder.remove(path);
        else await folder.write(path, encoder.encode(old));
      }
    }
    await folder.remove(TRANSACTION);
  }

  async #read(folder: WorkspaceDirectory): Promise<Package | null> {
    await this.#recover(folder);
    const paths = await folder.listPaths();
    if (paths.includes(DELETED) || !paths.includes(MANIFEST)) return null;
    const entries: [string, string][] = [];
    for (const path of paths) {
      if (path === TRANSACTION || path === DELETED || path.startsWith('assets/')) continue;
      const bytes = await folder.read(path);
      if (bytes === undefined) throw new Error(`Desapareció el archivo ${path}.`);
      entries.push([path, decoder.decode(bytes)]);
    }
    const files = Object.fromEntries(entries);
    const parsed = parseWorkspace(files);
    if (!parsed.ok) throw new Error(`Paquete v1 inválido: ${parsed.issues.map((issue) => `${issue.code}@${issue.path}`).join(', ')}`);
    return { folder, files, workspace: parsed.value, fingerprint: fingerprint(files) };
  }

  async #packages(): Promise<readonly Package[]> {
    const folders = await this.port.folders();
    const found: Package[] = [];
    for (const { folder } of folders) {
      const read = await this.#read(folder);
      if (read) found.push(read);
    }
    const ids = new Set<string>();
    for (const item of found) {
      if (ids.has(item.workspace.id)) throw new Error(`ID repetido entre carpetas: ${item.workspace.id}.`);
      ids.add(item.workspace.id);
    }
    return found;
  }

  async #commit(folder: WorkspaceDirectory, previous: TextFiles, next: TextFiles): Promise<void> {
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .filter((path) => previous[path] !== next[path])
      .sort((a, b) => (a === MANIFEST ? 1 : b === MANIFEST ? -1 : a.localeCompare(b)));
    if (changed.length === 0) return;
    const old = Object.fromEntries(changed.map((path) => [path, previous[path] ?? null]));
    const marker: Transaction = { version: 1, committed: false, old };
    await folder.write(TRANSACTION, encoder.encode(JSON.stringify(marker)));
    try {
      for (const path of changed) {
        const text = next[path];
        if (text === undefined) await folder.remove(path);
        else await folder.write(path, encoder.encode(text));
      }
      await folder.write(TRANSACTION, encoder.encode(JSON.stringify({ ...marker, committed: true })));
      await folder.remove(TRANSACTION);
    } catch (cause) {
      try { await this.#recover(folder); } catch { /* Se conserva el marcador para recuperar al reconectar. */ }
      throw cause;
    }
  }

  async list(): Promise<WorkspaceStorageResult<readonly WorkspaceSummary[]>> {
    const denied = await this.#allowed<readonly WorkspaceSummary[]>();
    if (denied) return denied;
    try { return success((await this.#packages()).map((item) => summary(item.workspace)).sort((a, b) => a.id.localeCompare(b.id))); }
    catch { return error('invalid-stored-data', 'folder', 'La carpeta contiene datos inválidos o una recuperación pendiente.'); }
  }

  async open(id: WorkspaceId): Promise<WorkspaceStorageResult<Workspace>> {
    if (!isValidId(id)) return invalidWorkspaceIdFailure(id, 'id');
    const denied = await this.#allowed<Workspace>();
    if (denied) return denied;
    try {
      const found = (await this.#packages()).find((item) => item.workspace.id === id);
      if (!found) return storageFailure('workspace-not-found', 'id', `No existe el workspace "${id}".`);
      const baseline = this.#baseline.get(id);
      if (baseline !== undefined && baseline !== found.fingerprint) return error('external-change', 'id', 'La carpeta cambió fuera de NoutyNotes. Reconecta para cargar la versión actual.');
      this.#baseline.set(id, found.fingerprint);
      return success(found.workspace);
    } catch { return error('invalid-stored-data', 'id', 'No se pudo leer o recuperar el workspace.'); }
  }

  /** Reconocer explícitamente cambios externos tras mostrar el conflicto al usuario. */
  acknowledgeExternalChange(id: WorkspaceId): void { this.#baseline.delete(id); }

  async create(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const serialized = serializeWorkspace(workspace);
    if (!serialized.ok) return storageFailure('invalid-workspace', 'workspace', 'Workspace inválido.', serialized.issues);
    const denied = await this.#allowed<WorkspaceSummary>();
    if (denied) return denied;
    try {
      const folders = await this.port.folders();
      if ((await this.#packages()).some((item) => item.workspace.id === workspace.id)) return storageFailure('workspace-already-exists', 'workspace', 'Ya existe el workspace.');
      const names = new Set(folders.map((item) => item.key));
      let key: string = workspace.id;
      for (let index = 2; names.has(key); index += 1) key = `${workspace.id}-${index}`;
      const folder = await this.port.createFolder(key);
      await this.#commit(folder, {}, serialized.value);
      this.#baseline.set(workspace.id, fingerprint(serialized.value));
      return success(summary(workspace));
    } catch { return error('io-failure', 'workspace', 'No se pudo crear el workspace en la carpeta.'); }
  }

  async save(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const serialized = serializeWorkspace(workspace);
    if (!serialized.ok) return storageFailure('invalid-workspace', 'workspace', 'Workspace inválido.', serialized.issues);
    const denied = await this.#allowed<WorkspaceSummary>();
    if (denied) return denied;
    try {
      const found = (await this.#packages()).find((item) => item.workspace.id === workspace.id);
      if (!found) return storageFailure('workspace-not-found', 'workspace', 'No existe el workspace.');
      const baseline = this.#baseline.get(workspace.id);
      if (baseline === undefined || baseline !== found.fingerprint) return error('external-change', 'workspace', 'La carpeta cambió o aún no se abrió en esta sesión. Reconecta antes de guardar.');
      const next = serializeWorkspace(workspace, found.files);
      if (!next.ok) return storageFailure('invalid-stored-data', 'workspace', 'El paquete previo no se puede actualizar.', next.issues);
      await this.#commit(found.folder, found.files, next.value);
      this.#baseline.set(workspace.id, fingerprint(next.value));
      return success(summary(workspace));
    } catch { return error('io-failure', 'workspace', 'No se pudo guardar el workspace; comprueba la recuperación de la carpeta.'); }
  }

  async rename(from: WorkspaceId, to: WorkspaceId): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    if (!isValidId(from)) return invalidWorkspaceIdFailure(from, 'from');
    if (!isValidId(to)) return invalidWorkspaceIdFailure(to, 'to');
    const denied = await this.#allowed<WorkspaceSummary>();
    if (denied) return denied;
    try {
      const all = await this.#packages();
      const found = all.find((item) => item.workspace.id === from);
      if (!found) return storageFailure('workspace-not-found', 'from', 'No existe el workspace.');
      if (from === to) return success(summary(found.workspace));
      if (all.some((item) => item.workspace.id === to)) return storageFailure('workspace-already-exists', 'to', 'El destino ya existe.');
      if (this.#baseline.has(from) && this.#baseline.get(from) !== found.fingerprint) return error('external-change', 'from', 'La carpeta cambió fuera de NoutyNotes.');
      const workspace = { ...found.workspace, id: to };
      const next = serializeWorkspace(workspace, found.files);
      if (!next.ok) return storageFailure('invalid-stored-data', 'from', 'No se pudo renombrar el paquete.', next.issues);
      await this.#commit(found.folder, found.files, next.value);
      this.#baseline.delete(from);
      this.#baseline.set(to, fingerprint(next.value));
      return success(summary(workspace));
    } catch { return error('io-failure', 'from', 'No se pudo renombrar el workspace.'); }
  }

  async delete(id: WorkspaceId): Promise<WorkspaceStorageResult<null>> {
    if (!isValidId(id)) return invalidWorkspaceIdFailure(id, 'id');
    const denied = await this.#allowed<null>();
    if (denied) return denied;
    try {
      const found = (await this.#packages()).find((item) => item.workspace.id === id);
      if (!found) return storageFailure('workspace-not-found', 'id', 'No existe el workspace.');
      if (this.#baseline.has(id) && this.#baseline.get(id) !== found.fingerprint) return error('external-change', 'id', 'La carpeta cambió fuera de NoutyNotes.');
      // Borrado recuperable: un marcador único hace que la app deje de listar la carpeta.
      await found.folder.write(DELETED, encoder.encode('1'));
      this.#baseline.delete(id);
      return success(null);
    } catch { return error('io-failure', 'id', 'No se pudo quitar el workspace de la lista.'); }
  }
}
