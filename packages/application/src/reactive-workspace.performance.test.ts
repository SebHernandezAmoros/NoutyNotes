import { describe, expect, it } from 'vitest';

import { ideaA, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import type { Workspace, WorkspaceId } from '@noutynotes/domain';

import { ReactiveWorkspaceEditor } from './reactive-workspace';
import { editCardContent } from './workspace-editing';
import type { WorkspaceStorage, WorkspaceSummary } from './workspace-storage';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class MeasuredStorage implements WorkspaceStorage {
  workspace = validWorkspace();
  opens = 0;
  saves = 0;

  async create(workspace: Workspace) { this.workspace = workspace; return this.summary(); }
  async save(workspace: Workspace) { this.saves += 1; await wait(40); this.workspace = workspace; return this.summary(); }
  async open(_id: WorkspaceId) { this.opens += 1; await wait(10); return { ok: true as const, value: structuredClone(this.workspace) }; }
  async list() { return { ok: true as const, value: [this.summary().value] }; }
  async rename() { return this.summary(); }
  async delete() { return { ok: true as const, value: null }; }

  private summary(): { ok: true; value: WorkspaceSummary } {
    return { ok: true, value: { id: this.workspace.id, name: this.workspace.metadata.name } };
  }
}

describe('medición controlada de P18-E1', () => {
  it('reduce aperturas físicas y desacopla la respuesta visual de la latencia de guardado', async () => {
    const legacy = new MeasuredStorage();
    const legacyStart = performance.now();
    await editCardContent(legacy, legacy.workspace.id, ideaA.id, { title: 'Anterior' });
    await legacy.open(legacy.workspace.id);
    const legacyVisualMs = performance.now() - legacyStart;

    const reactive = new MeasuredStorage();
    const editor = new ReactiveWorkspaceEditor(reactive, reactive.workspace.id, reactive.workspace);
    const reactiveStart = performance.now();
    const request = editor.dispatch(
      (port, id) => editCardContent(port, id, ideaA.id, { title: 'Reactivo' }),
      { label: 'Texto' },
    );
    await request.applied;
    const reactiveVisualMs = performance.now() - reactiveStart;
    await request.persisted;

    console.info(JSON.stringify({
      legacy: { actionToVisualMs: Number(legacyVisualMs.toFixed(2)), physicalOpens: legacy.opens, physicalSaves: legacy.saves },
      reactive: { actionToVisualMs: Number(reactiveVisualMs.toFixed(2)), physicalOpens: reactive.opens, physicalSaves: reactive.saves },
    }));
    expect(legacy.opens).toBe(2);
    expect(reactive.opens).toBe(0);
    expect(legacy.saves).toBe(1);
    expect(reactive.saves).toBe(1);
    expect(reactiveVisualMs).toBeLessThan(legacyVisualMs);
  });
});
