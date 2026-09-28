import { isArchiveInstant } from '../cards/trashed-card';
import { checkOptionalText, checkRequiredText, isRecord, issue, listAt } from '../errors';
import type { DomainIssue } from '../errors';
import { checkId, checkUniqueIds, isValidId } from '../ids';
import type { BoardId, CardId } from '../ids';

/**
 * Tablero archivado como unidad (ADR 0039): el tablero (sin tarjetas, se reconstruye vacío al
 * restaurar) y la lista de tarjetas que se archivaron con él, en su orden original. Cada tarjeta
 * sigue siendo también una entrada normal de `workspace.archive`, restaurable por su cuenta.
 */
export interface ArchivedBoard {
  readonly board: { readonly id: BoardId; readonly title: string; readonly description?: string };
  readonly archivedAt: string;
  readonly cardIds: readonly CardId[];
}

/**
 * `cardIds` es la pertenencia histórica (qué se archivó junto con el tablero), no una referencia
 * estricta al Archivo actual: una de esas tarjetas puede restaurarse o purgarse por su cuenta más
 * tarde sin que eso invalide el resto de la unidad (`restoreArchivedBoard` la omite e informa).
 */
export function collectArchivedBoardsIssues(value: unknown, activeBoardIds: ReadonlySet<string>, issues: DomainIssue[]): void {
  if (value === undefined) return;
  const entries = listAt(value, 'archivedBoards', issues);
  const boardIds: unknown[] = [];
  entries.forEach((entry, i) => {
    const path = `archivedBoards[${i}]`;
    if (!isRecord(entry) || !isRecord(entry.board)) {
      issues.push(issue('invalid-value', path, 'Debe tener un tablero y la fecha de archivo.'));
      return;
    }
    checkId(entry.board.id, `${path}.board.id`, issues);
    checkRequiredText(entry.board.title, `${path}.board.title`, issues);
    checkOptionalText(entry.board.description, `${path}.board.description`, issues);
    if (isValidId(entry.board.id)) {
      boardIds.push(entry.board.id);
      if (activeBoardIds.has(entry.board.id)) {
        issues.push(issue('duplicate-id', `${path}.board.id`, `"${entry.board.id}" ya es un tablero activo.`));
      }
    }
    if (!isArchiveInstant(entry.archivedAt)) issues.push(issue('invalid-value', `${path}.archivedAt`, 'Debe ser una fecha y hora ISO 8601 en UTC.'));
    const cardIds = listAt(entry.cardIds, `${path}.cardIds`, issues);
    cardIds.forEach((cardId, j) => checkId(cardId, `${path}.cardIds[${j}]`, issues));
    checkUniqueIds(cardIds, `${path}.cardIds`, `el tablero archivado "${String(entry.board.id)}"`, issues);
  });
  checkUniqueIds(boardIds, 'archivedBoards', 'los tableros archivados', issues);
}
