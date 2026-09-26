import { describe, expect, it } from 'vitest';

import { addBoardToWorkspace, addCardToBoard, createEmptyWorkspaceNamed } from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import type { BoardId } from '../../packages/domain/src/index';
import { MemoryStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

async function session() {
  const storage = new MemoryStorage();
  const summary = ok(await createEmptyWorkspaceNamed(storage, 'Guion'));
  return { storage, workspaceId: summary.id };
}

describe('tableros del workspace (experiencia del workspace, ADR 0013)', () => {
  it('crea tableros con ID secuencial, título y layout vacío, y los conserva al reabrir', async () => {
    const { storage, workspaceId } = await session();
    expect(ok(await addBoardToWorkspace(storage, workspaceId, { title: '  Escenas  ' }))).toBe('tablero-1');
    expect(ok(await addBoardToWorkspace(storage, workspaceId, {}))).toBe('tablero-2');
    const workspace = ok(await storage.open(workspaceId));
    expect(workspace.boards).toEqual([
      { id: 'tablero-1', title: 'Escenas', cardIds: [] },
      { id: 'tablero-2', title: 'Tablero 2', cardIds: [] },
    ]);
    expect(workspace.layouts).toEqual([
      { boardId: 'tablero-1', placements: [] },
      { boardId: 'tablero-2', placements: [] },
    ]);
  });

  it('añade tarjetas al tablero indicado sin tocar los demás; sin tablero indicado usa el primero', async () => {
    const { storage, workspaceId } = await session();
    const first = ok(await addBoardToWorkspace(storage, workspaceId, { title: 'Ideas' }));
    const second = ok(await addBoardToWorkspace(storage, workspaceId, { title: 'Personajes' }));
    ok(await addCardToBoard(storage, workspaceId, { kind: 'note', boardId: second }));
    ok(await addCardToBoard(storage, workspaceId, { kind: 'note' }));
    const workspace = ok(await storage.open(workspaceId));
    expect(workspace.boards.map((board) => [board.id, board.cardIds])).toEqual([[first, ['tarjeta-2']], [second, ['tarjeta-1']]]);
    // Cada tablero coloca en su propio layout: ambas tarjetas empiezan en (0, 0).
    expect(workspace.layouts.map((layout) => [layout.boardId, layout.placements.map(({ rect }) => [rect.x, rect.y])]))
      .toEqual([[first, [[0, 0]]], [second, [[0, 0]]]]);
  });

  it('un tablero inexistente o un título inválido no guardan nada', async () => {
    const { storage, workspaceId } = await session();
    const before = ok(await storage.open(workspaceId));
    const missing = await addCardToBoard(storage, workspaceId, { kind: 'note', boardId: 'no-existe' as BoardId });
    expect(missing.ok).toBe(false);
    expect(missing.ok ? [] : missing.issues[0]?.details?.map(({ code }) => code)).toEqual(['missing-reference']);
    const badTitle = await addBoardToWorkspace(storage, workspaceId, { title: 42 as unknown as string });
    expect(badTitle.ok).toBe(false);
    expect(ok(await storage.open(workspaceId))).toEqual(before);
  });
});
