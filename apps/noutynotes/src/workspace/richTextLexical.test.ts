import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import type { RichTextDocument } from '@noutynotes/domain';

import { isBasicRichTextDocument } from './basicRichText';
import { $loadBasicRichTextDocument, $readBasicRichTextDocument } from './richTextLexical';

const basicDocument: RichTextDocument = {
  schemaVersion: 1,
  blocks: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Texto ' },
        { type: 'text', text: 'fuerte', marks: ['bold'] },
        { type: 'hard-break' },
        { type: 'text', text: 'suave', marks: ['italic'] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Segundo párrafo', marks: ['bold', 'italic'] }] },
  ],
};

describe('adaptador Lexical de UX7 P04', () => {
  it('carga y vuelve a leer párrafos, saltos y marcas sin usar Markdown como estado', () => {
    const editor = createEditor({ namespace: 'rich-text-test', onError: (error) => { throw error; } });
    editor.update(() => $loadBasicRichTextDocument(basicDocument), { discrete: true });

    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readBasicRichTextDocument(); });
    expect(read).toEqual(basicDocument);
  });

  it('solo habilita P04 para párrafos básicos y preserva para fases posteriores lo demás', () => {
    expect(isBasicRichTextDocument(basicDocument)).toBe(true);
    expect(isBasicRichTextDocument({ schemaVersion: 1, blocks: [{ type: 'heading', level: 1, content: [] }] })).toBe(false);
    expect(isBasicRichTextDocument({
      schemaVersion: 1,
      blocks: [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'sitio' }] }] }],
    })).toBe(false);
    expect(isBasicRichTextDocument({ schemaVersion: 1, blocks: [{ type: 'opaque-markdown', source: '<aside>literal</aside>' }] })).toBe(false);
  });
});
