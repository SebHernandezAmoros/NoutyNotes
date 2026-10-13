import { describe, expect, it } from 'vitest';

import type { RichTextDocument } from '@noutynotes/domain';

import { projectRichTextPreview } from './richTextPreviewProjection';

const paragraph = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] });

describe('projectRichTextPreview', () => {
  it('conserva el principio y no monta una tabla lejana de un documento extenso', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [
        ...Array.from({ length: 1_700 }, (_, index) => paragraph(`Linea ${index + 1}`)),
        { type: 'table', header: { cells: [{ content: [{ type: 'text', text: 'Final' }] }] }, rows: [] },
      ],
    };

    const preview = projectRichTextPreview(document, 6, true);

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

    const preview = projectRichTextPreview(document, 4, true);
    const table = preview.document.blocks[0];

    expect(table?.type).toBe('table');
    expect(table?.type === 'table' ? table.rows : []).toHaveLength(2);
    expect(preview.hiddenLines).toBe(3);
  });
});
