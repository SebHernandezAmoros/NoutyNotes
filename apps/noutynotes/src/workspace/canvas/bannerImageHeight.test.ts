import type { RichTextBlock } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { bannerImageHeight } from './bannerImageHeight';

const LINE = 18;
const FALLBACK = 88;

const image = (ref = 'assets/images/a.png'): RichTextBlock => ({ type: 'image', assetRef: ref as never, alt: '' });
const paragraph = (text: string): RichTextBlock => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('bannerImageHeight — OBS-N2-28/G1: alto de imagen en Notas banner con cuerpo enriquecido', () => {
  it('G1-01: sin texto, la imagen recibe prácticamente todo el disponible', () => {
    const height = bannerImageHeight([image()], 400, LINE, FALLBACK);
    expect(height).toBeGreaterThan(FALLBACK);
    expect(height).toBeLessThanOrEqual(400);
  });

  it('G1-02: con texto breve, la imagen aprovecha el resto por encima del histórico', () => {
    const height = bannerImageHeight([image(), paragraph('Una línea breve')], 300, LINE, FALLBACK);
    expect(height).toBeGreaterThan(FALLBACK);
  });

  it('G1-03: con texto abundante, la imagen no baja del alto histórico', () => {
    const abundant = Array.from({ length: 20 }, (_, index) => `Línea ${index}`).join('\n');
    const height = bannerImageHeight([image(), paragraph(abundant)], 150, LINE, FALLBACK);
    expect(height).toBe(FALLBACK);
  });

  it('sin bloques de imagen, devuelve el histórico sin calcular nada más', () => {
    const height = bannerImageHeight([paragraph('solo texto')], 500, LINE, FALLBACK);
    expect(height).toBe(FALLBACK);
  });

  it('con dos imágenes, el presupuesto disponible se reparte entre ambas', () => {
    const height = bannerImageHeight([image('assets/images/a.png'), image('assets/images/b.png')], 400, LINE, FALLBACK);
    expect(height * 2).toBeLessThanOrEqual(400);
    expect(height).toBeGreaterThan(FALLBACK);
  });
});
