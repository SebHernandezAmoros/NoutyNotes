import { annotateDocumentInDiary, localDay } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import { useState } from 'react';

import { isPdfFileName } from '../session/assetMime';
import type { AnnotateSaveInput, AnnotateTarget } from './AnnotateInDiaryDialog';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

/**
 * Estado y guardado de «Anotar en Diario» (B9-R4-11), extraído para que lo compartan Assets y la
 * tarjeta de documento del Canvas sin dos copias de la misma lógica — mismo criterio que
 * `usePdfPreview`/`useTextAssetPreview`. `closeOtherPreviews` cierra el visor de documento abierto
 * antes de mostrar el formulario (un solo diálogo visible a la vez, nunca anidado).
 */
export function useAnnotateInDiary(run: Run, closeOtherPreviews: () => void) {
  const [target, setTarget] = useState<AnnotateTarget | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const start = (ref: string, name: string) => {
    closeOtherPreviews();
    setJustSaved(false);
    setTarget({ ref, name, kind: isPdfFileName(ref) ? 'pdf' : /\.(?:md|markdown)$/i.test(name) ? 'markdown' : 'txt' });
  };
  const save = async (input: AnnotateSaveInput): Promise<boolean> => {
    if (!target) return false;
    const day = localDay(new Date().toISOString(), new Date().getTimezoneOffset());
    const result = await run(
      (storage, workspaceId) => annotateDocumentInDiary(storage, workspaceId, {
        day, createdAt: new Date().toISOString(), documentRef: target.ref, documentName: target.name, ...input,
      }),
      { key: 'action.diaryAnnotationSaved' },
    );
    if (result.ok) { setTarget(null); setJustSaved(true); }
    return result.ok;
  };

  return { target, justSaved, dismissJustSaved: () => setJustSaved(false), start, save, close: () => setTarget(null) };
}
