import { describe, expect, it } from 'vitest';

import { validateRichTextDocument } from './rich-text';

const image = { type: 'image', assetRef: 'assets/images/plano.png', alt: 'Descripción anterior' };
const document = (fields: object = {}, schemaVersion = 2) => ({ schemaVersion, blocks: [{ ...image, ...fields }] });

describe('N1: contrato independiente de leyenda e intención por imagen', () => {
  it('D01/D05 conserva la imagen histórica en ambas versiones sin inferir campos', () => {
    for (const version of [1, 2]) {
      const input = document({}, version);
      expect(validateRichTextDocument(input)).toEqual({ ok: true, value: input });
      expect(input.blocks[0]).not.toHaveProperty('captionPolicy');
      expect(input.blocks[0]).not.toHaveProperty('accessibilityIntent');
    }
  });

  it.each([
    { captionPolicy: 'explicit' },
    { accessibilityIntent: 'informative' },
    { accessibilityIntent: 'decorative' },
    { accessibilityIntent: 'pending' },
    { captionPolicy: 'explicit', accessibilityIntent: 'pending', caption: [] },
    { accessibilityIntent: 'informative', alt: '' },
  ])('D02/D03/D05/D06/D07 admite %j sin mutar alt ni caption', (fields) => {
    const input = document(fields);
    const before = JSON.stringify(input);
    expect(validateRichTextDocument(input)).toEqual({ ok: true, value: input });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([{ captionPolicy: 'legacy' }, { accessibilityIntent: 'unknown' }, { caption: '' }])('D04 rechaza %j', (fields) => {
    expect(validateRichTextDocument(document(fields)).ok).toBe(false);
  });

  it('no permite etiquetar datos nuevos como v1 ni aceptar versiones futuras', () => {
    expect(validateRichTextDocument(document({ captionPolicy: 'explicit' }, 1)).ok).toBe(false);
    expect(validateRichTextDocument(document({}, 3)).ok).toBe(false);
  });
});
