import { collectBoardIssues } from '../boards/board';
import type { Board } from '../boards/board';
import { collectCardIssues } from '../cards/card';
import type { Card } from '../cards/card';
import { collectCardTypeIssues } from '../cards/card-type';
import type { CardTypeDefinition } from '../cards/card-type';
import { checkOptionalText, checkRequiredText, isRecord, issue, listAt, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { checkId, checkUniqueIds, isValidId } from '../ids';
import type { WorkspaceId } from '../ids';
import { collectLayoutIssues } from '../layouts/layout';
import type { BoardLayout } from '../layouts/layout';
import { collectRelationIssues, collectRelationTypeIssues } from '../relations/relation';
import type { Relation, RelationTypeDefinition } from '../relations/relation';
import { checkSchemaVersion } from '../schema-version';

export interface WorkspaceMetadata {
  readonly name: string;
  readonly description?: string;
}

/**
 * Raíz de consistencia. Tarjetas, tipos y relaciones pertenecen al workspace; boards y layouts
 * las referencian por ID. Cada colección tiene su propio ámbito de identificadores.
 */
export interface Workspace {
  readonly schemaVersion: number;
  readonly id: WorkspaceId;
  readonly metadata: WorkspaceMetadata;
  readonly cardTypes: readonly CardTypeDefinition[];
  readonly relationTypes: readonly RelationTypeDefinition[];
  readonly cards: readonly Card[];
  readonly boards: readonly Board[];
  readonly layouts: readonly BoardLayout[];
  readonly relations: readonly Relation[];
}

/** Índice de elementos que existen por ID; ignora IDs inválidos o repetidos, ya informados. */
function indexById<T>(items: readonly unknown[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    if (isRecord(item) && isValidId(item.id) && !index.has(item.id)) index.set(item.id, item as T);
  }
  return index;
}

/**
 * Recoge las incidencias locales de cada elemento y devuelve solo los utilizables: sin incidencias
 * propias. La validación cruzada profundiza únicamente en ellos, para no recorrer estructuras mal
 * formadas; las referencias siguen comprobándose contra todos los elementos existentes.
 */
function collectUsable<T>(
  items: readonly unknown[],
  path: string,
  collect: (item: unknown, itemPath: string, issues: DomainIssue[]) => void,
  issues: DomainIssue[],
): Map<string, T> {
  const usable = new Map<string, T>();
  items.forEach((item, i) => {
    const local: DomainIssue[] = [];
    collect(item, `${path}[${i}]`, local);
    issues.push(...local);
    if (local.length === 0 && isRecord(item) && isValidId(item.id) && !usable.has(item.id)) usable.set(item.id, item as T);
  });
  return usable;
}

function collection(workspace: Readonly<Record<string, unknown>>, key: string, issues: DomainIssue[]): readonly unknown[] {
  return listAt(workspace[key], key, issues);
}

function ids(items: readonly unknown[]): unknown[] {
  return items.map((item) => (isRecord(item) ? item.id : undefined));
}

function checkReference(value: unknown, index: ReadonlyMap<string, unknown>, path: string, target: string, issues: DomainIssue[]): void {
  if (isValidId(value) && !index.has(value)) {
    issues.push(issue('missing-reference', path, `No existe ${target} "${value}".`));
  }
}

/**
 * Valida invariantes locales y referencias entre colecciones: tipos de tarjeta, pertenencia a
 * boards, layouts y relaciones. Una versión no admitida detiene la validación porque el resto
 * de la estructura podría tener otro significado.
 */
export function validateWorkspace(workspace: Workspace): ValidationResult<Workspace> {
  const issues: DomainIssue[] = [];
  const input: unknown = workspace;
  if (!isRecord(input)) return resultOf(workspace, [issue('invalid-value', 'workspace', 'Debe ser un objeto.')]);
  if (!checkSchemaVersion(input.schemaVersion, 'schemaVersion', issues)) return resultOf(workspace, issues);

  checkId(input.id, 'id', issues);
  if (isRecord(input.metadata)) {
    checkRequiredText(input.metadata.name, 'metadata.name', issues);
    checkOptionalText(input.metadata.description, 'metadata.description', issues);
  } else {
    issues.push(issue('invalid-value', 'metadata', 'Debe ser un objeto con nombre.'));
  }

  const cardTypes = collection(input, 'cardTypes', issues);
  const relationTypes = collection(input, 'relationTypes', issues);
  const cards = collection(input, 'cards', issues);
  const boards = collection(input, 'boards', issues);
  const layouts = collection(input, 'layouts', issues);
  const relations = collection(input, 'relations', issues);

  const usableCardTypes = collectUsable<CardTypeDefinition>(cardTypes, 'cardTypes', collectCardTypeIssues, issues);
  relationTypes.forEach((type, i) => collectRelationTypeIssues(type, `relationTypes[${i}]`, issues));
  checkUniqueIds(ids(cardTypes), 'cardTypes', 'los tipos de tarjeta', issues);
  checkUniqueIds(ids(relationTypes), 'relationTypes', 'los tipos de relación', issues);
  checkUniqueIds(ids(cards), 'cards', 'las tarjetas', issues);
  checkUniqueIds(ids(boards), 'boards', 'los boards', issues);
  checkUniqueIds(ids(relations), 'relations', 'las relaciones', issues);

  const cardTypeIndex = indexById<CardTypeDefinition>(cardTypes);
  const usableBoards = collectUsable<Board>(boards, 'boards', collectBoardIssues, issues);
  const relationTypeIndex = indexById<RelationTypeDefinition>(relationTypes);
  const cardIndex = indexById<Card>(cards);
  const boardIndex = indexById<Board>(boards);

  cards.forEach((card, i) => {
    const typeId = isRecord(card) ? card.typeId : undefined;
    // Un tipo existente pero mal formado ya tiene incidencias; no se usa para validar campos.
    const type = isValidId(typeId) ? usableCardTypes.get(typeId) : undefined;
    collectCardIssues(card, type, `cards[${i}]`, issues);
    checkReference(typeId, cardTypeIndex, `cards[${i}].typeId`, 'el tipo de tarjeta', issues);
  });

  boards.forEach((board, i) => {
    if (!isRecord(board) || !Array.isArray(board.cardIds)) return;
    board.cardIds.forEach((cardId: unknown, j: number) =>
      checkReference(cardId, cardIndex, `boards[${i}].cardIds[${j}]`, 'la tarjeta', issues));
  });

  checkUniqueIds(layouts.map((layout) => (isRecord(layout) ? layout.boardId : undefined)), 'layouts', 'los layouts (uno por board)', issues);
  layouts.forEach((layout, i) => {
    collectLayoutIssues(layout, `layouts[${i}]`, issues);
    if (!isRecord(layout)) return;
    checkReference(layout.boardId, boardIndex, `layouts[${i}].boardId`, 'el board', issues);
    const board = isValidId(layout.boardId) ? usableBoards.get(layout.boardId) : undefined;
    if (!board || !Array.isArray(layout.placements)) return;
    const members = new Set<unknown>(board.cardIds);
    layout.placements.forEach((placement: unknown, j: number) => {
      if (!isRecord(placement) || !isValidId(placement.cardId)) return;
      const path = `layouts[${i}].placements[${j}].cardId`;
      if (!cardIndex.has(placement.cardId)) {
        checkReference(placement.cardId, cardIndex, path, 'la tarjeta', issues);
      } else if (!members.has(placement.cardId)) {
        issues.push(issue('invalid-membership', path, `"${placement.cardId}" no pertenece al board "${board.id}".`));
      }
    });
  });

  relations.forEach((relation, i) => {
    collectRelationIssues(relation, `relations[${i}]`, issues);
    if (!isRecord(relation)) return;
    checkReference(relation.typeId, relationTypeIndex, `relations[${i}].typeId`, 'el tipo de relación', issues);
    checkReference(relation.from, cardIndex, `relations[${i}].from`, 'la tarjeta', issues);
    checkReference(relation.to, cardIndex, `relations[${i}].to`, 'la tarjeta', issues);
  });

  return resultOf(workspace, issues);
}
