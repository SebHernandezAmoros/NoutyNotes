import { validateWorkspace } from '@noutynotes/domain';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { EMPTY_HISTORY, recordStep, redoStep, undoStep } from './history';
import type { UndoHistory } from './history';
import { storageFailure } from './workspace-storage';
import type { WorkspaceStorage, WorkspaceStorageIssue, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';

export type ReactiveWorkspaceAction<T> = (
  storage: WorkspaceStorage,
  id: WorkspaceId,
) => Promise<WorkspaceStorageResult<T>>;

export interface ReactiveRunOptions {
  readonly label: string;
  readonly mergeKey?: string;
  readonly history?: 'record' | 'clear' | 'skip';
  readonly refreshEditors?: boolean;
}

export type ReactiveSaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

export interface ReactiveWorkspaceSnapshot {
  readonly workspace: Workspace;
  readonly confirmed: Workspace;
  readonly status: ReactiveSaveStatus;
  readonly pendingCount: number;
  readonly issues: readonly WorkspaceStorageIssue[];
  readonly history: UndoHistory;
  /** Cambia cuando una navegación histórica o recuperación debe reiniciar borradores locales. */
  readonly revision: number;
  /** Número de instantáneas confirmadas por el puerto durante esta sesión. */
  readonly persistedRevision: number;
}

export interface ReactiveDispatch<T> {
  /** Termina cuando el caso de uso produjo y publicó su instantánea local. */
  readonly applied: Promise<WorkspaceStorageResult<T>>;
  /** Termina con el primer intento de persistencia de esta operación. */
  readonly persisted: Promise<WorkspaceStorageResult<T>>;
}

interface Capture<T> {
  readonly result: WorkspaceStorageResult<T>;
  readonly candidate: Workspace | null;
}

interface PendingOperation<T = unknown> {
  readonly action: ReactiveWorkspaceAction<T>;
  /** Base visible exacta sobre la que se calculó la operación local. */
  readonly base: Workspace;
  candidate: Workspace;
  readonly result: WorkspaceStorageResult<T>;
  readonly options: ReactiveRunOptions;
  settled: boolean;
  readonly settle: (result: WorkspaceStorageResult<T>) => void;
}

type Listener = (snapshot: ReactiveWorkspaceSnapshot) => void;

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayIdentity(value: unknown): string | null {
  if (!isPlainRecord(value)) return null;
  for (const key of ['id', 'cardId', 'boardId'] as const) {
    if (typeof value[key] === 'string') return `${key}=${value[key]}`;
  }
  return null;
}

/** Diferencias semánticas conservadoras entre dos instantáneas de datos planos. */
function changedPaths(before: unknown, after: unknown, path = 'workspace', output = new Set<string>()): Set<string> {
  if (Object.is(before, after)) return output;
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeKeys = before.map(arrayIdentity);
    const afterKeys = after.map(arrayIdentity);
    const keyed = [...beforeKeys, ...afterKeys].every((key) => key !== null)
      && new Set(beforeKeys).size === beforeKeys.length
      && new Set(afterKeys).size === afterKeys.length;
    if (keyed) {
      const left = new Map(beforeKeys.map((key, index) => [key as string, before[index]]));
      const right = new Map(afterKeys.map((key, index) => [key as string, after[index]]));
      for (const key of new Set([...left.keys(), ...right.keys()])) {
        changedPaths(left.get(key), right.get(key), `${path}[${key}]`, output);
      }
      return output;
    }
    if (before.length !== after.length) output.add(path);
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      changedPaths(before[index], after[index], `${path}[${index}]`, output);
    }
    return output;
  }
  if (isPlainRecord(before) && isPlainRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changedPaths(before[key], after[key], `${path}.${key}`, output);
    }
    return output;
  }
  output.add(path);
  return output;
}

/** Título y cuerpo son campos atómicos: E1 no intenta fusionar internamente documentos ricos. */
function conflictUnit(path: string): string {
  const marker = /\.(titleRichText|contentDocument|content)(?:\.|\[|$)/.exec(path);
  const unit = marker?.[1];
  return marker?.index === undefined || unit === undefined ? path : path.slice(0, marker.index + 1 + unit.length);
}

function overlappingChanges(base: Workspace, local: Workspace, external: Workspace): string[] {
  const localPaths = [...changedPaths(base, local)].map(conflictUnit);
  const externalPaths = [...changedPaths(base, external)].map(conflictUnit);
  return [...new Set(localPaths.filter((localPath) => externalPaths.some((externalPath) =>
    localPath === externalPath || localPath.startsWith(`${externalPath}.`) || localPath.startsWith(`${externalPath}[`)
    || externalPath.startsWith(`${localPath}.`) || externalPath.startsWith(`${localPath}[`))))];
}

function failure<T>(issues: readonly WorkspaceStorageIssue[]): WorkspaceStorageResult<T> {
  return { ok: false, issues };
}

function unsupported<T>(operation: string): Promise<WorkspaceStorageResult<T>> {
  return Promise.resolve(storageFailure('io-failure', operation, `La operación ${operation} no admite actualización reactiva.`));
}

/**
 * Coordinador de P18-E1. El caso de uso transforma una sola vez una instantánea en memoria; esa
 * misma instantánea se publica y se guarda después, en orden. Un error conserva tanto la vista
 * como la cola para reintento y nunca restaura globalmente un estado anterior.
 */
export class ReactiveWorkspaceEditor {
  private visible: Workspace;
  private confirmed: Workspace;
  private history: UndoHistory = EMPTY_HISTORY;
  private pending: PendingOperation[] = [];
  private blockedIssues: readonly WorkspaceStorageIssue[] = [];
  private revision = 0;
  private persistedRevision = 0;
  private listeners = new Set<Listener>();
  private applyTail: Promise<void> = Promise.resolve();
  private processing: Promise<WorkspaceStorageResult<void>> | null = null;

  constructor(
    private readonly storage: WorkspaceStorage,
    private readonly id: WorkspaceId,
    initial: Workspace,
  ) {
    this.visible = initial;
    this.confirmed = initial;
  }

  snapshot(): ReactiveWorkspaceSnapshot {
    const status: ReactiveSaveStatus = this.blockedIssues[0]?.code === 'external-change'
      ? 'conflict'
      : this.blockedIssues.length > 0
        ? 'error'
        : this.pending.length > 0
          ? 'saving'
          : 'saved';
    return {
      workspace: this.visible,
      confirmed: this.confirmed,
      status,
      pendingCount: this.pending.length,
      issues: this.blockedIssues,
      history: this.history,
      revision: this.revision,
      persistedRevision: this.persistedRevision,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Incorpora el resultado de una operación no reactiva una vez vaciada la cola. */
  adopt(workspace: Workspace, options: ReactiveRunOptions): void {
    if (this.pending.length > 0) throw new Error('No se puede adoptar una instantánea con guardados pendientes.');
    const before = this.visible;
    this.visible = workspace;
    this.confirmed = workspace;
    this.blockedIssues = [];
    if (options.history === 'clear') this.history = EMPTY_HISTORY;
    else if (options.history !== 'skip') {
      this.history = recordStep(this.history, {
        label: options.label,
        before,
        after: workspace,
        ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
      });
    }
    this.persistedRevision += 1;
    this.emit();
  }

  dispatch<T>(action: ReactiveWorkspaceAction<T>, options: ReactiveRunOptions): ReactiveDispatch<T> {
    let settle!: (result: WorkspaceStorageResult<T>) => void;
    const persisted = new Promise<WorkspaceStorageResult<T>>((resolve) => { settle = resolve; });
    let finishApplied!: (result: WorkspaceStorageResult<T>) => void;
    const applied = new Promise<WorkspaceStorageResult<T>>((resolve) => { finishApplied = resolve; });

    const apply = async () => {
      const before = this.visible;
      const captured = await this.capture(action, before);
      if (!captured.result.ok || !captured.candidate) {
        finishApplied(captured.result);
        settle(captured.result);
        return;
      }
      this.visible = captured.candidate;
      if (options.history === 'clear') this.history = EMPTY_HISTORY;
      else if (options.history !== 'skip') {
        this.history = recordStep(this.history, {
          label: options.label,
          before,
          after: captured.candidate,
          ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
        });
      }
      if (options.refreshEditors) this.revision += 1;
      const operation: PendingOperation<T> = {
        action,
        base: before,
        candidate: captured.candidate,
        result: captured.result,
        options,
        settled: false,
        settle,
      };
      this.pending.push(operation as PendingOperation);
      finishApplied(captured.result);
      this.emit();
      if (this.blockedIssues.length > 0) this.settle(operation, failure(this.blockedIssues));
      else void this.ensureProcessing();
    };
    this.applyTail = this.applyTail.then(apply, apply);
    return { applied, persisted };
  }

  undo(): ReactiveDispatch<WorkspaceSummary> | null {
    const moved = undoStep(this.history);
    if (!moved) return null;
    this.history = moved.history;
    return this.replace(moved.step.before, `Deshacer: ${moved.step.label}`);
  }

  redo(): ReactiveDispatch<WorkspaceSummary> | null {
    const moved = redoStep(this.history);
    if (!moved) return null;
    this.history = moved.history;
    return this.replace(moved.step.after, `Rehacer: ${moved.step.label}`);
  }

  async retry(): Promise<WorkspaceStorageResult<void>> {
    await this.applyTail;
    if (this.pending.length === 0) return { ok: true, value: undefined };
    if (this.blockedIssues[0]?.code === 'external-change') return failure(this.blockedIssues);
    this.blockedIssues = [];
    this.emit();
    return this.ensureProcessing();
  }

  /**
   * Recuperación explícita: reconoce el cambio, abre la versión externa y reaplica, en orden, solo
   * las operaciones aún no confirmadas. El historial se reconstruye sobre la nueva base para que
   * deshacer no elimine información externa.
   */
  async recoverExternal(): Promise<WorkspaceStorageResult<void>> {
    await this.applyTail;
    if (this.blockedIssues[0]?.code !== 'external-change') return this.retry();
    if (!this.storage.acknowledgeExternalChange) {
      return storageFailure('external-change', 'workspace', 'Este almacenamiento no permite reconocer el cambio externo.');
    }
    await this.storage.acknowledgeExternalChange(this.id);
    const opened = await this.storage.open(this.id);
    if (!opened.ok) return failure(opened.issues);

    let base = opened.value;
    let rebuilt: UndoHistory = EMPTY_HISTORY;
    for (const operation of this.pending) {
      const before = base;
      const conflicts = overlappingChanges(operation.base, operation.candidate, base);
      if (conflicts.length > 0) {
        this.blockedIssues = [{
          code: 'external-change',
          path: conflicts[0] as string,
          message: 'El mismo contenido cambió fuera de NoutyNotes. La versión externa permanece guardada y el cambio local se conserva en esta sesión para resolverlo manualmente.',
          details: conflicts.map((path) => ({ code: 'concurrent-change', path, message: 'Cambio local y externo sobre la misma unidad de contenido.' })),
        }];
        this.emit();
        return failure(this.blockedIssues);
      }
      const captured = await this.capture(operation.action, base);
      if (!captured.result.ok || !captured.candidate) {
        this.blockedIssues = [{
          code: 'external-change', path: 'workspace',
          message: 'La versión externa ya no admite una operación local pendiente. El cambio local se conserva en esta sesión para resolverlo manualmente.',
          ...(captured.result.ok ? {} : { details: captured.result.issues }),
        }];
        this.emit();
        return failure(this.blockedIssues);
      }
      base = captured.candidate;
      operation.candidate = base;
      if (operation.options.history !== 'skip') {
        rebuilt = operation.options.history === 'clear' ? EMPTY_HISTORY : recordStep(rebuilt, {
          label: operation.options.label,
          before,
          after: base,
          ...(operation.options.mergeKey ? { mergeKey: operation.options.mergeKey } : {}),
        });
      }
    }
    this.confirmed = opened.value;
    this.visible = base;
    this.history = rebuilt;
    this.blockedIssues = [];
    this.revision += 1;
    this.emit();
    return this.ensureProcessing();
  }

  /** Espera transformaciones y escrituras; devuelve error si queda trabajo recuperable. */
  async flush(): Promise<WorkspaceStorageResult<void>> {
    await this.applyTail;
    if (this.processing) await this.processing;
    return this.pending.length === 0
      ? { ok: true, value: undefined }
      : failure(this.blockedIssues.length > 0
        ? this.blockedIssues
        : [{ code: 'io-failure', path: 'workspace', message: 'Quedan cambios pendientes de guardar.' }]);
  }

  private replace(target: Workspace, label: string): ReactiveDispatch<WorkspaceSummary> {
    this.revision += 1;
    return this.dispatch(async (storage) => storage.save(target), { label, history: 'skip' });
  }

  private async capture<T>(action: ReactiveWorkspaceAction<T>, base: Workspace): Promise<Capture<T>> {
    let candidate: Workspace | null = null;
    const port: WorkspaceStorage = {
      open: async (id) => id === this.id
        ? { ok: true, value: base }
        : storageFailure('workspace-not-found', 'id', 'El workspace solicitado no está abierto.'),
      save: async (workspace) => {
        const checked = validateWorkspace(workspace);
        if (!checked.ok) return storageFailure('invalid-workspace', 'workspace', 'El workspace transformado no es válido.', checked.issues);
        if (workspace.id !== this.id) return storageFailure('invalid-workspace', 'workspace.id', 'La transformación no puede cambiar el ID.');
        candidate = workspace;
        return { ok: true, value: { id: workspace.id, name: workspace.metadata.name } };
      },
      create: () => unsupported('create'),
      list: () => unsupported('list'),
      rename: () => unsupported('rename'),
      delete: () => unsupported('delete'),
    };
    const result = await action(port, this.id);
    return { result, candidate };
  }

  private async ensureProcessing(): Promise<WorkspaceStorageResult<void>> {
    if (this.processing) return this.processing;
    this.processing = this.processPending().finally(() => {
      this.processing = null;
      if (this.pending.length > 0 && this.blockedIssues.length === 0) void this.ensureProcessing();
    });
    return this.processing;
  }

  private async processPending(): Promise<WorkspaceStorageResult<void>> {
    while (this.pending.length > 0 && this.blockedIssues.length === 0) {
      const operation = this.pending[0] as PendingOperation;
      const saved = await this.storage.save(operation.candidate);
      if (!saved.ok) {
        this.blockedIssues = saved.issues;
        for (const queued of this.pending) this.settle(queued, failure(saved.issues));
        this.emit();
        return failure(saved.issues);
      }
      this.confirmed = operation.candidate;
      this.pending.shift();
      this.persistedRevision += 1;
      this.settle(operation, operation.result);
      this.emit();
    }
    return { ok: true, value: undefined };
  }

  private settle<T>(operation: PendingOperation<T>, result: WorkspaceStorageResult<T>) {
    if (operation.settled) return;
    operation.settled = true;
    operation.settle(result);
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
