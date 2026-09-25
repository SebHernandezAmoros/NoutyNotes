import { FolderStorage } from '@noutynotes/storage';
import type { FolderPort, WorkspaceDirectory } from '@noutynotes/storage';
import { Platform } from 'react-native';

type Permission = 'granted' | 'prompt' | 'denied';
interface BrowserFile {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
interface BrowserDirectory {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFile>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, BrowserDirectory | { kind: 'file' }]>;
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>;
}

const parts = (path: string): string[] => path.split('/');

class BrowserWorkspaceDirectory implements WorkspaceDirectory {
  constructor(readonly handle: BrowserDirectory) {}

  async listPaths(): Promise<readonly string[]> {
    const paths: string[] = [];
    const walk = async (directory: BrowserDirectory, prefix: string): Promise<void> => {
      for await (const [name, entry] of directory.entries()) {
        const path = `${prefix}${name}`;
        if (entry.kind === 'directory') await walk(entry, `${path}/`);
        else paths.push(path);
      }
    };
    await walk(this.handle, '');
    return paths;
  }

  async #parent(path: string, create: boolean): Promise<[BrowserDirectory, string]> {
    const segments = parts(path);
    const name = segments.pop() as string;
    let directory = this.handle;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
    return [directory, name];
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      const [directory, name] = await this.#parent(path, false);
      const file = await (await directory.getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (cause) {
      if ((cause as { name?: string }).name === 'NotFoundError') return undefined;
      throw cause;
    }
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const [directory, name] = await this.#parent(path, true);
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    try {
      const [directory, name] = await this.#parent(path, false);
      await directory.removeEntry(name);
    } catch (cause) {
      if ((cause as { name?: string }).name !== 'NotFoundError') throw cause;
    }
  }
}

class BrowserFolderPort implements FolderPort {
  constructor(readonly root: BrowserDirectory) {}
  async permission(): Promise<boolean> { return (await this.root.queryPermission({ mode: 'readwrite' })) === 'granted'; }
  async folders(): Promise<readonly { key: string; folder: WorkspaceDirectory }[]> {
    const found: { key: string; folder: WorkspaceDirectory }[] = [];
    const rootDirectory = new BrowserWorkspaceDirectory(this.root);
    if ((await rootDirectory.listPaths()).includes('.nouty/workspace.yaml')) {
      found.push({ key: '.', folder: rootDirectory });
      return found;
    }
    for await (const [key, entry] of this.root.entries()) {
      if (entry.kind !== 'directory') continue;
      const folder = new BrowserWorkspaceDirectory(entry);
      found.push({ key, folder });
    }
    return found;
  }
  async createFolder(key: string): Promise<WorkspaceDirectory> {
    if ((await new BrowserWorkspaceDirectory(this.root).listPaths()).includes('.nouty/workspace.yaml')) {
      throw new Error('La carpeta seleccionada es un workspace. Elige su carpeta padre para crear otro.');
    }
    return new BrowserWorkspaceDirectory(await this.root.getDirectoryHandle(key, { create: true }));
  }
}

export function supportsFolderAccess(): boolean {
  return Platform.OS === 'web' && typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Solo se invoca desde el gesto del botón; el handle no se guarda entre sesiones. */
export async function chooseFolder(): Promise<FolderStorage | null> {
  if (!supportsFolderAccess()) return null;
  const picker = (globalThis as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<BrowserDirectory> }).showDirectoryPicker;
  const root = await picker({ mode: 'readwrite' });
  return new FolderStorage(new BrowserFolderPort(root));
}
