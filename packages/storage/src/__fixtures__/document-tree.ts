// Árbol de documentos en memoria para pruebas: imita un árbol SAF con fallos y acceso revocable.
import type { DocumentTree, DocumentTreeEntry } from '../document-tree';

type Node = Map<string, Node | Uint8Array>;

export class MemoryDocumentTree implements DocumentTree {
  /** Rutas completas (desde la raíz del árbol) cuya escritura falla. */
  static failWrites = new Set<string>();

  constructor(
    readonly node: Node = new Map(),
    readonly state: { accessible: boolean } = { accessible: true },
    readonly prefix = '',
  ) {}

  #guard(): void {
    if (!this.state.accessible) throw Object.assign(new Error('Acceso revocado'), { name: 'SecurityException' });
  }

  async exists(): Promise<boolean> {
    return this.state.accessible;
  }

  async entries(): Promise<readonly DocumentTreeEntry[]> {
    this.#guard();
    return [...this.node].map(([name, value]) => ({ name, kind: value instanceof Map ? 'directory' : 'file' }));
  }

  async directory(name: string, create: boolean): Promise<DocumentTree | undefined> {
    this.#guard();
    const found = this.node.get(name);
    if (found instanceof Map) return new MemoryDocumentTree(found, this.state, `${this.prefix}${name}/`);
    if (found !== undefined) throw new Error(`${name} es un archivo`);
    if (!create) return undefined;
    const child: Node = new Map();
    this.node.set(name, child);
    return new MemoryDocumentTree(child, this.state, `${this.prefix}${name}/`);
  }

  async readFile(name: string): Promise<Uint8Array | undefined> {
    this.#guard();
    const found = this.node.get(name);
    if (found instanceof Map) throw new Error(`${name} es un directorio`);
    return found?.slice();
  }

  async writeFile(name: string, bytes: Uint8Array): Promise<void> {
    this.#guard();
    if (MemoryDocumentTree.failWrites.has(`${this.prefix}${name}`)) throw new Error(`Fallo inyectado en ${this.prefix}${name}`);
    if (this.node.get(name) instanceof Map) throw new Error(`${name} es un directorio`);
    this.node.set(name, bytes.slice());
  }

  async removeFile(name: string): Promise<void> {
    this.#guard();
    if (this.node.get(name) instanceof Map) throw new Error(`${name} es un directorio`);
    this.node.delete(name);
  }

  /** Todos los archivos con su ruta relativa, para comparar bytes. */
  snapshot(): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    const walk = (node: Node, prefix: string) => {
      for (const [name, value] of node) {
        if (value instanceof Map) walk(value, `${prefix}${name}/`);
        else out[`${prefix}${name}`] = value.slice();
      }
    };
    walk(this.node, '');
    return out;
  }

  /** Coloca un archivo en una ruta con `/`, creando directorios (para preparar fixtures). */
  put(path: string, bytes: Uint8Array): void {
    const parts = path.split('/');
    const name = parts.pop() as string;
    let node = this.node;
    for (const part of parts) {
      let next = node.get(part);
      if (!(next instanceof Map)) {
        next = new Map();
        node.set(part, next);
      }
      node = next;
    }
    node.set(name, bytes.slice());
  }
}
