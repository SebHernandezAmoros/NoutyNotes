import { describe, expect, it } from 'vitest';

import { restoreArchivedCard } from '../cards/archive';
import { DESKTOP_GRID } from '../layouts/grid';
import { id, ideaA, problems, validWorkspace } from '../__fixtures__/workspace';
import type { BoardId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import { archiveBoard, restoreArchivedBoard } from './archive';

const overview = id<BoardId>('overview');
const research = id<BoardId>('research');
const at = '2026-09-26T10:00:00.000Z';

function ok<T>(result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('Archivar un tablero como unidad (ADR 0039)', () => {
  it('archiva cada una de sus tarjetas (también fuera de otros tableros que las comparten) y quita el tablero y su layout', () => {
    const source = validWorkspace();
    // «research» solo tiene idea-a, que también está en «overview»: archivar «research» se la lleva de ambos.
    const archived = ok(archiveBoard(source, research, at));
    expect(archived.boards.map((board) => board.id)).toEqual([overview]);
    expect(archived.boards[0]?.cardIds).toEqual(['idea-b']);
    expect(archived.layouts.some((layout) => layout.boardId === research)).toBe(false);
    expect(archived.cards.map((card) => card.id)).toEqual(['idea-b']);
    expect(archived.archive).toHaveLength(1);
    expect(archived.archive?.[0]).toMatchObject({ card: ideaA, archivedAt: at });
    expect(archived.archivedBoards).toEqual([{ board: { id: research, title: 'Investigación' }, archivedAt: at, cardIds: [ideaA.id] }]);
    expect(problems(validateWorkspace(archived))).toEqual([]);
  });

  it('restaurar recrea el tablero y devuelve cada tarjeta a su sitio exacto (no al tablero de reserva)', () => {
    const source = validWorkspace();
    const archived = ok(archiveBoard(source, research, at));
    const { workspace, report } = ok(restoreArchivedBoard(archived, research, DESKTOP_GRID));
    expect(report).toEqual({ restored: 1, skipped: 0 });
    const restoredBoard = workspace.boards.find((board) => board.id === research);
    expect(restoredBoard).toMatchObject({ id: research, title: 'Investigación', cardIds: [ideaA.id] });
    // «overview» también recupera idea-a: la instantánea de la tarjeta recordaba los dos tableros.
    expect(workspace.boards.find((board) => board.id === overview)?.cardIds).toEqual([ideaA.id, 'idea-b']);
    expect(workspace.archivedBoards ?? []).toEqual([]);
    expect(problems(validateWorkspace(workspace))).toEqual([]);
  });

  it('una tarjeta de la unidad ya restaurada aparte no rompe el resto: se omite y se informa', () => {
    const source = validWorkspace();
    const archived = ok(archiveBoard(source, research, at));
    // Se restaura idea-a por su cuenta antes de restaurar el tablero.
    const cardRestored = ok(restoreArchivedCard(archived, ideaA.id, { fallbackBoardId: overview, config: DESKTOP_GRID })).workspace;
    const { workspace, report } = ok(restoreArchivedBoard(cardRestored, research, DESKTOP_GRID));
    expect(report).toEqual({ restored: 0, skipped: 1 });
    expect(workspace.boards.find((board) => board.id === research)).toMatchObject({ cardIds: [] });
    expect(problems(validateWorkspace(workspace))).toEqual([]);
  });

  it('errores claros: tablero inexistente, sin tarjetas, fecha inválida, o restaurar algo que no está archivado', () => {
    const source = validWorkspace();
    expect(archiveBoard(source, id<BoardId>('no-existe'), at).ok).toBe(false);
    expect(archiveBoard(source, research, 'ayer').ok).toBe(false);
    const empty = { ...source, boards: [...source.boards, { id: id<BoardId>('vacio'), title: 'Vacío', cardIds: [] }] };
    expect(archiveBoard(empty, id<BoardId>('vacio'), at).ok).toBe(false);
    expect(restoreArchivedBoard(source, research, DESKTOP_GRID).ok).toBe(false);
  });
});
