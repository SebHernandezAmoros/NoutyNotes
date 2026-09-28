import { describe, expect, it } from 'vitest';

import {
  addBoardToWorkspace, addCardToBoard, addNoteImage, buildAssetCatalog, connectCards, createEmptyWorkspaceNamed, deleteUnusedAssets, moveBoardToArchive, moveCardToArchive, moveCardToTrash,
  purgeCardFromTrash, restoreBoardFromArchive, restoreCardFromArchive, restoreCardsFromArchive, searchWorkspace, sendArchivedCardsToTrash, sendArchivedToTrash, takenCardIds,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { AssetRef, BoardId } from '../../packages/domain/src/index';
import { ArchiveStorage, readWorkspaceArchive } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const at = '2026-09-26T10:00:00.000Z';

describe('Archivo (ADR 0023)', () => {
  it('archivar aparta sin destruir: fuera de tableros y búsquedas, dentro del ZIP; restaurar recupera sitio y conexiones', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Estudio'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Borrador viejo' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Plan' }));
    ok(await connectCards(storage, id, { from: a, to: b }));
    ok(await moveCardToArchive(storage, id, a, at));
    const archived = ok(await storage.open(id));
    expect(archived.cards.map((card) => card.id)).toEqual([b]);
    expect(archived.relations).toEqual([]);
    expect(archived.archive?.map((entry) => [entry.card.id, entry.archivedAt])).toEqual([[a, at]]);
    expect(searchWorkspace(archived, 'borrador')).toEqual([]);
    // El ID sigue reservado: una tarjeta nueva no lo reutiliza.
    expect(takenCardIds(archived)).toContain(a);
    const c = ok(await addCardToBoard(storage, id, { kind: 'note' }));
    expect(c).not.toBe(a);
    const zip = readWorkspaceArchive(ok(storage.exportArchive(id)).bytes);
    if (!zip.ok) throw new Error('ZIP inválido');
    expect(zip.value.files['.nouty/archive.yaml']).toContain('Borrador viejo');

    const report = ok(await restoreCardFromArchive(storage, id, { cardId: a, fallbackBoardId: 'principal' as BoardId }));
    // La tarjeta nueva ocupó su hueco mientras estaba archivada: vuelve al primer hueco libre y el informe lo dice.
    expect(report).toEqual({ relocated: ['principal'], addedToFallback: false, skippedRelations: 0 });
    const restored = ok(await storage.open(id));
    expect(restored.archive ?? []).toEqual([]);
    expect(restored.relations.map((relation) => `${relation.from}→${relation.to}`)).toEqual([`${a}→${b}`]);
  });

  it('eliminar desde el Archivo la envía a la Papelera; los assets de una archivada siguen en uso', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Estudio'));
    const note = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Con foto' }));
    const { ref } = ok(await addNoteImage(storage, storage, id, note, { bytes: PNG, fileName: 'foto.png', content: 'Hoy.', place: { kind: 'insert' } }));
    const other = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Otra' }));
    ok(await moveCardToArchive(storage, id, note, at));
    // En el Archivo, su imagen sigue en uso: ni «sin usar» ni borrable.
    const catalog = buildAssetCatalog(ok(await storage.open(id)), ok(await storage.listAssets(id)));
    expect(catalog.find((entry) => entry.ref === ref)).toMatchObject({ unused: false, usedBy: [{ cardId: note, inArchive: true }] });
    expect(ok(await deleteUnusedAssets(storage, storage, id, [ref])).inUse).toEqual([ref]);
    // Purgar otra tarjeta de la Papelera no libera la imagen de la archivada.
    ok(await moveCardToTrash(storage, id, other));
    expect(ok(await purgeCardFromTrash(storage, storage, id, other)).releasedAssets).toEqual([]);

    ok(await sendArchivedToTrash(storage, id, note));
    const after = ok(await storage.open(id));
    expect(after.archive ?? []).toEqual([]);
    expect(after.trash?.map((entry) => entry.card.id)).toEqual([note]);
    expect((await storage.readAsset(id, ref as AssetRef)).ok).toBe(true);
  });

  it('archivar un tablero completo (ADR 0039): se lleva sus tarjetas, y restaurarlo las devuelve a su sitio', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Estudio'));
    const guion = ok(await addBoardToWorkspace(storage, id, { title: 'Guion' }));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Escena 1', boardId: guion }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Escena 2', boardId: guion }));
    ok(await connectCards(storage, id, { from: a, to: b }));

    ok(await moveBoardToArchive(storage, id, guion, at));
    const archived = ok(await storage.open(id));
    expect(archived.boards.map((board) => board.id)).not.toContain(guion);
    expect(archived.cards.map((card) => card.id)).not.toEqual(expect.arrayContaining([a, b]));
    expect(archived.archive?.map((entry) => entry.card.id).sort()).toEqual([a, b].sort());
    expect(archived.archivedBoards).toEqual([{ board: { id: guion, title: 'Guion' }, archivedAt: at, cardIds: [a, b] }]);

    const report = ok(await restoreBoardFromArchive(storage, id, guion));
    expect(report).toEqual({ restored: 2, skipped: 0 });
    const restored = ok(await storage.open(id));
    expect(restored.boards.find((board) => board.id === guion)).toMatchObject({ title: 'Guion', cardIds: [a, b] });
    expect(restored.archivedBoards ?? []).toEqual([]);
    expect(restored.relations.map((relation) => `${relation.from}→${relation.to}`)).toEqual([`${a}→${b}`]);
  });

  it('selección múltiple en el Archivo (ADR 0039): restaurar o enviar a la Papelera varias tarjetas en una sola escritura', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Estudio'));
    const a = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Una' }));
    const b = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Dos' }));
    const c = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Tres' }));
    ok(await moveCardToArchive(storage, id, a, at));
    ok(await moveCardToArchive(storage, id, b, at));
    ok(await moveCardToArchive(storage, id, c, at));

    ok(await restoreCardsFromArchive(storage, id, { cardIds: [a, b], fallbackBoardId: 'principal' as BoardId }));
    const afterRestore = ok(await storage.open(id));
    expect(afterRestore.cards.map((card) => card.id).sort()).toEqual([a, b].sort());
    expect(afterRestore.archive?.map((entry) => entry.card.id)).toEqual([c]);

    ok(await sendArchivedCardsToTrash(storage, id, [c]));
    const afterTrash = ok(await storage.open(id));
    expect(afterTrash.archive ?? []).toEqual([]);
    expect(afterTrash.trash?.map((entry) => entry.card.id)).toEqual([c]);
  });
});
