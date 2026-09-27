import { describe, expect, it } from 'vitest';

import {
  EMPTY_HISTORY, addCardToBoard, createEmptyWorkspaceNamed, moveCardOnBoard, moveCardsToArchive, recordStep, redoStep, revertWorkspace, undoStep,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId } from '../../packages/domain/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const boardId = 'principal' as BoardId;

describe('Deshacer y rehacer (ADR 0026)', () => {
  it('vuelve al estado de antes y al de después; un cambio de fuera impide deshacer sin tocar nada', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Mesa'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'A' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'B' }));

    // Lo que hace la interfaz: estado de antes, acción, estado de después.
    let history = EMPTY_HISTORY;
    const step = async (label: string, action: () => Promise<WorkspaceStorageResult<unknown>>) => {
      const before = ok(await storage.open(id));
      ok(await action());
      history = recordStep(history, { label, before, after: ok(await storage.open(id)) });
    };
    const start = ok(await storage.open(id));
    await step('Tarjeta movida', () => moveCardOnBoard(storage, id, { boardId, cardId: a, to: { x: 0, y: 30 } }));
    await step('2 tarjetas archivadas', () => moveCardsToArchive(storage, id, [a, b], '2026-09-26T10:00:00.000Z'));
    const end = ok(await storage.open(id));

    const undone = undoStep(history);
    if (!undone) throw new Error('sin paso');
    ok(await revertWorkspace(storage, id, { expected: undone.step.after, target: undone.step.before }));
    const back = ok(await storage.open(id));
    expect(back.cards.map((card) => card.title)).toEqual(['A', 'B']);
    expect(back.archive ?? []).toEqual([]);
    const second = undoStep(undone.history);
    if (!second) throw new Error('sin paso');
    ok(await revertWorkspace(storage, id, { expected: second.step.after, target: second.step.before }));
    expect(ok(await storage.open(id)).layouts).toEqual(start.layouts);

    const redone = redoStep(second.history);
    if (!redone) throw new Error('sin paso');
    ok(await revertWorkspace(storage, id, { expected: redone.step.before, target: redone.step.after }));
    // Otra app (u otra ventana) cambia el proyecto: rehacer el archivado ya no coincide y no se toca nada.
    ok(await moveCardOnBoard(storage, id, { boardId, cardId: b, to: { x: 20, y: 0 } }));
    const changed = ok(await storage.open(id));
    const next = redoStep(redone.history);
    if (!next) throw new Error('sin paso');
    const refused = await revertWorkspace(storage, id, { expected: next.step.before, target: next.step.after });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.issues[0]?.code).toBe('external-change');
    expect(ok(await storage.open(id))).toEqual(changed);
    expect(end.archive?.length).toBe(2);
  });
});
