import type { BrowserDirectory } from './folderAccess';

/**
 * UX7-E2B: handles de carpeta web en IndexedDB, por `RecentFolderEntry.id` opaco. Solo web: en Android
 * `indexedDB` no existe (`typeof indexedDB === 'undefined'`), así que cada función degrada en silencio
 * sin necesitar un archivo `.android.ts` — Android ya tiene su propia persistencia real (SAF, URI
 * estable), no necesita esta capa. Nunca se guarda en `localStorage` (no es serializable a JSON de
 * forma fiable) ni se expone fuera de este módulo — el handle no es contenido del proyecto ni viaja en
 * el ZIP portable; es una referencia local del dispositivo al recurso del sistema operativo.
 */
const DB_NAME = 'noutynotes-folder-handles';
const STORE = 'handles';
const DB_VERSION = 1;

export function supportsHandlePersistence(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Nunca lanza: un fallo de IndexedDB solo significa que esta carpeta no podrá reabrirse en silencio
 * la próxima vez — no bloquea nada de lo que ya funcionaba sin esta capa (UX7-E2B, sección 5). */
export async function saveFolderHandle(id: string, handle: BrowserDirectory): Promise<boolean> {
  if (!supportsHandlePersistence()) return false;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadFolderHandle(id: string): Promise<BrowserDirectory | null> {
  if (!supportsHandlePersistence()) return null;
  try {
    const db = await openDb();
    const handle = await new Promise<BrowserDirectory | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as BrowserDirectory | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

/** Todos los handles guardados, para buscar coincidencias reales (`isSameEntry`) al conectar una
 * carpeta por el selector genérico — nunca por nombre (UX7-E2A/D73). */
export async function loadAllFolderHandles(): Promise<ReadonlyMap<string, BrowserDirectory>> {
  if (!supportsHandlePersistence()) return new Map();
  try {
    const db = await openDb();
    const entries = await new Promise<[string, BrowserDirectory][]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      tx.oncomplete = () => {
        const keys = keysRequest.result as string[];
        const values = valuesRequest.result as BrowserDirectory[];
        resolve(keys.map((key, index) => [key, values[index]]).filter((entry): entry is [string, BrowserDirectory] => entry[1] !== undefined));
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/** Quita el handle guardado — nunca borra la carpeta real ni la entrada del historial de Recientes,
 * que puede seguir visible pidiendo reconexión manual (UX7-E2A, sección 6). */
export async function deleteFolderHandle(id: string): Promise<void> {
  if (!supportsHandlePersistence()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Sin IndexedDB disponible, no hay nada que borrar.
  }
}
