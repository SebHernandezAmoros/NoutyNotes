import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, createEmptyWorkspaceNamed, dailyLog, importImageCard, moveCardToArchive, openDiaryEntry, searchWorkspace,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { ArchiveStorage } from '../../packages/storage/src/index';

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
});

function codes(result: WorkspaceStorageResult<unknown>) {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}
