import { describe, expect, it } from 'vitest';

import { createEmptyWorkspaceNamed } from '../../packages/application/src/index';
import type { WorkspaceStorage } from '../../packages/application/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import type { DocumentTree, DocumentTreeEntry } from '../../packages/storage/src/index';
import { chooseFolderInto, reopenRememberedInto } from '../../apps/noutynotes/src/session/folderSession';
import type { FolderState, RememberedFolder } from '../../apps/noutynotes/src/session/folderSession';

type Folder = { readonly uri: string; readonly name: string };
const A: Folder = { uri: 'content://tree/A', name: 'A' };
const B: Folder = { uri: 'content://tree/B', name: 'B' };
const encode = (text: string) => new TextEncoder().encode(text);

/** Almacén persistente de la carpeta recordada: sobrevive a «reiniciar» la app. */
function persistentMemory(initial: Folder | null): RememberedFolder<Folder> & { value: Folder | null } {
  return {
    value: initial,
    remember(folder) { this.value = folder; },
    forget() { this.value = null; },
  };
}

async function validTree(name: string): Promise<MemoryDocumentTree> {
  const tree = new MemoryDocumentTree();
  const created = await createEmptyWorkspaceNamed(new FolderStorage(new DocumentTreeFolderPort(tree)), name);
  expect(created.ok).toBe(true);
  return tree;
}

function invalidTree(): MemoryDocumentTree {
  const tree = new MemoryDocumentTree();
  tree.put('roto/.nouty/workspace.yaml', encode('schemaVersion: 99\n'));
  return tree;
}

const storageOf = (tree: DocumentTree) => new FolderStorage(new DocumentTreeFolderPort(tree));

/** Árbol cuya lectura falla una vez (fallo transitorio del proveedor) y después funciona. */
class FlakyTree implements DocumentTree {
  constructor(readonly inner: DocumentTree, readonly failures: { left: number }) {}
  exists() { return this.inner.exists(); }
  entries(): Promise<readonly DocumentTreeEntry[]> { return this.inner.entries(); }
  async directory(name: string, create: boolean) {
    const child = await this.inner.directory(name, create);
    return child ? new FlakyTree(child, this.failures) : undefined;
  }
  async readFile(name: string) {
    if (this.failures.left > 0) {
      this.failures.left -= 1;
      throw new Error('Fallo de E/S transitorio');
    }
    return this.inner.readFile(name);
  }
  writeFile(name: string, bytes: Uint8Array) { return this.inner.writeFile(name, bytes); }
  removeFile(name: string) { return this.inner.removeFile(name); }
}

describe('sesión de carpetas Android: elegir y reabrir (cierre de fase 10)', () => {
  it('A/B: con A abierta y recordada, elegir B inválida muestra el error y conserva A en la sesión y para reabrir', async () => {
    const aTree = await validTree('Espacio A');
    const aStorage = storageOf(aTree);
    const memory = persistentMemory(A);
    const state: FolderState<Folder> = { storage: aStorage, mode: 'folder', saved: A };

    const chosen = await chooseFolderInto(state, async () => ({ storage: storageOf(invalidTree()), folder: B }), memory);

    expect(chosen.result.ok).toBe(false);
    expect(chosen.result).toMatchObject({ message: expect.stringMatching(/inválid/) });
    expect(chosen.state.storage).toBe(aStorage);
    expect(chosen.state).toMatchObject({ mode: 'folder', saved: A });
    // Tras reiniciar la app se ofrece A, no B.
    expect(memory.value).toEqual(A);
    const restarted = await reopenRememberedInto(
      { storage: {} as WorkspaceStorage, mode: 'memory', saved: memory.value },
      (folder) => (folder.uri === A.uri ? storageOf(aTree) : storageOf(invalidTree())),
      memory,
    );
    expect(restarted.result.ok).toBe(true);
    const listed = await restarted.state.storage.list();
    expect(listed.ok && listed.value.map((item) => item.name)).toEqual(['Espacio A']);
  });

  it('elegir una carpeta válida la abre y solo entonces la recuerda', async () => {
    const memory = persistentMemory(A);
    const bStorage = storageOf(await validTree('Espacio B'));
    const chosen = await chooseFolderInto({ storage: {} as WorkspaceStorage, mode: 'memory', saved: A }, async () => ({ storage: bStorage, folder: B }), memory);
    expect(chosen.result.ok).toBe(true);
    expect(chosen.state).toMatchObject({ storage: bStorage, mode: 'folder', saved: B });
    expect(memory.value).toEqual(B);
  });

  it('cancelar el selector no cambia la sesión ni la carpeta recordada', async () => {
    const memory = persistentMemory(A);
    const state: FolderState<Folder> = { storage: {} as WorkspaceStorage, mode: 'memory', saved: A };
    const chosen = await chooseFolderInto(state, async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, memory);
    expect(chosen.result).toEqual({ ok: false, message: 'No se seleccionó ninguna carpeta.' });
    expect(chosen.state).toBe(state);
    expect(memory.value).toEqual(A);
  });

  it('reabrir una carpeta accesible con datos inválidos informa del error real y no olvida la URI', async () => {
    const memory = persistentMemory(B);
    const state: FolderState<Folder> = { storage: {} as WorkspaceStorage, mode: 'memory', saved: B };
    const reopened = await reopenRememberedInto(state, () => storageOf(invalidTree()), memory);
    expect(reopened.result.ok).toBe(false);
    expect(reopened.result).toMatchObject({ message: expect.stringMatching(/inválid/) });
    expect(reopened.result).not.toMatchObject({ message: expect.stringMatching(/Ya no hay acceso|permiso/) });
    expect(reopened.state).toBe(state);
    expect(memory.value).toEqual(B);
  });

  it('un fallo de lectura transitorio al reabrir no olvida la URI y el reintento funciona', async () => {
    const memory = persistentMemory(A);
    const tree = new FlakyTree(await validTree('Espacio A'), { left: 1 });
    const state: FolderState<Folder> = { storage: {} as WorkspaceStorage, mode: 'memory', saved: A };
    const first = await reopenRememberedInto(state, () => storageOf(tree), memory);
    expect(first.result.ok).toBe(false);
    expect(first.result).not.toMatchObject({ message: expect.stringMatching(/Ya no hay acceso|permiso/) });
    expect(first.state).toBe(state);
    expect(memory.value).toEqual(A);
    const second = await reopenRememberedInto(first.state, () => storageOf(tree), memory);
    expect(second.result.ok).toBe(true);
    expect(second.state.mode).toBe('folder');
  });

  it('una excepción al abrir la URI recordada tampoco se toma como pérdida de acceso', async () => {
    const memory = persistentMemory(A);
    const state: FolderState<Folder> = { storage: {} as WorkspaceStorage, mode: 'memory', saved: A };
    const reopened = await reopenRememberedInto(state, () => { throw new Error('Proveedor ocupado'); }, memory);
    expect(reopened.result.ok).toBe(false);
    expect(memory.value).toEqual(A);
    expect(reopened.state).toBe(state);
  });

  it('solo olvida la URI cuando se confirma la pérdida de acceso', async () => {
    // El árbol ya no existe o no es accesible: reopen lo indica devolviendo null.
    const lost = persistentMemory(A);
    const gone = await reopenRememberedInto({ storage: {} as WorkspaceStorage, mode: 'memory', saved: A }, () => null, lost);
    expect(gone.result).toMatchObject({ ok: false, message: expect.stringMatching(/Ya no hay acceso a «A»/) });
    expect(gone.state.saved).toBeNull();
    expect(lost.value).toBeNull();

    // Existe al abrir, pero FolderStorage confirma permiso denegado al listar.
    const tree = await validTree('Espacio A');
    tree.state.accessible = false;
    const revoked = persistentMemory(A);
    const denied = await reopenRememberedInto({ storage: {} as WorkspaceStorage, mode: 'memory', saved: A }, () => storageOf(tree), revoked);
    expect(denied.result).toMatchObject({ ok: false, message: expect.stringMatching(/Ya no hay acceso a «A»/) });
    expect(revoked.value).toBeNull();
  });
});
