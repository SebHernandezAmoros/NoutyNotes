import type { WorkspaceAssets } from '@noutynotes/application';
import type { AssetRef, RichTextDocument, WorkspaceId } from '@noutynotes/domain';
import { parseRichTextMarkdown } from '@noutynotes/storage';
import { useLocale } from '@noutynotes/ui';
import { useRef, useState } from 'react';

import { decodeTextAssetPreview } from '../session/textAssetPreview';

export interface TextAssetPreviewState {
  readonly name: string;
  readonly ref: string;
  readonly text: string;
  /** B9-R2-12: solo para `.md`/`.markdown` analizado con éxito; `null` deja el texto literal como está
   * (`.txt`, u otra construcción que `parseRichTextMarkdown` no modela a nivel de bloque). */
  readonly markdownDocument: RichTextDocument | null;
  /** B9-R4-04: el documento supera 1 MiB y solo se muestran sus primeros bytes (en una frontera UTF-8
   * válida) — nunca se recorta el archivo original ni su descarga. */
  readonly truncated: boolean;
}

/**
 * Ciclo de vida de la vista previa de texto/Markdown (B9-R3-06, mismo criterio que `usePdfPreview`
 * desde UX7.1-A4): extraído para que lo compartan Assets y una tarjeta de documento del Canvas, sin un
 * segundo sistema de vista previa. `workspaceId` recordado junto al estado evita que cambiar de
 * proyecto deje visible el texto de otro Workspace.
 */
export function useTextAssetPreview(assets: WorkspaceAssets | null, workspaceId: WorkspaceId | undefined) {
  const { locale } = useLocale();
  const [raw, setRaw] = useState<{ readonly workspaceId: WorkspaceId; readonly state: TextAssetPreviewState } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const preview = raw && raw.workspaceId === workspaceId ? raw.state : null;
  const requestRef = useRef(0);

  const open = async (entry: { readonly ref: string; readonly name: string }) => {
    if (!assets || !workspaceId) return;
    const requestId = ++requestRef.current;
    const openedWorkspaceId = workspaceId;
    setProblem(null);
    const read = await assets.readAsset(openedWorkspaceId, entry.ref as AssetRef);
    if (requestRef.current !== requestId) return; // se cerró o se abrió otro documento mientras tanto
    if (!read.ok) {
      setProblem(read.issues[0]?.message ?? (locale === 'es' ? 'No se pudo leer el archivo.' : 'Could not read the file.'));
      return;
    }
    const decoded = decodeTextAssetPreview(entry.name, read.value);
    if (!decoded.ok) {
      setProblem(locale === 'es' ? 'No se puede mostrar como texto UTF-8. Descarga el original.' : 'Cannot display as UTF-8 text. Download the original.');
      return;
    }
    const markdown = /\.(?:md|markdown)$/i.test(entry.name) ? parseRichTextMarkdown(decoded.text) : null;
    setRaw({ workspaceId: openedWorkspaceId, state: { name: entry.name, ref: entry.ref, text: decoded.text, markdownDocument: markdown?.ok ? markdown.value : null, truncated: decoded.truncated ?? false } });
  };
  const close = () => { requestRef.current += 1; setRaw(null); setProblem(null); };

  return { preview, problem, open, close };
}
