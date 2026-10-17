import type { WorkspaceAssets } from '@noutynotes/application';
import type { AssetRef, WorkspaceId } from '@noutynotes/domain';
import { useLocale } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { isPdfSignature } from '../session/assetMime';
import type { PdfPreviewState } from './PdfPreview';

/**
 * Ciclo de vida del visor de PDF embebido (UX7-F, extraído en UX7.1-A4 para que lo compartan Assets y
 * una tarjeta de documento del Canvas, sin un segundo sistema de vista previa). `requestId` descarta
 * una lectura en curso si se abre otro documento o se cierra el visor mientras tanto; el Blob URL se
 * revoca en su propio efecto de limpieza, nunca al asignarlo. `workspaceId` recordado junto al estado
 * hace que cambiar de proyecto nunca deje visible un PDF del Workspace anterior, sin tocar refs ni
 * `setState` durante el render ni dentro de un efecto (reglas de hooks de este proyecto).
 */
export function usePdfPreview(assets: WorkspaceAssets | null, workspaceId: WorkspaceId | undefined) {
  const { locale } = useLocale();
  const [raw, setRaw] = useState<{ readonly workspaceId: WorkspaceId; readonly state: PdfPreviewState } | null>(null);
  const preview = raw && raw.workspaceId === workspaceId ? raw.state : null;
  const requestRef = useRef(0);

  useEffect(() => {
    if (preview?.status !== 'ready') return undefined;
    const url = preview.url;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const open = async (entry: { readonly ref: string; readonly name: string }) => {
    if (!assets || !workspaceId) return;
    const requestId = ++requestRef.current;
    const openedWorkspaceId = workspaceId;
    setRaw({ workspaceId: openedWorkspaceId, state: { status: 'loading', name: entry.name } });
    const read = await assets.readAsset(openedWorkspaceId, entry.ref as AssetRef);
    if (requestRef.current !== requestId) return; // se cerró o se abrió otro documento mientras tanto
    if (!read.ok) {
      setRaw({ workspaceId: openedWorkspaceId, state: { status: 'error', name: entry.name, message: read.issues[0]?.message ?? t('assets.error.readFailed', locale) } });
      return;
    }
    if (!isPdfSignature(read.value)) {
      setRaw({ workspaceId: openedWorkspaceId, state: { status: 'error', name: entry.name, message: t('assets.pdf.error.invalid', locale) } });
      return;
    }
    const url = URL.createObjectURL(new Blob([read.value as BlobPart], { type: 'application/pdf' }));
    setRaw({ workspaceId: openedWorkspaceId, state: { status: 'ready', name: entry.name, url } });
  };
  const close = () => {
    requestRef.current += 1;
    setRaw(null);
  };

  return { preview, open, close };
}
