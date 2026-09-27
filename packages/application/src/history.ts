/**
 * Deshacer y rehacer (ADR 0026). Pila pura de instantáneas: cada paso guarda el workspace de antes y el
 * de después tal como los devolvió el almacenamiento. Sin reloj ni efectos; el guardado lo hace
 * `revertWorkspace`.
 */
import type { Workspace } from '@noutynotes/domain';

export interface HistoryStep {
  /** Nombre de la acción para el aviso y la etiqueta accesible («Tarjeta movida»). */
  readonly label: string;
  readonly before: Workspace;
  readonly after: Workspace;
  /** Pasos seguidos con la misma clave (el texto de una tarjeta) se agrupan en uno. */
  readonly mergeKey?: string;
}

export interface UndoHistory {
  readonly past: readonly HistoryStep[];
  readonly future: readonly HistoryStep[];
}

export const EMPTY_HISTORY: UndoHistory = { past: [], future: [] };
export const HISTORY_LIMIT = 50;

/** Forma canónica: claves ordenadas y sin `undefined`, para comparar sin depender del orden. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return a === b || JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Añade un paso. Sin cambios no hay paso; una acción nueva vacía rehacer. */
export function recordStep(history: UndoHistory, step: HistoryStep, limit = HISTORY_LIMIT): UndoHistory {
  if (sameWorkspace(step.before, step.after)) return history;
  const last = history.past.at(-1);
  if (last && step.mergeKey !== undefined && last.mergeKey === step.mergeKey && history.future.length === 0) {
    return { past: [...history.past.slice(0, -1), { ...last, after: step.after }], future: [] };
  }
  return { past: [...history.past, step].slice(-limit), future: [] };
}

/** El paso que se deshace (hay que volver a `step.before`) y la pila resultante; null si no hay. */
export function undoStep(history: UndoHistory): { readonly step: HistoryStep; readonly history: UndoHistory } | null {
  const step = history.past.at(-1);
  if (!step) return null;
  return { step, history: { past: history.past.slice(0, -1), future: [...history.future, step] } };
}

/** El paso que se rehace (hay que volver a `step.after`); null si no hay. */
export function redoStep(history: UndoHistory): { readonly step: HistoryStep; readonly history: UndoHistory } | null {
  const step = history.future.at(-1);
  if (!step) return null;
  return { step, history: { past: [...history.past, step], future: history.future.slice(0, -1) } };
}
