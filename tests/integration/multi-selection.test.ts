import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, connectCards, createEmptyWorkspaceNamed, moveCardsOnBoard, moveCardsToArchive, moveCardsToTrash,
  restoreCardFromArchive, restoreCardFromTrash,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId, CardId, Workspace } from '../../packages/domain/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const board = 'principal' as BoardId;
const at = '2026-09-26T10:00:00.000Z';
const rect = (workspace: Workspace, cardId: CardId) => workspace.layouts[0]?.placements.find((placement) => placement.cardId === cardId)?.rect;

/** Cuenta los guardados: cada acción sobre el conjunto es una sola escritura. */
function counting(storage: ArchiveStorage) {
  let saves = 0;
  const save = storage.save.bind(storage);
  storage.save = (workspace) => { saves += 1; return save(workspace); };
  return () => saves;
}

describe('Selección múltiple (ADR 0025)', () => {
  it('mover, archivar y enviar a la Papelera un conjunto es una sola escritura; si una falla no cambia nada; cada tarjeta se restaura sola', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Mesa'));
    const [a, b, c, d] = [
      ok(await addCardToBoard(storage, id, { kind: 'note', title: 'A' })),
      ok(await addCardToBoard(storage, id, { kind: 'note', title: 'B' })),
      ok(await addCardToBoard(storage, id, { kind: 'note', title: 'C' })),
      ok(await addCardToBoard(storage, id, { kind: 'note', title: 'D' })),
    ];
    ok(await connectCards(storage, id, { from: a, to: c }));
    const saves = counting(storage);
    const before = ok(await storage.open(id));

    ok(await moveCardsOnBoard(storage, id, { boardId: board, cardIds: [a, b], delta: { x: 0, y: 40 } }));
    const moved = ok(await storage.open(id));
    expect([rect(moved, a)?.y, rect(moved, b)?.y]).toEqual([(rect(before, a)?.y ?? 0) + 40, (rect(before, b)?.y ?? 0) + 40]);
    expect(rect(moved, c)).toEqual(rect(before, c));
    // Chocar con una tarjeta de fuera: no se mueve ninguna.
    const cRect = rect(moved, c);
    const aRect = rect(moved, a);
    if (!cRect || !aRect) throw new Error('sin colocación');
    const blocked = await moveCardsOnBoard(storage, id, { boardId: board, cardIds: [a, b], delta: { x: cRect.x - aRect.x, y: cRect.y - aRect.y } });
    expect(blocked.ok).toBe(false);
    expect(ok(await storage.open(id)).layouts).toEqual(moved.layouts);

    ok(await moveCardsToArchive(storage, id, [a, b], at));
    const archived = ok(await storage.open(id));
    expect(archived.cards.map((card) => card.id)).toEqual([c, d]);
    expect(archived.archive?.map((entry) => entry.card.id)).toEqual([a, b]);
    // Una tarjeta que no existe: ni siquiera se archiva la otra.
    expect((await moveCardsToTrash(storage, id, [c, 'no-existe' as CardId])).ok).toBe(false);
    ok(await moveCardsToTrash(storage, id, [c, d]));
    expect(saves()).toBe(3);

    // Cada una se restaura por separado y recupera su conexión cuando vuelve el otro extremo.
    ok(await restoreCardFromArchive(storage, id, { cardId: a, fallbackBoardId: board }));
    ok(await restoreCardFromTrash(storage, id, { cardId: c, fallbackBoardId: board }));
    const restored = ok(await storage.open(id));
    expect(restored.cards.map((card) => card.id).sort()).toEqual([a, c].sort());
    expect(restored.archive?.map((entry) => entry.card.id)).toEqual([b]);
    expect(restored.trash?.map((entry) => entry.card.id)).toEqual([d]);
  });
});
