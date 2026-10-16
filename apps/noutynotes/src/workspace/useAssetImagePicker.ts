import type { WorkspaceStorage } from '@noutynotes/application';
import type { Workspace } from '@noutynotes/domain';
import { useRef, useState } from 'react';

import { useAssetImageCatalog } from './useAssetImageCatalog';

/**
 * Plomería del selector «Insertar desde Assets» (ASSET-04), compartida por edición rápida y enfocada:
 * una única instancia vive en `WorkspaceScreen` y se ofrece a ambas superficies como una promesa
 * (`pick`) — ninguna de las dos necesita conocer `storage`/`workspace` ni renderizar su propio diálogo.
 */
export function useAssetImagePicker(storage: WorkspaceStorage, workspace: Workspace | null) {
  const [visible, setVisible] = useState(false);
  const pending = useRef<((ref: string | null) => void) | null>(null);
  // Solo lee Assets mientras el selector está abierto; cerrarlo no deja una lectura obsoleta en memoria.
  const catalog = useAssetImageCatalog(storage, visible ? workspace : null);

  const pick = (): Promise<string | null> => new Promise((resolve) => {
    pending.current = resolve;
    setVisible(true);
  });
  const select = (ref: string) => {
    setVisible(false);
    pending.current?.(ref);
    pending.current = null;
  };
  const cancel = () => {
    setVisible(false);
    pending.current?.(null);
    pending.current = null;
  };
  return { visible, entries: catalog.entries, loading: catalog.loading, pick, select, cancel };
}
