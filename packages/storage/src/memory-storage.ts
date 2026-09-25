import { invalidWorkspaceIdFailure, storageFailure } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from '@noutynotes/application';
import { isValidId } from '@noutynotes/domain';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { fail, storageIssue, succeed as succeedStorage } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { validateTextFiles } from './text-files';
import type { TextFiles } from './text-files';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';

/** Paquete guardado: solo textos inmutables del formato v1 y el nombre para el listado. */
interface StoredPackage {
  readonly files: TextFiles;
  readonly name: string;
}

function succeed<T>(value: T): WorkspaceStorageResult<T> {
  return { ok: true, value };
}

function invalidId<T>(value: unknown, path: string): WorkspaceStorageResult<T> | null {
  // La descripción del valor no ejecuta conversiones controladas por él (cierre de fase 6).
  return isValidId(value) ? null : invalidWorkspaceIdFailure(value, path);
}

/**
 * Adaptador en memoria del puerto WorkspaceStorage (ADR 0008). Guarda cada workspace como
 * paquete `TextFiles` producido por los codecs v1 y lo vuelve a leer con ellos: no hay una vía
 * que evite el formato ni referencias compartidas con el llamador. Cada operación calcula su
 * resultado completo antes de confirmarlo, así que un error no deja cambios parciales.
 */
export class MemoryStorage implements WorkspaceStorage {
  readonly #packages = new Map<string, StoredPackage>();

  /** Crea un almacenamiento con paquetes v1 existentes (por ejemplo, fixtures), validando cada uno. */
  static fromPackages(packages: Readonly<Record<string, TextFiles>>): StorageResult<MemoryStorage> {
    const container: unknown = packages;
    if (typeof container !== 'object' || container === null || Array.isArray(container) || Object.getOwnPropertySymbols(container).length > 0) {
      return fail([storageIssue('invalid-value', 'packages', 'Debe ser un objeto de ID de workspace → paquete de archivos.')]);
    }
    const issues: StorageIssue[] = [];
    const loaded: [string, StoredPackage][] = [];
    for (const key of Object.getOwnPropertyNames(container).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      const files: unknown = descriptor?.value;
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof files !== 'object' || files === null) {
        issues.push(storageIssue('invalid-value', key, 'El paquete debe ser un objeto almacenado, no calculado.'));
        continue;
      }
      if (!isValidId(key)) {
        issues.push(storageIssue('invalid-id', key, `"${key}" no es un ID de workspace válido.`));
        continue;
      }
      const parsed = parseWorkspace(files as TextFiles);
      const copied = validateTextFiles(files);
      if (!parsed.ok || !copied.ok) {
        issues.push(...(parsed.ok ? [] : parsed.issues).map((found) => ({ ...found, path: `${key}:${found.path}` })));
        continue;
      }
      if (parsed.value.id !== key) {
        issues.push(storageIssue('identity-mismatch', `${key}:.nouty/workspace.yaml#id`, `El paquete declara "${parsed.value.id}", no "${key}".`));
        continue;
      }
      loaded.push([key, { files: copied.value, name: parsed.value.metadata.name }]);
    }
    if (issues.length > 0) return fail(issues);
    const storage = new MemoryStorage();
    for (const [key, stored] of loaded) storage.#packages.set(key, stored);
    return succeedStorage(storage);
  }

  /** Copia del paquete guardado, para inspección. No forma parte del puerto. */
  exportPackage(id: WorkspaceId): WorkspaceStorageResult<TextFiles> {
    const rejected = invalidId<TextFiles>(id, 'id');
    if (rejected) return rejected;
    const stored = this.#packages.get(id);
    if (!stored) return storageFailure('workspace-not-found', 'id', `No existe el workspace "${id}".`);
    // Object.fromEntries crea propiedades propias: la copia no comparte el objeto guardado.
    return succeed(Object.fromEntries(Object.entries(stored.files)));
  }

  /** Valida y serializa; solo después se leen campos del workspace recibido. */
  #serialize(workspace: Workspace, previous?: TextFiles): WorkspaceStorageResult<StoredPackage> {
    const serialized = serializeWorkspace(workspace, previous);
    if (!serialized.ok) {
      return storageFailure('invalid-workspace', 'workspace', 'El workspace no se puede guardar en el formato v1.', serialized.issues);
    }
    return succeed({ files: serialized.value, name: workspace.metadata.name });
  }

  #summary(id: string, stored: StoredPackage): WorkspaceSummary {
    return { id: id as WorkspaceId, name: stored.name };
  }

  async create(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const stored = this.#serialize(workspace);
    if (!stored.ok) return stored;
    const id = workspace.id;
    if (this.#packages.has(id)) return storageFailure('workspace-already-exists', 'workspace', `Ya existe el workspace "${id}".`);
    this.#packages.set(id, stored.value);
    return succeed(this.#summary(id, stored.value));
  }

  async save(workspace: Workspace): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const validated = this.#serialize(workspace);
    if (!validated.ok) return validated;
    const id = workspace.id;
    const previous = this.#packages.get(id);
    if (!previous) return storageFailure('workspace-not-found', 'workspace', `No existe el workspace "${id}".`);
    // Con el paquete anterior se conservan los bytes de los documentos sin cambios y los extras.
    const stored = this.#serialize(workspace, previous.files);
    if (!stored.ok) return stored;
    this.#packages.set(id, stored.value);
    return succeed(this.#summary(id, stored.value));
  }

  async open(id: WorkspaceId): Promise<WorkspaceStorageResult<Workspace>> {
    const rejected = invalidId<Workspace>(id, 'id');
    if (rejected) return rejected;
    const stored = this.#packages.get(id);
    if (!stored) return storageFailure('workspace-not-found', 'id', `No existe el workspace "${id}".`);
    const parsed = parseWorkspace(stored.files);
    if (!parsed.ok) return storageFailure('invalid-stored-data', 'id', 'El paquete guardado no se puede leer.', parsed.issues);
    return succeed(parsed.value);
  }

  async list(): Promise<WorkspaceStorageResult<readonly WorkspaceSummary[]>> {
    const ids = [...this.#packages.keys()].sort();
    return succeed(ids.map((id) => this.#summary(id, this.#packages.get(id) as StoredPackage)));
  }

  async rename(from: WorkspaceId, to: WorkspaceId): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
    const rejected = invalidId<WorkspaceSummary>(from, 'from') ?? invalidId<WorkspaceSummary>(to, 'to');
    if (rejected) return rejected;
    const source = this.#packages.get(from);
    if (!source) return storageFailure('workspace-not-found', 'from', `No existe el workspace "${from}".`);
    if (from === to) return succeed(this.#summary(from, source));
    if (this.#packages.has(to)) return storageFailure('workspace-already-exists', 'to', `Ya existe el workspace "${to}".`);
    const parsed = parseWorkspace(source.files);
    if (!parsed.ok) return storageFailure('invalid-stored-data', 'from', 'El paquete guardado no se puede leer.', parsed.issues);
    // Solo cambia el manifiesto (su ID); el resto de documentos y extras conserva sus bytes.
    const renamed = this.#serialize({ ...parsed.value, id: to }, source.files);
    if (!renamed.ok) return storageFailure('invalid-stored-data', 'from', 'El paquete renombrado no se puede escribir.', renamed.issues[0]?.details);
    this.#packages.delete(from);
    this.#packages.set(to, renamed.value);
    return succeed(this.#summary(to, renamed.value));
  }

  async delete(id: WorkspaceId): Promise<WorkspaceStorageResult<null>> {
    const rejected = invalidId<null>(id, 'id');
    if (rejected) return rejected;
    if (!this.#packages.delete(id)) return storageFailure('workspace-not-found', 'id', `No existe el workspace "${id}".`);
    return succeed(null);
  }
}
