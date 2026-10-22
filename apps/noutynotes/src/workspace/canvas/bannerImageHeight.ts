import type { CaptionPosition, RichTextBlock, RichTextDocument, RichTextImage } from '@noutynotes/domain';

import { blockLines } from './richTextPreviewProjection';

/**
 * Alto de imagen para una Nota banner con cuerpo HTML seguro (OBS-N2-28/IMAGE-GEOMETRY-G1): cede el
 * espacio que el texto ya seleccionado para la previsualización no necesita (mismo costo por bloque
 * que ya usa `projectRichTextPreview` para decidir qué cabe, reutilizado aquí — nunca duplicado),
 * repartido entre las imágenes visibles si hay más de una, sin bajar del alto histórico `fallback`.
 * `width`/`fontSize` permiten que ese costo por bloque cuente renglones reales por envoltorio visual,
 * no solo saltos de línea explícitos (corrección de regresión de texto omitido).
 *
 * Pura, sin React Native: vive en su propio módulo por la misma razón que `bannerImageBudget.ts`.
 */
export function bannerImageHeight(
  blocks: readonly RichTextBlock[], available: number, lineHeight: number, fallback: number, width: number, fontSize: number,
  layout?: { readonly reservedHeight: number; readonly textHeight: number },
): number {
  const imageBlocks = blocks.filter((block): block is RichTextImage => block.type === 'image');
  if (imageBlocks.length === 0) return fallback;
  const textLines = blocks.reduce((total, block) => (block.type === 'image' ? total : total + blockLines(block, width, fontSize)), 0);
  return Math.max(fallback, Math.floor((Math.max(0, available) - (layout?.textHeight ?? textLines * lineHeight) - (layout?.reservedHeight ?? 0)) / imageBlocks.length));
}

// Actual sizes shared with RichNotePreview, not an arbitrary safety margin.
export const BANNER_BLOCK_GAP = 6;
export const BANNER_CAPTION_GAP = 2;
export const BANNER_CAPTION_LINE = 14;
export const BANNER_OVERFLOW_HEIGHT = 44;

/** Pixel budget for whole Banner blocks; never changes the durable document. */
export function projectBannerPreview(document: RichTextDocument, options: {
  readonly height: number;
  readonly width: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly imageMinimum: number;
  readonly captionPosition: CaptionPosition;
  readonly textHeights: Readonly<Record<number, number>>;
}) {
  const { height, width, fontSize, lineHeight, imageMinimum, captionPosition, textHeights } = options;
  const sideways = captionPosition === 'left' || captionPosition === 'right';
  const captionHeight = (block: RichTextBlock) => block.type === 'image' && !sideways
    && (block.caption?.length || block.alt) ? BANNER_CAPTION_LINE + BANNER_CAPTION_GAP : 0;
  const textHeight = (block: RichTextBlock, index: number) => textHeights[index] ?? blockLines(block, width, fontSize) * lineHeight;
  const select = (available: number) => {
    let used = 0;
    const blocks: RichTextBlock[] = [];
    for (const [index, block] of document.blocks.entries()) {
      const cost = (blocks.length > 0 ? BANNER_BLOCK_GAP : 0)
        + (block.type === 'image' ? imageMinimum + captionHeight(block) : textHeight(block, index));
      if (used + cost > Math.max(0, available)) break;
      used += cost;
      blocks.push(block);
    }
    return blocks;
  };
  let blocks = select(height);
  const hidden = blocks.length < document.blocks.length;
  if (hidden) blocks = select(height - BANNER_OVERFLOW_HEIGHT - BANNER_BLOCK_GAP);
  const gaps = BANNER_BLOCK_GAP * Math.max(0, blocks.length - 1);
  const captions = blocks.reduce((sum, block) => sum + captionHeight(block), 0);
  const text = blocks.reduce((sum, block, index) => sum + (block.type === 'image' ? 0 : textHeight(block, index)), 0);
  const overflow = hidden ? BANNER_OVERFLOW_HEIGHT + (blocks.length > 0 ? BANNER_BLOCK_GAP : 0) : 0;
  return {
    document: { schemaVersion: document.schemaVersion, blocks },
    hiddenLines: document.blocks.slice(blocks.length).reduce((sum, block) => sum + blockLines(block, width, fontSize), 0),
    imageHeight: bannerImageHeight(blocks, height, lineHeight, imageMinimum, width, fontSize, { reservedHeight: gaps + captions + overflow, textHeight: text }),
  };
}
