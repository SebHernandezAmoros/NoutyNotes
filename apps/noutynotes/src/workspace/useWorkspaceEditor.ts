import { EMPTY_HISTORY, recordStep, redoStep, revertWorkspace, undoStep } from '@noutynotes/application';
import type { UndoHistory, WorkspaceStorage, WorkspaceStorageResult } from '@noutynotes/application';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';
import { useLocale } from '@noutynotes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { describeFailure } from '../session/messages';
import { useWorkspaceSession, useWorkspaceStorage } from '../session/WorkspaceSession';
import { composeSaved, resolveAction } from './actionFeedback';
import type { ActionSuccess } from './actionFeedback';
import { isSaveFailure } from './saveStatus';

export type { ActionSuccess } from './actionFeedback';

export type WorkspaceView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing'; readonly message: string }
  | { readonly kind: 'ready'; readonly workspace: Workspace };

export interface Feedback {
  readonly tone: 'error' | 'success';
  readonly text: string;
  /** Falló la carpeta (no una validación): la cabecera muestra «error al guardar». */
  readonly saveFailed?: boolean;
}

export type WorkspaceAction<T> = (storage: WorkspaceStorage, id: WorkspaceId) => Promise<WorkspaceStorageResult<T>>;

/** Cómo entra una acción en el historial (ADR 0026). Por defecto, un paso. */
export interface RunOptions {
  /** `clear`: borra archivos (irreversible) y vacía el historial. */
  readonly history?: 'record' | 'clear';
  /** Pasos seguidos con la misma clave se agrupan (el texto de una tarjeta). */
  readonly mergeKey?: string;
}

/**
 * Estado de pantalla de un workspace: lo lee del puerto y despacha casos de uso. Las acciones se
 * encadenan en serie para que cada una parta de lo guardado por la anterior; tras un éxito se
 * vuelve a abrir el workspace. La UI nunca modifica el objeto recibido.
 */
export function useWorkspaceEditor(id: string | undefined) {
  const storage = useWorkspaceStorage();
  const { mode } = useWorkspaceSession();
  const { locale } = useLocale();
  const workspaceId = (id ?? '') as WorkspaceId;
  const [view, setView] = useState<WorkspaceView>({ kind: 'loading' });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);
  // Historial de la sesión (ADR 0026): el último estado leído es el «antes» de la siguiente acción.
  const current = useRef<Workspace | null>(null);
  const history = useRef<UndoHistory>(EMPTY_HISTORY);
  const [steps, setSteps] = useState<UndoHistory>(EMPTY_HISTORY);
  // Cambia al deshacer o rehacer: los editores con borrador local se vuelven a montar con lo guardado.
  const [revision, setRevision] = useState(0);
  const setHistory = useCallback((next: UndoHistory) => {
    history.current = next;
    if (mounted.current) setSteps(next);
  }, []);

  const reload = useCallback(async (): Promise<Workspace | null> => {
    const opened = await storage.open(workspaceId);
    current.current = opened.ok ? opened.value : null;
    if (!mounted.current) return current.current;
    setView(opened.ok ? { kind: 'ready', workspace: opened.value } : { kind: 'missing', message: describeFailure(opened.issues, mode) });
    return current.current;
  }, [storage, workspaceId, mode]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const run = useCallback(<T>(action: WorkspaceAction<T>, success: ActionSuccess, options: RunOptions = {}): Promise<WorkspaceStorageResult<T>> => {
    setSaving(true);
    const { label, text } = resolveAction(success, mode, locale);
    const task = queue.current.then(async () => {
      const before = current.current;
      const result = await action(storage, workspaceId);
      if (mounted.current) {
        setFeedback(result.ok ? { tone: 'success', text } : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
      }
      if (result.ok) {
        const after = await reload();
        if (options.history === 'clear') setHistory(EMPTY_HISTORY);
        else if (before && after) {
          setHistory(recordStep(history.current, { label, before, after, ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}) }));
        }
      }
      if (mounted.current) setSaving(false);
      return result;
    });
    queue.current = task.catch(() => { if (mounted.current) setSaving(false); });
    return task;
  }, [storage, workspaceId, reload, mode, locale, setHistory]);

  // Deshacer o rehacer: vuelve a la instantánea solo si lo guardado sigue siendo el estado esperado.
  const travel = useCallback((direction: 'undo' | 'redo'): Promise<boolean> => {
    setSaving(true);
    const task = queue.current.then(async () => {
      const moved = direction === 'undo' ? undoStep(history.current) : redoStep(history.current);
      if (!moved) {
        if (mounted.current) setSaving(false);
        return false;
      }
      const { step } = moved;
      const result = await revertWorkspace(storage, workspaceId, direction === 'undo'
        ? { expected: step.after, target: step.before } : { expected: step.before, target: step.after });
      if (result.ok) {
        setHistory(moved.history);
        await reload();
        if (mounted.current) {
          setRevision((value) => value + 1);
          const prefix = t(direction === 'undo' ? 'workview.undone' : 'workview.redone', locale);
          setFeedback({ tone: 'success', text: composeSaved(`${prefix}: ${step.label}`, mode, locale) });
        }
      } else {
        const external = result.issues[0]?.path === 'history';
        // Otra app o ventana cambió el proyecto: el historial ya no describe lo guardado.
        if (external) setHistory(EMPTY_HISTORY);
        await reload();
        if (mounted.current) {
          setFeedback(external
            ? { tone: 'error', text: t('workview.externalChange', locale) }
            : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
        }
      }
      if (mounted.current) setSaving(false);
      return result.ok;
    });
    queue.current = task.catch(() => { if (mounted.current) setSaving(false); });
    return task;
  }, [storage, workspaceId, reload, mode, locale, setHistory]);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  return {
    view, feedback, saving, run, setFeedback, undo, redo, revision,
    undoLabel: steps.past.at(-1)?.label ?? null,
    redoLabel: steps.future.at(-1)?.label ?? null,
  };
}
