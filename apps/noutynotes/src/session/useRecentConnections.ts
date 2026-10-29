import { Platform } from 'react-native';

import { reopenHandle, sameEntry } from './folderAccess';
import type { BrowserDirectory } from './folderAccess';
import type { FolderOpenFailure } from './folderOpenDiagnostics';
import { deleteFolderHandle, loadAllFolderHandles, loadFolderHandle, saveFolderHandle } from './folderHandles';
import { newFolderId, useRecentItems } from './useRecentItems';
import { resolveProjectStatus } from './recentItems';
import type { RecentFolderEntry, RecentProjectBackend, RecentProjectEntry, RecentProjectStatus } from './recentItems';
import { useWorkspaceSession } from './WorkspaceSession';

export interface RecentConnectionsApi {
  readonly folders: readonly RecentFolderEntry[];
  readonly projects: readonly RecentProjectEntry[];
  readonly currentBackend: RecentProjectBackend;
  /** `RecentFolderEntry.id` de la carpeta conectada ahora mismo; `null` fuera de modo carpeta. */
  readonly currentFolderId: string | null;
  /**
   * Conecta una carpeta nueva por el selector nativo (web) o Android. UX7-E2A/D73: nunca reutiliza una
   * identidad por nombre — compara el handle recién elegido contra TODOS los handles guardados
   * (`isSameEntry`, evidencia física real) o, en Android, contra la URI SAF; solo si alguno coincide
   * reutiliza su `id`. En cualquier otro caso crea una identidad nueva.
   */
  connectNewFolder(): Promise<{ readonly ok: true; readonly folderId: string } | FolderOpenFailure>;
  /** Activa un handle que otra UI ya eligió y validó. No debe llamarse durante la selección: solo al
   * confirmar una operación que necesita cambiar la sesión (por ejemplo, crear un proyecto allí). */
  connectSelectedWebFolder(handle: BrowserDirectory, name: string): Promise<{ readonly ok: true; readonly folderId: string } | { readonly ok: false; readonly message: string }>;
  /** Android: reabre `session.savedFolder` (el botón «Reabrir» independiente de Recientes) y registra
   * el uso con la misma evidencia real (URI) que `reconnectFolderEntry`. */
  reopenSavedAndroidFolder(): Promise<{ readonly ok: true; readonly folderId: string } | { readonly ok: false; readonly message: string }>;
  /**
   * UX7-E2B: reconectar una carpeta conocida — intenta primero su handle guardado en IndexedDB
   * (reapertura silenciosa o con un aviso ligero del navegador, nunca el selector nativo completo) o,
   * en Android, la URI SAF ya recordada; solo si no hay nada guardado o deja de funcionar recurre al
   * selector nativo completo (`connectNewFolder`, con la misma verificación por evidencia real).
   */
  reconnectFolderEntry(entry: RecentFolderEntry): Promise<{ readonly ok: true; readonly folderId: string } | { readonly ok: false; readonly message: string }>;
  /** Recovery: intenta exclusivamente la identidad de carpeta activa ya conocida. En web reutiliza
   * su handle persistido y solicita permiso sobre él; nunca abre el selector ni cambia a otra carpeta
   * como efecto secundario. La selección manual permanece como una acción separada de la UI. */
  reconnectCurrentFolder(): Promise<{ readonly ok: true; readonly folderId: string } | { readonly ok: false; readonly message: string }>;
  recordProjectUse(input: { readonly workspaceId: string; readonly name: string; readonly backend: RecentProjectBackend; readonly folderId: string | null }): void;
  forgetFolderEntry(id: string): void;
  forgetProjectEntry(id: string): void;
  projectStatus(entry: RecentProjectEntry, knownWorkspaceIds: readonly string[], workspacesLoading: boolean): RecentProjectStatus;
}

/**
 * Orquesta identidad de carpetas + Recientes + persistencia de handles (UX7-E2A/E2B). Vive en
 * `session/` porque tanto `home/HomeScreen.tsx` como `workspace/WorkspaceScreen.tsx` (catálogo de
 * `ProjectSheet`, UX7-E2C) lo consumen — un único punto de verdad para "qué carpeta es cuál".
 */
export function useRecentConnections(): RecentConnectionsApi {
  const session = useWorkspaceSession();
  const recent = useRecentItems();
  const currentBackend: RecentProjectBackend = session.mode === 'memory' ? 'memory' : (Platform.OS === 'web' ? 'web' : 'android');

  // Comparación de conveniencia dentro de la sesión viva (nombre en web, URI en Android) — no es la
  // identidad persistida (siempre `entry.id`, opaco); solo resuelve cuál entrada ya conocida es la
  // activa ahora mismo, igual que documentó D73.
  const folderIsCurrent = (entry: RecentFolderEntry) => session.mode === 'folder' && (
    entry.backend === 'android' ? entry.androidUri === session.activeFolderKey : entry.name === session.activeFolderKey
  );
  const currentFolderId = session.mode === 'folder' ? (currentBackend === 'web' ? session.activeFolderId : (recent.folders.find(folderIsCurrent)?.id ?? null)) : null;

  const registerWebConnection = async (handle: BrowserDirectory, name: string): Promise<string> => {
    const stored = await loadAllFolderHandles();
    let matchedId: string | null = null;
    for (const [id, storedHandle] of stored) {
      if (await sameEntry(handle, storedHandle)) { matchedId = id; break; }
    }
    const id = matchedId ?? newFolderId('web');
    recent.recordFolderUse({ id, backend: 'web', name, origin: 'created', androidUri: null });
    await saveFolderHandle(id, handle);
    session.identifyWebFolder(id);
    return id;
  };

  const registerAndroidConnection = (uri: string, name: string): string => {
    const existing = recent.folders.find((entry) => entry.androidUri === uri);
    const id = existing?.id ?? newFolderId('android');
    recent.recordFolderUse({ id, backend: 'android', name, origin: 'created', androidUri: uri });
    return id;
  };

  const connectNewFolder = async (): Promise<{ ok: true; folderId: string } | FolderOpenFailure> => {
    const result = await session.connectFolder();
    if (!result.ok) return result;
    const folderId = result.webHandle
      ? await registerWebConnection(result.webHandle, result.folder.name)
      : registerAndroidConnection(result.folder.key, result.folder.name);
    return { ok: true, folderId };
  };

  const connectSelectedWebFolder = async (handle: BrowserDirectory, name: string): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    const result = await session.connectFolderWithHandle(handle);
    if (!result.ok) return result;
    return { ok: true, folderId: await registerWebConnection(handle, name) };
  };

  const reopenSavedAndroidFolder = async (): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    const result = await session.reconnectFolder();
    if (!result.ok) return result;
    return { ok: true, folderId: registerAndroidConnection(result.folder.key, result.folder.name) };
  };

  const reconnectFolderEntry = async (entry: RecentFolderEntry): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    if (entry.backend === 'android') {
      if (session.savedFolder?.uri === entry.androidUri) return reopenSavedAndroidFolder();
      return connectNewFolder();
    }
    // Web (UX7-E2B): intentar primero el handle guardado antes de abrir el selector nativo completo.
    const handle = await loadFolderHandle(entry.id);
    if (handle) {
      const reopened = await reopenHandle(handle);
      if (reopened.ok) {
        const result = await session.connectFolderWithHandle(handle);
        if (!result.ok) return result;
        session.identifyWebFolder(entry.id);
        recent.recordFolderUse({ id: entry.id, backend: 'web', name: reopened.name, origin: 'created', androidUri: null });
        return { ok: true, folderId: entry.id };
      }
      // El handle ya no sirve (carpeta movida/borrada): se olvida solo el handle, la entrada de
      // Recientes permanece visible pidiendo reconexión manual (sección 6, UX7-E2A).
      if (reopened.reason === 'invalid') await deleteFolderHandle(entry.id);
    }
    // Sin handle utilizable: selector nativo completo. No se asume que el resultado sea esta misma
    // entrada por coincidencia de nombre (corrección de la sección 4) — `connectNewFolder` decide la
    // identidad únicamente por evidencia real.
    return connectNewFolder();
  };

  const reconnectCurrentFolder = async (): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    const entry = currentFolderId ? recent.folders.find((candidate) => candidate.id === currentFolderId) : null;
    if (!entry) return { ok: false, message: 'No hay una carpeta activa conocida que se pueda reconectar. Elige la carpeta manualmente.' };
    if (entry.backend === 'android') {
      if (session.savedFolder?.uri !== entry.androidUri) {
        return { ok: false, message: 'La carpeta activa ya no tiene un permiso guardado. Elige la carpeta manualmente.' };
      }
      return reopenSavedAndroidFolder();
    }
    const handle = await loadFolderHandle(entry.id);
    if (!handle) return { ok: false, message: 'No hay un handle guardado para esta carpeta. Elige la carpeta manualmente.' };
    const reopened = await reopenHandle(handle);
    if (!reopened.ok) {
      if (reopened.reason === 'invalid') await deleteFolderHandle(entry.id);
      return {
        ok: false,
        message: reopened.reason === 'denied'
          ? 'El permiso de la carpeta sigue denegado. Autorízalo o elige la carpeta manualmente.'
          : 'La carpeta conocida ya no está disponible. Elige la carpeta manualmente.',
      };
    }
    const result = await session.connectFolderWithHandle(handle);
    if (!result.ok) return result;
    session.identifyWebFolder(entry.id);
    recent.recordFolderUse({ id: entry.id, backend: 'web', name: reopened.name, origin: 'created', androidUri: null });
    return { ok: true, folderId: entry.id };
  };

  const projectStatus = (entry: RecentProjectEntry, knownWorkspaceIds: readonly string[], workspacesLoading: boolean) => resolveProjectStatus(entry, {
    currentBackend, currentFolderId, workspacesLoading, knownWorkspaceIds,
    knownFolderIds: recent.folders.map((folder) => folder.id),
  });

  return {
    folders: recent.folders,
    projects: recent.projects,
    currentBackend,
    currentFolderId,
    connectNewFolder,
    connectSelectedWebFolder,
    reopenSavedAndroidFolder,
    reconnectFolderEntry,
    reconnectCurrentFolder,
    recordProjectUse: recent.recordProjectUse,
    forgetFolderEntry: recent.forgetFolderEntry,
    forgetProjectEntry: recent.forgetProjectEntry,
    projectStatus,
  };
}
