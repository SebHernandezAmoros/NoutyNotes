import type { WorkspaceStorage, WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeFailure } from '../session/messages';
import { useWorkspaceSession, useWorkspaceStorage } from '../session/WorkspaceSession';

export type WorkspaceView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing'; readonly message: string }
  | { readonly kind: 'ready'; readonly workspace: Workspace };

export interface Feedback {
  readonly tone: 'error' | 'success';
  readonly text: string;
}

export type WorkspaceAction<T> = (storage: WorkspaceStorage, id: WorkspaceId) => Promise<WorkspaceStorageResult<T>>;

/**
 * Estado de pantalla de un workspace: lo lee del puerto y despacha casos de uso. Las acciones se
 * encadenan en serie para que cada una parta de lo guardado por la anterior; tras un éxito se
 * vuelve a abrir el workspace. La UI nunca modifica el objeto recibido.
 */
export function useWorkspaceEditor(id: string | undefined) {
  const storage = useWorkspaceStorage();
  const { mode } = useWorkspaceSession();
  const workspaceId = (id ?? '') as WorkspaceId;
  const [view, setView] = useState<WorkspaceView>({ kind: 'loading' });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);

  const reload = useCallback(async () => {
    const opened = await storage.open(workspaceId);
    if (!mounted.current) return;
    setView(opened.ok ? { kind: 'ready', workspace: opened.value } : { kind: 'missing', message: describeFailure(opened.issues, mode) });
  }, [storage, workspaceId, mode]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const run = useCallback(<T>(action: WorkspaceAction<T>, success: string): Promise<WorkspaceStorageResult<T>> => {
    setSaving(true);
    const task = queue.current.then(async () => {
      const result = await action(storage, workspaceId);
      if (mounted.current) {
        setFeedback(result.ok ? { tone: 'success', text: mode === 'folder' ? success.replace('Guardado en memoria.', 'Guardado en la carpeta.') : success } : { tone: 'error', text: describeFailure(result.issues, mode) });
      }
      if (result.ok) await reload();
      if (mounted.current) setSaving(false);
      return result;
    });
    queue.current = task.catch(() => { if (mounted.current) setSaving(false); });
    return task;
  }, [storage, workspaceId, reload, mode]);

  return { view, feedback, saving, run };
}
