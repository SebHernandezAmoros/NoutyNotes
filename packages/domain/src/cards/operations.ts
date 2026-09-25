import { failure, isNonBlankString, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { BoardId, CardId } from '../ids';
import type { GridConfig, GridSize } from '../layouts/grid';
import type { BoardLayout, CardPlacement } from '../layouts/layout';
import { findFreeSpace } from '../layouts/operations';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import { validateCard } from './card';
import type { Card } from './card';

export interface DeleteCardOptions {
  /** Por defecto no permite borrar una tarjeta conectada; cascade elimina sus vínculos explícitamente. */
  readonly relations?: 'restrict' | 'cascade';
}

/** Borrado global atómico en memoria. No elimina assets ni archivos (ADR 0005). */
export function deleteCard(workspace: Workspace, cardId: CardId, options: DeleteCardOptions = {}): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(options)) return failure([issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')]);
  const policy = options.relations === undefined ? 'restrict' : options.relations;
  if (policy !== 'restrict' && policy !== 'cascade') {
    return failure([issue('invalid-value', 'options.relations', 'Debe ser restrict o cascade.')]);
  }
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  if (!workspace.cards.some(card => card.id === cardId)) {
    return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  }
  const incident = workspace.relations.some(relation => relation.from === cardId || relation.to === cardId);
  if (incident && policy === 'restrict') {
    return failure([issue('card-has-relations', 'cardId', 'La tarjeta tiene relaciones; eliminarlas o usar cascade explícitamente.')]);
  }
  return resultOf({
    ...workspace,
    cards: workspace.cards.filter(card => card.id !== cardId),
    relations: workspace.relations.filter(relation => relation.from !== cardId && relation.to !== cardId),
    boards: workspace.boards.map(board => board.cardIds.includes(cardId)
      ? { ...board, cardIds: board.cardIds.filter(member => member !== cardId) } : board),
    layouts: workspace.layouts.map(layout => layout.placements.some(placement => placement.cardId === cardId)
      ? { ...layout, placements: layout.placements.filter(placement => placement.cardId !== cardId) } : layout),
  }, []);
}

export interface AddCardOptions {
  /** Board existente donde se muestra la tarjeta. */
  readonly boardId: BoardId;
  /** Tamaño expandido inicial, en unidades de la grilla indicada. */
  readonly size: GridSize;
  readonly config: GridConfig;
}

/**
 * Agrega una tarjeta aportada por el llamador (con su ID) al workspace, al final del board y en el
 * primer hueco libre de su layout, expandida. Si el board aún no tenía layout, lo crea. No genera
 * IDs ni tipos: el tipo y el board deben existir (fase 7).
 */
export function addCard(workspace: Workspace, card: Card, options: AddCardOptions): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(options)) return failure([issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')]);
  const input: unknown = card;
  if (!isRecord(input)) return failure([issue('invalid-value', 'card', 'Debe ser un objeto.')]);
  if (workspace.cards.some((existing) => existing.id === card.id)) {
    return failure([issue('duplicate-id', 'card.id', `Ya existe una tarjeta "${card.id}".`)]);
  }
  if (!isValidId(card.typeId)) return failure([issue('invalid-id', 'card.typeId', 'Identificador de tipo inválido.')]);
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  if (!type) return failure([issue('missing-reference', 'card.typeId', `No existe el tipo de tarjeta "${card.typeId}".`)]);
  const checked = validateCard(card, type);
  if (!checked.ok) return failure(checked.issues);
  const { boardId } = options;
  if (!isValidId(boardId)) return failure([issue('invalid-id', 'options.boardId', 'Identificador de board inválido.')]);
  if (!workspace.boards.some((board) => board.id === boardId)) {
    return failure([issue('missing-reference', 'options.boardId', `No existe el board "${boardId}".`)]);
  }
  const current = workspace.layouts.find((layout) => layout.boardId === boardId);
  const layout: BoardLayout = current ?? { boardId, placements: [] };
  const spot = findFreeSpace(layout, options.size, options.config);
  if (!spot.ok) return failure(spot.issues);
  const placement: CardPlacement = {
    cardId: card.id, rect: { x: spot.value.x, y: spot.value.y, w: options.size.w, h: options.size.h }, display: 'expanded',
  };
  const placed: BoardLayout = { ...layout, placements: [...layout.placements, placement] };
  return validateWorkspace({
    ...workspace,
    cards: [...workspace.cards, { ...card }],
    boards: workspace.boards.map((board) => (board.id === boardId ? { ...board, cardIds: [...board.cardIds, card.id] } : board)),
    layouts: current ? workspace.layouts.map((existing) => (existing === current ? placed : existing)) : [...workspace.layouts, placed],
  });
}

/** Cambios editables desde el prototipo: título y cuerpo Markdown. */
export interface CardContentChanges {
  /** Un título en blanco elimina el título (es opcional); cualquier otro se guarda tal cual. */
  readonly title?: string;
  /** Markdown opaco: se guarda literal, también vacío. */
  readonly content?: string;
}

const editableCardKeys: readonly string[] = ['title', 'content'];

/** Edita título y Markdown sin tocar campos, assets, representación ni relaciones. */
export function updateCard(workspace: Workspace, cardId: CardId, changes: CardContentChanges): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  const card = workspace.cards.find((candidate) => candidate.id === cardId);
  if (!card) return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  const input: unknown = changes;
  if (!isRecord(input)) return failure([issue('invalid-value', 'changes', 'Debe ser un objeto de cambios.')]);
  const issues: DomainIssue[] = Object.keys(input)
    .filter((key) => !editableCardKeys.includes(key))
    .map((key) => issue('unknown-property', `changes.${key}`, 'Solo se pueden editar el título y el contenido.'));
  for (const key of editableCardKeys) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'string') {
      issues.push(issue('invalid-value', `changes.${key}`, 'Debe ser texto.'));
    }
  }
  if (issues.length > 0) return failure(issues);
  const { title, ...untitled } = card;
  const nextTitle = changes.title === undefined ? title : changes.title;
  const edited: Card = {
    ...(isNonBlankString(nextTitle) ? { ...untitled, title: nextTitle } : untitled),
    ...(changes.content === undefined ? {} : { content: changes.content }),
  };
  return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => (candidate === card ? edited : candidate)) });
}
