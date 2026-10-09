import { EMPTY_HISTORY, ReactiveWorkspaceEditor, recordStep } from '@noutynotes/application';
import type { ReactiveSaveStatus, ReactiveWorkspaceSnapshot, UndoHistory, WorkspaceStorage, WorkspaceStorageResult } from '@noutynotes/application';
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
  /** Publica la transformación antes de persistirla mediante la cola P18-E1. */
  readonly reactive?: boolean;
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
  const [saveState, setSaveState] = useState<ReactiveSaveStatus>('saved');
  const [pendingCount, setPendingCount] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);
  const reactive = useRef<ReactiveWorkspaceEditor | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
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

  const reflectReactive = useCallback((snapshot: ReactiveWorkspaceSnapshot) => {
    current.current = snapshot.workspace;
    history.current = snapshot.history;
    if (!mounted.current) return;
    setView({ kind: 'ready', workspace: snapshot.workspace });
    setSteps(snapshot.history);
    setRevision(snapshot.revision);
    setSaveState(snapshot.status);
    setPendingCount(snapshot.pendingCount);
    setSaving(snapshot.status === 'saving');
  }, []);

  const installReactive = useCallback((workspace: Workspace) => {
    unsubscribe.current?.();
    const next = new ReactiveWorkspaceEditor(storage, workspaceId, workspace);
    reactive.current = next;
    unsubscribe.current = next.subscribe(reflectReactive);
  }, [reflectReactive, storage, workspaceId]);

  const reload = useCallback(async (): Promise<Workspace | null> => {
    const opened = await storage.open(workspaceId);
    current.current = opened.ok ? opened.value : null;
    if (!mounted.current) return current.current;
    if (opened.ok) installReactive(opened.value);
    else setView({ kind: 'missing', message: describeFailure(opened.issues, mode) });
    return current.current;
  }, [storage, workspaceId, mode, installReactive]);

  useEffect(() => {
    mounted.current = true;
    // La carga comienza en la microtarea siguiente; el efecto solo instala/cancela la suscripción.
    void Promise.resolve().then(reload);
    return () => {
      mounted.current = false;
      unsubscribe.current?.();
      unsubscribe.current = null;
      reactive.current = null;
    };
  }, [reload]);

  const run = useCallback(<T>(action: WorkspaceAction<T>, success: ActionSuccess, options: RunOptions = {}): Promise<WorkspaceStorageResult<T>> => {
    const { label, text } = resolveAction(success, mode, locale);
    const active = reactive.current;
    if (options.reactive && active) {
      const request = active.dispatch(action, {
        label,
        ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
        ...(options.history ? { history: options.history } : {}),
      });
      void request.applied.then((result) => {
        if (!result.ok && mounted.current) {
          setFeedback({ tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
        }
      });
      return request.persisted.then((result) => {
        if (mounted.current) setFeedback(result.ok
          ? { tone: 'success', text }
          : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
        return result;
      });
    }
    setSaving(true);
    const task = queue.current.then(async () => {
      const flushed = await reactive.current?.flush();
      if (flushed && !flushed.ok) {
        const blocked = { ok: false as const, issues: flushed.issues };
        if (mounted.current) {
          setSaving(false);
          setFeedback({ tone: 'error', text: describeFailure(blocked.issues, mode), saveFailed: isSaveFailure(blocked.issues) });
        }
        return blocked as WorkspaceStorageResult<T>;
      }
      const before = current.current;
      const result = await action(storage, workspaceId);
      if (mounted.current) {
        setFeedback(result.ok ? { tone: 'success', text } : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
      }
      if (result.ok) {
        const opened = await storage.open(workspaceId);
        const after = opened.ok ? opened.value : null;
        current.current = after;
        if (after && reactive.current) reactive.current.adopt(after, {
          label,
          ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
          ...(options.history ? { history: options.history } : {}),
        });
        else if (after) installReactive(after);
        else if (mounted.current && !opened.ok) setView({ kind: 'missing', message: describeFailure(opened.issues, mode) });
        if (options.history === 'clear') setHistory(EMPTY_HISTORY);
        else if (before && after) {
          // `adopt` ya registró el paso en el coordinador; este fallback solo cubre la carga inicial.
          if (!reactive.current) setHistory(recordStep(history.current, { label, before, after, ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}) }));
        }
      }
      if (mounted.current) setSaving(false);
      return result;
    });
    queue.current = task.catch(() => { if (mounted.current) setSaving(false); });
    return task;
  }, [storage, workspaceId, mode, locale, setHistory, installReactive]);

  // Deshacer o rehacer también publica primero y respeta el orden de la cola reactiva.
  const travel = useCallback((direction: 'undo' | 'redo'): Promise<boolean> => {
    const editor = reactive.current;
    const step = direction === 'undo' ? history.current.past.at(-1) : history.current.future.at(-1);
    const request = editor ? (direction === 'undo' ? editor.undo() : editor.redo()) : null;
    if (!request || !step) return Promise.resolve(false);
    const task = request.persisted.then(async (result) => {
      if (result.ok) {
        if (mounted.current) {
          const prefix = t(direction === 'undo' ? 'workview.undone' : 'workview.redone', locale);
          setFeedback({ tone: 'success', text: composeSaved(`${prefix}: ${step.label}`, mode, locale) });
        }
      } else {
        if (mounted.current) {
          setFeedback({ tone: 'error', text: describeFailure(result.issues, mode), saveFailed: isSaveFailure(result.issues) });
        }
      }
      return result.ok;
    });
    return task;
  }, [mode, locale]);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  const retry = useCallback(async () => {
    const result = await reactive.current?.retry();
    if (result && mounted.current) setFeedback(result.ok
      ? { tone: 'success', text: composeSaved('Cambios reintentados', mode, locale) }
      : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: true });
    return result?.ok ?? false;
  }, [locale, mode]);
  const recoverExternal = useCallback(async () => {
    const result = await reactive.current?.recoverExternal();
    if (result && mounted.current) setFeedback(result.ok
      ? { tone: 'success', text: composeSaved('Cambios reaplicados', mode, locale) }
      : { tone: 'error', text: describeFailure(result.issues, mode), saveFailed: true });
    return result?.ok ?? false;
  }, [locale, mode]);
  const flush = useCallback(async () => (await reactive.current?.flush())?.ok ?? true, []);

  return {
    view, feedback, saving, saveState, pendingCount, run, setFeedback, undo, redo, retry, recoverExternal, flush, revision,
    undoLabel: steps.past.at(-1)?.label ?? null,
    redoLabel: steps.future.at(-1)?.label ?? null,
  };
}
