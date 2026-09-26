/** Zoom por pasos y desplazamiento acotado del lienzo (ADR 0013). Puro: sin React ni plataforma. */

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number;

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-9) ?? MAX_ZOOM;
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-9) ?? MIN_ZOOM;
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)} %`;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Margen que se puede desplazar más allá del contenido; nunca se pierde de vista el lienzo. */
const PAN_MARGIN = 48;

function clampAxis(value: number, content: number, viewport: number): number {
  const min = Math.min(0, viewport - content) - PAN_MARGIN;
  return Math.min(PAN_MARGIN, Math.max(min, value)) + 0;
}

/** Desplazamiento permitido del contenido escalado dentro de la ventana del lienzo. */
export function clampPan(pan: Point, content: Size, zoom: number, viewport: Size): Point {
  return {
    x: clampAxis(pan.x, content.width * zoom, viewport.width),
    y: clampAxis(pan.y, content.height * zoom, viewport.height),
  };
}

/** Cámara práctica del mundo: suficiente para un millón de celdas sin desbordar coordenadas UI. */
const WORLD_PAN_LIMIT = 96_000_000;
export function worldPan(pan: Point): Point {
  const bound = (value: number) => Number.isFinite(value) ? Math.max(-WORLD_PAN_LIMIT, Math.min(WORLD_PAN_LIMIT, value)) + 0 : 0;
  return { x: bound(pan.x), y: bound(pan.y) };
}

/** Líneas del mundo visibles en pantalla, independientemente de la distancia al origen. */
export function visibleGridLines(pan: number, zoom: number, unit: number, viewport: number): number[] {
  const step = zoom * unit;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(pan) || !Number.isFinite(viewport) || viewport <= 0) return [];
  const first = Math.ceil(-pan / step);
  const last = Math.floor((viewport - pan) / step);
  const count = Math.min(Math.max(0, last - first + 1), 2000);
  return Array.from({ length: count }, (_, index) => pan + (first + index) * step);
}

/** Rectángulo en coordenadas del contenido, sin escalar. */
export interface ContentBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Distancia al borde del lienzo con la que queda una tarjeta mostrada al enfocarla. */
const REVEAL_MARGIN = 16;

function revealAxis(pan: number, start: number, size: number, viewport: number): number {
  // Ya se ve entera (aunque toque el borde): no se mueve nada.
  if (pan + start >= 0 && pan + start + size <= viewport) return pan;
  let next = pan;
  if (next + start + size > viewport - REVEAL_MARGIN) next = viewport - REVEAL_MARGIN - start - size;
  // Si no cabe entera, se prioriza su comienzo (título y cabecera).
  if (next + start < REVEAL_MARGIN) next = REVEAL_MARGIN - start;
  return next;
}

/** Pan mínimo para que `box` se vea en la ventana; el mismo objeto si ya se ve. */
export function panToReveal(pan: Point, box: ContentBox, content: Size, zoom: number, viewport: Size): Point {
  const x = revealAxis(pan.x, box.left * zoom, box.width * zoom, viewport.width);
  const y = revealAxis(pan.y, box.top * zoom, box.height * zoom, viewport.height);
  if (x === pan.x && y === pan.y) return pan;
  return clampPan({ x, y }, content, zoom, viewport);
}

/** Enfoca una tarjeta sin volver a recortar la cámara al contenido de 12 columnas. */
export function panToRevealWorld(pan: Point, box: ContentBox, zoom: number, viewport: Size): Point {
  return worldPan({
    x: revealAxis(pan.x, box.left * zoom, box.width * zoom, viewport.width),
    y: revealAxis(pan.y, box.top * zoom, box.height * zoom, viewport.height),
  });
}

/**
 * Celdas enteras visibles con la cámara actual (P2): esquina superior izquierda y ancho de la banda.
 * Una tarjeta nueva se coloca en el primer hueco de esta zona, donde la persona está mirando.
 */
export function visibleCells(pan: Point, zoom: number, metrics: { readonly cell: number; readonly row: number }, viewport: Size): { x: number; y: number; columns: number } {
  const x = Math.ceil(-pan.x / (metrics.cell * zoom)) + 0;
  const y = Math.ceil(-pan.y / (metrics.row * zoom)) + 0;
  const lastColumn = Math.floor((viewport.width - pan.x) / zoom / metrics.cell);
  return { x, y, columns: Math.max(1, lastColumn - x) };
}

/** Paso de la base de pintado, en píxeles del mundo: la base cambia poco al desplazarse. */
const RENDER_STEP = 4096;

/**
 * Base de pintado cerca de la cámara (P2). La capa del lienzo se traslada `pan + base × zoom` y cada
 * caja se dibuja en `caja − base`: los números pintados quedan cerca de cero aunque la tarjeta esté a
 * un millón de celdas. Sin esto, el compositor (coma flotante de 32 bits) pintaba mal lejos del origen.
 */
export function renderBase(pan: Point, zoom: number): Point {
  return {
    x: Math.round(-pan.x / zoom / RENDER_STEP) * RENDER_STEP + 0,
    y: Math.round(-pan.y / zoom / RENDER_STEP) * RENDER_STEP + 0,
  };
}
