import { describe, expect, it } from 'vitest';

import { ideaA, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { ReactiveWorkspaceEditor } from './reactive-workspace';
import { editCardContent } from './workspace-editing';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class ControlledStorage implements WorkspaceStorage {
  workspace = validWorkspace();
  saves: Workspace[] = [];
  nextSave: Promise<WorkspaceStorageResult<WorkspaceSummary>> | null = null;
  openCount = 0;
  acknowledged = 0;

  async create(workspace: Workspace) { this.workspace = workspace; return this.summary(); }
  async save(workspace: Workspace) {
    this.saves.push(workspace);
    const result = this.nextSave ? await this.nextSave : this.summary(workspace);
    this.nextSave = null;
    if (result.ok) this.workspace = workspace;
    return result;
  }
  async open(_id: WorkspaceId) { this.openCount += 1; return { ok: true as const, value: structuredClone(this.workspace) }; }
  async list() { return { ok: true as const, value: [this.summary().value] }; }
  async rename() { return this.summary(); }
  async delete() { return { ok: true as const, value: null }; }
  acknowledgeExternalChange() { this.acknowledged += 1; }

  private summary(workspace = this.workspace): { ok: true; value: WorkspaceSummary } {
    return { ok: true, value: { id: workspace.id, name: workspace.metadata.name } };
  }
}

const titleOf = (workspace: Workspace) => workspace.cards.find((card) => card.id === ideaA.id)?.title;
const titleOfCard = (workspace: Workspace, cardId: string) => workspace.cards.find((card) => card.id === cardId)?.title;

describe('ReactiveWorkspaceEditor (UX7 P18-E1)', () => {
  it('publica la transformación antes de que termine el guardado y no vuelve a abrir', async () => {
    const storage = new ControlledStorage();
    const gate = deferred<WorkspaceStorageResult<WorkspaceSummary>>();
    storage.nextSave = gate.promise;
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);

    const request = editor.dispatch(
      (port, id) => editCardContent(port, id, ideaA.id, { title: 'Visible ya' }),
      { label: 'Texto guardado', mergeKey: `title:${ideaA.id}` },
    );

    expect((await request.applied).ok).toBe(true);
    expect(titleOf(editor.snapshot().workspace)).toBe('Visible ya');
    expect(editor.snapshot().status).toBe('saving');
    expect(storage.openCount).toBe(0);
    expect(storage.saves).toHaveLength(1);

    gate.resolve({ ok: true, value: { id: storage.workspace.id, name: storage.workspace.metadata.name } });
    expect((await request.persisted).ok).toBe(true);
    expect(editor.snapshot().status).toBe('saved');
    expect(storage.openCount).toBe(0);
  });

  it('conserva el orden de cambios rápidos aunque la primera escritura sea lenta', async () => {
    const storage = new ControlledStorage();
    const first = deferred<WorkspaceStorageResult<WorkspaceSummary>>();
    storage.nextSave = first.promise;
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);

    const a = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'A' }), { label: 'A' });
    await a.applied;
    const b = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'B' }), { label: 'B' });
    await b.applied;

    expect(titleOf(editor.snapshot().workspace)).toBe('B');
    expect(storage.saves).toHaveLength(1);
    first.resolve({ ok: true, value: { id: storage.workspace.id, name: storage.workspace.metadata.name } });
    await a.persisted;
    expect((await b.persisted).ok).toBe(true);
    expect(storage.saves.map(titleOf)).toEqual(['A', 'B']);
  });

  it('integra historial y cambios pendientes sin restaurar por encima de una operación posterior', async () => {
    const storage = new ControlledStorage();
    const first = deferred<WorkspaceStorageResult<WorkspaceSummary>>();
    storage.nextSave = first.promise;
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);
    const changed = editor.dispatch(
      (port, id) => editCardContent(port, id, ideaA.id, { title: 'Todavía pendiente' }),
      { label: 'Texto', mergeKey: `title:${ideaA.id}` },
    );
    await changed.applied;

    const undone = editor.undo();
    expect(undone).not.toBeNull();
    await undone?.applied;
    expect(titleOf(editor.snapshot().workspace)).toBe('Idea A');
    expect(editor.snapshot().pendingCount).toBe(2);
    expect(storage.saves).toHaveLength(1);

    first.resolve({ ok: true, value: { id: storage.workspace.id, name: storage.workspace.metadata.name } });
    await changed.persisted;
    expect((await undone?.persisted)?.ok).toBe(true);
    expect(storage.saves.map(titleOf)).toEqual(['Todavía pendiente', 'Idea A']);
    expect(editor.snapshot().history.future).toHaveLength(1);
  });

  it('mantiene cambios fallidos de notas distintas y los reintenta en orden', async () => {
    const storage = new ControlledStorage();
    storage.nextSave = Promise.resolve({ ok: false, issues: [{ code: 'io-failure', path: 'workspace', message: 'disco ocupado' }] });
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);
    const request = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'Pendiente' }), { label: 'Texto' });

    expect((await request.persisted).ok).toBe(false);
    expect(editor.snapshot()).toMatchObject({ status: 'error', pendingCount: 1 });
    expect(titleOf(editor.snapshot().workspace)).toBe('Pendiente');

    const second = editor.dispatch(
      (port, id) => editCardContent(port, id, 'idea-b' as typeof ideaA.id, { title: 'Otra pendiente' }),
      { label: 'Otro texto' },
    );
    expect((await second.applied).ok).toBe(true);
    expect((await second.persisted).ok).toBe(false);
    expect(editor.snapshot().pendingCount).toBe(2);
    expect(titleOfCard(editor.snapshot().workspace, 'idea-b')).toBe('Otra pendiente');

    expect((await editor.retry()).ok).toBe(true);
    expect(editor.snapshot()).toMatchObject({ status: 'saved', pendingCount: 0 });
    expect(storage.saves.map(titleOf)).toEqual(['Pendiente', 'Pendiente', 'Pendiente']);
    expect(titleOfCard(storage.workspace, 'idea-b')).toBe('Otra pendiente');
  });

  it('agrupa texto y rehace sobre la instantánea visible confirmada', async () => {
    const storage = new ControlledStorage();
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);
    const first = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'Uno' }),
      { label: 'Texto', mergeKey: `title:${ideaA.id}` });
    await first.persisted;
    const second = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'Dos' }),
      { label: 'Texto', mergeKey: `title:${ideaA.id}` });
    await second.persisted;
    expect(editor.snapshot().history.past).toHaveLength(1);

    const undone = editor.undo();
    expect((await undone?.persisted)?.ok).toBe(true);
    expect(titleOf(editor.snapshot().workspace)).toBe('Idea A');
    const redone = editor.redo();
    expect((await redone?.persisted)?.ok).toBe(true);
    expect(titleOf(editor.snapshot().workspace)).toBe('Dos');
  });

  it('reabre explícitamente un conflicto externo, reaplica lo pendiente y permite deshacerlo', async () => {
    const storage = new ControlledStorage();
    storage.nextSave = Promise.resolve({ ok: false, issues: [{ code: 'external-change', path: 'workspace', message: 'cambió fuera' }] });
    const editor = new ReactiveWorkspaceEditor(storage, storage.workspace.id, storage.workspace);
    const request = editor.dispatch((port, id) => editCardContent(port, id, ideaA.id, { title: 'Local' }), { label: 'Texto' });
    await request.persisted;
    storage.workspace = { ...validWorkspace(), metadata: { ...validWorkspace().metadata, description: 'Externa' } };

    expect((await editor.recoverExternal()).ok).toBe(true);
    expect(editor.snapshot().workspace.metadata.description).toBe('Externa');
    expect(titleOf(editor.snapshot().workspace)).toBe('Local');
    expect(storage.acknowledged).toBe(1);
    expect(storage.openCount).toBe(1);

    const undone = editor.undo();
    expect(undone).not.toBeNull();
    await undone?.applied;
    expect(titleOf(editor.snapshot().workspace)).toBe('Idea A');
  });
});
