import type { Card } from '../cards/card';
import { checkOptionalText, failure, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { CardId, RelationId, RelationTypeId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import { relationArrows, validateRelation } from './relation';
import type { Relation, RelationArrow } from './relation';

/** Agrega una relación aportada por el llamador; valida referencias y unicidad antes de devolverla. */
export function createRelation(workspace: Workspace, relation: Relation): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  const checked = validateRelation(relation);
  if (!checked.ok) return failure(checked.issues);
  return validateWorkspace({ ...workspace, relations: [...workspace.relations, { ...relation }] });
}

export interface RelationChanges {
  readonly typeId?: RelationTypeId;
  readonly label?: string;
  readonly arrow?: RelationArrow;
}

const editableRelationKeys = ['typeId', 'label', 'arrow'];

/**
 * Cambia tipo, rótulo o estilo de flecha de una conexión existente (ADR 0034); lo que no se indica no
 * cambia. `from`/`to` no se editan aquí: desconectar y volver a conectar cambia los extremos.
 */
export function updateRelation(workspace: Workspace, relationId: RelationId, changes: RelationChanges): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isValidId(relationId)) return failure([issue('invalid-id', 'relationId', 'Identificador de relación inválido.')]);
  const relation = workspace.relations.find((candidate) => candidate.id === relationId);
  if (!relation) return failure([issue('missing-reference', 'relationId', 'La relación no existe en el workspace.')]);
  const input: unknown = changes;
  if (!isRecord(input)) return failure([issue('invalid-value', 'changes', 'Debe ser un objeto de cambios.')]);
  const issues: DomainIssue[] = Object.keys(input)
    .filter((key) => !editableRelationKeys.includes(key))
    .map((key) => issue('unknown-property', `changes.${key}`, 'Solo se pueden editar el tipo, el rótulo y la flecha.'));
  if (Object.hasOwn(input, 'typeId') && typeof input.typeId !== 'string') issues.push(issue('invalid-value', 'changes.typeId', 'Debe ser texto.'));
  checkOptionalText(input.label, 'changes.label', issues);
  if (Object.hasOwn(input, 'arrow') && !relationArrows.includes(input.arrow as RelationArrow)) {
    issues.push(issue('invalid-value', 'changes.arrow', `Debe ser una de: ${relationArrows.join(', ')}.`));
  }
  if (issues.length > 0) return failure(issues);
  const edited: Relation = {
    ...relation,
    ...(changes.typeId === undefined ? {} : { typeId: changes.typeId }),
    ...(changes.label === undefined ? {} : { label: changes.label }),
    ...(changes.arrow === undefined ? {} : { arrow: changes.arrow }),
  };
  return validateWorkspace({ ...workspace, relations: workspace.relations.map((candidate) => (candidate === relation ? edited : candidate)) });
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
