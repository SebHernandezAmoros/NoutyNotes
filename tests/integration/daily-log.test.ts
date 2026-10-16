import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, createEmptyWorkspaceNamed, dailyLog, editCardContent, importImageCard, moveCardToArchive, moveCardToTrash, openDiaryEntry, restoreCardFromTrash, searchWorkspace,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('Daily Log con fechas reales (ADR 0024)', () => {
  it('las tarjetas creadas con fecha aparecen en su día; las entradas no duplican y viven fuera de los tableros', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Bitácora'));
    const nota = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Idea', createdAt: '2026-09-26T08:00:00.000Z' }));
    const antigua = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Sin fecha' }));
    const foto = ok(await importImageCard(storage, storage, id, { bytes: PNG, fileName: 'f.png', createdAt: '2026-09-26T09:00:00.000Z' }));
    const today = ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T10:00:00.000Z', reuse: true }));
    // «Escribir la nota de hoy» reutiliza la del día; «Nueva entrada» crea otra.
    expect(ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T11:00:00.000Z', reuse: true }))).toBe(today);
    const second = ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T12:00:00.000Z', reuse: false }));
    expect(second).not.toBe(today);
    ok(await moveCardToArchive(storage, id, nota, '2026-09-26T13:00:00.000Z'));

    const workspace = ok(await storage.open(id));
    expect(workspace.boards.flatMap((board) => board.cardIds)).not.toContain(today);
    const log = dailyLog(workspace, '2026-09-26', 0);
    expect(log.entries.map((card) => card.id)).toEqual([today, second]);
    expect(log.created.map((item) => [item.card.id, item.time])).toEqual([[foto, '09:00']]);
    expect(log.archived.map((item) => [item.card.id, item.time])).toEqual([[nota, '13:00']]);
    expect(workspace.cards.find((card) => card.id === antigua)?.createdAt).toBeUndefined();
    // Las entradas se buscan como cualquier tarjeta.
    expect(searchWorkspace(workspace, 'diario').map((result) => result.cardId)).toEqual(expect.arrayContaining([today, second]));
    expect(codes(await openDiaryEntry(storage, id, { day: '26/09/2026', createdAt: '2026-09-26T10:00:00.000Z', reuse: true }))).toContain('invalid-workspace');
  });

  it('conserva una entrada enriquecida al enviarla a Papelera, reabrir y restaurar al Diario', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Diario seguro'));
    const entryId = ok(await openDiaryEntry(storage, id, {
      day: '2026-10-16', createdAt: '2026-10-16T18:00:00.000Z', reuse: false,
    }));
    ok(await editCardContent(storage, id, entryId, { title: 'Legada', content: 'Primera línea\nSegunda <línea> con ñ.' }));
    const beforeOpen = tree.snapshot();
    expect(ok(await openDiaryEntry(storage, id, {
      day: '2026-10-16', createdAt: '2026-10-16T19:00:00.000Z', reuse: true,
    }))).toBe(entryId);
    expect(tree.snapshot()).toEqual(beforeOpen);

    const document = {
      schemaVersion: 1 as const,
      blocks: [
        { type: 'heading' as const, level: 2 as const, content: [{ type: 'text' as const, text: 'Balance' }] },
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Árbol, ñandú y <seguro>', marks: ['bold' as const] }] },
      ],
    };
    ok(await editCardContent(storage, id, entryId, { title: 'Día especial', contentDocument: document }));
    expect(searchWorkspace(ok(await storage.open(id)), 'ñandu')[0]).toMatchObject({ cardId: entryId, excerpt: expect.stringContaining('Árbol') });

    ok(await moveCardToTrash(storage, id, entryId));
    const reopenedTrash = new FolderStorage(new DocumentTreeFolderPort(tree));
    expect(ok(await reopenedTrash.open(id)).trash?.[0]?.card).toMatchObject({ id: entryId, contentDocument: document, fields: { fecha: '2026-10-16' } });

    const report = ok(await restoreCardFromTrash(reopenedTrash, id, { cardId: entryId, fallbackBoardId: 'principal' as BoardId }));
    expect(report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    const restored = ok(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id));
    expect(restored.cards.find((card) => card.id === entryId)).toMatchObject({ title: 'Día especial', contentDocument: document, fields: { fecha: '2026-10-16' } });
    expect(restored.boards.every((board) => !board.cardIds.includes(entryId))).toBe(true);
  });
});

function codes(result: WorkspaceStorageResult<unknown>) {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}
