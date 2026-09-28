/**
 * Archivar un tablero completo (ADR 0039): reutiliza el archivado de tarjeta a tarjeta ya existente
 * (ADR 0023), no lo duplica. Al terminar, el tablero (ya sin tarjetas) se quita del workspace junto
 * con su layout, y queda una unidad en `archivedBoards` para poder restaurarlo entero.
 */
import { archiveCard, restoreArchivedCard } from '../cards/archive';
import { isArchiveInstant } from '../cards/trashed-card';
import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import type { BoardId } from '../ids';
import type { GridConfig } from '../layouts/grid';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import type { ArchivedBoard } from './archived-board';

/** Archiva un tablero: cada una de sus tarjetas, en una sola transacción, y luego el tablero mismo. */
export function archiveBoard(workspace: Workspace, boardId: BoardId, archivedAt: string): ValidationResult<Workspace> {
  if (!isArchiveInstant(archivedAt)) return failure([issue('invalid-value', 'archivedAt', 'Debe ser una fecha y hora ISO 8601 en UTC.')]);
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure([...source.issues]);
  const board = workspace.boards.find((candidate) => candidate.id === boardId);
  if (!board) return failure([issue('missing-reference', 'boardId', 'El tablero no existe en el workspace.')]);
  if (board.cardIds.length === 0) return failure([issue('invalid-value', 'boardId', 'El tablero no tiene tarjetas que archivar.')]);

  // De atrás hacia adelante: cada `archiveCard` relee el índice de la tarjeta en el tablero en ese
  // momento (`setAsideCard`), que se va encogiendo. Archivando desde el final, el índice de cada una
  // ya archivada no cambia por las que se archivan después, y la posición original queda intacta.
  let current = workspace;
  for (const cardId of [...board.cardIds].reverse()) {
    const archived = archiveCard(current, cardId, archivedAt);
    if (!archived.ok) return failure([...archived.issues]);
    current = archived.value;
  }
  const entry: ArchivedBoard = {
    board: { id: board.id, title: board.title, ...(board.description === undefined ? {} : { description: board.description }) },
    archivedAt,
    cardIds: board.cardIds,
  };
  return validateWorkspace({
    ...current,
    boards: current.boards.filter((candidate) => candidate.id !== boardId),
    layouts: current.layouts.filter((layout) => layout.boardId !== boardId),
    archivedBoards: [...(workspace.archivedBoards ?? []), entry],
  });
}

export interface RestoreBoardReport {
  readonly restored: number;
  /** Tarjetas de la unidad que ya no estaban en el Archivo (restauradas o eliminadas aparte). */
  readonly skipped: number;
}

/**
 * Restaura un tablero archivado: lo recrea vacío con su ID original y luego restaura cada una de
 * sus tarjetas — como ya recuerdan ese tablero en su propia instantánea, vuelven a él directamente,
 * sin tablero de reserva. Una tarjeta que ya no está en el Archivo se omite, sin fallar el resto.
 */
export function restoreArchivedBoard(
  workspace: Workspace, boardId: BoardId, config: GridConfig,
): ValidationResult<{ readonly workspace: Workspace; readonly report: RestoreBoardReport }> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure([...source.issues]);
  const entry = workspace.archivedBoards?.find((candidate) => candidate.board.id === boardId);
  if (!entry) return failure([issue('missing-reference', 'boardId', 'Ese tablero no está en el Archivo.')]);
  if (workspace.boards.some((candidate) => candidate.id === boardId)) {
    return failure([issue('duplicate-id', 'boardId', 'Ya existe un tablero activo con ese identificador.')]);
  }

  let current: Workspace = {
    ...workspace,
    boards: [...workspace.boards, { ...entry.board, cardIds: [] }],
    archivedBoards: (workspace.archivedBoards ?? []).filter((candidate) => candidate !== entry),
  };
  let restored = 0;
  let skipped = 0;
  for (const cardId of entry.cardIds) {
    if (!current.archive?.some((candidate) => candidate.card.id === cardId)) {
      skipped += 1;
      continue;
    }
    const result = restoreArchivedCard(current, cardId, { fallbackBoardId: boardId, config });
    if (!result.ok) return failure([...result.issues]);
    current = result.value.workspace;
    restored += 1;
  }
  const restoredWorkspace = validateWorkspace(current);
  if (!restoredWorkspace.ok) return failure([...restoredWorkspace.issues]);
  return resultOf({ workspace: restoredWorkspace.value, report: { restored, skipped } }, []);
}
