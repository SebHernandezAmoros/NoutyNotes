import type { FolderPort, WorkspaceDirectory } from './folder-storage';

/**
 * Directorio de documentos mínimo y sin plataforma (ADR 0012): lo implementan el árbol SAF de
 * Android en la app y árboles en memoria en las pruebas. Solo conoce nombres de un nivel.
 */
export interface DocumentTreeEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface DocumentTree {
  /** El árbol sigue existiendo y la app puede acceder a él (permiso vigente). */
  exists(): Promise<boolean>;
  entries(): Promise<readonly DocumentTreeEntry[]>;
  /** Subdirectorio con ese nombre; con `create`, lo crea si no existe. */
  directory(name: string, create: boolean): Promise<DocumentTree | undefined>;
  readFile(name: string): Promise<Uint8Array | undefined>;
  /** Crea el archivo o sustituye todo su contenido (nunca añade al final). */
  writeFile(name: string, bytes: Uint8Array): Promise<void>;
  /** Borra el archivo; si no existe, no hace nada. */
  removeFile(name: string): Promise<void>;
}

const MANIFEST = '.nouty/workspace.yaml';

/** Segmentos de una ruta relativa con `/`; rechaza lo que podría salir del árbol. */
function segmentsOf(path: string): string[] {
  const segments = path.split('/');
  if (path === '' || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))) {
    throw new Error(`Ruta no admitida en el árbol de documentos: ${JSON.stringify(path)}`);
  }
  return segments;
}

/** Paquete de workspace sobre un árbol de documentos: rutas con `/` resueltas nivel a nivel. */
export class DocumentTreeDirectory implements WorkspaceDirectory {
  constructor(readonly tree: DocumentTree) {}

  async #parent(path: string, create: boolean): Promise<[DocumentTree | undefined, string]> {
    const segments = segmentsOf(path);
    const name = segments.pop() as string;
    let current: DocumentTree | undefined = this.tree;
    for (const segment of segments) {
      current = await current.directory(segment, create);
      if (!current) return [undefined, name];
    }
    return [current, name];
  }

  async listPaths(): Promise<readonly string[]> {
    const paths: string[] = [];
    const walk = async (tree: DocumentTree, prefix: string): Promise<void> => {
      for (const entry of await tree.entries()) {
        if (entry.kind === 'directory') {
          const child = await tree.directory(entry.name, false);
          if (child) await walk(child, `${prefix}${entry.name}/`);
        } else {
          paths.push(`${prefix}${entry.name}`);
        }
      }
    };
    await walk(this.tree, '');
    return paths;
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const [parent, name] = await this.#parent(path, false);
    return parent ? parent.readFile(name) : undefined;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const [parent, name] = await this.#parent(path, true);
    if (!parent) throw new Error(`No se pudo crear la carpeta de ${path}.`);
    await parent.writeFile(name, bytes);
  }

  async remove(path: string): Promise<void> {
    const [parent, name] = await this.#parent(path, false);
    if (parent) await parent.removeFile(name);
  }
}

/**
 * Puerto de carpetas sobre un árbol elegido por el usuario (ADR 0012). Igual que en web (ADR 0010):
 * si el árbol es un paquete v1 se usa directamente; si no, cada subdirectorio es un candidato.
 */
export class DocumentTreeFolderPort implements FolderPort {
  constructor(readonly root: DocumentTree) {}

  async #isPackage(): Promise<boolean> {
    return (await new DocumentTreeDirectory(this.root).read(MANIFEST)) !== undefined;
  }

  async permission(): Promise<boolean> {
    try {
      return await this.root.exists();
    } catch {
      return false;
    }
  }

  async folders(): Promise<readonly { key: string; folder: WorkspaceDirectory }[]> {
    if (await this.#isPackage()) return [{ key: '.', folder: new DocumentTreeDirectory(this.root) }];
    const found: { key: string; folder: WorkspaceDirectory }[] = [];
    for (const entry of await this.root.entries()) {
      if (entry.kind !== 'directory') continue;
      const tree = await this.root.directory(entry.name, false);
      if (tree) found.push({ key: entry.name, folder: new DocumentTreeDirectory(tree) });
    }
    return found;
  }

  async createFolder(key: string): Promise<WorkspaceDirectory> {
    if (await this.#isPackage()) throw new Error('La carpeta seleccionada es un workspace. Elige su carpeta padre para crear otro.');
    const [name] = segmentsOf(key);
    const tree = await this.root.directory(name as string, true);
    if (!tree) throw new Error(`No se pudo crear la carpeta ${key}.`);
    return new DocumentTreeDirectory(tree);
  }
}
