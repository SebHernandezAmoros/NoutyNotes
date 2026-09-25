import type { WorkspaceStorage } from '@noutynotes/application';
import type { WorkspaceId } from '@noutynotes/domain';
import { ArchiveStorage } from '@noutynotes/storage';
import type { ArchiveImport, ExportConfirmation } from '@noutynotes/storage';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { useHydrated } from '../components/useHydrated';
import { chooseAndroidFolder, forgetAndroidFolder, readSavedAndroidFolder, rememberAndroidFolder, reopenAndroidFolder, supportsAndroidFolders } from './androidFolder';
import type { SavedFolder } from './androidFolder';
import { downloadFile, pickZipFile, supportsArchiveFiles } from './archiveFiles';
import { chooseFolder, supportsFolderAccess } from './folderAccess';
import { chooseFolderInto, reopenRememberedInto } from './folderSession';
import type { FolderState } from './folderSession';
import { describeImport, describeImportFailure } from './messages';

type Outcome<T = null> = { readonly ok: true; readonly value: T; readonly message: string } | { readonly ok: false; readonly message: string };

interface Session {
  readonly storage: WorkspaceStorage;
  readonly mode: 'memory' | 'folder';
  readonly folderSupported: boolean;
  /** Importar y exportar ZIP: navegador web, espacios del navegador y app ya hidratada. */
  readonly archiveSupported: boolean;
  /** Espacios del navegador con cambios que no se han exportado a ZIP. */
  readonly unexported: readonly WorkspaceId[];
  connectFolder(): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Android: carpeta elegida en una sesión anterior que se puede reabrir (ADR 0012). */
  readonly savedFolder: SavedFolder | null;
  reconnectFolder(): Promise<{ ok: true } | { ok: false; message: string }>;
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
  const [storage, setStorage] = useState<WorkspaceStorage>(archive);
  const [mode, setMode] = useState<'memory' | 'folder'>('memory');
  const [unexported, setUnexported] = useState<readonly WorkspaceId[]>([]);
  // Fuera de Android siempre es null (el sustituto no lee nada), también en el HTML estático.
  const [savedFolder, setSavedFolder] = useState<SavedFolder | null>(() => readSavedAndroidFolder());

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
  const connectFolder = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const choose = async () => {
      if (supportsAndroidFolders()) return chooseAndroidFolder();
      const selected = await chooseFolder();
      return selected ? { storage: selected, folder: null } : null;
    };
    const { state, result } = await chooseFolderInto({ storage, mode, saved: savedFolder }, choose, memory);
    apply(state);
    return result;
  };

  /** Android: reabre la carpeta recordada; solo la olvida si se confirma la pérdida de acceso. */
  const reconnectFolder = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const { state, result } = await reopenRememberedInto({ storage, mode, saved: savedFolder }, reopenAndroidFolder, memory);
    apply(state);
    return result;
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
      storage, mode, folderSupported: hydrated && (supportsFolderAccess() || supportsAndroidFolders()), archiveSupported,
      savedFolder: mode === 'memory' ? savedFolder : null, reconnectFolder,
      unexported: mode === 'memory' ? unexported : [], connectFolder, importArchive, exportArchive, confirmExported,
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
