import { describe, expect, it } from 'vitest';

import { estimatePreviewLines, previewOverflow } from './previewOverflow';

describe('previewOverflow', () => {
  it('reserva una línea para anunciar los renglones explícitos que quedan ocultos', () => {
    expect(previewOverflow(Array.from({ length: 20 }, (_, index) => `Línea ${index + 1}`).join('\n'), 240, 14, 5)).toEqual({
      shownLines: 4,
      hiddenLines: 15,
    });
  });

  it('tiene en cuenta el ajuste automático de una línea larga según el ancho', () => {
    const text = 'una frase extensa '.repeat(8);
    expect(estimatePreviewLines(text, 120, 14)).toBeGreaterThan(estimatePreviewLines(text, 360, 14));
  });
});
