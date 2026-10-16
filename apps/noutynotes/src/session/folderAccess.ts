import { FolderStorage } from '@noutynotes/storage';
import type { FolderPort, WorkspaceDirectory } from '@noutynotes/storage';
import { Platform } from 'react-native';

type Permission = 'granted' | 'prompt' | 'denied';
interface BrowserFile {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
/** También es el tipo real `FileSystemDirectoryHandle` en tiempo de ejecución (clonable
 * estructuralmente, por eso puede guardarse en IndexedDB — ver `folderHandles.ts`, UX7-E2B). */
export interface BrowserDirectory {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFile>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, BrowserDirectory | { kind: 'file' }]>;
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<Permission>;
  /** Única prueba real de identidad física entre dos handles — nunca el nombre (UX7-E2A/D73). */
  isSameEntry(other: BrowserDirectory): Promise<boolean>;
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

/**
 * Solo se invoca desde el gesto del botón. El nombre y el handle se exponen — ya estaban disponibles
 * en el objeto devuelto por el navegador — para que la sesión registre el uso en Recientes (UX7-E1) y,
 * si corresponde, guarde el handle para una reconexión silenciosa futura (UX7-E2B).
 */
export async function chooseFolder(): Promise<{ readonly storage: FolderStorage; readonly name: string; readonly handle: BrowserDirectory } | null> {
  if (!supportsFolderAccess()) return null;
  const picker = (globalThis as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<BrowserDirectory> }).showDirectoryPicker;
  const root = await picker({ mode: 'readwrite' });
  return { storage: storageForHandle(root), name: root.name, handle: root };
}

/** Misma envoltura que usa `chooseFolder`, reutilizable sobre un handle ya obtenido (recordado o
 * recién verificado) sin volver a abrir el selector nativo. */
export function storageForHandle(handle: BrowserDirectory): FolderStorage {
  return new FolderStorage(new BrowserFolderPort(handle));
}

/**
 * UX7-E2B: reabre un handle guardado sin selector nativo. Primero consulta el permiso (sin gesto); si
 * no está concedido, lo solicita (requiere el gesto del usuario que ya disparó esta llamada — un clic
 * en «Reconectar»). El navegador decide cuánta UI mostrar: nada si ya hay un permiso persistente, o un
 * aviso ligero propio — nunca el selector de carpetas completo.
 */
export async function reopenHandle(handle: BrowserDirectory): Promise<
  | { readonly ok: true; readonly storage: FolderStorage; readonly name: string }
  | { readonly ok: false; readonly reason: 'denied' | 'invalid' }
> {
  try {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    return { ok: true, storage: storageForHandle(handle), name: handle.name };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Única comparación de identidad física admitida (UX7-E2A/D73): nunca por nombre. */
export async function sameEntry(a: BrowserDirectory, b: BrowserDirectory): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}
