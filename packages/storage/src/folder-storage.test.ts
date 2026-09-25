import { describe, expect, it } from 'vitest';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';
import { FolderStorage } from './folder-storage';
import type { FolderPort, WorkspaceDirectory } from './folder-storage';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const id = (value: string) => value as WorkspaceId;

class FakeDirectory implements WorkspaceDirectory {
  readonly files = new Map<string, Uint8Array>();
  failOnWrite: string | null = null;
  async listPaths(): Promise<readonly string[]> { return [...this.files.keys()]; }
  async read(path: string): Promise<Uint8Array | undefined> { return this.files.get(path)?.slice(); }
  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (path === this.failOnWrite) throw new Error('fallo inyectado');
    this.files.set(path, bytes.slice());
  }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

class FakePort implements FolderPort {
  readonly directories = new Map<string, FakeDirectory>();
  allowed = true;
  async permission(): Promise<boolean> { return this.allowed; }
  async folders(): Promise<readonly { key: string; folder: WorkspaceDirectory }[]> {
    return [...this.directories].map(([key, folder]) => ({ key, folder }));
  }
  async createFolder(key: string): Promise<WorkspaceDirectory> {
    const folder = new FakeDirectory();
    this.directories.set(key, folder);
    return folder;
  }
}

const workspace = (workspaceId = 'demo'): Workspace => ({ ...validWorkspace(), id: id(workspaceId) });
const code = (result: { ok: boolean; issues?: readonly { code: string }[] }): string | undefined =>
  result.ok ? undefined : result.issues?.[0]?.code;

describe('FolderStorage: paquetes v1 y cambios externos', () => {
  it('crea, abre y guarda un workspace en archivos; otra instancia lo reabre', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    expect((await storage.open(id('demo'))).ok).toBe(true);
    const folder = port.directories.get('demo');
    expect(folder?.files.has('.nouty/workspace.yaml')).toBe(true);
    const changed = { ...workspace(), metadata: { name: 'Cambio' } };
    expect((await storage.save(changed)).ok).toBe(true);
    expect(await new FolderStorage(port).open(id('demo'))).toEqual({ ok: true, value: changed });
  });

  it('detecta un cambio externo y no sobrescribe los bytes', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    const previous = folder.files.get('.nouty/workspace.yaml') as Uint8Array;
    folder.files.set('.nouty/workspace.yaml', encode(new TextDecoder().decode(previous).replace('name: Demo', 'name: Externo')));
    const before = folder.files.get('.nouty/workspace.yaml')?.slice();
    expect(code(await storage.save({ ...workspace(), metadata: { name: 'Local' } }))).toBe('external-change');
    expect(folder.files.get('.nouty/workspace.yaml')).toEqual(before);
  });

  it('restaura una escritura parcial y conserva la copia de recuperación si falla la restauración', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    const before = new TextDecoder().decode(folder.files.get('.nouty/workspace.yaml'));
    folder.failOnWrite = '.nouty/workspace.yaml';
    expect(code(await storage.save({ ...workspace(), metadata: { name: 'Cambio' } }))).toBe('io-failure');
    expect(new TextDecoder().decode(folder.files.get('.nouty/workspace.yaml'))).toBe(before);
    expect(folder.files.has('.nouty-transaction.json')).toBe(true);
    folder.failOnWrite = null;
    expect((await new FolderStorage(port).open(id('demo'))).ok).toBe(true);
    expect(folder.files.has('.nouty-transaction.json')).toBe(false);
  });

  it('permiso denegado no crea archivos ni altera el paquete', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    port.allowed = false;
    expect(code(await storage.create(workspace()))).toBe('permission-denied');
    expect(port.directories.size).toBe(0);
  });

  it('conserva un asset binario byte a byte al guardar documentos', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    const bytes = new Uint8Array([0, 255, 120, 8]);
    folder.files.set('assets/foto.png', bytes.slice());
    expect((await storage.save({ ...workspace(), metadata: { name: 'Cambio' } })).ok).toBe(true);
    expect(folder.files.get('assets/foto.png')).toEqual(bytes);
  });

  it('un marcador externo no puede restaurar archivos fuera de los documentos gestionados', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({ version: 1, committed: false, old: { '../secreto': 'ataque' } })));
    expect(code(await new FolderStorage(port).open(id('demo')))).toBe('invalid-stored-data');
    expect(folder.files.has('../secreto')).toBe(false);
    expect(folder.files.has('.nouty-transaction.json')).toBe(true);
  });
});
