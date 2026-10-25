import { expect, it } from 'vitest';
import { normalizeRichTextDocument, richTextDocumentText, richTextImageRefs, validateRichTextDocument } from './rich-text';
import { removedImageDocument } from '../../../../tests/fixtures/removed-image-blocks';

it('valida un marcador sin referencia cargable entre dos párrafos, sin cambiar posición ni metadatos', () => {
  expect(validateRichTextDocument(removedImageDocument)).toEqual({ ok: true, value: removedImageDocument });
});

it('rechaza cualquier referencia/atributo resoluble y enlaces de leyenda, sin limpiar datos', () => {
  const block = removedImageDocument.blocks[1]!;
  for (const key of ['assetRef', 'src', 'url', 'originalRef', 'id']) {
    const input = { schemaVersion: 3, blocks: [{ ...block, [key]: 'assets/images/old.png' }] };
    const before = JSON.stringify(input);
    expect(validateRichTextDocument(input).ok, key).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  }
  expect(validateRichTextDocument({ schemaVersion: 3, blocks: [{ ...block, caption: [{ type: 'link', href: 'https://example.com/old.png', content: [{ type: 'text', text: 'Cargar' }] }] }] }).ok).toBe(false);
});

it('conserva versiones históricas y exige la capacidad nueva para el marcador', () => {
  for (const schemaVersion of [1, 2]) {
    expect(validateRichTextDocument({ schemaVersion, blocks: [removedImageDocument.blocks[0]] }).ok).toBe(true);
    expect(validateRichTextDocument({ ...removedImageDocument, schemaVersion }).ok).toBe(false);
  }
  expect(validateRichTextDocument({ ...removedImageDocument, schemaVersion: 4 }).ok).toBe(false);
});

it('solo enumera referencias de imágenes activas o temporalmente inaccesibles, nunca del marcador', () => {
  const active = { type: 'image' as const, assetRef: 'assets/images/active.png', alt: '' };
  const missing = { ...active, assetRef: 'assets/images/missing.png' };
  const checked = validateRichTextDocument({ schemaVersion: 3, blocks: [active, removedImageDocument.blocks[1], missing] });
  expect(checked.ok).toBe(true);
  if (checked.ok) expect(richTextImageRefs(checked.value)).toEqual([active.assetRef, missing.assetRef]);
});

it('normalización y texto de lectura mantienen el marcador y ambos vecinos', () => {
  expect(normalizeRichTextDocument(removedImageDocument)).toEqual({ ok: true, value: removedImageDocument });
  expect(richTextDocumentText(removedImageDocument)).toBe('Texto anterior conservado\nImagen retirada\nMapa del río\nLeyenda conservada\nTexto posterior conservado');
});
