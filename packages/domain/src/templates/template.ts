import { collectCardTypeIssues } from '../cards/card-type';
import type { CardTypeDefinition } from '../cards/card-type';
import type { Card } from '../cards/card';
import type { AssetRef } from '../assets/asset-ref';
import type { BoardLayout } from '../layouts/layout';
import { checkAssetRef } from '../assets/asset-ref';
import { DESKTOP_GRID, validateGridLayout } from '../layouts/grid';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace, WorkspaceMetadata } from '../workspace/workspace';
import { checkOptionalText, checkRequiredText, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds } from '../ids';
import type { BoardId, CardId, TemplateId, WorkspaceId } from '../ids';
import { collectRelationTypeIssues } from '../relations/relation';
import type { Relation, RelationTypeDefinition } from '../relations/relation';
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
  readonly cardIds?: readonly CardId[];
}

/**
 * Plantilla como datos: describe tipos, relaciones y boards iniciales con las primitivas del
 * núcleo. Nunca aporta comportamiento; el catálogo de assets declara rutas, no bytes ni I/O.
 */
export interface Template {
  readonly schemaVersion: number;
  readonly template: TemplateManifest;
  readonly cardTypes: readonly CardTypeDefinition[];
  readonly relationTypes: readonly RelationTypeDefinition[];
  readonly boards: readonly TemplateBoard[];
  readonly cards?: readonly Card[];
  readonly relations?: readonly Relation[];
  readonly layouts?: readonly BoardLayout[];
  readonly assets?: readonly AssetRef[];
  readonly readme?: string;
  readonly preview?: AssetRef;
}

const templateKeys = ['schemaVersion', 'template', 'cardTypes', 'relationTypes', 'boards', 'cards', 'relations', 'layouts', 'assets', 'readme', 'preview'];
const manifestKeys = ['id', 'name', 'version', 'author', 'description'];
const boardKeys = ['id', 'title', 'description', 'cardIds'];
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
export function collectExecutableContentIssues(value: unknown, path: string, issues: DomainIssue[], seen = new Set<object>(), depth = 0): void {
  if (depth > 64) {
    issues.push(issue('invalid-value', path, 'La profundidad máxima de datos es 64.'));
    return;
  }
  // `undefined` equivale a una clave ausente; su obligatoriedad se comprueba después.
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(issue('invalid-value', path, 'Los números deben ser finitos.'));
    return;
  }
  if (typeof value !== 'object') {
    issues.push(issue('executable-content', path, `Solo se admiten datos; no se admite ${typeof value}.`));
    return;
  }
  if (seen.has(value)) {
    issues.push(issue('invalid-value', path, 'Referencia circular.'));
    return;
  }
  seen.add(value);
  if (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : !isPlainObject(value)) {
    issues.push(issue('executable-content', path, 'Solo se admiten objetos y listas simples.'));
    return;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).filter(key => key !== 'length').length !== value.length) {
    issues.push(issue('invalid-value', path, 'No se admiten listas dispersas ni propiedades extra.'));
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    const childPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    if (descriptor.get || descriptor.set) {
      issues.push(issue('executable-content', childPath, 'No se admiten propiedades calculadas.'));
      continue;
    }
    if (!descriptor.enumerable || (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || descriptor.value === undefined))) {
      issues.push(issue('invalid-value', childPath, 'La propiedad no se puede representar sin pérdida en JSON.'));
      continue;
    }
    collectExecutableContentIssues(descriptor.value, childPath, issues, seen, depth + 1);
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
 * Validación declarativa y semántica de datos externos. El resultado nunca se evalúa: los textos
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

  const optionalList = (key: string): readonly unknown[] => input[key] === undefined ? [] : listAt(input[key], key, issues);
  const cards = optionalList('cards');
  const relations = optionalList('relations');
  const layouts = optionalList('layouts');
  const assets = optionalList('assets');
  cards.forEach((card, i) => {
    if (isRecord(card)) checkKnownKeys(card, ['id', 'typeId', 'title', 'content', 'fields', 'assetRefs'], `cards[${i}]`, issues);
  });
  relations.forEach((relation, i) => {
    if (isRecord(relation)) checkKnownKeys(relation, ['id', 'typeId', 'from', 'to', 'label'], `relations[${i}]`, issues);
  });
  layouts.forEach((layout, i) => {
    if (!isRecord(layout)) return;
    checkKnownKeys(layout, ['boardId', 'placements'], `layouts[${i}]`, issues);
    if (!Array.isArray(layout.placements)) return;
    layout.placements.forEach((placement: unknown, j: number) => {
      if (!isRecord(placement)) return;
      const path = `layouts[${i}].placements[${j}]`;
      checkKnownKeys(placement, ['cardId', 'rect', 'display'], path, issues);
      if (isRecord(placement.rect)) checkKnownKeys(placement.rect, ['x', 'y', 'w', 'h'], `${path}.rect`, issues);
    });
  });
  assets.forEach((ref, i) => checkAssetRef(ref, `assets[${i}]`, issues));
  if (new Set(assets).size !== assets.length) issues.push(issue('invalid-asset-ref', 'assets', 'Hay rutas de assets repetidas.'));
  if (input.readme !== undefined && typeof input.readme !== 'string') issues.push(issue('invalid-value', 'readme', 'Debe ser texto Markdown.'));
  if (input.preview !== undefined) checkAssetRef(input.preview, 'preview', issues);
  if (issues.length > 0) return resultOf(template, issues);

  const workspace = templateWorkspace(template, 'template-validation' as WorkspaceId, { name: template.template.name });
  const checked = validateWorkspace(workspace);
  if (!checked.ok) return resultOf(template, checked.issues);
  workspace.layouts.forEach((layout, index) => {
    const grid = validateGridLayout(layout, DESKTOP_GRID);
    if (!grid.ok) issues.push(...grid.issues.map(found => ({ ...found, path: `layouts[${index}].${found.path}` })));
  });
  const declared = new Set(assets);
  const requireAsset = (ref: string, path: string): void => {
    if (!declared.has(ref)) issues.push(issue('missing-reference', path, `Asset no declarado: "${ref}".`));
  };
  if (template.preview !== undefined) requireAsset(template.preview, 'preview');
  const types = new Map(workspace.cardTypes.map(type => [type.id, type]));
  workspace.cards.forEach((card, i) => {
    card.assetRefs?.forEach((ref, j) => requireAsset(ref, `cards[${i}].assetRefs[${j}]`));
    for (const field of types.get(card.typeId)?.fields ?? []) {
      const value = card.fields[field.key];
      if (field.kind === 'asset' && typeof value === 'string') requireAsset(value, `cards[${i}].fields.${field.key}`);
    }
  });

  return resultOf(template, issues);
}

/** Ensambla colecciones; el llamador valida antes el manifiesto y las listas, o el resultado. */
export function templateWorkspace(template: Template, id: WorkspaceId, metadata: WorkspaceMetadata): Workspace {
  return {
    schemaVersion: template.schemaVersion, id, metadata,
    cardTypes: template.cardTypes, relationTypes: template.relationTypes,
    cards: template.cards ?? [], relations: template.relations ?? [], layouts: template.layouts ?? [],
    boards: template.boards.map(board => ({ ...board, cardIds: board.cardIds === undefined ? [] : board.cardIds })),
  };
}
