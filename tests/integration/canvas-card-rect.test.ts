import { expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { duplicateSelection, editCardAppearance, moveCardsOnBoard, ReactiveWorkspaceEditor, resizeCardRectOnBoard } from '../../packages/application/src/index';
import { archiveCard, restoreArchivedCard, restoreTrashedCard, trashCard, WORLD_GRID } from '../../packages/domain/src/index';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { detachmentPng, detachmentPdf, detachmentRef, detachmentPdfRef } from '../fixtures/asset-detachment';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

it('un rect completo produce un único paso reversible y conserva el movimiento relativo del grupo', async () => {
  const source = canvasCardsWorkspace();
  const storage = new ArchiveStorage();
  value(await storage.create(source));
  const editor = new ReactiveWorkspaceEditor(storage, source.id, source);
  const boardId = source.boards[0]!.id;
  const cardId = source.cards[0]!.id;
  const rect = { x: 1, y: 1, w: 7, h: 6 };
  const resized = editor.dispatch((port, id) => resizeCardRectOnBoard(port, id, { boardId, cardId, rect }), { label: 'Tamaño' });
  value(await resized.persisted);
  expect(editor.snapshot().history.past).toHaveLength(1);
  expect(editor.snapshot().workspace.layouts[0]!.placements[0]!.rect).toEqual(rect);
  value(await editor.undo()!.persisted);
  expect(editor.snapshot().workspace.layouts).toEqual(source.layouts);
  value(await editor.redo()!.persisted);
  expect(editor.snapshot().workspace.layouts[0]!.placements[0]!.rect).toEqual(rect);
  // A shared Card on the second Board retains its own placement.
  expect(editor.snapshot().workspace.layouts[1]).toEqual(source.layouts[1]);
  const beforeMove = editor.snapshot().workspace;
  const moved = editor.dispatch((port, id) => moveCardsOnBoard(port, id, { boardId, cardIds: source.cards.slice(0, 2).map((card) => card.id), delta: { x: -2, y: 0 } }), { label: 'Mover grupo' });
  value(await moved.persisted);
  const actual = editor.snapshot().workspace;
  for (const index of [0, 1]) {
    const previous = beforeMove.layouts[0]!.placements[index]!.rect;
    expect(actual.layouts[0]!.placements[index]!.rect).toEqual({ ...previous, x: previous.x - 2 });
  }
  expect(actual.relations).toEqual(source.relations);
  expect(actual.cards).toEqual(source.cards);
  value(await editor.undo()!.persisted);
  expect(editor.snapshot().workspace).toEqual(beforeMove);
});

it('duplicar una Nota conserva el fondo explícito y el documento sin modificar el original', async () => {
  const source = canvasCardsWorkspace();
  const storage = new ArchiveStorage();
  value(await storage.create(source));
  const cardId = source.cards[0]!.id;
  value(await editCardAppearance(storage, source.id, cardId, { noteBackground: 'transparent', frameOverride: 'visible' }));
  const before = value(await storage.open(source.id));
  value(await duplicateSelection(storage, source.id, source.boards[0]!.id, [cardId]));
  const after = value(await storage.open(source.id));
  const copy = after.cards.find((card) => !before.cards.some((existing) => existing.id === card.id));
  expect(copy).toBeDefined();
  expect({ ...copy, id: cardId }).toEqual(before.cards.find((card) => card.id === cardId));
  expect(after.cards.find((card) => card.id === cardId)).toEqual(before.cards.find((card) => card.id === cardId));
});

it('carpeta, restauración y ZIP conservan rect, contenido, relaciones y bytes sin migración', async () => {
  const source = canvasCardsWorkspace();
  const tree = new MemoryDocumentTree();
  const folder = new FolderStorage(new DocumentTreeFolderPort(tree));
  value(await folder.create(source));
  const boardId = source.boards[0]!.id;
  const cardId = source.cards[0]!.id;
  const rect = { x: 1, y: 1, w: 7, h: 6 };
  value(await resizeCardRectOnBoard(folder, source.id, { boardId, cardId, rect }));
  const reopened = value(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(source.id));
  expect(reopened.layouts[0]!.placements[0]!.rect).toEqual(rect);
  expect(reopened.cards).toEqual(source.cards);
  const options = { fallbackBoardId: boardId, config: WORLD_GRID };
  const archived = value(archiveCard(reopened, cardId, '2026-10-25T12:00:00.000Z'));
  const restored = value(restoreArchivedCard(archived, cardId, options)).workspace;
  const fromTrash = value(restoreTrashedCard(value(trashCard(restored, cardId)), cardId, options)).workspace;
  expect(fromTrash.layouts.find((layout) => layout.boardId === boardId)!.placements.find((placement) => placement.cardId === cardId)!.rect).toEqual(rect);
  expect(fromTrash.relations).toEqual(source.relations);
  const storage = new ArchiveStorage();
  value(await storage.create(fromTrash));
  const bytes = new Uint8Array(Buffer.from(detachmentPng, 'base64'));
  value(await storage.writeAsset(source.id, detachmentRef, bytes));
  value(await storage.writeAsset(source.id, detachmentPdfRef, new Uint8Array(Buffer.from(detachmentPdf))));
  const zip = value(storage.exportArchive(source.id));
  const destination = new ArchiveStorage();
  value(await destination.importArchive(zip.bytes));
  const imported = value(await destination.open(source.id));
  // Existing codecs omit empty collections; absence and [] carry the same meaning.
  expect({ ...imported, archive: imported.archive ?? [], trash: imported.trash ?? [] }).toEqual(fromTrash);
  expect(value(await destination.readAsset(source.id, detachmentRef))).toEqual(bytes);
});
