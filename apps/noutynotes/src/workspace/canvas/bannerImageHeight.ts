import type { RichTextBlock, RichTextImage } from '@noutynotes/domain';

import { blockLines } from './richTextPreviewProjection';

/**
 * Alto de imagen para una Nota banner con cuerpo HTML seguro (OBS-N2-28/IMAGE-GEOMETRY-G1): cede el
 * espacio que el texto ya seleccionado para la previsualización no necesita (mismo costo por bloque
 * que ya usa `projectRichTextPreview` para decidir qué cabe, reutilizado aquí — nunca duplicado),
 * repartido entre las imágenes visibles si hay más de una, sin bajar del alto histórico `fallback`.
 *
 * Pura, sin React Native: vive en su propio módulo por la misma razón que `bannerImageBudget.ts`.
 */
export function bannerImageHeight(blocks: readonly RichTextBlock[], available: number, lineHeight: number, fallback: number): number {
  const imageBlocks = blocks.filter((block): block is RichTextImage => block.type === 'image');
  if (imageBlocks.length === 0) return fallback;
  const textLines = blocks.reduce((total, block) => (block.type === 'image' ? total : total + blockLines(block)), 0);
  return Math.max(fallback, Math.floor((Math.max(0, available) - textLines * lineHeight) / imageBlocks.length));
}
