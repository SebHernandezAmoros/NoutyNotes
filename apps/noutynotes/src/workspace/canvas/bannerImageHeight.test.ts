import type { RichTextBlock } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { bannerImageHeight, projectBannerPreview } from './bannerImageHeight';
import { estimatePreviewLines } from './previewOverflow';

const LINE = 18;
const FALLBACK = 88;
// Ancho generoso: los textos de estos casos son breves y no envuelven, así que el resultado
// esperado no cambia frente al cálculo histórico (OBS-N2-28/G1, corrección de regresión).
const WIDTH = 300;
const FONT_SIZE = 14;

const image = (ref = 'assets/images/a.png'): RichTextBlock => ({ type: 'image', assetRef: ref as never, alt: '' });
const paragraph = (text: string): RichTextBlock => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('bannerImageHeight — OBS-N2-28/G1: alto de imagen en Notas banner con cuerpo enriquecido', () => {
  it('G1-01: sin texto, la imagen recibe prácticamente todo el disponible', () => {
    const height = bannerImageHeight([image()], 400, LINE, FALLBACK, WIDTH, FONT_SIZE);
    expect(height).toBeGreaterThan(FALLBACK);
    expect(height).toBeLessThanOrEqual(400);
  });

  it('G1-02: con texto breve, la imagen aprovecha el resto por encima del histórico', () => {
    const height = bannerImageHeight([image(), paragraph('Una línea breve')], 300, LINE, FALLBACK, WIDTH, FONT_SIZE);
    expect(height).toBeGreaterThan(FALLBACK);
  });

  it('G1-03: con texto abundante, la imagen no baja del alto histórico', () => {
    const abundant = Array.from({ length: 20 }, (_, index) => `Línea ${index}`).join('\n');
    const height = bannerImageHeight([image(), paragraph(abundant)], 150, LINE, FALLBACK, WIDTH, FONT_SIZE);
    expect(height).toBe(FALLBACK);
  });

  it('sin bloques de imagen, devuelve el histórico sin calcular nada más', () => {
    const height = bannerImageHeight([paragraph('solo texto')], 500, LINE, FALLBACK, WIDTH, FONT_SIZE);
    expect(height).toBe(FALLBACK);
  });

  it('con dos imágenes, el presupuesto disponible se reparte entre ambas', () => {
    const height = bannerImageHeight([image('assets/images/a.png'), image('assets/images/b.png')], 400, LINE, FALLBACK, WIDTH, FONT_SIZE);
    expect(height * 2).toBeLessThanOrEqual(400);
    expect(height).toBeGreaterThan(FALLBACK);
  });

  it('OBS-N2-28/G1, corrección de regresión: un párrafo que envuelve en varios renglones reales no deja que la imagen le robe el espacio que de verdad necesita', () => {
    const narrowWidth = 160;
    const longParagraph = 'Este párrafo es deliberadamente largo para que, a un ancho angosto, envuelva en varios renglones reales sin usar ningún salto de línea explícito.';
    const textLines = estimatePreviewLines(longParagraph, narrowWidth, FONT_SIZE);
    expect(textLines).toBeGreaterThan(1); // confirma que el párrafo realmente envuelve a este ancho

    const available = 400;
    const height = bannerImageHeight([image(), paragraph(longParagraph)], available, LINE, FALLBACK, narrowWidth, FONT_SIZE);

    // La imagen nunca debe recibir más que lo que sobra tras los renglones reales del párrafo.
    expect(height).toBeLessThanOrEqual(Math.max(FALLBACK, Math.floor(available - textLines * LINE)));
    // Antes de la corrección (el párrafo sin `\n` contaba siempre 1 renglón) habría recibido más de
    // lo debido, robándole espacio al texto que de verdad necesitaba varios renglones.
    expect(height).toBeLessThan(Math.max(FALLBACK, Math.floor(available - 1 * LINE)));
  });
});

describe('Banner pixel budget — G1-TEXT-OVERFLOW-FIX', () => {
  const options = { height: 200, width: 168, fontSize: 13, lineHeight: 18, imageMinimum: 88, captionPosition: 'bottom' as const, textHeights: { 0: 36, 2: 36 } };
  const document = { schemaVersion: 1 as const, blocks: [paragraph('Antes'), { ...image(), alt: 'Leyenda' }, paragraph('Después')] };

  it('reserva texto medido, gaps y leyenda antes de expandir la imagen', () => {
    const preview = projectBannerPreview(document, options);
    expect(preview.document.blocks).toEqual(document.blocks);
    expect(preview.hiddenLines).toBe(0);
    expect(preview.imageHeight + 72 + 12 + 16).toBeLessThanOrEqual(200);
    expect(preview.imageHeight).toBeGreaterThanOrEqual(88);
    expect(projectBannerPreview(document, { ...options, height: 392 }).imageHeight).toBeGreaterThan(preview.imageHeight);
  });

  it('omite bloques completos y reserva una acción accesible cuando no caben', () => {
    const preview = projectBannerPreview(document, { ...options, height: 108 });
    expect(preview.document.blocks).toEqual([document.blocks[0]]);
    expect(preview.hiddenLines).toBeGreaterThan(0);
    expect(36 + 6 + 44).toBeLessThanOrEqual(108);
    expect(document.blocks).toHaveLength(3);
  });

  it('distingue leyendas laterales y sin leyenda, y reparte varias imágenes', () => {
    const side = projectBannerPreview(document, { ...options, captionPosition: 'left' });
    const withoutCaption = projectBannerPreview({ ...document, blocks: [paragraph('Antes'), image(), paragraph('Después')] }, options);
    expect(side.imageHeight).toBe(withoutCaption.imageHeight);
    const two = projectBannerPreview({ schemaVersion: 1, blocks: [image(), image('assets/images/b.png')] }, { ...options, textHeights: {} });
    expect(two.document.blocks).toHaveLength(2);
    expect(two.imageHeight * 2 + 6).toBeLessThanOrEqual(options.height);
  });
});
