/**
 * Portapapeles interno de selección múltiple (ADR 0052): copiar/cortar son instantáneas puras del
 * workspace ya cargado (sin tocar `storage`); pegar y duplicar son las únicas operaciones que
 * escriben, cada una en un solo `modifyWorkspace` (una sola entrada de deshacer, sin importar
 * cuántas tarjetas lleve el grupo).
 */
import { findFreeSpace, pasteCardsOnBoard } from '@noutynotes/domain';
import type {
  BoardId, Card, CardId, CardPlacement, GridPoint, Relation, RelationId, ValidationResult, Workspace, WorkspaceId,
} from '@noutynotes/domain';

import { nextSequentialId } from './ids';
import { CANONICAL_GRID, takenCardIds, takenRelationIds } from './workspace-editing';
import type { WorkspaceStorage, WorkspaceStorageResult, WorkspaceSummary } from './workspace-storage';
import { modifyWorkspace } from './workspace-use-cases';

export interface ClipboardSnapshot {
  readonly mode: 'copy' | 'cut';
  readonly cards: readonly Card[];
  readonly relations: readonly Relation[];
  readonly placements: readonly CardPlacement[];
}

/** Conservative integer occupancy for the whole-cell free-space search. Merging rounded neighbours
 * keeps this temporary layout valid without touching the real quarter-cell geometry. */
function wholeCellSearchLayout(layout: Workspace['layouts'][number]): Workspace['layouts'][number] {
  const cells: CardPlacement[] = [];
  for (const placement of layout.placements) {
    if (placement.connectorPath !== undefined) continue;
    const x = Math.floor(placement.rect.x);
    const y = Math.floor(placement.rect.y);
    let box = { x, y, w: Math.max(1, Math.ceil(placement.rect.x + placement.rect.w) - x),
      h: Math.max(1, Math.ceil(placement.rect.y + placement.rect.h) - y) };
    for (let index = 0; index < cells.length;) {
      const other = cells[index]!.rect;
      const overlaps = box.x < other.x + other.w && other.x < box.x + box.w
        && box.y < other.y + other.h && other.y < box.y + box.h;
      if (!overlaps) { index++; continue; }
      const right = Math.max(box.x + box.w, other.x + other.w);
      const bottom = Math.max(box.y + box.h, other.y + other.h);
      box = { x: Math.min(box.x, other.x), y: Math.min(box.y, other.y), w: 0, h: 0 };
      box = { ...box, w: right - box.x, h: bottom - box.y };
      cells.splice(index, 1);
      index = 0;
    }
    cells.push({ ...placement, rect: box, display: 'expanded' });
  }
  return { ...layout, placements: cells };
}

/**
 * Instantánea de una selección en un tablero: solo relaciones con ambos extremos dentro del
 * conjunto (ADR 0052). `null` si la selección está vacía o alguna tarjeta no tiene colocación en
 * ese tablero (p. ej. aparece en otro). Pura: no toca `storage`, copiar no es una acción guardada.
 */
export function snapshotSelection(workspace: Workspace, boardId: BoardId, cardIds: readonly CardId[], mode: 'copy' | 'cut'): ClipboardSnapshot | null {
  const idSet = new Set(cardIds);
  if (idSet.size === 0) return null;
  const cards = workspace.cards.filter((card) => idSet.has(card.id)).map((card) => {
    const { connectorStartCardId, connectorEndCardId, ...rest } = card;
    return {
      ...rest,
      ...(connectorStartCardId && idSet.has(connectorStartCardId) ? { connectorStartCardId } : {}),
      ...(connectorEndCardId && idSet.has(connectorEndCardId) ? { connectorEndCardId } : {}),
    } as Card;
  });
  if (cards.length !== idSet.size) return null;
  const layout = workspace.layouts.find((candidate) => candidate.boardId === boardId);
  const placements = (layout?.placements ?? []).filter((placement) => idSet.has(placement.cardId));
  if (placements.length !== idSet.size) return null;
  const relations = workspace.relations.filter((relation) => idSet.has(relation.from) && idSet.has(relation.to));
  return { mode, cards, relations, placements };
}

/**
 * Añade la instantánea a un tablero (destino puro, reutilizado por pegar y duplicar): IDs nuevos
 * para tarjetas y relaciones, con la relación remapeada a los IDs nuevos; el grupo conserva sus
 * posiciones relativas y se desplaza como conjunto al siguiente hueco libre desde una celda a la
 * derecha y abajo de donde se copió (visible, nunca superpuesto a sí mismo).
 */
function pasteOnto(workspace: Workspace, boardId: BoardId, snapshot: ClipboardSnapshot, near?: GridPoint): ValidationResult<Workspace> {
  if (!workspace.boards.some((board) => board.id === boardId)) {
    return { ok: false, issues: [{ code: 'missing-reference', path: 'boardId', message: 'El tablero destino no existe.' }] };
  }
  const takenCards = [...takenCardIds(workspace)];
  const cardIdMap = new Map<CardId, CardId>();
  snapshot.cards.forEach((card) => {
    const newId = nextSequentialId('tarjeta', takenCards) as CardId;
    takenCards.push(newId);
    cardIdMap.set(card.id, newId);
  });
  const cards: Card[] = snapshot.cards.map((card) => {
    const { connectorStartCardId, connectorEndCardId, ...rest } = card;
    return {
      ...rest,
      id: cardIdMap.get(card.id) as CardId,
      ...(connectorStartCardId && cardIdMap.has(connectorStartCardId) ? { connectorStartCardId: cardIdMap.get(connectorStartCardId) } : {}),
      ...(connectorEndCardId && cardIdMap.has(connectorEndCardId) ? { connectorEndCardId: cardIdMap.get(connectorEndCardId) } : {}),
    } as Card;
  });
  const takenRelations = [...takenRelationIds(workspace)];
  const relations: Relation[] = snapshot.relations.map((relation) => {
    const newId = nextSequentialId('relacion', takenRelations) as RelationId;
    takenRelations.push(newId);
    return { ...relation, id: newId, from: cardIdMap.get(relation.from) as CardId, to: cardIdMap.get(relation.to) as CardId };
  });
  const placementXs = snapshot.placements.flatMap((placement) => [placement.rect.x, placement.rect.x + placement.rect.w, ...(placement.connectorPath ?? []).map((point) => point.x)]);
  const placementYs = snapshot.placements.flatMap((placement) => [placement.rect.y, placement.rect.y + placement.rect.h, ...(placement.connectorPath ?? []).map((point) => point.y)]);
  const minX = Math.min(...placementXs);
  const minY = Math.min(...placementYs);
  const maxX = Math.max(...placementXs);
  const maxY = Math.max(...placementYs);
  // `findFreeSpace` searches whole cells. A group may start or end on quarter cells when the
  // visual snap is off; round only its search envelope, then move every original by a whole-cell
  // delta. This preserves relative geometry and the fractional phase of each placement/path.
  const searchX = Math.floor(minX);
  const searchY = Math.floor(minY);
  const searchSize = { w: Math.max(1, Math.ceil(maxX) - searchX), h: Math.max(1, Math.ceil(maxY) - searchY) };
  const layout = workspace.layouts.find((candidate) => candidate.boardId === boardId) ?? { boardId, placements: [] };
  // Occupied quarter-cell edges can make findFreeSpace return a fractional candidate row.
  // Use outward whole-cell envelopes only for the search; never rewrite actual placements.
  const searchLayout = wholeCellSearchLayout(layout);
  const spot = findFreeSpace(searchLayout, searchSize, CANONICAL_GRID,
    near ? { from: near, columns: 1 } : { from: { x: searchX + 1, y: searchY + 1 } });
  if (!spot.ok) return spot;
  const delta: GridPoint = { x: spot.value.x - searchX, y: spot.value.y - searchY };
  const placements: CardPlacement[] = snapshot.placements.map((placement) => ({
    cardId: cardIdMap.get(placement.cardId) as CardId,
    rect: { x: placement.rect.x + delta.x, y: placement.rect.y + delta.y, w: placement.rect.w, h: placement.rect.h },
    display: placement.display,
    ...(placement.connectorPath === undefined ? {} : { connectorPath: placement.connectorPath.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })) }),
  }));
  return pasteCardsOnBoard(workspace, { boardId, cards, relations, placements, config: CANONICAL_GRID });
}

/** Pegar (ADR 0052): la instantánea puede ir a un tablero distinto del que se copió, mismo workspace. */
export function pasteSnapshot(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, boardId: BoardId, snapshot: ClipboardSnapshot, near?: GridPoint,
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => pasteOnto(workspace, boardId, snapshot, near));
}

/** Duplicar (ADR 0052): copiar y pegar en un solo paso, sin tocar el portapapeles existente. */
export function duplicateSelection(
  storage: WorkspaceStorage, workspaceId: WorkspaceId, boardId: BoardId, cardIds: readonly CardId[],
): Promise<WorkspaceStorageResult<WorkspaceSummary>> {
  return modifyWorkspace(storage, workspaceId, (workspace) => {
    const snapshot = snapshotSelection(workspace, boardId, cardIds, 'copy');
    if (!snapshot) return { ok: false, issues: [{ code: 'invalid-value', path: 'cardIds', message: 'Selección vacía o sin colocación en este tablero.' }] };
    return pasteOnto(workspace, boardId, snapshot);
  });
}
