import { DocumentTreeFolderPort, FolderStorage } from '@noutynotes/storage';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { SafTree, displayNameFromDocumentUri, folderNameFromTreeUri } from './safTree';
import type { SafApi } from './safTree';
import type { SavedFolder } from './androidFolder';

export type { SavedFolder } from './androidFolder';

/** Operaciones SAF reales con `expo-file-system` 57 (API nueva File/Directory), ADR 0012. */
const api: SafApi<Directory, File> = {
  exists: (dir) => dir.exists,
  children(dir) {
    const entries = dir.list();
    const derived = entries.map((entry) => displayNameFromDocumentUri(entry.uri));
    if (derived.every((name): name is string => name !== undefined)) return { names: derived, entries };
    // Proveedor con IDs opacos: info().files da los nombres visibles en el orden de list() (ambos salen de
    // DocumentFile.listFiles(); SafTree comprueba longitudes). Es caro: info() también mide todo el subárbol.
    return { names: dir.info().files ?? [], entries };
  },
  isDirectory: (entry): entry is Directory => entry instanceof Directory,
  uriOf: (entry) => entry.uri,
  createDirectory: (dir, name) => dir.createDirectory(name),
  // Con un tipo de texto algunos proveedores añaden extensión (workspace.yaml.txt).
  createFile: (dir, name) => dir.createFile(name, 'application/octet-stream'),
  readBytes: (file) => file.bytes(),
  writeTruncating(file, bytes) {
    // File.write() usa el modo "w", que no trunca en todos los proveedores; "wt" sí.
    const handle = file.open(FileMode.Truncate);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
  },
  deleteFile: (file) => file.delete(),
};

/** Archivo privado de la app con la última carpeta elegida; nunca se escribe en el workspace. */
const savedFile = () => new File(Paths.document, 'nouty-android-folder.json');

function storageFor(directory: Directory): FolderStorage {
  return new FolderStorage(new DocumentTreeFolderPort(new SafTree(api, directory)));
}

export function supportsAndroidFolders(): boolean {
  return true;
}

/**
 * Abre el selector de carpetas del sistema; el permiso persistente lo toma el módulo nativo. No recuerda
 * nada: la sesión llama a `rememberAndroidFolder` solo si la carpeta se lee bien (folderSession.ts).
 */
export async function chooseAndroidFolder(): Promise<{ readonly storage: FolderStorage; readonly folder: SavedFolder } | null> {
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (cause) {
    if (/cancel/i.test(String((cause as { message?: unknown }).message ?? ''))) {
      throw Object.assign(new Error('No se seleccionó ninguna carpeta.'), { name: 'AbortError' });
    }
    throw cause;
  }
  const folder: SavedFolder = { uri: directory.uri, name: folderNameFromTreeUri(directory.uri) };
  return { storage: storageFor(directory), folder };
}

export function rememberAndroidFolder(folder: SavedFolder): void {
  try {
    savedFile().write(JSON.stringify(folder));
  } catch {
    // Sin recordar la carpeta, la sesión actual funciona igual; solo no se ofrecerá reabrirla.
  }
}

export function readSavedAndroidFolder(): SavedFolder | null {
  try {
    const file = savedFile();
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(file.textSync());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { uri, name } = parsed as Record<string, unknown>;
    return typeof uri === 'string' && typeof name === 'string' ? { uri, name } : null;
  } catch {
    return null;
  }
}

/**
 * Reabre la carpeta recordada. Devuelve null solo si Android confirma que el árbol ya no existe o no es
 * accesible (`exists` falso); las excepciones se propagan para no confundir un fallo con la pérdida de acceso.
 */
export function reopenAndroidFolder(folder: SavedFolder): FolderStorage | null {
  const directory = new Directory(folder.uri);
  return directory.exists ? storageFor(directory) : null;
}

export function forgetAndroidFolder(): void {
  try {
    const file = savedFile();
    if (file.exists) file.delete();
  } catch {
    // Nada que olvidar.
  }
}
