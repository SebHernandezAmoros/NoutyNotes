import { CANONICAL_GRID } from '@noutynotes/application';
import { MOBILE_GRID, compareReadingOrder, createOrthogonalConnectorPath, footprint, projectLayout } from '@noutynotes/domain';
import type { BoardLayout, Card, CardId, CardPlacement, GridCell, GridRect, Relation, RelationId } from '@noutynotes/domain';
import type { LayoutMode } from '@noutynotes/ui';

import { cardBox } from './canvas/geometry';
import type { CanvasMetrics, PixelBox } from './canvas/geometry';

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

/**
 * Única proyección visual de las tarjetas durante P18-E1. Los rectángulos confirmados, los cambios
 * locales pendientes y las cajas exactas de un gesto activo confluyen aquí; relaciones, conectores,
 * tarjetas y controles consumen después el mismo resultado.
 */
export function projectedCardBoxes(
  placements: readonly CardPlacement[],
  metrics: CanvasMetrics,
  rectOverrides: ReadonlyMap<CardId, GridRect> = new Map(),
  boxOverrides: ReadonlyMap<CardId, PixelBox> = new Map(),
): CardBox[] {
  return placements.map((placement) => {
    const exact = boxOverrides.get(placement.cardId);
    const rect = rectOverrides.get(placement.cardId);
    const box = exact ?? cardBox(footprint(rect ? { ...placement, rect } : placement), metrics);
    return { cardId: placement.cardId, ...box };
  });
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

export interface ConnectorSegment extends Omit<RelationSegment, 'relationId'> {
  readonly cardId: CardId;
  readonly index: number;
}

export interface ConnectorRouteGeometry {
  readonly cardId: CardId;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly segments: readonly ConnectorSegment[];
  readonly legacy: boolean;
}

export interface ConnectorProjectionMetrics {
  readonly cell: number;
  readonly row: number;
  readonly gap: number;
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

function pointOnBorder(box: CardBox, targetX: number, targetY: number): { x: number; y: number } {
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const dx = targetX - x;
  const dy = targetY - y;
  if (dx === 0 && dy === 0) return { x, y };
  const fraction = exitFraction(dx, dy, box.width / 2, box.height / 2);
  return { x: x + dx * fraction, y: y + dy * fraction };
}

const segment = (cardId: CardId, index: number, start: { x: number; y: number }, end: { x: number; y: number }): ConnectorSegment | null => {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return null;
  return { cardId, index, startX: start.x, startY: start.y, endX: end.x, endY: end.y,
    left: (start.x + end.x) / 2 - length / 2, top: (start.y + end.y) / 2,
    length, angle: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI };
};

/**
 * Geometría decorativa portable (ADR 0061). La ruta vive en CardPlacement porque puede diferir por tablero.
 * Los conectores v10 sin ruta conservan su diagonal hasta que la persona los edita deliberadamente.
 */
export function connectorRoutes(
  connectors: readonly Card[], placements: readonly CardPlacement[], boxes: readonly CardBox[], metrics: ConnectorProjectionMetrics,
): ConnectorRouteGeometry[] {
  const byId = new Map(boxes.map((box) => [box.cardId, box]));
  const placementById = new Map(placements.map((placement) => [placement.cardId, placement]));
  return connectors.flatMap((card): ConnectorRouteGeometry[] => {
    const own = byId.get(card.id);
    if (!own) return [];
    const placement = placementById.get(card.id);
    if (placement?.connectorPath) {
      const path = placement.connectorPath;
      const pixels = path.map((point) => ({
        x: own.left - metrics.gap / 2 + (point.x - placement.rect.x) * metrics.cell,
        y: own.top - metrics.gap / 2 + (point.y - placement.rect.y) * metrics.row,
      }));
      const startBox = card.connectorStartCardId ? byId.get(card.connectorStartCardId) : undefined;
      const endBox = card.connectorEndCardId ? byId.get(card.connectorEndCardId) : undefined;
      if (startBox && pixels.length >= 2) {
        const next = pixels[1] as { x: number; y: number };
        if (pixels[0]?.y === next.y) {
          const y = startBox.top + startBox.height / 2;
          pixels[0] = { x: next.x >= startBox.left + startBox.width / 2 ? startBox.left + startBox.width : startBox.left, y };
          pixels[1] = { ...next, y };
        } else {
          const x = startBox.left + startBox.width / 2;
          pixels[0] = { x, y: next.y >= startBox.top + startBox.height / 2 ? startBox.top + startBox.height : startBox.top };
          pixels[1] = { ...next, x };
        }
      }
      if (endBox && pixels.length >= 2) {
        const previousIndex = pixels.length - 2;
        const previous = pixels[previousIndex] as { x: number; y: number };
        const last = pixels[pixels.length - 1] as { x: number; y: number };
        if (previous.y === last.y) {
          const y = endBox.top + endBox.height / 2;
          pixels[pixels.length - 1] = { x: previous.x <= endBox.left + endBox.width / 2 ? endBox.left : endBox.left + endBox.width, y };
          pixels[previousIndex] = { ...previous, y };
        } else {
          const x = endBox.left + endBox.width / 2;
          pixels[pixels.length - 1] = { x, y: previous.y <= endBox.top + endBox.height / 2 ? endBox.top : endBox.top + endBox.height };
          pixels[previousIndex] = { ...previous, x };
        }
      }
      const projected = pixels.length === 2 && pixels[0]?.x !== pixels[1]?.x && pixels[0]?.y !== pixels[1]?.y
        ? createOrthogonalConnectorPath(pixels[0] as { x: number; y: number }, pixels[1] as { x: number; y: number })
        : pixels;
      const segments = projected.slice(0, -1).flatMap((start, index) => {
        const current = segment(card.id, index, start, projected[index + 1] as { x: number; y: number });
        return current ? [current] : [];
      });
      return [{ cardId: card.id, points: projected, segments, legacy: false }];
    }
    const down = (card.connectorDirection ?? 'down') === 'down';
    let start = { x: own.left, y: down ? own.top : own.top + own.height };
    let end = { x: own.left + own.width, y: down ? own.top + own.height : own.top };
    const startBox = card.connectorStartCardId ? byId.get(card.connectorStartCardId) : undefined;
    const endBox = card.connectorEndCardId ? byId.get(card.connectorEndCardId) : undefined;
    if (startBox) start = pointOnBorder(startBox, endBox ? endBox.left + endBox.width / 2 : end.x, endBox ? endBox.top + endBox.height / 2 : end.y);
    if (endBox) end = pointOnBorder(endBox, startBox ? startBox.left + startBox.width / 2 : start.x, startBox ? startBox.top + startBox.height / 2 : start.y);
    const legacy = segment(card.id, 0, start, end);
    return legacy ? [{ cardId: card.id, points: [start, end], segments: [legacy], legacy: true }] : [];
  });
}

/** Compatibilidad con las pruebas y vistas P15 que aún consumen un único tramo diagonal. */
export function connectorSegments(connectors: readonly Card[], boxes: readonly CardBox[]): ConnectorSegment[] {
  const placements = connectors.flatMap((card) => {
    const box = boxes.find((candidate) => candidate.cardId === card.id);
    return box ? [{ cardId: card.id, rect: { x: 0, y: 0, w: 1, h: 1 }, display: 'expanded' as const }] : [];
  });
  return connectorRoutes(connectors, placements, boxes, { cell: 1, row: 1, gap: 0 }).flatMap((route) => route.segments);
}
