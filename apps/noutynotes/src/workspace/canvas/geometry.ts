import { CANONICAL_GRID } from '@noutynotes/application';
import { cellsOverlap, footprint, moveCard, resizeCard } from '@noutynotes/domain';
import type { BoardLayout, CardId, GridCell, GridPoint, GridSize, ValidationResult } from '@noutynotes/domain';

/**
 * Geometría pura del lienzo (ADR 0013): el layout canónico de 12 columnas en píxeles, arrastre y
 * asas convertidos a celdas, y la validación previa al guardado con el motor de grilla del dominio.
 */

/** Tamaño de una celda al 100 %. En compacto (< 800 px) caben dos tarjetas de 4 columnas en 390 px. */
export interface CanvasMetrics {
  readonly cell: number;
  readonly row: number;
  /** Separación entre fichas (densidad, ADR 0014). */
  readonly gap: number;
}

export const WIDE_METRICS: CanvasMetrics = { cell: 96, row: 64, gap: 8 };
export const COMPACT_METRICS: CanvasMetrics = { cell: 56, row: 56, gap: 8 };
const MIN_ROWS = 8;
const FREE_ROWS_BELOW = 4;

export interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function cardBox(cell: GridCell, metrics: CanvasMetrics): PixelBox {
  return {
    left: cell.x * metrics.cell + metrics.gap / 2,
    top: cell.y * metrics.row + metrics.gap / 2,
    width: cell.w * metrics.cell - metrics.gap,
    height: cell.h * metrics.row - metrics.gap,
  };
}

/** Todo el ancho de la grilla canónica y filas libres bajo la última huella para poder soltar debajo. */
export function canvasSize(layout: BoardLayout | undefined, metrics: CanvasMetrics): { width: number; height: number; rows: number } {
  const bottom = (layout?.placements ?? []).reduce((max, placement) => {
    const cell = footprint(placement);
    return Math.max(max, cell.y + cell.h);
  }, 0);
  const rows = Math.max(MIN_ROWS, bottom === 0 ? 0 : bottom + FREE_ROWS_BELOW);
  return { width: CANONICAL_GRID.columns * metrics.cell, height: rows * metrics.row, rows };
}

const cells = (pixels: number, zoom: number, unit: number) => Math.round(pixels / zoom / unit) + 0;

/** Esquina de destino de un arrastre de (dx, dy) px de pantalla. No recorta: eso lo decide el motor. */
export function dragTarget(cell: GridPoint, dx: number, dy: number, zoom: number, metrics: CanvasMetrics): GridPoint {
  return { x: cell.x + cells(dx, zoom, metrics.cell), y: cell.y + cells(dy, zoom, metrics.row) };
}

export type ResizeHandle = 'e' | 's' | 'se';

/** Tamaño de destino al arrastrar un asa; la esquina superior izquierda no cambia. Mínimo 1 × 1. */
export function resizeTarget(size: GridSize, handle: ResizeHandle, dx: number, dy: number, zoom: number, metrics: CanvasMetrics): GridSize {
  const w = handle === 's' ? size.w : size.w + cells(dx, zoom, metrics.cell);
  const h = handle === 'e' ? size.h : size.h + cells(dy, zoom, metrics.row);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Caja de la vista previa: con imán, la celda de destino; sin imán, sigue al puntero. */
export function previewBox(
  cell: GridCell, target: GridPoint, dx: number, dy: number, zoom: number, snap: boolean, metrics: CanvasMetrics,
): PixelBox {
  if (snap) return cardBox({ ...cell, x: target.x, y: target.y }, metrics);
  const origin = cardBox(cell, metrics);
  return { ...origin, left: origin.left + dx / zoom, top: origin.top + dy / zoom };
}

export type PlacementCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly colliding: readonly CardId[] };

function checked(layout: BoardLayout, cardId: CardId, result: ValidationResult<BoardLayout>, candidate: (current: BoardLayout['placements'][number]) => GridCell): PlacementCheck {
  if (result.ok) return { ok: true };
  const code = result.issues[0]?.code ?? 'invalid-layout';
  const placement = layout.placements.find((current) => current.cardId === cardId);
  if (code !== 'grid-collision' || !placement) return { ok: false, code, colliding: [] };
  const area = candidate(placement);
  const colliding = layout.placements
    .filter((other) => other.cardId !== cardId && cellsOverlap(area, footprint(other)))
    .map((other) => other.cardId);
  return { ok: false, code, colliding };
}

/** ¿Se puede mover ahí? Mismas reglas que el caso de uso que guardará (moveCard sobre la grilla canónica). */
export function checkMove(layout: BoardLayout, cardId: CardId, to: GridPoint): PlacementCheck {
  return checked(layout, cardId, moveCard(layout, cardId, to, CANONICAL_GRID),
    (placement) => footprint({ ...placement, rect: { ...placement.rect, ...to } }));
}

export function checkResize(layout: BoardLayout, cardId: CardId, size: GridSize): PlacementCheck {
  return checked(layout, cardId, resizeCard(layout, cardId, size, CANONICAL_GRID),
    (placement) => footprint({ ...placement, rect: { ...placement.rect, ...size } }));
}

/** Umbral en píxeles de pantalla: por debajo, el gesto es un toque (selección), no un arrastre. */
export const DRAG_THRESHOLD = 6;

export function isDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;
}
