import { checkOptionalText, checkRequiredText, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId } from '../ids';
import type { CardId, RelationId, RelationTypeId } from '../ids';

export interface RelationTypeDefinition {
  readonly id: RelationTypeId;
  readonly label: string;
}

/**
 * Vínculo semántico dirigido entre dos tarjetas del workspace. No depende de boards, posiciones
 * ni modo de visualización; la línea dibujada es solo una representación.
 */
export interface Relation {
  readonly id: RelationId;
  readonly typeId: RelationTypeId;
  readonly from: CardId;
  readonly to: CardId;
  readonly label?: string;
}

export function collectRelationTypeIssues(type: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(type)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(type.id, `${path}.id`, issues);
  checkRequiredText(type.label, `${path}.label`, issues);
}

/** Forma de la relación. Autoenlaces y duplicados semánticos se deciden en fase 3. */
export function collectRelationIssues(relation: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(relation)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(relation.id, `${path}.id`, issues);
  checkId(relation.typeId, `${path}.typeId`, issues);
  checkId(relation.from, `${path}.from`, issues);
  checkId(relation.to, `${path}.to`, issues);
  checkOptionalText(relation.label, `${path}.label`, issues);
}

export function validateRelation(relation: Relation): ValidationResult<Relation> {
  const issues: DomainIssue[] = [];
  collectRelationIssues(relation, 'relation', issues);
  return resultOf(relation, issues);
}
