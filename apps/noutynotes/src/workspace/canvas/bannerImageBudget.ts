import type { NoteBlock } from '@noutynotes/application';

import { estimatePreviewLines } from './previewOverflow';

/**
 * Reparto del alto entre imagen(es) y texto para una Nota banner (OBS-N2-28/IMAGE-GEOMETRY-G1): el
 * texto reserva primero lo que realmente necesita (mismo criterio de recorte que ya usa `NotePreview`
 * para el texto, sin un máximo arbitrario de líneas); la imagen recibe el resto del espacio disponible,
 * repartido entre varias si hay más de una, sin bajar nunca del tamaño histórico `thumb`. Solo decide
 * el tamaño objetivo: el llamador sigue acotando el resultado al presupuesto real restante bloque a
 * bloque (una tarjeta sin espacio para ninguno de los dos sigue degradando igual que hoy).
 *
 * `width`/`fontSize` estiman renglones reales por envoltorio visual (reutilizando `estimatePreviewLines`,
 * ya probado en `previewOverflow.ts`) en vez de solo contar saltos de línea explícitos — un párrafo
 * largo sin saltos propios antes «costaba» siempre 1 renglón, dejándole a la imagen más espacio del
 * que realmente sobraba (causa confirmada de OBS-N2-RICHTEXT-CANVAS-VISIBILITY).
 *
 * Pura, sin React Native: vive en su propio módulo (en vez de dentro de `NotePreview.tsx`) porque
 * importar `react-native` desde una prueba unitaria directa falla fuera del empaquetador de la app.
 */
export function bannerImageBudget(
  blocks: readonly NoteBlock[], available: number, lineHeight: number, gap: number, thumb: number, width: number, fontSize: number,
): number {
  const images = blocks.filter((block) => block.kind === 'image');
  if (images.length === 0) return thumb;
  let left = available;
  for (const block of blocks) {
    if (block.kind === 'image') continue;
    const lines = Math.min(estimatePreviewLines(block.text, width, fontSize), Math.floor(left / lineHeight));
    if (lines <= 0) break;
    left -= lines * lineHeight + gap;
  }
  const textNeed = available - left;
  // Cada imagen con `alt` reserva, además, su propia línea de leyenda (ADR 0051) — sin descontarla
  // aquí, el presupuesto calculado dejaría sin espacio real a un bloque de texto que sí debería caber.
  const captionReserve = images.filter((image) => image.kind === 'image' && image.alt !== '').length * lineHeight;
  return Math.max(thumb, Math.floor((available - textNeed - captionReserve - gap * images.length) / images.length));
}
