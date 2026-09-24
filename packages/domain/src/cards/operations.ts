import { failure, isRecord, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { CardId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';

export interface DeleteCardOptions {
  /** Por defecto no permite borrar una tarjeta conectada; cascade elimina sus vínculos explícitamente. */
  readonly relations?: 'restrict' | 'cascade';
}

/** Borrado global atómico en memoria. No elimina assets ni archivos (ADR 0005). */
export function deleteCard(workspace: Workspace, cardId: CardId, options: DeleteCardOptions = {}): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(options)) return failure([issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')]);
  const policy = options.relations === undefined ? 'restrict' : options.relations;
  if (policy !== 'restrict' && policy !== 'cascade') {
    return failure([issue('invalid-value', 'options.relations', 'Debe ser restrict o cascade.')]);
  }
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  if (!workspace.cards.some(card => card.id === cardId)) {
    return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  }
  const incident = workspace.relations.some(relation => relation.from === cardId || relation.to === cardId);
  if (incident && policy === 'restrict') {
    return failure([issue('card-has-relations', 'cardId', 'La tarjeta tiene relaciones; eliminarlas o usar cascade explícitamente.')]);
  }
  return resultOf({
    ...workspace,
    cards: workspace.cards.filter(card => card.id !== cardId),
    relations: workspace.relations.filter(relation => relation.from !== cardId && relation.to !== cardId),
    boards: workspace.boards.map(board => board.cardIds.includes(cardId)
      ? { ...board, cardIds: board.cardIds.filter(member => member !== cardId) } : board),
    layouts: workspace.layouts.map(layout => layout.placements.some(placement => placement.cardId === cardId)
      ? { ...layout, placements: layout.placements.filter(placement => placement.cardId !== cardId) } : layout),
  }, []);
}
