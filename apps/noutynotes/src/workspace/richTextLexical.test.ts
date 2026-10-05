import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode } from '@lexical/rich-text';
import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import type { RichTextDocument } from '@noutynotes/domain';
import { parseRichTextMarkdown } from '@noutynotes/storage';

import { isBasicRichTextDocument, isWebRichTextDocument } from './basicRichText';
import { $loadBasicRichTextDocument, $loadWebRichTextDocument, $readBasicRichTextDocument, $readWebRichTextDocument } from './richTextLexical';

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

const advancedDocument: RichTextDocument = {
  schemaVersion: 1,
  blocks: [
    {
      type: 'heading', level: 2,
      content: [
        { type: 'text', text: 'Plan ' },
        { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'externo', marks: ['bold'] }] },
      ],
    },
    {
      type: 'list', style: 'bullet', items: [{
        content: [{ type: 'text', text: 'Principal' }],
        children: [{ type: 'list', style: 'ordered', start: 3, items: [{ content: [{ type: 'text', text: 'Hija', marks: ['italic'] }] }] }],
      }],
    },
    {
      type: 'list', style: 'checklist', items: [
        { checked: false, content: [{ type: 'text', text: 'Pendiente' }] },
        { checked: true, content: [{ type: 'text', text: 'Lista' }] },
      ],
    },
  ],
};

describe('adaptador Lexical de UX7 P04/P07', () => {
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
    expect(isWebRichTextDocument(advancedDocument)).toBe(true);
    expect(isWebRichTextDocument({ schemaVersion: 1, blocks: [{ type: 'table', rows: [] }] })).toBe(false);
  });

  it('P07 carga y vuelve a leer encabezados, enlaces, listas anidadas y checklist sin usar Markdown como estado', () => {
    const editor = createEditor({
      namespace: 'rich-text-advanced-test',
      nodes: [HeadingNode, LinkNode, ListNode, ListItemNode],
      onError: (error) => { throw error; },
    });
    editor.update(() => $loadWebRichTextDocument(advancedDocument), { discrete: true });

    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(); });
    expect(read).toEqual(advancedDocument);
  });

  it('P07 acepta el Markdown avanzado que el usuario abre desde el editor existente', () => {
    const parsed = parseRichTextMarkdown('## Plan [sitio](https://example.com)\n\n- Uno\n- Dos\n\n- [ ] Pendiente\n- [x] Lista');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(isWebRichTextDocument(parsed.value)).toBe(true);
  });
});
