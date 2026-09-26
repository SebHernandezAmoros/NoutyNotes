import type { AssetRef } from '../assets/asset-ref';
import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { BoardId, CardId } from '../ids';
import { validateGridLayout } from '../layouts/grid';
import type { GridConfig } from '../layouts/grid';
import type { BoardLayout, CardPlacement } from '../layouts/layout';
import { findFreeSpace } from '../layouts/operations';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import type { Card } from './card';
import { deleteCard } from './operations';
import type { TrashedCard } from './trashed-card';

/**
 * Papelera de tarjetas (ADR 0015). Transformaciones puras y validadas: una operación que falla no
 * devuelve un workspace a medias.
 */

/** Envía una tarjeta a la Papelera con su pertenencia, colocación y relaciones. */
export function trashCard(workspace: Workspace, cardId: CardId): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  const card = workspace.cards.find((candidate) => candidate.id === cardId);
  if (!isValidId(cardId) || !card) return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  const entry: TrashedCard = {
    card,
    boards: workspace.boards.flatMap((board) => {
      const index = board.cardIds.indexOf(cardId);
      return index < 0 ? [] : [{ boardId: board.id, index }];
    }),
    placements: workspace.layouts.flatMap((layout) => layout.placements
      .filter((placement) => placement.cardId === cardId)
      .map((placement) => ({ boardId: layout.boardId, rect: placement.rect, display: placement.display }))),
    relations: workspace.relations.filter((relation) => relation.from === cardId || relation.to === cardId),
  };
  const removed = deleteCard(workspace, cardId, { relations: 'cascade' });
  if (!removed.ok) return removed;
  return validateWorkspace({ ...removed.value, trash: [...(workspace.trash ?? []), entry] });
}

export interface RestoreOptions {
  /** Tablero donde colocarla si ninguno de los suyos existe ya (normalmente, el visible). */
  readonly fallbackBoardId: BoardId;
  readonly config: GridConfig;
}

export interface RestoreReport {
  /** Tableros donde su sitio estaba ocupado y se colocó en el primer hueco libre. */
  readonly relocated: readonly BoardId[];
  /** Ningún tablero suyo existía: se añadió al tablero indicado. */
  readonly addedToFallback: boolean;
  /** Relaciones no restauradas: el otro extremo, el tipo o el ID ya no están disponibles. */
  readonly skippedRelations: number;
}

/** Coloca en su rect si cabe; si no, en el primer hueco con el mismo tamaño. */
function place(layout: BoardLayout, candidate: CardPlacement, config: GridConfig): ValidationResult<{ layout: BoardLayout; relocated: boolean }> {
  const direct: BoardLayout = { ...layout, placements: [...layout.placements, candidate] };
  if (validateGridLayout(direct, config).ok) return resultOf({ layout: direct, relocated: false }, []);
  const spot = findFreeSpace(layout, { w: candidate.rect.w, h: candidate.rect.h }, config);
  if (!spot.ok) return failure([...spot.issues]);
  const moved: CardPlacement = { ...candidate, rect: { ...candidate.rect, x: spot.value.x, y: spot.value.y } };
  return resultOf({ layout: { ...layout, placements: [...layout.placements, moved] }, relocated: true }, []);
}

/** Restaura una tarjeta de la Papelera; explica en el informe lo que no pudo quedar igual. */
export function restoreTrashedCard(
  workspace: Workspace, cardId: CardId, options: RestoreOptions,
): ValidationResult<{ readonly workspace: Workspace; readonly report: RestoreReport }> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure([...source.issues]);
  const entry = workspace.trash?.find((candidate) => candidate.card.id === cardId);
  if (!entry) return failure([issue('missing-reference', 'cardId', 'La tarjeta no está en la Papelera.')]);
  const boardIds = new Set(workspace.boards.map((board) => board.id));
  let memberships = entry.boards.filter((membership) => boardIds.has(membership.boardId));
  let placements = entry.placements.filter((placement) => boardIds.has(placement.boardId));
  const addedToFallback = memberships.length === 0;
  if (addedToFallback) {
    if (!boardIds.has(options.fallbackBoardId)) return failure([issue('missing-reference', 'fallbackBoardId', 'No existe el tablero donde restaurar.')]);
    const [first] = entry.placements;
    memberships = [{ boardId: options.fallbackBoardId, index: Number.MAX_SAFE_INTEGER }];
    placements = [{ boardId: options.fallbackBoardId, rect: first?.rect ?? { x: 0, y: 0, w: 4, h: 3 }, display: first?.display ?? 'expanded' }];
  }

  const boards = workspace.boards.map((board) => {
    const membership = memberships.find((candidate) => candidate.boardId === board.id);
    if (!membership) return board;
    const cardIds = [...board.cardIds];
    cardIds.splice(Math.min(membership.index, cardIds.length), 0, cardId);
    return { ...board, cardIds };
  });
  let layouts = [...workspace.layouts];
  const relocated: BoardId[] = [];
  for (const saved of placements) {
    const current = layouts.find((layout) => layout.boardId === saved.boardId) ?? { boardId: saved.boardId, placements: [] };
    const placed = place(current, { cardId, rect: saved.rect, display: saved.display }, options.config);
    if (!placed.ok) return failure([...placed.issues]);
    if (placed.value.relocated) relocated.push(saved.boardId);
    layouts = layouts.some((layout) => layout.boardId === saved.boardId)
      ? layouts.map((layout) => (layout.boardId === saved.boardId ? placed.value.layout : layout))
      : [...layouts, placed.value.layout];
  }

  const active = new Set([...workspace.cards.map((card) => card.id), cardId]);
  const relationIds = new Set(workspace.relations.map((relation) => relation.id));
  const relationTypes = new Set(workspace.relationTypes.map((type) => type.id));
  const relations = entry.relations.filter((relation) => active.has(relation.from) && active.has(relation.to)
    && !relationIds.has(relation.id) && relationTypes.has(relation.typeId));

  const restored = validateWorkspace({
    ...workspace,
    cards: [...workspace.cards, entry.card],
    boards,
    layouts,
    relations: [...workspace.relations, ...relations],
    trash: (workspace.trash ?? []).filter((candidate) => candidate !== entry),
  });
  if (!restored.ok) return failure([...restored.issues]);
  return resultOf({
    workspace: restored.value,
    report: { relocated, addedToFallback, skippedRelations: entry.relations.length - relations.length },
  }, []);
}

/** Referencias a assets de una tarjeta: `assetRefs` y valores de campos de tipo asset. */
function assetsOf(workspace: Workspace, card: Card): string[] {
  const kinds = new Map(workspace.cardTypes.find((type) => type.id === card.typeId)?.fields.map((field) => [field.key as string, field.kind]) ?? []);
  const fromFields = Object.entries(card.fields)
    .filter(([key, value]) => kinds.get(key) === 'asset' && typeof value === 'string')
    .map(([, value]) => value as string);
  return [...(card.assetRefs ?? []), ...fromFields];
}

/**
 * Elimina definitivamente una tarjeta de la Papelera. Devuelve los assets que ya no usa ninguna
 * tarjeta activa ni otra de la Papelera: solo esos pueden borrarse (después de guardar).
 */
export function purgeTrashedCard(
  workspace: Workspace, cardId: CardId,
): ValidationResult<{ readonly workspace: Workspace; readonly releasedAssets: readonly AssetRef[] }> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return failure([...source.issues]);
  const entry = workspace.trash?.find((candidate) => candidate.card.id === cardId);
  if (!entry) return failure([issue('missing-reference', 'cardId', 'La tarjeta no está en la Papelera.')]);
  const trash = (workspace.trash ?? []).filter((candidate) => candidate !== entry);
  const stillUsed = new Set([
    ...workspace.cards.flatMap((card) => assetsOf(workspace, card)),
    ...trash.flatMap((other) => assetsOf(workspace, other.card)),
  ]);
  const releasedAssets = [...new Set(assetsOf(workspace, entry.card))].filter((ref) => !stillUsed.has(ref)) as AssetRef[];
  const purged = validateWorkspace({ ...workspace, trash });
  if (!purged.ok) return failure([...purged.issues]);
  return resultOf({ workspace: purged.value, releasedAssets }, []);
}
