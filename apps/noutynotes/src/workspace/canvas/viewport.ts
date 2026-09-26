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
