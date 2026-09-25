import { afterEach, describe, expect, it } from 'vitest';

import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { MemoryDocumentTree } from './__fixtures__/document-tree';
import { DocumentTreeDirectory, DocumentTreeFolderPort } from './document-tree';
import { FolderStorage } from './folder-storage';

const id = (value: string) => value as WorkspaceId;
const encode = (value: string) => new TextEncoder().encode(value);
const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
const workspace = (workspaceId = 'demo'): Workspace => ({ ...validWorkspace(), id: id(workspaceId) });
const code = (result: { ok: boolean; issues?: readonly { code: string }[] }) => (result.ok ? 'ok' : result.issues?.[0]?.code);

afterEach(() => MemoryDocumentTree.failWrites.clear());

describe('DocumentTreeDirectory: rutas de un paquete sobre un árbol de documentos (fase 10)', () => {
  it('escribe creando subdirectorios, lista recursivamente, lee, sobrescribe y borra', async () => {
    const tree = new MemoryDocumentTree();
    const folder = new DocumentTreeDirectory(tree);
    await folder.write('.nouty/workspace.yaml', encode('uno largo'));
    await folder.write('cards/a.md', encode('a'));
    await folder.write('assets/img/x.png', binary);
    expect([...(await folder.listPaths())].sort()).toEqual(['.nouty/workspace.yaml', 'assets/img/x.png', 'cards/a.md']);
    await folder.write('.nouty/workspace.yaml', encode('dos'));
    expect(new TextDecoder().decode(await folder.read('.nouty/workspace.yaml'))).toBe('dos');
    expect(await folder.read('cards/nada.md')).toBeUndefined();
    expect(await folder.read('otra/nada.md')).toBeUndefined();
    await folder.remove('cards/a.md');
    await folder.remove('cards/a.md');
    await folder.remove('sin/directorio.md');
    expect([...(await folder.listPaths())].sort()).toEqual(['.nouty/workspace.yaml', 'assets/img/x.png']);
  });

  it.each(['../fuera.md', '/abs.md', 'a//b.md', 'a\\b.md', '.', 'cards/..'])('rechaza la ruta %j antes de tocar el árbol', async (path) => {
    const tree = new MemoryDocumentTree();
    const folder = new DocumentTreeDirectory(tree);
    await expect(folder.write(path, encode('x'))).rejects.toThrow(/Ruta/);
    await expect(folder.read(path)).rejects.toThrow(/Ruta/);
    await expect(folder.remove(path)).rejects.toThrow(/Ruta/);
    expect(tree.snapshot()).toEqual({});
  });
});

describe('FolderStorage sobre DocumentTreeFolderPort (Android, fase 10)', () => {
  it('crea en un subdirectorio, guarda y otra sesión reabre el mismo workspace', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    expect(code(await storage.create(workspace()))).toBe('ok');
    expect(Object.keys(tree.snapshot())).toContain('demo/.nouty/workspace.yaml');
    const changed = { ...workspace(), metadata: { name: 'Cambio' } };
    expect(code(await storage.open(id('demo')))).toBe('ok');
    expect(code(await storage.save(changed))).toBe('ok');
    // Cerrar y reabrir la app: puerto y almacenamiento nuevos sobre el mismo árbol.
    expect(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id('demo'))).toEqual({ ok: true, value: changed });
  });

  it('abre una carpeta elegida que ya es un paquete v1 y no crea otros dentro', async () => {
    const source = new MemoryDocumentTree();
    const web = new FolderStorage(new DocumentTreeFolderPort(source));
    await web.create(workspace());
    const packageOnly = new MemoryDocumentTree();
    for (const [path, bytes] of Object.entries(source.snapshot())) packageOnly.put(path.replace(/^demo\//, ''), bytes);
    const storage = new FolderStorage(new DocumentTreeFolderPort(packageOnly));
    expect(await storage.list()).toEqual({ ok: true, value: [{ id: 'demo', name: 'Demo' }] });
    expect(code(await storage.create(workspace('otro')))).toBe('io-failure');
    expect(Object.keys(packageOnly.snapshot()).some((path) => path.startsWith('otro/'))).toBe(false);
  });

  it('con el acceso revocado devuelve permission-denied y no escribe nada', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    await storage.create(workspace());
    const before = tree.snapshot();
    tree.state.accessible = false;
    expect(code(await storage.list())).toBe('permission-denied');
    expect(code(await storage.save({ ...workspace(), metadata: { name: 'X' } }))).toBe('permission-denied');
    tree.state.accessible = true;
    expect(tree.snapshot()).toEqual(before);
  });

  it('un fallo a mitad de guardado se recupera y deja el paquete anterior legible', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    await storage.create(workspace());
    await storage.open(id('demo'));
    MemoryDocumentTree.failWrites.add('demo/.nouty/workspace.yaml');
    const failed = await storage.save({ ...workspace(), metadata: { name: 'A medias' } });
    expect(code(failed)).toBe('io-failure');
    // La restauración inmediata también falla (el fallo sigue activo): se conserva el marcador.
    expect(Object.keys(tree.snapshot())).toContain('demo/.nouty-transaction.json');
    MemoryDocumentTree.failWrites.clear();
    // Al cerrar y reabrir, la lectura recupera el estado anterior y retira el marcador.
    expect(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id('demo'))).toEqual({ ok: true, value: workspace() });
    expect(Object.keys(tree.snapshot())).not.toContain('demo/.nouty-transaction.json');
  });

  it('un cambio externo bloquea el guardado y conserva los bytes externos', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    await storage.create(workspace());
    await storage.open(id('demo'));
    const manifest = 'demo/.nouty/workspace.yaml';
    const external = new TextDecoder().decode(tree.snapshot()[manifest]).replace('name: Demo', 'name: Externo');
    tree.put(manifest, encode(external));
    expect(code(await storage.save({ ...workspace(), metadata: { name: 'Mío' } }))).toBe('external-change');
    expect(new TextDecoder().decode(tree.snapshot()[manifest])).toBe(external);
  });

  it('los assets binarios no se leen ni se modifican al guardar', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    await storage.create(workspace());
    tree.put('demo/assets/images/a.png', binary);
    await storage.open(id('demo'));
    expect(code(await storage.save({ ...workspace(), metadata: { name: 'Otro nombre' } }))).toBe('ok');
    expect(tree.snapshot()['demo/assets/images/a.png']).toEqual(binary);
  });
});
