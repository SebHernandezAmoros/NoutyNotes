import { EditorialSessionCoordinator } from '@noutynotes/application';
import type { DraftStore, WorkspaceStorage } from '@noutynotes/application';
import type { BoardId, WorkspaceId } from '@noutynotes/domain';
import { ArchiveStorage } from '@noutynotes/storage';
import type { ArchiveImport, ExportConfirmation } from '@noutynotes/storage';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { useHydrated } from '../components/useHydrated';
import { chooseAndroidFolder, forgetAndroidFolder, readSavedAndroidFolder, rememberAndroidFolder, reopenAndroidFolder, supportsAndroidFolders } from './androidFolder';
import type { SavedFolder } from './androidFolder';
import { downloadFile, pickZipFile, supportsArchiveFiles } from './archiveFiles';
import { chooseFolder, storageForHandle, supportsFolderAccess } from './folderAccess';
import type { BrowserDirectory } from './folderAccess';
import { chooseFolderInto, reopenRememberedInto } from './folderSession';
import type { FolderState } from './folderSession';
import { describeImport, describeImportFailure } from './messages';
import { createDeviceDraftStore } from './draftPersistence';
import { loadFolderHandle } from './folderHandles';
import { parseRegistry } from './recentItems';
import { loadRecentItems } from './recentItemsStore';
import { resolveResumeBoard, SessionResume } from './sessionResume';
import type { ResumeState } from './sessionResume';
import { isReload, readResumeIntent, writeResumeIntent } from './sessionResumeStore';

type Outcome<T = null> = { readonly ok: true; readonly value: T; readonly message: string } | { readonly ok: false; readonly message: string };

interface Session {
  readonly storage: WorkspaceStorage;
  /** Borradores privados del dispositivo; nunca forman parte del workspace ni del ZIP. */
  readonly drafts: DraftStore;
  readonly editorialSessions: EditorialSessionCoordinator;
  readonly mode: 'memory' | 'folder';
  readonly folderSupported: boolean;
  /** Importar y exportar ZIP: navegador web, espacios del navegador y app ya hidratada. */
  readonly archiveSupported: boolean;
  /** Espacios del navegador con cambios que no se han exportado a ZIP. */
  readonly unexported: readonly WorkspaceId[];
  /** `webHandle` solo en éxito en web — identidad física real del handle recién elegido (UX7-E2A/B):
   * sirve para comparar con `isSameEntry()` y, si corresponde, guardarlo para una reconexión futura. */
  connectFolder(): Promise<{ ok: true; folder: { key: string; name: string }; webHandle: BrowserDirectory | null } | { ok: false; message: string }>;
  /** UX7-E2B: conecta directamente un handle web ya obtenido (recordado o recién verificado), sin
   * abrir el selector nativo. Misma garantía que `connectFolder`: solo cambia la sesión si `list()`
   * de esa carpeta responde bien. */
  connectFolderWithHandle(handle: BrowserDirectory): Promise<{ ok: true; folder: { key: string; name: string } } | { ok: false; message: string }>;
  /** Android: carpeta elegida en una sesión anterior que se puede reabrir (ADR 0012). */
  readonly savedFolder: SavedFolder | null;
  /** Identidad local de la carpeta conectada ahora mismo (nombre en web, URI SAF en Android); `null`
   * en modo memoria. No persiste entre cargas — solo indica "ya conectada en esta sesión" para el
   * historial de recientes (UX7-E1). */
  readonly activeFolderKey: string | null;
  readonly activeFolderId: string | null;
  /** Semilla de navegación preparada con el proyecto; no es otro estado activo ni registro durable. */
  readonly boardResume: { readonly storage: WorkspaceStorage; readonly folderId: string; readonly workspaceId: string; readonly boardId: BoardId | null } | null;
  acknowledgeBoardResume(storage: WorkspaceStorage): void;
  identifyWebFolder(id: string): void;
  beginResume(id: string | undefined): Promise<ResumeState | 'skip'>;
  reconnectResume(): Promise<ResumeState>;
  cancelResume(): void;
  leaveProject(): void;
  reconnectFolder(): Promise<{ ok: true; folder: { key: string; name: string } } | { ok: false; message: string }>;
  /** `null` si el usuario cancela el selector. */
  importArchive(): Promise<Outcome<ArchiveImport> | null>;
  /** Inicia la descarga. No da por conservado nada: devuelve la revisión que el usuario podrá confirmar. */
  exportArchive(id: WorkspaceId): Outcome<{ readonly fileName: string; readonly revision: number }>;
  /** El usuario confirma que guardó el ZIP de esa revisión. */
  confirmExported(id: WorkspaceId, revision: number): Outcome<ExportConfirmation>;
}
const StorageContext = createContext<Session | null>(null);

/**
 * Raíz de composición (ADR 0009–0011): una única instancia de ArchiveStorage por carga de la app
 * para los espacios del navegador (memoria + ZIP), o FolderStorage tras elegir una carpeta. Sobrevive
 * a la navegación y a los cambios de tema; los espacios del navegador se pierden al recargar o
 * cerrar si no se exportan. Las pantallas solo conocen el puerto `WorkspaceStorage`.
 */
export function WorkspaceSessionProvider({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const [archive] = useState(() => new ArchiveStorage());
  const [drafts] = useState(() => createDeviceDraftStore());
  const [editorialSessions] = useState(() => new EditorialSessionCoordinator(() => 'editorial-session'));
  const [storage, setStorage] = useState<WorkspaceStorage>(archive);
  const [mode, setMode] = useState<'memory' | 'folder'>('memory');
  const [unexported, setUnexported] = useState<readonly WorkspaceId[]>([]);
  // Fuera de Android siempre es null (el sustituto no lee nada), también en el HTML estático.
  const [savedFolder, setSavedFolder] = useState<SavedFolder | null>(() => readSavedAndroidFolder());
  // UX7-E1: identidad local de la carpeta activa, solo para saber "ya conectada en esta sesión" en
  // el historial de recientes; no es un handle persistente ni sustituye a `savedFolder` (Android).
  const [activeFolderKey, setActiveFolderKey] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [boardResume, setBoardResume] = useState<Session['boardResume']>(null);
  const acknowledgeBoardResume = useCallback((source: WorkspaceStorage) => {
    setBoardResume((current) => current?.storage === source ? null : current);
  }, []);
  const [resume] = useState(() => new SessionResume<BrowserDirectory, { storage: WorkspaceStorage; name: string; boardId: BoardId | null }>({
    loadHandle: loadFolderHandle,
    queryPermission: (handle) => handle.queryPermission({ mode: 'readwrite' }),
    prepare: async (handle, intent) => {
      const candidate = storageForHandle(handle, { readRecovery: 'defer' });
      const opened = await candidate.open(intent.workspaceId as WorkspaceId);
      if (!opened.ok) return { state: candidate.recoveryRequired ? 'recovery' : 'unavailable' };
      const boardId = resolveResumeBoard(intent, { backend: 'web', folderId: intent.folderId, workspaceId: opened.value.id }, opened.value.boards);
      return { state: 'ready', candidate: { storage: candidate, name: handle.name, boardId } };
    },
    activate: (candidate, intent) => {
      setStorage(candidate.storage);
      setMode('folder');
      setActiveFolderKey(candidate.name);
      setActiveFolderId(intent.folderId);
      setBoardResume({ storage: candidate.storage, folderId: intent.folderId, workspaceId: intent.workspaceId, boardId: candidate.boardId });
    },
  }));
  const identifyWebFolder = useCallback((id: string) => { setActiveFolderId(id); }, []);
  const cancelResume = useCallback(() => { resume.cancel(); }, [resume]);
  const leaveProject = useCallback(() => {
    resume.abandon();
    setBoardResume(null);
    writeResumeIntent(null);
  }, [resume]);
  const beginResume = useCallback(async (id: string | undefined): Promise<ResumeState | 'skip'> => {
    if (Platform.OS !== 'web') return 'skip';
    const intent = readResumeIntent();
    const known = !!intent && parseRegistry(loadRecentItems()).folders.some((entry) => entry.id === intent.folderId && entry.backend === 'web');
    const claim = resume.claimReload(intent, id, isReload(), known);
    if (claim.discard) writeResumeIntent(null); // Invalida copias de opener y pistas incompatibles.
    return claim.target ? resume.start(claim.target) : 'skip';
  }, [resume]);
  const reconnectResume = useCallback(() => resume.reconnect((handle) => handle.requestPermission({ mode: 'readwrite' })), [resume]);

  useEffect(() => archive.subscribe(() => setUnexported(archive.unexportedIds())), [archive]);

  // Salir con cambios sin exportar pide confirmación al navegador: no se descartan en silencio.
  const pending = mode === 'memory' && unexported.length > 0;
  useEffect(() => {
    if (Platform.OS !== 'web' || !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  const memory = { remember: rememberAndroidFolder, forget: forgetAndroidFolder };
  const apply = (next: FolderState<SavedFolder>) => {
    setStorage(next.storage);
    setMode(next.mode);
    setSavedFolder(next.saved);
  };

  /** La sesión y la carpeta recordada solo cambian si la carpeta elegida se lee bien (folderSession.ts). */
  const connectFolder = async (): Promise<{ ok: true; folder: { key: string; name: string }; webHandle: BrowserDirectory | null } | { ok: false; message: string }> => {
    resume.cancel();
    // UX7-E1/E2B: captura por cierre la identidad de la carpeta elegida (nombre web / URI Android) y,
    // en web, el handle real, para registrarla en Recientes y permitir guardarlo solo si
    // `chooseFolderInto` confirma el éxito debajo. `box` evita la pérdida de estrechamiento de
    // TypeScript sobre un `let` reasignado en un cierre.
    const box: { chosen: { key: string; name: string } | null; webHandle: BrowserDirectory | null } = { chosen: null, webHandle: null };
    const choose = async () => {
      if (supportsAndroidFolders()) {
        const picked = await chooseAndroidFolder();
        if (picked) box.chosen = { key: picked.folder.uri, name: picked.folder.name };
        return picked;
      }
      const selected = await chooseFolder();
      if (selected) {
        box.chosen = { key: selected.name, name: selected.name };
        box.webHandle = selected.handle;
      }
      return selected ? { storage: selected.storage, folder: null } : null;
    };
    const { state, result } = await chooseFolderInto({ storage, mode, saved: savedFolder }, choose, memory);
    apply(state);
    if (!result.ok) return result;
    if (!box.chosen) return { ok: false, message: 'No se pudo identificar la carpeta elegida.' };
    setActiveFolderKey(box.chosen.key);
    setActiveFolderId(null);
    return { ok: true, folder: box.chosen, webHandle: box.webHandle };
  };

  /** UX7-E2B: igual que `connectFolder`, pero partiendo de un handle web ya obtenido (recordado en
   * IndexedDB o recién verificado) — nunca abre el selector nativo. */
  const connectFolderWithHandle = async (handle: BrowserDirectory): Promise<{ ok: true; folder: { key: string; name: string } } | { ok: false; message: string }> => {
    resume.cancel();
    const candidate = storageForHandle(handle);
    const listed = await candidate.list();
    if (!listed.ok) return { ok: false, message: listed.issues[0]?.message ?? 'No se pudo leer la carpeta.' };
    setStorage(candidate);
    setMode('folder');
    setActiveFolderKey(handle.name);
    setActiveFolderId(null);
    return { ok: true, folder: { key: handle.name, name: handle.name } };
  };

  /** Android: reabre la carpeta recordada; solo la olvida si se confirma la pérdida de acceso. */
  const reconnectFolder = async (): Promise<{ ok: true; folder: { key: string; name: string } } | { ok: false; message: string }> => {
    const { state, result } = await reopenRememberedInto({ storage, mode, saved: savedFolder }, reopenAndroidFolder, memory);
    apply(state);
    if (!result.ok || !state.saved) return result.ok ? { ok: false, message: 'No se pudo identificar la carpeta reabierta.' } : result;
    setActiveFolderKey(state.saved.uri);
    return { ok: true, folder: { key: state.saved.uri, name: state.saved.name } };
  };

  const importArchive = async (): Promise<Outcome<ArchiveImport> | null> => {
    let bytes: Uint8Array | null;
    try {
      bytes = await pickZipFile();
    } catch {
      return { ok: false, message: 'No se pudo leer el archivo elegido.' };
    }
    if (bytes === null) return null;
    const imported = await archive.importArchive(bytes);
    return imported.ok
      ? { ok: true, value: imported.value, message: describeImport(imported.value) }
      : { ok: false, message: describeImportFailure(imported.issues) };
  };

  const exportArchive = (id: WorkspaceId): Outcome<{ readonly fileName: string; readonly revision: number }> => {
    const exported = archive.exportArchive(id);
    if (!exported.ok) return { ok: false, message: `No se pudo exportar el ZIP: ${exported.issues[0]?.details?.[0]?.message ?? exported.issues[0]?.message ?? 'error desconocido'}` };
    const { fileName, bytes, revision } = exported.value;
    try {
      downloadFile(fileName, bytes);
    } catch {
      return { ok: false, message: 'No se pudo iniciar la descarga del ZIP. El espacio sigue sin exportar.' };
    }
    // Iniciar la descarga no demuestra que el archivo se guardara (puede cancelarse o fallar).
    return {
      ok: true,
      value: { fileName, revision },
      message: `Descarga iniciada: «${fileName}». El navegador no confirma que se haya guardado: comprueba tus descargas y pulsa «Ya lo guardé». Hasta entonces sigue marcado como sin exportar.`,
    };
  };

  const confirmExported = (id: WorkspaceId, revision: number): Outcome<ExportConfirmation> => {
    const confirmed = archive.confirmExported(id, revision);
    if (!confirmed.ok) return { ok: false, message: confirmed.issues[0]?.message ?? 'No se pudo confirmar la exportación.' };
    return {
      ok: true,
      value: confirmed.value,
      message: confirmed.value === 'confirmed'
        ? 'Confirmado: el estado exportado está guardado.'
        : 'Hubo cambios después de exportar ese ZIP: sigue sin exportar. Vuelve a exportar.',
    };
  };

  const archiveSupported = hydrated && mode === 'memory' && supportsArchiveFiles();
  return (
    <StorageContext.Provider value={{
      storage, drafts, editorialSessions, mode, folderSupported: hydrated && (supportsFolderAccess() || supportsAndroidFolders()), archiveSupported,
      savedFolder: mode === 'memory' ? savedFolder : null, activeFolderKey: mode === 'folder' ? activeFolderKey : null, reconnectFolder,
      activeFolderId: mode === 'folder' ? activeFolderId : null, boardResume, acknowledgeBoardResume, identifyWebFolder, beginResume, reconnectResume, cancelResume, leaveProject,
      unexported: mode === 'memory' ? unexported : [], connectFolder, connectFolderWithHandle, importArchive, exportArchive, confirmExported,
    }}
    >
      {children}
    </StorageContext.Provider>
  );
}

export function useWorkspaceStorage(): WorkspaceStorage {
  return useWorkspaceSession().storage;
}

export function useWorkspaceSession(): Session {
  const session = useContext(StorageContext);
  if (!session) throw new Error('useWorkspaceSession requiere WorkspaceSessionProvider.');
  return session;
}
