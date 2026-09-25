import type { DocumentTree, DocumentTreeEntry } from '@noutynotes/storage';

/**
 * Operaciones nativas que necesita el árbol SAF (ADR 0012). La implementación real usa
 * `expo-file-system` (androidFolder.android.ts); las pruebas usan un doble. Nada de esto llega a
 * dominio, application ni storage.
 */
export interface SafApi<D, F> {
  /** El directorio existe y la app conserva acceso. */
  exists(dir: D): boolean;
  /** Nombres visibles e hijos, en el mismo orden (ambos salen de DocumentFile.listFiles()). */
  children(dir: D): { readonly names: readonly string[]; readonly entries: readonly (D | F)[] };
  isDirectory(entry: D | F): entry is D;
  uriOf(entry: D | F): string;
  createDirectory(dir: D, name: string): D;
  /** Crea con `application/octet-stream` para que el proveedor no añada extensiones. */
  createFile(dir: D, name: string): F;
  readBytes(file: F): Promise<Uint8Array>;
  /** Sustituye todo el contenido (`FileMode.Truncate`, modo `"wt"`); nunca `"w"` sin truncar. */
  writeTruncating(file: F, bytes: Uint8Array): void;
  deleteFile(file: F): void;
}

type Child<D, F> = { readonly name: string; readonly entry: D | F };

// Al listar, el módulo nativo añade «/» a las URIs de directorio; al crear, no siempre.
const sameUri = (uri: string) => uri.replace(/\/+$/, '');

/**
 * Un directorio SAF como `DocumentTree`: resuelve hijos por su nombre visible, no por la URI.
 * Cada listado cuesta una consulta al proveedor por hijo, así que se reutiliza el último: `entries()`
 * siempre lista de nuevo, y si un nombre no está en el listado guardado o la operación sobre esa
 * entrada falla (borrada o sustituida fuera de la app), se vuelve a listar y se reintenta una vez.
 */
export class SafTree<D, F> implements DocumentTree {
  #listed: Child<D, F>[] | undefined;
  readonly #subtrees = new Map<string, SafTree<D, F>>();

  constructor(readonly api: SafApi<D, F>, readonly dir: D) {}

  #list(): Child<D, F>[] {
    const { names, entries } = this.api.children(this.dir);
    if (names.length !== entries.length) throw new Error('La carpeta cambió mientras se leía; vuelve a intentarlo.');
    this.#listed = entries.map((entry, index) => ({ name: names[index] as string, entry }));
    return this.#listed;
  }

  /** Actúa sobre el hijo con ese nombre (o `undefined`) usando el listado guardado si es posible. */
  async #withChild<T>(name: string, act: (entry: D | F | undefined) => T | Promise<T>): Promise<T> {
    const cached = this.#listed?.find((child) => child.name === name)?.entry;
    if (cached !== undefined) {
      try {
        return await act(cached);
      } catch {
        // Entrada obsoleta o fallo transitorio: se decide con un listado nuevo.
      }
    }
    return act(this.#list().find((child) => child.name === name)?.entry);
  }

  #subtree(entry: D): SafTree<D, F> {
    const key = sameUri(this.api.uriOf(entry));
    let tree = this.#subtrees.get(key);
    if (!tree) {
      tree = new SafTree(this.api, entry);
      this.#subtrees.set(key, tree);
    }
    return tree;
  }

  /** Tras crear, el hijo debe tener exactamente el nombre pedido; si el proveedor lo cambió, se deshace. */
  #verifyCreated(entry: D | F, name: string): void {
    const uri = sameUri(this.api.uriOf(entry));
    const created = this.#list().find((child) => sameUri(this.api.uriOf(child.entry)) === uri);
    if (created?.name === name) return;
    if (!this.api.isDirectory(entry)) this.api.deleteFile(entry);
    this.#listed = undefined;
    throw new Error(`El almacenamiento cambió el nombre de «${name}» al crearlo${created ? ` («${created.name}»)` : ''}.`);
  }

  async exists(): Promise<boolean> {
    try {
      return this.api.exists(this.dir);
    } catch {
      return false;
    }
  }

  async entries(): Promise<readonly DocumentTreeEntry[]> {
    return this.#list().map(({ name, entry }) => ({ name, kind: this.api.isDirectory(entry) ? 'directory' : 'file' }));
  }

  async directory(name: string, create: boolean): Promise<DocumentTree | undefined> {
    return this.#withChild(name, (found) => {
      if (found !== undefined) {
        if (!this.api.isDirectory(found)) throw new Error(`«${name}» no es una carpeta.`);
        return this.#subtree(found);
      }
      if (!create) return undefined;
      const created = this.api.createDirectory(this.dir, name);
      this.#verifyCreated(created, name);
      return this.#subtree(created);
    });
  }

  async readFile(name: string): Promise<Uint8Array | undefined> {
    return this.#withChild(name, (found) => {
      if (found === undefined) return undefined;
      if (this.api.isDirectory(found)) throw new Error(`«${name}» no es un archivo.`);
      return this.api.readBytes(found);
    });
  }

  async writeFile(name: string, bytes: Uint8Array): Promise<void> {
    await this.#withChild(name, (found) => {
      let file: F;
      if (found === undefined) {
        const created = this.api.createFile(this.dir, name);
        this.#verifyCreated(created, name);
        file = created;
      } else if (this.api.isDirectory(found)) {
        throw new Error(`«${name}» no es un archivo.`);
      } else {
        // Con genéricos TypeScript no estrecha la rama negativa del guardián: aquí no es un directorio.
        file = found as F;
      }
      this.api.writeTruncating(file, bytes);
    });
  }

  async removeFile(name: string): Promise<void> {
    await this.#withChild(name, (found) => {
      if (found === undefined) return;
      if (this.api.isDirectory(found)) throw new Error(`«${name}» no es un archivo.`);
      this.api.deleteFile(found);
      this.#listed = this.#listed?.filter((child) => child.entry !== found);
    });
  }
}

const EXTERNAL_STORAGE = 'content://com.android.externalstorage.documents/';

/**
 * Nombre visible de un documento del almacenamiento del dispositivo sin consultar al proveedor: su ID
 * es `volumen:ruta` (ExternalStorageProvider), así que el nombre es el último segmento de la ruta.
 * Con cualquier otro proveedor el ID es opaco y devuelve `undefined` (hay que preguntar el nombre).
 */
export function displayNameFromDocumentUri(uri: string): string | undefined {
  if (!uri.startsWith(EXTERNAL_STORAGE)) return undefined;
  const encoded = uri.split('/document/')[1]?.split('/')[0];
  if (!encoded) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  const colon = id.indexOf(':');
  if (colon < 0) return undefined;
  const name = id.slice(colon + 1).split('/').pop();
  return name ? name : undefined;
}

/** Nombre legible de una URI de árbol SAF (`…/tree/primary%3ADownload%2Fnotes` → `notes`). */
export function folderNameFromTreeUri(uri: string): string {
  const encoded = uri.split('/tree/')[1]?.split('/')[0] ?? uri;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    decoded = encoded;
  }
  const colon = decoded.indexOf(':');
  const path = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  const last = path.split('/').filter(Boolean).pop();
  return last ?? (colon >= 0 ? decoded.slice(0, colon) : decoded);
}
