import type { WorkspaceStorage } from '@noutynotes/application';
import { MemoryStorage } from '@noutynotes/storage';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

const StorageContext = createContext<WorkspaceStorage | null>(null);

/**
 * Raíz de composición del prototipo (ADR 0009): una única instancia de MemoryStorage por carga
 * de la app. Sobrevive a la navegación y a los cambios de tema; se pierde al recargar o cerrar.
 * Las pantallas solo conocen el puerto `WorkspaceStorage`.
 */
export function WorkspaceSessionProvider({ children }: { readonly children: ReactNode }) {
  const [storage] = useState<WorkspaceStorage>(() => new MemoryStorage());
  return <StorageContext.Provider value={storage}>{children}</StorageContext.Provider>;
}

export function useWorkspaceStorage(): WorkspaceStorage {
  const storage = useContext(StorageContext);
  if (!storage) throw new Error('useWorkspaceStorage requiere WorkspaceSessionProvider.');
  return storage;
}
