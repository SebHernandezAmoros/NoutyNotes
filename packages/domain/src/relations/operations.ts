import type { Card } from '../cards/card';
import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { CardId, RelationId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import { validateRelation } from './relation';
import type { Relation } from './relation';

/** Agrega una relación aportada por el llamador; valida referencias y unicidad antes de devolverla. */
export function createRelation(workspace: Workspace, relation: Relation): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  const checked = validateRelation(relation);
  if (!checked.ok) return failure(checked.issues);
  return validateWorkspace({ ...workspace, relations: [...workspace.relations, { ...relation }] });
}

/** Elimina exactamente un vínculo. No borra sus extremos ni altera la representación visual. */
export function deleteRelation(workspace: Workspace, relationId: RelationId): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isValidId(relationId)) return failure([issue('invalid-id', 'relationId', 'Identificador de relación inválido.')]);
  if (!workspace.relations.some(relation => relation.id === relationId)) {
    return failure([issue('missing-reference', 'relationId', 'La relación no existe en el workspace.')]);
  }
  return resultOf({ ...workspace, relations: workspace.relations.filter(relation => relation.id !== relationId) }, []);
}

function queryRelations(workspace: Workspace, cardId: CardId, direction: 'incoming' | 'outgoing' | 'both'): ValidationResult<readonly Relation[]> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure(source.issues);
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  if (!workspace.cards.some(card => card.id === cardId)) {
    return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  }
  return resultOf(workspace.relations.filter(relation =>
    (direction !== 'outgoing' && relation.to === cardId) || (direction !== 'incoming' && relation.from === cardId)), []);
}

/** Orden estable de la colección de relaciones del workspace. */
export function getIncomingRelations(workspace: Workspace, cardId: CardId): ValidationResult<readonly Relation[]> {
  return queryRelations(workspace, cardId, 'incoming');
}

export function getOutgoingRelations(workspace: Workspace, cardId: CardId): ValidationResult<readonly Relation[]> {
  return queryRelations(workspace, cardId, 'outgoing');
}

/** Vecinos en cualquier sentido, sin repeticiones y en el orden de workspace.cards. */
export function getRelatedCards(workspace: Workspace, cardId: CardId): ValidationResult<readonly Card[]> {
  const relations = queryRelations(workspace, cardId, 'both');
  if (!relations.ok) return failure(relations.issues);
  const neighbors = new Set(relations.value.map(relation => relation.from === cardId ? relation.to : relation.from));
  return resultOf(workspace.cards.filter(card => neighbors.has(card.id)), []);
}
