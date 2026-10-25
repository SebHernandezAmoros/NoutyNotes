import { describe, expect, it } from 'vitest';

import type { RichTextDocument } from '@noutynotes/domain';

import { IMAGE_BLOCK_LINES, blockLines, projectRichTextPreview } from './richTextPreviewProjection';

const paragraph = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] });
const image = (ref = 'assets/images/a.png') => ({ type: 'image' as const, assetRef: ref as never, alt: '' });

// Ancho generoso: estos párrafos son cortos («Linea N»), así que no envuelven y el resultado
// esperado no cambia frente al cálculo histórico (OBS-N2-28/G1, corrección de regresión).
const WIDTH = 300;
const FONT_SIZE = 14;

it('U2-B cobra las líneas de una leyenda retirada larga para conservar acceso al contenido posterior', () => {
  const marker = { type: 'retired-image' as const, alt: 'Mapa', caption: [{ type: 'text' as const, text: 'Detalle\n'.repeat(50) }] };
  expect(blockLines(marker, WIDTH, FONT_SIZE)).toBeGreaterThan(50);
  expect(projectRichTextPreview({ schemaVersion: 3, blocks: [marker, paragraph('Final')] }, 10, WIDTH, FONT_SIZE).hiddenLines).toBeGreaterThan(0);
});

// Ancho angosto, representativo de una tarjeta compacta: a este ancho, un párrafo de varias
// decenas de caracteres sin saltos de línea explícitos SÍ envuelve en varios renglones reales
// (OBS-N2-RICHTEXT-CANVAS-VISIBILITY / OBS-N2-28/G1, corrección de regresión).
const NARROW_WIDTH = 160;

describe('projectRichTextPreview', () => {
  it('conserva el principio y no monta una tabla lejana de un documento extenso', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [
        ...Array.from({ length: 1_700 }, (_, index) => paragraph(`Linea ${index + 1}`)),
        { type: 'table', header: { cells: [{ content: [{ type: 'text', text: 'Final' }] }] }, rows: [] },
      ],
    };

    const preview = projectRichTextPreview(document, 6, WIDTH, FONT_SIZE, true);

    expect(preview.document.blocks).toEqual([
      paragraph('Linea 1'), paragraph('Linea 2'), paragraph('Linea 3'), paragraph('Linea 4'), paragraph('Linea 5'),
    ]);
    expect(preview.hiddenLines).toBe(1_696);
  });

  it('recorta filas de tabla y reserva una linea para anunciar el resto', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [{
        type: 'table',
        header: { cells: [{ content: [{ type: 'text', text: 'Cabecera' }] }] },
        rows: Array.from({ length: 5 }, (_, index) => ({ cells: [{ content: [{ type: 'text', text: `Fila ${index + 1}` }] }] })),
      }],
    };

    const preview = projectRichTextPreview(document, 4, WIDTH, FONT_SIZE, true);
    const table = preview.document.blocks[0];

    expect(table?.type).toBe('table');
    expect(table?.type === 'table' ? table.rows : []).toHaveLength(2);
    expect(preview.hiddenLines).toBe(3);
  });
});

describe('blockLines — OBS-N2-28/G1: corrección de regresión de texto omitido (OBS-N2-RICHTEXT-CANVAS-VISIBILITY)', () => {
  it('un párrafo largo sin saltos de línea explícitos envuelve en varios renglones reales a un ancho angosto, no en uno solo', () => {
    const longParagraph = 'Este párrafo es deliberadamente largo para que, a un ancho angosto, envuelva en varios renglones reales sin usar ningún salto de línea explícito.';

    const lines = blockLines(paragraph(longParagraph), NARROW_WIDTH, FONT_SIZE);

    // Antes de la corrección, cualquier párrafo sin `\n` propio «costaba» siempre 1 renglón, sin
    // importar cuánto ocupara realmente al envolver visualmente: la causa confirmada de
    // OBS-N2-RICHTEXT-CANVAS-VISIBILITY.
    expect(lines).toBeGreaterThan(1);
  });

  it('un párrafo corto sigue costando 1 solo renglón: la corrección no penaliza el caso simple', () => {
    expect(blockLines(paragraph('Antes'), NARROW_WIDTH, FONT_SIZE)).toBe(1);
  });
});

describe('projectRichTextPreview — Caso 3 (OBS-N2-28/G1, corrección de regresión): párrafo antes y después de una imagen', () => {
  it('con la capacidad que el cálculo histórico habría considerado suficiente, el párrafo largo de después de la imagen en realidad no cabe: debe señalarse, no darse por bueno en silencio', () => {
    const beforeParagraph = 'Antes';
    const afterParagraph = 'Este párrafo es deliberadamente largo para que, a un ancho angosto, envuelva en varios renglones reales sin usar ningún salto de línea explícito.';
    const afterLines = blockLines(paragraph(afterParagraph), NARROW_WIDTH, FONT_SIZE);
    expect(afterLines).toBeGreaterThan(3); // confirma que este párrafo envuelve de verdad a este ancho

    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [paragraph(beforeParagraph), image(), paragraph(afterParagraph)],
    };
    // Capacidad que el cálculo histórico (newline-only) habría estimado como el total del documento:
    // 1 renglón de «Antes» + el costo de la imagen + 1 solo renglón para el párrafo largo (su
    // envoltorio real, de más de 3 renglones, se ignoraba por completo).
    const buggyEstimatedTotal = 1 + IMAGE_BLOCK_LINES + 1;

    const preview = projectRichTextPreview(document, buggyEstimatedTotal, NARROW_WIDTH, FONT_SIZE, true);

    expect(preview.hiddenLines).toBeGreaterThan(0);
  });

  it('con la capacidad real que el párrafo envuelto necesita, los tres bloques caben enteros y nada se oculta: el párrafo de después de la imagen ya no desaparece', () => {
    const beforeParagraph = 'Antes';
    const afterParagraph = 'Este párrafo es deliberadamente largo para que, a un ancho angosto, envuelva en varios renglones reales sin usar ningún salto de línea explícito.';
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [paragraph(beforeParagraph), image(), paragraph(afterParagraph)],
    };
    const realTotal = blockLines(paragraph(beforeParagraph), NARROW_WIDTH, FONT_SIZE)
      + IMAGE_BLOCK_LINES
      + blockLines(paragraph(afterParagraph), NARROW_WIDTH, FONT_SIZE);

    const preview = projectRichTextPreview(document, realTotal, NARROW_WIDTH, FONT_SIZE, true);

    expect(preview.hiddenLines).toBe(0);
    expect(preview.document.blocks).toHaveLength(3);
    expect(preview.document.blocks[2]).toEqual(paragraph(afterParagraph));
  });
});

describe('projectBlocks — OBS-N2-28/G1, hallazgo adicional confirmado en navegador real: una imagen se muestra entera o no se muestra', () => {
  it('si el presupuesto restante no alcanza para el costo completo de la imagen, se omite (no se recorta a medias) y el resto pasa al siguiente bloque', () => {
    // Reproduce con navegador real (Lista, Caso 3): antes de esta corrección, una imagen con
    // presupuesto insuficiente se incluía igual, cobrándose solo lo que quedaba de presupuesto —
    // pero su alto real en pantalla (bannerImageHeight) nunca baja de un piso fijo, así que acababa
    // ocupando más píxeles de los «cobrados». Ese déficit lo absorbía en pantalla el bloque de texto
    // vecino, encogido por CSS hasta volverse invisible (0 px) aunque la proyección lo había
    // seleccionado para mostrarse — contradiciendo la regla de que el texto nunca debe quedar oculto.
    const before = 'Antes';
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [paragraph(before), image(), paragraph('Después')],
    };
    // Presupuesto: cabe «Antes» (1) pero no le queda a la imagen su costo completo (IMAGE_BLOCK_LINES).
    const capacity = 1 + Math.floor(IMAGE_BLOCK_LINES / 2);

    const preview = projectRichTextPreview(document, capacity, NARROW_WIDTH, FONT_SIZE);

    expect(preview.document.blocks.some((block) => block.type === 'image')).toBe(false);
    expect(preview.document.blocks[0]).toEqual(paragraph(before));
    // El presupuesto que la imagen no pudo usar se ofrece al bloque siguiente en vez de perderse.
    expect(preview.document.blocks).toContainEqual(paragraph('Después'));
  });

  it('si el presupuesto restante sí alcanza para el costo completo de la imagen, se muestra entera, como antes', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [paragraph('Antes'), image()],
    };

    const preview = projectRichTextPreview(document, 1 + IMAGE_BLOCK_LINES, NARROW_WIDTH, FONT_SIZE);

    expect(preview.document.blocks).toHaveLength(2);
    expect(preview.document.blocks[1]?.type).toBe('image');
  });
});
