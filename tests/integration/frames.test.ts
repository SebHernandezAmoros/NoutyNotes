import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, addNoteToFrame, createEmptyWorkspaceNamed, groupCardsInFrame, moveCardOnBoard, moveFrameOnBoard, removeFrameFromBoard,
  renameFrameOnBoard, resizeFrameOnBoard,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, Workspace } from '../../packages/domain/src/index';
import { frameMembers } from '../../packages/domain/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const boardId = 'principal' as BoardId;
const layoutOf = (workspace: Workspace) => workspace.layouts.find((layout) => layout.boardId === boardId);

describe('Marcos (ADR 0027)', () => {
  it('agrupar, mover con sus tarjetas, añadir una nota dentro, renombrar, cambiar el tamaño y quitar', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Viaje'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'A' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'B' }));
    // Lejos, para que el marco de a y b no la pise.
    const c = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'C' }));
    ok(await moveCardOnBoard(storage, id, { boardId, cardId: c, to: { x: 30, y: 0 } }));
    ok(await moveCardOnBoard(storage, id, { boardId, cardId: a, to: { x: 0, y: 1 } }));
    ok(await moveCardOnBoard(storage, id, { boardId, cardId: b, to: { x: 4, y: 1 } }));

    const frameId = ok(await groupCardsInFrame(storage, id, { boardId, cardIds: [a, b], title: 'Kioto' }));
    expect(frameId).toBe('marco-1');
    let layout = layoutOf(ok(await storage.open(id)));
    expect(layout?.frames).toEqual([{ id: 'marco-1', title: 'Kioto', rect: { x: 0, y: 0, w: 8, h: 4 } }]);
    expect(layout ? frameMembers(layout, frameId) : []).toEqual([a, b]);

    ok(await moveFrameOnBoard(storage, id, { boardId, frameId, delta: { x: 0, y: 10 } }));
    layout = layoutOf(ok(await storage.open(id)));
    expect(layout?.frames?.[0]?.rect.y).toBe(10);
    expect(layout?.placements.map((placement) => [placement.cardId, placement.rect.y])).toEqual([[a, 11], [b, 11], [c, 0]]);

    // Sin hueco dentro (las dos tarjetas lo llenan): no se crea nada.
    expect((await addNoteToFrame(storage, id, { boardId, frameId })).ok).toBe(false);
    ok(await resizeFrameOnBoard(storage, id, { boardId, frameId, size: { w: 8, h: 7 } }));
    const note = ok(await addNoteToFrame(storage, id, { boardId, frameId, createdAt: '2026-09-26T10:00:00.000Z' }));
    layout = layoutOf(ok(await storage.open(id)));
    expect(layout ? frameMembers(layout, frameId) : []).toEqual([a, b, note]);

    ok(await renameFrameOnBoard(storage, id, { boardId, frameId, title: 'Kioto y Nara' }));
    expect(layoutOf(ok(await storage.open(id)))?.frames?.[0]?.title).toBe('Kioto y Nara');
    // Agrupar c sola crea otro marco con otro ID.
    expect(ok(await groupCardsInFrame(storage, id, { boardId, cardIds: [c], title: 'Suelta' }))).toBe('marco-2');

    const before = layoutOf(ok(await storage.open(id)))?.placements;
    ok(await removeFrameFromBoard(storage, id, { boardId, frameId }));
    const after = layoutOf(ok(await storage.open(id)));
    expect(after?.frames?.map((frame) => frame.id)).toEqual(['marco-2']);
    expect(after?.placements).toEqual(before);
  });
});
