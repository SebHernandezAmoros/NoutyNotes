import { issue, resultOf } from './errors';
import type { DomainIssue, ValidationResult } from './errors';

declare const idKind: unique symbol;

/**
 * Identificador estable. Lo aporta quien crea la entidad (usuario, plantilla o un puerto de
 * generación en capas exteriores); el dominio nunca lo genera, normaliza ni reescribe.
 */
export type Id<Kind extends string> = string & { readonly [idKind]: Kind };

export type WorkspaceId = Id<'workspace'>;
export type BoardId = Id<'board'>;
export type CardId = Id<'card'>;
export type CardTypeId = Id<'card-type'>;
export type FieldKey = Id<'field'>;
export type RelationId = Id<'relation'>;
export type RelationTypeId = Id<'relation-type'>;
export type TemplateId = Id<'template'>;

export const ID_MAX_LENGTH = 64;

// Minúsculas, dígitos y separadores simples: seguro como nombre de archivo en sistemas que no
// distinguen mayúsculas (Windows, almacenamiento Android) y legible en diffs.
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= ID_MAX_LENGTH && ID_PATTERN.test(value);
}

export function checkId(value: unknown, path: string, issues: DomainIssue[]): void {
  if (!isValidId(value)) {
    issues.push(issue('invalid-id', path,
      `Identificador inválido: minúsculas, dígitos, "-" o "_" entre caracteres, máximo ${ID_MAX_LENGTH}.`));
  }
}

/** Valida sin transformar: `Card-1` o ` card-1` se rechazan en lugar de corregirse. */
export function parseId<T extends Id<string>>(value: unknown, path = 'id'): ValidationResult<T> {
  const issues: DomainIssue[] = [];
  checkId(value, path, issues);
  return resultOf(value as T, issues);
}

/**
 * Informa de cada repetición dentro de un ámbito. `ids[i]` se asocia a `path[i]`.
 * Los valores no válidos se ignoran aquí porque ya los informa `checkId`.
 */
export function checkUniqueIds(ids: readonly unknown[], path: string, scope: string, issues: DomainIssue[]): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (!isValidId(id)) return;
    if (seen.has(id)) issues.push(issue('duplicate-id', `${path}[${index}]`, `"${id}" está repetido en ${scope}.`));
    seen.add(id);
  });
}
