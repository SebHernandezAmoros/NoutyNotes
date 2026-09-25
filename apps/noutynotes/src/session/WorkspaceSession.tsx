import type { WorkspaceStorage } from '@noutynotes/application';
import { MemoryStorage } from '@noutynotes/storage';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { chooseFolder, supportsFolderAccess } from './folderAccess';
import { useHydrated } from '../components/useHydrated';

interface Session {
  readonly storage: WorkspaceStorage;
  readonly mode: 'memory' | 'folder';
  readonly folderSupported: boolean;
  connectFolder(): Promise<{ ok: true } | { ok: false; message: string }>;
}
const StorageContext = createContext<Session | null>(null);

/**
 * Raíz de composición del prototipo (ADR 0009): una única instancia de MemoryStorage por carga
 * de la app. Sobrevive a la navegación y a los cambios de tema; se pierde al recargar o cerrar.
 * Las pantallas solo conocen el puerto `WorkspaceStorage`.
 */
export function WorkspaceSessionProvider({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const [storage, setStorage] = useState<WorkspaceStorage>(() => new MemoryStorage());
  const [mode, setMode] = useState<'memory' | 'folder'>('memory');
  const connectFolder = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    try {
      const selected = await chooseFolder();
      if (!selected) return { ok: false, message: 'Este navegador no admite el acceso a carpetas.' };
      const listed = await selected.list();
      if (!listed.ok) return { ok: false, message: listed.issues[0]?.message ?? 'No se pudo leer la carpeta.' };
      setStorage(selected);
      setMode('folder');
      return { ok: true };
    } catch (cause) {
      if ((cause as { name?: string }).name === 'AbortError') return { ok: false, message: 'No se seleccionó ninguna carpeta.' };
      return { ok: false, message: 'No se pudo abrir la carpeta. Revisa los permisos y vuelve a intentarlo.' };
    }
  };
  return <StorageContext.Provider value={{ storage, mode, folderSupported: hydrated && supportsFolderAccess(), connectFolder }}>{children}</StorageContext.Provider>;
}

export function useWorkspaceStorage(): WorkspaceStorage {
  return useWorkspaceSession().storage;
}

export function useWorkspaceSession(): Session {
  const session = useContext(StorageContext);
  if (!session) throw new Error('useWorkspaceSession requiere WorkspaceSessionProvider.');
  return session;
}
