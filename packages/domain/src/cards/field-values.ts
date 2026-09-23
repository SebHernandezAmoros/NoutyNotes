import { isValidAssetRef } from '../assets/asset-ref';
import { isRecord, issue } from '../errors';
import type { DomainIssue } from '../errors';
import type { CardTypeDefinition, FieldDefinition } from './card-type';

/** Valores de campo: datos primitivos. La ausencia de la clave significa "sin valor". */
export type FieldValue = string | number | boolean;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const URL_PATTERN = /^(?:https?:\/\/[^\s/?#]+[^\s]*|mailto:[^\s@]+@[^\s@]+)$/i;

/** Fecha de calendario `AAAA-MM-DD`, comprobada sin depender del reloj ni de la zona horaria. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function valueProblem(definition: FieldDefinition, value: unknown): string | null {
  switch (definition.kind) {
    case 'text':
    case 'markdown':
      return typeof value === 'string' ? null : 'Debe ser texto.';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Debe ser un número finito.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Debe ser verdadero o falso.';
    case 'date':
      return typeof value === 'string' && isCalendarDate(value) ? null : 'Debe ser una fecha AAAA-MM-DD válida.';
    case 'url':
      return typeof value === 'string' && URL_PATTERN.test(value) ? null : 'Debe ser un enlace http(s) o mailto.';
    case 'asset':
      return isValidAssetRef(value) ? null : 'Debe ser una referencia relativa a un asset del workspace.';
    case 'select':
      return typeof value === 'string' && (definition.options ?? []).includes(value)
        ? null
        : `Debe ser una de: ${(definition.options ?? []).join(', ')}.`;
  }
}

/** Comprueba que los valores de una tarjeta corresponden a las definiciones de su tipo. */
export function collectFieldValueIssues(fields: unknown, type: CardTypeDefinition, path: string, issues: DomainIssue[]): void {
  if (!isRecord(fields)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto de campos.'));
    return;
  }
  const definitions = new Map(type.fields.map((definition) => [definition.key as string, definition]));
  for (const [key, value] of Object.entries(fields)) {
    const definition = definitions.get(key);
    if (!definition) {
      issues.push(issue('unknown-field', `${path}.${key}`, `El tipo "${type.id}" no define el campo "${key}".`));
      continue;
    }
    const problem = valueProblem(definition, value);
    if (problem) issues.push(issue('invalid-field-value', `${path}.${key}`, problem));
  }
  for (const definition of type.fields) {
    if (definition.required && !Object.hasOwn(fields, definition.key)) {
      issues.push(issue('missing-required-field', `${path}.${definition.key}`, 'Campo obligatorio sin valor.'));
    }
  }
}
