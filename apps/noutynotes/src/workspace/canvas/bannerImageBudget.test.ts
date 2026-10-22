import { describe, expect, it } from 'vitest';

import { bannerImageBudget } from './bannerImageBudget';
import { estimatePreviewLines } from './previewOverflow';

const LINE = 18;
const GAP = 6;
const THUMB = 72;
// Ancho generoso: los textos de estos casos son breves y no envuelven, así que el resultado
// esperado no cambia frente al cálculo histórico (OBS-N2-28/G1, corrección de regresión).
const WIDTH = 300;
const FONT_SIZE = 14;

const image = (ref: string, alt = ''): { readonly kind: 'image'; readonly alt: string; readonly ref: string; readonly start: number } => ({
  kind: 'image', alt, ref, start: 0,
});
const text = (value: string): { readonly kind: 'text'; readonly text: string; readonly start: number } => ({
  kind: 'text', text: value, start: 0,
});

describe('bannerImageBudget — OBS-N2-28/G1: reparto de espacio en Notas banner', () => {
  it('G1-01: sin texto, la imagen recibe prácticamente todo el disponible', () => {
    const available = 400;
    const budget = bannerImageBudget([image('assets/images/a.png')] as never, available, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    expect(budget).toBeGreaterThan(THUMB);
    expect(budget).toBeLessThanOrEqual(available);
  });

  it('G1-02: con texto breve, la imagen aprovecha el resto por encima del histórico', () => {
    const available = 300;
    const blocks = [image('assets/images/a.png'), text('Una línea breve')] as never;
    const budget = bannerImageBudget(blocks, available, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    expect(budget).toBeGreaterThan(THUMB);
  });

  it('G1-03: con texto abundante, la imagen no baja del tamaño histórico aunque el texto reserve casi todo', () => {
    const available = 200;
    const abundant = Array.from({ length: 20 }, (_, index) => `Línea ${index}`).join('\n');
    const blocks = [image('assets/images/a.png'), text(abundant)] as never;
    const budget = bannerImageBudget(blocks, available, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    expect(budget).toBe(THUMB);
  });

  it('sin bloques de imagen, devuelve el histórico sin calcular nada más', () => {
    const budget = bannerImageBudget([text('solo texto')] as never, 500, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    expect(budget).toBe(THUMB);
  });

  it('G1-02b: con una leyenda de imagen (alt no vacío) y un párrafo añadido, ambos siguen cabiendo', () => {
    // Reproduce un hallazgo real: una imagen con `alt` reserva su propia línea de leyenda (ADR 0051);
    // si el presupuesto no lo descuenta por anticipado, un párrafo añadido después puede quedar sin
    // espacio y desaparecer tras «+1 bloque más» — justo lo que D1 prohíbe (ocultar texto).
    const available = 600;
    const blocks = [image('assets/images/a.png', 'app-icon'), text('Una línea breve de pie de foto.')] as never;
    const budget = bannerImageBudget(blocks, available, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    // El párrafo (1 línea) y la leyenda de la imagen (1 línea) deben seguir cabiendo tras reservar `budget`.
    const remaining = available - budget - GAP - LINE /* leyenda de la imagen */;
    expect(remaining).toBeGreaterThanOrEqual(LINE);
  });

  it('con dos imágenes, el presupuesto disponible se reparte entre ambas', () => {
    const available = 400;
    const blocks = [image('assets/images/a.png'), image('assets/images/b.png')] as never;
    const budget = bannerImageBudget(blocks, available, LINE, GAP, THUMB, WIDTH, FONT_SIZE);
    expect(budget * 2).toBeLessThanOrEqual(available);
    expect(budget).toBeGreaterThan(THUMB);
  });

  it('OBS-N2-28/G1, corrección de regresión: un párrafo que envuelve en varios renglones reales no deja que la imagen le robe el espacio que de verdad necesita', () => {
    const narrowWidth = 160;
    const fontSize = 14;
    const longParagraph = 'Este párrafo es deliberadamente largo para que, a un ancho angosto, envuelva en varios renglones reales sin usar ningún salto de línea explícito.';
    const textLines = estimatePreviewLines(longParagraph, narrowWidth, fontSize);
    expect(textLines).toBeGreaterThan(1); // confirma que el párrafo realmente envuelve a este ancho

    const available = 400;
    const blocks = [image('assets/images/a.png'), text(longParagraph)] as never;
    const budget = bannerImageBudget(blocks, available, LINE, GAP, THUMB, narrowWidth, fontSize);

    // La imagen nunca debe recibir más que lo que sobra tras los renglones reales del párrafo.
    expect(budget).toBeLessThanOrEqual(Math.max(THUMB, available - textLines * LINE - GAP));
    // Antes de la corrección (el párrafo sin `\n` contaba siempre 1 renglón) habría recibido más de
    // lo debido, robándole espacio al texto que de verdad necesitaba varios renglones.
    expect(budget).toBeLessThan(Math.max(THUMB, available - 1 * LINE - GAP));
  });
});
