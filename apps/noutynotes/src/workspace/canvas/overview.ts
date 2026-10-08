/**
 * Vista general del lienzo (ADR 0028): límites del contenido, «Ver todo», minimapa y selección por
 * área. Puro: coordenadas del mundo en píxeles al 100 % (las de `cardBox`), sin React ni plataforma.
 */
import { footprint } from '@noutynotes/domain';
import type { BoardLayout, CardId } from '@noutynotes/domain';

import { cardBox } from './geometry';
import type { CanvasMetrics, PixelBox } from './geometry';
import { MIN_ZOOM, worldPan, zoomOut } from './viewport';
import type { Point, Size } from './viewport';

const FIT_MARGIN = 24;

const union = (a: PixelBox, b: PixelBox): PixelBox => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
};

/** Rectángulo que contiene todas las tarjetas (con su huella) y los marcos; null si no hay nada. */
export function contentBounds(layout: BoardLayout | undefined, metrics: CanvasMetrics): PixelBox | null {
  const routePoints = (layout?.placements ?? []).flatMap((placement) => (placement.connectorPath ?? []).map((point) => ({
    left: point.x * metrics.cell, top: point.y * metrics.row, width: 0, height: 0,
  })));
  const boxes = [
    ...(layout?.placements ?? []).map((placement) => cardBox(footprint(placement), metrics)),
    ...(layout?.frames ?? []).map((frame) => cardBox(frame.rect, metrics)),
    ...routePoints,
  ];
  return boxes.length === 0 ? null : boxes.reduce(union);
}

/**
 * «Ver todo»: el mayor paso de zoom en el que cabe (sin pasar de 100 %) y el contenido centrado en el
 * alto libre, sin los `reserveBottom` píxeles de los controles inferiores.
 */
export function fitView(bounds: PixelBox, viewport: Size, reserveBottom = 0): { readonly zoom: number; readonly pan: Point } {
  const free = { width: viewport.width, height: Math.max(1, viewport.height - reserveBottom) };
  const room = Math.min((viewport.width - 2 * FIT_MARGIN) / Math.max(1, bounds.width), (free.height - 2 * FIT_MARGIN) / Math.max(1, bounds.height));
  let zoom = 1;
  while (zoom > room && zoom > MIN_ZOOM) zoom = zoomOut(zoom);
  return { zoom, pan: panToCenter({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, zoom, free) };
}

/** Lo que se ve, en coordenadas del mundo. */
export function visibleWorld(pan: Point, zoom: number, viewport: Size): PixelBox {
  return { left: -pan.x / zoom + 0, top: -pan.y / zoom + 0, width: viewport.width / zoom, height: viewport.height / zoom };
}

/** Desplazamiento que deja ese punto del mundo en el centro de la ventana. */
export function panToCenter(point: Point, zoom: number, viewport: Size): Point {
  return worldPan({ x: viewport.width / 2 - point.x * zoom, y: viewport.height / 2 - point.y * zoom });
}

/**
 * Escala del minimapa: abarca el contenido y la zona visible (que puede estar lejos), centrados en el
 * panel. `toMap` pasa una caja del mundo al panel; `toWorld`, un punto del panel al mundo.
 */
export function minimap(content: PixelBox | null, view: PixelBox, size: Size, padding: number) {
  const world = content ? union(content, view) : view;
  const scale = Math.min((size.width - 2 * padding) / Math.max(1, world.width), (size.height - 2 * padding) / Math.max(1, world.height));
  const offsetX = padding + (size.width - 2 * padding - world.width * scale) / 2;
  const offsetY = padding + (size.height - 2 * padding - world.height * scale) / 2;
  return {
    scale,
    toMap: (box: PixelBox): PixelBox => ({
      left: offsetX + (box.left - world.left) * scale, top: offsetY + (box.top - world.top) * scale, width: box.width * scale, height: box.height * scale,
    }),
    toWorld: (point: Point): Point => ({ x: (point.x - offsetX) / scale + world.left, y: (point.y - offsetY) / scale + world.top }),
  };
}

/** Tarjetas que toca el rectángulo (en cualquier sentido del arrastre), en el orden del layout. */
export function cardsInArea(layout: BoardLayout | undefined, metrics: CanvasMetrics, area: PixelBox): CardId[] {
  const left = Math.min(area.left, area.left + area.width);
  const top = Math.min(area.top, area.top + area.height);
  const right = Math.max(area.left, area.left + area.width);
  const bottom = Math.max(area.top, area.top + area.height);
  return (layout?.placements ?? []).filter((placement) => {
    const box = cardBox(footprint(placement), metrics);
    return box.left < right && left < box.left + box.width && box.top < bottom && top < box.top + box.height;
  }).map((placement) => placement.cardId);
}
