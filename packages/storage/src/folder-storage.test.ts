import { describe, expect, it, vi } from 'vitest';

import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';
import { FolderStorage } from './folder-storage';
import type { FolderPort, WorkspaceDirectory } from './folder-storage';
import { htmlWorkspace } from './__fixtures__/html-workspace';
import { imagePolicyWorkspace } from './__fixtures__/image-policy-workspace';

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
  it('F5: diferir recuperación en list/open no escribe ni retira un journal; la apertura explícita conserva recuperación', async () => {
    const port = new FakePort();
    const source = workspace();
    expect((await new FolderStorage(port).create(source)).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({ version: 1, committed: true, old: {} })));
    const before = new Map(folder.files);
    const writes = vi.spyOn(folder, 'write');
    const removes = vi.spyOn(folder, 'remove');
    const automatic = new FolderStorage(port, { readRecovery: 'defer' });
    const listed = await automatic.list();
    const opened = await automatic.open(source.id);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(listed.ok).toBe(false);
    expect(opened.ok).toBe(false);
    expect(folder.files).toEqual(before);
    expect((await new FolderStorage(port).open(source.id)).ok).toBe(true);
    expect(folder.files.has('.nouty-transaction.json')).toBe(false);
  });

  it.each(['future', 'unknown-intent'])('N1 reabre v2 y rechaza %s sin escrituras ni borrados (sin journal previo)', async (kind) => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    const source = imagePolicyWorkspace();
    expect((await storage.create(source)).ok).toBe(true);
    expect((await storage.save(source)).ok).toBe(true);
    expect(await new FolderStorage(port).open(source.id)).toEqual({ ok: true, value: source });
    const folder = port.directories.get('demo')!;
    const body = new TextDecoder().decode(folder.files.get('cards/idea-a.md'));
    folder.files.set('cards/idea-a.md', encode(kind === 'future' ? body.replace('contentVersion: 2', 'contentVersion: 3')
      : body.replace('accessibility-intent="pending"', 'accessibility-intent="unknown"')));
    expect(folder.files.has('.nouty-transaction.json')).toBe(false);
    const before = new Map([...folder.files].map(([path, bytes]) => [path, bytes.slice()]));
    const writes = vi.spyOn(folder, 'write');
    const removes = vi.spyOn(folder, 'remove');
    expect((await new FolderStorage(port).open(source.id)).ok).toBe(false);
    expect((await storage.save(source)).ok).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(folder.files).toEqual(before);
  });

  it('escribe y reabre HTML v1 mediante el mismo adaptador de carpeta', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    const workspace = htmlWorkspace();
    expect((await storage.create(workspace)).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    expect(new TextDecoder().decode(folder.files.get('cards/idea-a.md'))).toContain('<h2><strong>Documento HTML</strong></h2>');
    expect(await new FolderStorage(port).open(id('demo'))).toEqual({ ok: true, value: workspace });
  });

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

  it('valida todas las entradas del marcador antes de restaurar el primer archivo', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    const original = folder.files.get('.nouty/workspace.yaml')!.slice();
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({
      version: 1, committed: false, old: { '.nouty/workspace.yaml': 'texto anterior', '../secreto': 'no autorizado' },
    })));
    const marker = folder.files.get('.nouty-transaction.json')!.slice();
    const write = vi.spyOn(folder, 'write');
    const remove = vi.spyOn(folder, 'remove');
    expect(code(await new FolderStorage(port).open(id('demo')))).toBe('invalid-stored-data');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(folder.files.get('.nouty/workspace.yaml')).toEqual(original);
    expect(folder.files.get('.nouty-transaction.json')).toEqual(marker);
  });

  it('conserva un marcador con rutas duplicadas o contenido inválido aunque figure como confirmado', async () => {
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    for (const marker of [
      '{"version":1,"committed":false,"old":{".nouty/workspace.yaml":null,".nouty/workspace.yaml":"duplicada"}}',
      JSON.stringify({ version: 1, committed: true, old: { '../fuera': 'contenido' } }),
    ]) {
      folder.files.set('.nouty-transaction.json', encode(marker));
      const write = vi.spyOn(folder, 'write');
      const remove = vi.spyOn(folder, 'remove');
      expect(code(await new FolderStorage(port).open(id('demo')))).toBe('invalid-stored-data');
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(folder.files.get('.nouty-transaction.json')).toEqual(encode(marker));
      write.mockRestore(); remove.mockRestore();
    }
  });

  it('acepta un marcador v1 válido con espacios sin confundir formato con rutas duplicadas', async () => {
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({ version: 1, committed: true, old: {} }, null, 2)));
    expect((await new FolderStorage(port).open(id('demo'))).ok).toBe(true);
    expect(folder.files.has('.nouty-transaction.json')).toBe(false);
  });

  it('si falla la E/S durante el rollback conserva el marcador y no afirma que nada cambió', async () => {
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({ version: 1, committed: false,
      old: { '.nouty/layout.yaml': 'anterior', '.nouty/workspace.yaml': 'no se alcanzará' } })));
    folder.failOnWrite = '.nouty/workspace.yaml';
    const result = await new FolderStorage(port).open(id('demo'));
    expect(code(result)).toBe('io-failure');
    expect(result.ok === false && result.issues[0]?.message).not.toContain('No se modificó nada');
    expect(new TextDecoder().decode(folder.files.get('.nouty/layout.yaml'))).toBe('anterior');
    expect(folder.files.has('.nouty-transaction.json')).toBe(true);
  });
});

describe('FolderStorage: diagnóstico de apertura fallida (ADR 0010, incidente de integridad, Paquete 1)', () => {
  it('recuperación pendiente se distingue de datos inválidos', async () => {
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo')!;
    folder.files.set('.nouty-transaction.json', encode(JSON.stringify({ version: 1, committed: true, old: {} })));
    const inspection = new FolderStorage(port, { readRecovery: 'defer' });
    expect(code(await inspection.list())).toBe('recovery-pending');
    expect(code(await inspection.open(id('demo')))).toBe('recovery-pending');
  });

  it('un marcador de recuperación truncado se distingue como tal, sin filtrar su contenido', async () => {
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    // JSON a medio escribir: el escenario real de una sincronización interrumpida entre computadoras.
    folder.files.set('.nouty-transaction.json', encode('{"version":1,"committed":fal'));
    const result = await new FolderStorage(port).open(id('demo'));
    expect(code(result)).toBe('invalid-stored-data');
    const message = !result.ok ? result.issues[0]?.message ?? '' : '';
    expect(message).toContain('marcador de recuperación');
    expect(message).not.toContain('committed');
    expect(message).not.toContain('version');
  });

  it('un archivo que desaparece durante la lectura se identifica por su ruta, no por un fallo genérico', async () => {
    class VanishingDirectory extends FakeDirectory {
      vanish: string | null = null;
      override async read(path: string): Promise<Uint8Array | undefined> {
        if (path === this.vanish) return undefined;
        return super.read(path);
      }
    }
    const port = new FakePort();
    expect((await new FolderStorage(port).create(workspace())).ok).toBe(true);
    const plain = port.directories.get('demo') as FakeDirectory;
    const vanishing = new VanishingDirectory();
    for (const [path, bytes] of plain.files) vanishing.files.set(path, bytes);
    port.directories.set('demo', vanishing);
    vanishing.vanish = 'cards/idea-a.md';
    const result = await new FolderStorage(port).open(id('demo'));
    expect(code(result)).toBe('invalid-stored-data');
    expect(!result.ok ? result.issues[0]?.path : null).toBe('cards/idea-a.md');
  });

  it('una incidencia de validación conserva el archivo y la ubicación exactos (p. ej. una versión de esquema no reconocida)', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    const source = imagePolicyWorkspace();
    expect((await storage.create(source)).ok).toBe(true);
    expect((await storage.save(source)).ok).toBe(true);
    const folder = port.directories.get('demo') as FakeDirectory;
    const body = new TextDecoder().decode(folder.files.get('cards/idea-a.md'));
    folder.files.set('cards/idea-a.md', encode(body.replace('contentVersion: 2', 'contentVersion: 3')));
    const result = await new FolderStorage(port).open(id('demo'));
    expect(code(result)).toBe('invalid-stored-data');
    const details = !result.ok ? result.issues[0]?.details ?? [] : [];
    expect(details.some((found) => found.path.startsWith('cards/idea-a.md'))).toBe(true);
  });

  it('un ID de workspace repetido entre dos carpetas se distingue como estructural', async () => {
    const port = new FakePort();
    const storage = new FolderStorage(port);
    expect((await storage.create(workspace())).ok).toBe(true);
    const original = port.directories.get('demo') as FakeDirectory;
    const copy = await port.createFolder('demo-copia') as FakeDirectory;
    for (const [path, bytes] of original.files) copy.files.set(path, bytes);
    expect(code(await new FolderStorage(port).list())).toBe('duplicate-workspace-id');
    expect(code(await new FolderStorage(port).open(id('demo')))).toBe('duplicate-workspace-id');
  });

  it('un error inesperado del puerto se informa como fallo de lectura, nunca como datos inválidos sin demostrarlo', async () => {
    class ThrowingPort extends FakePort {
      override async folders(): Promise<readonly { key: string; folder: WorkspaceDirectory }[]> {
        throw new Error('Fallo de red simulado, ajeno a los datos del proyecto.');
      }
    }
    const port = new ThrowingPort();
    expect(code(await new FolderStorage(port).list())).toBe('io-failure');
    expect(code(await new FolderStorage(port).open(id('demo')))).toBe('io-failure');
  });
});
