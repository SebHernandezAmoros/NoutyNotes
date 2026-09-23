import { collectCardTypeIssues } from '../cards/card-type';
import type { CardTypeDefinition } from '../cards/card-type';
import { checkOptionalText, checkRequiredText, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds } from '../ids';
import type { BoardId, TemplateId } from '../ids';
import { collectRelationTypeIssues } from '../relations/relation';
import type { RelationTypeDefinition } from '../relations/relation';
import { checkSchemaVersion } from '../schema-version';

export interface TemplateManifest {
  readonly id: TemplateId;
  readonly name: string;
  /** Versión de la plantilla, independiente de `schemaVersion`. */
  readonly version: string;
  readonly author?: string;
  readonly description?: string;
}

export interface TemplateBoard {
  readonly id: BoardId;
  readonly title: string;
  readonly description?: string;
}

/**
 * Plantilla como datos: describe tipos, relaciones y boards iniciales con las primitivas del
 * núcleo. Nunca aporta comportamiento. Tarjetas, layouts, assets e instanciación llegan en fase 4.
 */
export interface Template {
  readonly schemaVersion: number;
  readonly template: TemplateManifest;
  readonly cardTypes: readonly CardTypeDefinition[];
  readonly relationTypes: readonly RelationTypeDefinition[];
  readonly boards: readonly TemplateBoard[];
}

const templateKeys = ['schemaVersion', 'template', 'cardTypes', 'relationTypes', 'boards'];
const manifestKeys = ['id', 'name', 'version', 'author', 'description'];
const boardKeys = ['id', 'title', 'description'];
const cardTypeKeys = ['id', 'label', 'base', 'fields'];
const fieldKeys = ['key', 'kind', 'label', 'required', 'options'];
const relationTypeKeys = ['id', 'label'];
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Admite solo datos equivalentes a JSON/YAML: texto, números finitos, booleanos, null, listas y
 * objetos simples. Funciones, símbolos, clases, getters u objetos especiales se rechazan.
 */
export function collectExecutableContentIssues(value: unknown, path: string, issues: DomainIssue[], seen = new Set<object>()): void {
  // `undefined` equivale a una clave ausente; su obligatoriedad se comprueba después.
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(issue('invalid-value', path, 'Los números deben ser finitos.'));
    return;
  }
  if (typeof value !== 'object') {
    issues.push(issue('executable-content', path, `Una plantilla solo contiene datos; no admite ${typeof value}.`));
    return;
  }
  if (seen.has(value)) {
    issues.push(issue('invalid-value', path, 'Referencia circular.'));
    return;
  }
  seen.add(value);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    issues.push(issue('executable-content', path, 'Solo se admiten objetos y listas simples.'));
    return;
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    const childPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    if (descriptor.get || descriptor.set) {
      issues.push(issue('executable-content', childPath, 'No se admiten propiedades calculadas.'));
      continue;
    }
    collectExecutableContentIssues(descriptor.value, childPath, issues, seen);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push(issue('executable-content', path, 'No se admiten claves de símbolo.'));
  }
  // Solo los antepasados cuentan como ciclo; un mismo objeto compartido (alias YAML) es válido.
  seen.delete(value);
}

function checkKnownKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], path: string, issues: DomainIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(issue('unknown-property', path ? `${path}.${key}` : key, `Propiedad no admitida en una plantilla: "${key}".`));
    }
  }
}

/**
 * Validación mínima y declarativa de datos externos. El resultado nunca se evalúa: los textos
 * que parezcan código siguen siendo texto.
 */
export function validateTemplate(input: unknown): ValidationResult<Template> {
  const issues: DomainIssue[] = [];
  const template = input as Template;
  collectExecutableContentIssues(input, '', issues);
  if (issues.length > 0) return resultOf(template, issues);
  if (!isRecord(input)) return resultOf(template, [issue('invalid-value', 'template', 'Debe ser un objeto.')]);
  if (!checkSchemaVersion(input.schemaVersion, 'schemaVersion', issues)) return resultOf(template, issues);
  checkKnownKeys(input, templateKeys, '', issues);

  const manifest = input.template;
  if (isRecord(manifest)) {
    checkKnownKeys(manifest, manifestKeys, 'template', issues);
    checkId(manifest.id, 'template.id', issues);
    checkRequiredText(manifest.name, 'template.name', issues);
    if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) {
      issues.push(issue('invalid-value', 'template.version', 'Debe ser una versión MAYOR.MENOR.PARCHE.'));
    }
    checkOptionalText(manifest.author, 'template.author', issues);
    checkOptionalText(manifest.description, 'template.description', issues);
  } else {
    issues.push(issue('invalid-value', 'template', 'Falta el manifiesto de la plantilla.'));
  }

  const cardTypes = listAt(input.cardTypes, 'cardTypes', issues);
  cardTypes.forEach((type, i) => {
    collectCardTypeIssues(type, `cardTypes[${i}]`, issues);
    if (!isRecord(type)) return;
    // Contrato declarativo cerrado también en tipos y campos: una clave no prevista se rechaza.
    checkKnownKeys(type, cardTypeKeys, `cardTypes[${i}]`, issues);
    if (!Array.isArray(type.fields)) return;
    type.fields.forEach((field: unknown, j: number) => {
      if (isRecord(field)) checkKnownKeys(field, fieldKeys, `cardTypes[${i}].fields[${j}]`, issues);
    });
  });
  checkUniqueIds(cardTypes.map((type) => (isRecord(type) ? type.id : undefined)), 'cardTypes', 'los tipos de tarjeta', issues);

  const relationTypes = listAt(input.relationTypes, 'relationTypes', issues);
  relationTypes.forEach((type, i) => {
    collectRelationTypeIssues(type, `relationTypes[${i}]`, issues);
    if (isRecord(type)) checkKnownKeys(type, relationTypeKeys, `relationTypes[${i}]`, issues);
  });
  checkUniqueIds(relationTypes.map((type) => (isRecord(type) ? type.id : undefined)), 'relationTypes', 'los tipos de relación', issues);

  const boards = listAt(input.boards, 'boards', issues);
  boards.forEach((board, i) => {
    if (!isRecord(board)) {
      issues.push(issue('invalid-value', `boards[${i}]`, 'Debe ser un objeto.'));
      return;
    }
    checkKnownKeys(board, boardKeys, `boards[${i}]`, issues);
    checkId(board.id, `boards[${i}].id`, issues);
    checkRequiredText(board.title, `boards[${i}].title`, issues);
    checkOptionalText(board.description, `boards[${i}].description`, issues);
  });
  checkUniqueIds(boards.map((board) => (isRecord(board) ? board.id : undefined)), 'boards', 'los boards', issues);

  return resultOf(template, issues);
}
