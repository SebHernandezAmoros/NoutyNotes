/**
 * Escala semántica de título/cuerpo por ficha (ADR 0050): un único mapa de píxeles por nivel,
 * reutilizado por el lienzo, Lista y la impresión para que los tres se vean coherentes entre sí
 * en vez de divergir con medidas arbitrarias por superficie. `undefined` (ausente en la tarjeta)
 * es `'medium'`, el tamaño de hoy: ninguna ficha existente cambia de aspecto por este cambio.
 */
import type { TextSize } from '@noutynotes/domain';

const TITLE_PX: Readonly<Record<TextSize, number>> = { small: 13, medium: 16, large: 20 };
const BODY_PX: Readonly<Record<TextSize, number>> = { small: 11, medium: 13, large: 16 };

export function titleFontSize(size: TextSize | undefined): number {
  return TITLE_PX[size ?? 'medium'];
}

export function bodyFontSize(size: TextSize | undefined): number {
  return BODY_PX[size ?? 'medium'];
}

export function titleLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.25);
}

export function bodyLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.35);
}
