import { CANONICAL_GRID } from '@noutynotes/application';
import { MOBILE_GRID, compareReadingOrder, footprint, projectLayout } from '@noutynotes/domain';
import type { BoardLayout, CardId, GridCell, Relation, RelationId } from '@noutynotes/domain';
import type { LayoutMode } from '@noutynotes/ui';

/** Alto de una fila de la grilla en píxeles y separación visual entre tarjetas. */
export const BOARD_ROW_HEIGHT = 56;
export const BOARD_GAP = 8;
const EMPTY_BOARD_ROWS = 3;

export interface CardBox {
  readonly cardId: CardId;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardGeometry {
  readonly columns: number;
  /** En orden de lectura, para que el orden de tabulación siga al visual. */
  readonly boxes: readonly CardBox[];
  readonly height: number;
}

/**
 * Convierte celdas de grilla en cajas de píxeles. En modo amplio se dibuja el layout canónico
 * (12 columnas); en compacto, su proyección a una columna (ADR 0004). Nunca modifica el layout.
 */
export function boardBoxes(layout: BoardLayout, mode: LayoutMode, width: number): BoardGeometry | null {
  if (!(width > 0)) return null;
  let columns: number;
  let cells: { readonly cardId: CardId; readonly cell: GridCell }[];
  if (mode === 'wide') {
    columns = CANONICAL_GRID.columns;
    cells = [...layout.placements].sort(compareReadingOrder).map((placement) => ({ cardId: placement.cardId, cell: footprint(placement) }));
  } else {
    const projected = projectLayout(layout, CANONICAL_GRID, MOBILE_GRID);
    if (!projected.ok) return null;
    columns = projected.value.columns;
    cells = [...projected.value.items].sort((a, b) => a.order - b.order);
  }
  const column = width / columns;
  const boxes = cells.map(({ cardId, cell }) => ({
    cardId,
    left: cell.x * column + BOARD_GAP / 2,
    top: cell.y * BOARD_ROW_HEIGHT + BOARD_GAP / 2,
    width: cell.w * column - BOARD_GAP,
    height: cell.h * BOARD_ROW_HEIGHT - BOARD_GAP,
  }));
  const rows = cells.reduce((bottom, { cell }) => Math.max(bottom, cell.y + cell.h), 0);
  return { columns, boxes, height: Math.max(rows, cells.length === 0 ? EMPTY_BOARD_ROWS : 0) * BOARD_ROW_HEIGHT };
}

export interface RelationSegment {
  readonly relationId: RelationId;
  /** Extremos sobre el borde de la tarjeta de origen y de la de destino. */
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  /** Caja horizontal centrada en el punto medio, rotada `angle` grados. */
  readonly left: number;
  readonly top: number;
  readonly length: number;
  readonly angle: number;
}

/** Fracción del vector centro→centro que queda dentro de una caja de semiejes (hw, hh). */
function exitFraction(dx: number, dy: number, hw: number, hh: number): number {
  const horizontal = dx === 0 ? Infinity : hw / Math.abs(dx);
  const vertical = dy === 0 ? Infinity : hh / Math.abs(dy);
  return Math.min(horizontal, vertical);
}

/**
 * Segmentos de relación entre los bordes de las tarjetas dibujadas, en el sentido origen → destino.
 * Omite relaciones sin ambos extremos en pantalla o entre cajas que se tocan o se solapan.
 */
export function relationSegments(relations: readonly Relation[], boxes: readonly CardBox[]): RelationSegment[] {
  const byId = new Map(boxes.map((box) => [box.cardId, box]));
  return relations.flatMap((relation) => {
    const from = byId.get(relation.from);
    const to = byId.get(relation.to);
    if (!from || !to) return [];
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const dx = to.left + to.width / 2 - fromX;
    const dy = to.top + to.height / 2 - fromY;
    const leave = exitFraction(dx, dy, from.width / 2, from.height / 2);
    const enter = 1 - exitFraction(dx, dy, to.width / 2, to.height / 2);
    if (!(enter > leave)) return [];
    const startX = fromX + dx * leave;
    const startY = fromY + dy * leave;
    const endX = fromX + dx * enter;
    const endY = fromY + dy * enter;
    const length = Math.hypot(endX - startX, endY - startY);
    return [{
      relationId: relation.id, startX, startY, endX, endY,
      left: (startX + endX) / 2 - length / 2,
      top: (startY + endY) / 2,
      length,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    }];
  });
}
