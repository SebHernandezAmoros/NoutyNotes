import { checkOptionalText, checkRequiredText, isNonBlankString, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds } from '../ids';
import type { CardTypeId, FieldKey } from '../ids';

/** Primitivas que el núcleo sabe representar. Los tipos concretos surgen de plantillas. */
export const baseCardKinds = ['note', 'image', 'link', 'checklist', 'file', 'section'] as const;
export type BaseCardKind = (typeof baseCardKinds)[number];

export const fieldKinds = ['text', 'markdown', 'number', 'boolean', 'date', 'url', 'asset', 'select'] as const;
export type FieldKind = (typeof fieldKinds)[number];

export interface FieldDefinition {
  readonly key: FieldKey;
  readonly kind: FieldKind;
  readonly label?: string;
  readonly required?: boolean;
  /** Solo para `select`: valores admitidos, sin repetir. */
  readonly options?: readonly string[];
}

export interface CardTypeDefinition {
  readonly id: CardTypeId;
  readonly label: string;
  readonly base: BaseCardKind;
  readonly fields: readonly FieldDefinition[];
}

function checkFieldDefinition(field: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(field)) {
    issues.push(issue('invalid-field-definition', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(field.key, `${path}.key`, issues);
  if (!fieldKinds.includes(field.kind as FieldKind)) {
    issues.push(issue('invalid-field-definition', `${path}.kind`, `Tipo de campo desconocido: ${String(field.kind)}.`));
  }
  checkOptionalText(field.label, `${path}.label`, issues);
  if (field.required !== undefined && typeof field.required !== 'boolean') {
    issues.push(issue('invalid-field-definition', `${path}.required`, 'Debe ser verdadero o falso.'));
  }
  if (field.kind === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    if (options.length === 0 || !options.every(isNonBlankString) || new Set(options).size !== options.length) {
      issues.push(issue('invalid-field-definition', `${path}.options`, 'Un campo select necesita opciones de texto no vacías y únicas.'));
    }
  } else if (field.options !== undefined) {
    issues.push(issue('invalid-field-definition', `${path}.options`, 'Solo los campos select admiten opciones.'));
  }
}

export function collectCardTypeIssues(type: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(type)) {
    issues.push(issue('invalid-value', path, 'Debe ser un objeto.'));
    return;
  }
  checkId(type.id, `${path}.id`, issues);
  checkRequiredText(type.label, `${path}.label`, issues);
  if (!baseCardKinds.includes(type.base as BaseCardKind)) {
    issues.push(issue('invalid-value', `${path}.base`, `Primitiva desconocida: ${String(type.base)}.`));
  }
  const fields = listAt(type.fields, `${path}.fields`, issues);
  fields.forEach((field, index) => checkFieldDefinition(field, `${path}.fields[${index}]`, issues));
  checkUniqueIds(fields.map((field) => (isRecord(field) ? field.key : undefined)), `${path}.fields`, `el tipo "${String(type.id)}"`, issues);
}

export function validateCardType(type: CardTypeDefinition): ValidationResult<CardTypeDefinition> {
  const issues: DomainIssue[] = [];
  collectCardTypeIssues(type, 'cardType', issues);
  return resultOf(type, issues);
}
