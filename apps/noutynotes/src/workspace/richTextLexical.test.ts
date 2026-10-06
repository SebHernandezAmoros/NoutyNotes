import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import type { AssetRef, RichTextDocument } from '@noutynotes/domain';
import { parseRichTextMarkdown } from '@noutynotes/storage';

import { isBasicRichTextDocument, isNativeRichTextDocument, isWebRichTextDocument } from './basicRichText';
import { RichTextImageNode } from './RichTextImageNode.web';
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

  it('P08 admite varias imágenes intercaladas con texto y conserva alt y leyenda', () => {
    const mixed: RichTextDocument = {
      schemaVersion: 1,
      blocks: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Antes' }] },
        { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: 'Plano', caption: [{ type: 'text', text: 'Primera leyenda', marks: ['italic'] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Entre imágenes' }] },
        { type: 'image', assetRef: 'assets/images/dos.png' as AssetRef, alt: 'Mapa' },
      ],
    };

    expect(isWebRichTextDocument(mixed)).toBe(true);
    expect(isNativeRichTextDocument(mixed)).toBe(true);
    const editor = createEditor({
      namespace: 'rich-text-image-test',
      nodes: [HeadingNode, LinkNode, ListNode, ListItemNode, RichTextImageNode],
      onError: (error) => { throw error; },
    });
    editor.update(() => $loadWebRichTextDocument(mixed), { discrete: true });
    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(); });
    expect(read).toEqual(mixed);
  });

  it('P09 carga y vuelve a leer una tabla con encabezado sin convertirla en texto plano', () => {
    const tableDocument: RichTextDocument = {
      schemaVersion: 1,
      blocks: [{
        type: 'table',
        header: { cells: [
          { content: [{ type: 'text', text: 'Nombre', marks: ['bold'] }] },
          { content: [{ type: 'text', text: 'Estado' }] },
          { content: [{ type: 'text', text: 'Fecha' }] },
        ] },
        rows: [
          { cells: [{ content: [{ type: 'text', text: 'Idea' }] }, { content: [{ type: 'text', text: 'Activa' }] }, { content: [] }] },
          { cells: [{ content: [] }, { content: [] }, { content: [] }] },
        ],
      }],
    };
    const editor = createEditor({
      namespace: 'rich-text-table-test',
      nodes: [HeadingNode, LinkNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode],
      onError: (error) => { throw error; },
    });

    editor.update(() => $loadWebRichTextDocument(tableDocument), { discrete: true });
    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(); });

    expect(read).toEqual(tableDocument);
  });
});
