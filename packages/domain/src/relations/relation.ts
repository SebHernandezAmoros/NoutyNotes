import { checkOptionalText, checkRequiredText, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, isValidId } from '../ids';
import type { CardId, RelationId, RelationTypeId } from '../ids';

export interface RelationTypeDefinition {
  readonly id: RelationTypeId;
  readonly label: string;
}

/** Estilo visual de la punta de flecha (ADR 0034): independiente de `from`/`to`. Sin ella, «forward». */
export const relationArrows = ['none', 'forward', 'both'] as const;
export type RelationArrow = (typeof relationArrows)[number];

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
  /** Sin ella, se dibuja como una única punta en `to` (comportamiento anterior a esta versión). */
  readonly arrow?: RelationArrow;
}

export function collectRelationTypeIssues(type: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(type)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(type.id, `${path}.id`, issues);
  checkRequiredText(type.label, `${path}.label`, issues);
}

/** Forma de la relación y prohibición de autoenlaces (ADR 0005). */
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
  if (relation.arrow !== undefined && !relationArrows.includes(relation.arrow as RelationArrow)) {
    issues.push(issue('invalid-value', `${path}.arrow`, `Debe ser una de: ${relationArrows.join(', ')}.`));
  }
  if (isValidId(relation.from) && relation.from === relation.to) {
    issues.push(issue('self-relation', `${path}.to`, 'Una relación debe conectar dos tarjetas distintas.'));
  }
}

/** Unicidad semántica, independiente de ID y etiqueta; conserva el orden de diagnóstico. */
export function collectDuplicateRelationIssues(relations: readonly unknown[], path: string, issues: DomainIssue[]): void {
  const seen = new Set<string>();
  relations.forEach((relation, index) => {
    if (!isRecord(relation) || !isValidId(relation.from) || !isValidId(relation.to) || !isValidId(relation.typeId)) return;
    const key = JSON.stringify([relation.from, relation.to, relation.typeId]);
    if (seen.has(key)) issues.push(issue('duplicate-relation', `${path}[${index}]`, 'Ya existe una relación del mismo tipo y sentido entre estas tarjetas.'));
    seen.add(key);
  });
}

export function validateRelation(relation: Relation): ValidationResult<Relation> {
  const issues: DomainIssue[] = [];
  collectRelationIssues(relation, 'relation', issues);
  return resultOf(relation, issues);
}
