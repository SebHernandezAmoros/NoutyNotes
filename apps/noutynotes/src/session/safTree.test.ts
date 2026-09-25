import { describe, expect, it } from 'vitest';

import { SafTree, displayNameFromDocumentUri, folderNameFromTreeUri } from './safTree';
import type { SafApi } from './safTree';

/** Nodo SAF simulado: URIs opacas, nombres visibles aparte y fallos típicos del proveedor. */
interface FakeDir { kind: 'dir'; uri: string; children: (FakeDir | FakeFile)[]; names: string[] }
interface FakeFile { kind: 'file'; uri: string; bytes: Uint8Array; gone?: boolean }

function fakeApi(options: { renameOnCreate?: boolean; accessible?: boolean; dropName?: boolean; slashOnList?: boolean } = {}) {
  let counter = 0;
  const calls: string[] = [];
  const api: SafApi<FakeDir, FakeFile> = {
    exists: () => options.accessible !== false,
    children(dir) {
      if (options.accessible === false) throw new Error('SecurityException');
      const entries = options.slashOnList
        ? dir.children.map((child) => (child.kind === 'dir' ? { ...child, uri: `${child.uri}/` } : child))
        : [...dir.children];
      return { names: options.dropName ? dir.names.slice(1) : [...dir.names], entries };
    },
    isDirectory: (entry): entry is FakeDir => entry.kind === 'dir',
    // Como el módulo nativo: al listar, las URIs de directorio llevan «/» final; al crearlas, no.
    uriOf: (entry) => entry.uri,
    createDirectory(dir, name) {
      const created: FakeDir = { kind: 'dir', uri: `content://doc/${(counter += 1)}`, children: [], names: [] };
      dir.children.push(created);
      dir.names.push(options.renameOnCreate ? `${name} (1)` : name);
      calls.push(`mkdir ${name}`);
      return created;
    },
    createFile(dir, name) {
      const created: FakeFile = { kind: 'file', uri: `content://doc/${(counter += 1)}`, bytes: new Uint8Array() };
      dir.children.push(created);
      dir.names.push(options.renameOnCreate ? `${name} (1)` : name);
      calls.push(`create ${name}`);
      return created;
    },
    readBytes: async (file) => {
      if (file.gone) throw new Error('FileNotFoundException');
      return file.bytes.slice();
    },
    writeTruncating(file, bytes) {
      if (file.gone) throw new Error('FileNotFoundException');
      file.bytes = bytes.slice();
      calls.push(`truncate ${file.uri}`);
    },
    deleteFile(file) {
      calls.push(`delete ${file.uri}`);
    },
  };
  return { api, calls };
}

const root = (): FakeDir => ({ kind: 'dir', uri: 'content://tree/root', children: [], names: [] });
const encode = (value: string) => new TextEncoder().encode(value);

describe('árbol SAF sobre expo-file-system (fase 10)', () => {
  it('empareja nombres visibles con entradas y crea, lee, sobrescribe truncando y borra', async () => {
    const { api, calls } = fakeApi();
    const dir = root();
    const tree = new SafTree(api, dir);
    const nouty = await tree.directory('.nouty', true);
    await nouty?.writeFile('workspace.yaml', encode('contenido largo'));
    await nouty?.writeFile('workspace.yaml', encode('corto'));
    expect(new TextDecoder().decode(await nouty?.readFile('workspace.yaml'))).toBe('corto');
    expect(await tree.entries()).toEqual([{ name: '.nouty', kind: 'directory' }]);
    expect(await nouty?.entries()).toEqual([{ name: 'workspace.yaml', kind: 'file' }]);
    // Crear una vez; las escrituras siguientes sustituyen el contenido con el modo truncante.
    expect(calls.filter((call) => call.startsWith('create'))).toEqual(['create workspace.yaml']);
    expect(calls.filter((call) => call.startsWith('truncate'))).toHaveLength(2);
    expect(await nouty?.readFile('otro.yaml')).toBeUndefined();
    expect(await tree.directory('nada', false)).toBeUndefined();
    await nouty?.removeFile('otro.yaml');
    await nouty?.removeFile('workspace.yaml');
    expect(calls.at(-1)).toMatch(/^delete content:\/\/doc\//);
  });

  it('si el proveedor cambia el nombre al crear (por ejemplo «x (1)»), borra lo creado y falla', async () => {
    const { api, calls } = fakeApi({ renameOnCreate: true });
    const tree = new SafTree(api, root());
    await expect(tree.writeFile('workspace.yaml', encode('x'))).rejects.toThrow(/cambió el nombre/);
    expect(calls).toContain('create workspace.yaml');
    expect(calls.some((call) => call.startsWith('delete'))).toBe(true);
    await expect(tree.directory('.nouty', true)).rejects.toThrow(/cambió el nombre/);
  });

  it('si nombres y entradas no cuadran (cambio concurrente), la lectura falla sin escribir', async () => {
    const { api, calls } = fakeApi({ dropName: true });
    const dir = root();
    dir.children.push({ kind: 'file', uri: 'content://doc/a', bytes: encode('a') });
    dir.names.push('a.md');
    const tree = new SafTree(api, dir);
    await expect(tree.entries()).rejects.toThrow(/cambió mientras se leía/);
    await expect(tree.writeFile('a.md', encode('b'))).rejects.toThrow(/cambió mientras se leía/);
    expect(calls).toEqual([]);
  });

  it('un archivo y un directorio con el mismo nombre no se confunden', async () => {
    const { api } = fakeApi();
    const tree = new SafTree(api, root());
    await tree.writeFile('cards', encode('x'));
    await expect(tree.directory('cards', true)).rejects.toThrow(/no es una carpeta/);
    await tree.directory('boards', true);
    await expect(tree.readFile('boards')).rejects.toThrow(/no es un archivo/);
    await expect(tree.writeFile('boards', encode('x'))).rejects.toThrow(/no es un archivo/);
  });

  it('refleja el acceso: sin permiso, exists es falso y las operaciones fallan', async () => {
    const { api } = fakeApi({ accessible: false });
    const tree = new SafTree(api, root());
    expect(await tree.exists()).toBe(false);
    await expect(tree.entries()).rejects.toThrow();
  });

  it('reconoce un directorio recién creado aunque el listado añada «/» a su URI', async () => {
    const { api } = fakeApi({ slashOnList: true });
    const tree = new SafTree(api, root());
    await expect(tree.directory('.nouty', true)).resolves.toBeInstanceOf(SafTree);
  });

  it('reutiliza el listado, pero encuentra lo que aparece fuera y no usa entradas borradas fuera', async () => {
    const { api, calls } = fakeApi();
    const dir = root();
    const tree = new SafTree(api, dir);
    await tree.writeFile('a.md', encode('a'));
    expect(await tree.entries()).toEqual([{ name: 'a.md', kind: 'file' }]);

    // Otra app crea b.md: no está en el listado guardado, así que se vuelve a listar.
    dir.children.push({ kind: 'file', uri: 'content://doc/externo', bytes: encode('b') });
    dir.names.push('b.md');
    expect(new TextDecoder().decode(await tree.readFile('b.md'))).toBe('b');

    // Otra app borra a.md: la entrada guardada falla y se decide con un listado nuevo.
    const index = dir.names.indexOf('a.md');
    (dir.children[index] as FakeFile).gone = true;
    dir.children.splice(index, 1);
    dir.names.splice(index, 1);
    expect(await tree.readFile('a.md')).toBeUndefined();
    await tree.writeFile('a.md', encode('otra vez'));
    expect(calls.filter((call) => call === 'create a.md')).toHaveLength(2);
    expect(new TextDecoder().decode(await tree.readFile('a.md'))).toBe('otra vez');
  });

  it.each([
    ['content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes', 'notes'],
    ['content://com.android.externalstorage.documents/tree/primary%3Anotes', 'notes'],
    ['content://com.android.externalstorage.documents/tree/primary%3A', 'primary'],
    ['content://otro.proveedor/tree/abc123', 'abc123'],
  ])('nombre visible de %s → %s', (uri, name) => {
    expect(folderNameFromTreeUri(uri)).toBe(name);
  });

  const doc = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes/document/';
  it.each([
    [`${doc}primary%3ADownload%2Fnotes%2Fdemo%2Fcards%2Fidea-a.md`, 'idea-a.md'],
    [`${doc}primary%3ADownload%2Fnotes%2Fdemo%2F.nouty/`, '.nouty'],
    [`${doc}primary%3ADownload%2Fnotes%2Fdemo%2Fassets%2Fnotes%2Flista%20de%20ideas.txt`, 'lista de ideas.txt'],
    [`${doc}primary%3ADownload%2Fnotes%2Fcaf%C3%A9.md`, 'café.md'],
    [`${doc}primary%3Anotas.md`, 'notas.md'],
  ])('el almacenamiento del dispositivo deriva el nombre visible del ID: %s → %s', (uri, name) => {
    expect(displayNameFromDocumentUri(uri)).toBe(name);
  });

  it.each([
    'content://com.google.android.apps.docs.storage/tree/abc/document/opaco123',
    'content://com.android.providers.downloads.documents/tree/downloads/document/msf%3A42',
    'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fnotes',
    'content://com.android.externalstorage.documents/tree/primary%3Ax/document/primary%3A',
    'content://com.android.externalstorage.documents/tree/primary%3Ax/document/%E0%A4%A',
  ])('con otros proveedores o IDs sin ruta no adivina el nombre: %s', (uri) => {
    expect(displayNameFromDocumentUri(uri)).toBeUndefined();
  });
});
