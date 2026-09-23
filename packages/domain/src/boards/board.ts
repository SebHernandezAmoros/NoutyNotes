import { checkOptionalText, checkRequiredText, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds } from '../ids';
import type { BoardId, CardId } from '../ids';

/**
 * Vista organizada de tarjetas del workspace. Declara qué tarjetas muestra y en qué orden, pero
 * no posee su contenido: una tarjeta puede aparecer en varios boards o en ninguno, y retirarla
 * de un board no la elimina del workspace.
 */
export interface Board {
  readonly id: BoardId;
  readonly title: string;
  readonly description?: string;
  readonly cardIds: readonly CardId[];
}

export function collectBoardIssues(board: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(board)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(board.id, `${path}.id`, issues);
  checkRequiredText(board.title, `${path}.title`, issues);
  checkOptionalText(board.description, `${path}.description`, issues);
  const cardIds = listAt(board.cardIds, `${path}.cardIds`, issues);
  cardIds.forEach((cardId, index) => checkId(cardId, `${path}.cardIds[${index}]`, issues));
  checkUniqueIds(cardIds, `${path}.cardIds`, `el board "${String(board.id)}"`, issues);
}

export function validateBoard(board: Board): ValidationResult<Board> {
  const issues: DomainIssue[] = [];
  collectBoardIssues(board, 'board', issues);
  return resultOf(board, issues);
}
