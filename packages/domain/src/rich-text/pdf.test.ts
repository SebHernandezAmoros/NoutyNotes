import { expect, it } from 'vitest';
import { validateRichTextDocument } from './rich-text';

it('admite PDF entre párrafos solo con documento4 sin transformar el contenido', () => {
  const document = { schemaVersion: 4, blocks: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Antes' }] },
    { type: 'pdf', assetRef: 'assets/documents/manual.pdf', label: 'Manual' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Después' }] },
  ] };
  expect(validateRichTextDocument(document)).toEqual({ ok: true, value: document });
  for (const schemaVersion of [1, 2, 3, 5]) expect(validateRichTextDocument({ ...document, schemaVersion }).ok).toBe(false);
});

it('rechaza referencias externas, otro formato y atributos ejecutables sin limpiar el original', () => {
  for (const block of [
    { type: 'pdf', assetRef: 'https://example.com/a.pdf' },
    { type: 'pdf', assetRef: 'assets/images/a.png' },
    { type: 'pdf', assetRef: 'assets/documents/a.pdf', src: 'blob:private' },
    { type: 'pdf', assetRef: 'assets/documents/a.pdf', label: '' },
  ]) expect(validateRichTextDocument({ schemaVersion: 4, blocks: [block] }).ok).toBe(false);
});
