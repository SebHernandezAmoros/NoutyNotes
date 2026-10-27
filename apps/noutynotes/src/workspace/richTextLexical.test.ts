import { RichTextPdfNode } from './RichTextPdfNode.web';
import { block8Document } from '../../../../tests/fixtures/block8-content';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import type { AssetRef, RichTextDocument } from '@noutynotes/domain';
import { parseRichTextMarkdown } from '@noutynotes/storage';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import { isBasicRichTextDocument, isNativeRichTextDocument, isWebRichTextDocument } from './basicRichText';
import { RichTextImageNode } from './RichTextImageNode.web';
import { RichTextRetiredImageNode } from './RichTextRetiredImageNode.web';
import { removedImageDocument } from '../../../../tests/fixtures/removed-image-blocks';
import { $loadBasicRichTextDocument, $loadWebRichTextDocument, $readBasicRichTextDocument, $readWebRichTextDocument } from './richTextLexical';
vi.mock('./ContentResources', () => ({ PdfBlockView: () => null }));

// Este test ejercita el adaptador Lexical sin renderizar React Native. El nodo de
// imagen comparte componente con la UI web y consulta el tema al decorarse; aislar
// ese límite evita que Vitest/Rolldown intente analizar la entrada Flow de RN.
vi.mock('@noutynotes/ui', () => ({
  useTheme: () => ({
    theme: { colors: { cardSurface: '#fffdf6', cardText: '#23241f', border: '#34362f' } },
  }),
}));
// Headless transport test; the real marker UI is exercised in Playwright.
vi.mock('./RetiredImageBlock', () => ({ RetiredImageBlock: () => null }));

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
      type: 'heading', level: 2, alignment: 'center',
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
  it('U2-B conserva marcador y versión al editar vecinos y serializar el estado Lexical real', () => {
    const editor = createEditor({ namespace: 'u2-b-transport', nodes: [RichTextRetiredImageNode], onError: (error) => { throw error; } });
    expect(isWebRichTextDocument(removedImageDocument)).toBe(true);
    editor.update(() => $loadWebRichTextDocument(removedImageDocument), { discrete: true });
    const saved = editor.getEditorState().toJSON();
    editor.setEditorState(editor.parseEditorState(JSON.stringify(saved)));
    editor.update(() => {
      const first = $getRoot().getFirstDescendant();
      if (!first || !('setTextContent' in first)) throw new Error('Párrafo vecino no editable.');
      (first as import('lexical').TextNode).setTextContent('Anterior editado');
    }, { discrete: true });
    editor.getEditorState().read(() => {
      const read = $readWebRichTextDocument();
      expect(read?.schemaVersion).toBe(3);
      expect(read?.blocks[1]).toEqual(removedImageDocument.blocks[1]);
      expect(read?.blocks[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Anterior editado' }] });
      expect(read?.blocks[2]).toEqual(removedImageDocument.blocks[2]);
    });
  });
  it('N2 edita propósito y leyenda explícita independientemente sin borrar textos históricos', () => {
    const document: RichTextDocument = { schemaVersion: 1, blocks: [
      { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: 'Anterior', caption: [{ type: 'text', text: 'Leyenda' }] },
    ] };
    const editor = createEditor({ namespace: 'n2-fields', nodes: [RichTextImageNode], onError: (error) => { throw error; } });
    editor.update(() => $loadWebRichTextDocument(document), { discrete: true });
    for (const intent of ['informative', 'decorative', 'pending'] as const) {
      editor.update(() => {
        const node = $getRoot().getFirstChild();
        if (!(node instanceof RichTextImageNode)) throw new Error('Imagen ausente');
        node.setAccessibilityIntent(intent);
      }, { discrete: true });
      let read: RichTextDocument | null = null;
      editor.getEditorState().read(() => { read = $readWebRichTextDocument(); });
      expect(read).toEqual({ schemaVersion: 2, blocks: [{ ...document.blocks[0], accessibilityIntent: intent }] });
    }
    editor.update(() => {
      const node = $getRoot().getFirstChild();
      if (!(node instanceof RichTextImageNode)) throw new Error('Imagen ausente');
      node.setCaptionPolicy('explicit');
      node.setAlt('');
    }, { discrete: true });
    editor.getEditorState().read(() => {
      expect($readWebRichTextDocument()?.blocks[0]).toEqual({ ...document.blocks[0], alt: '', captionPolicy: 'explicit', accessibilityIntent: 'pending' });
    });
  });
  it('N1 conserva políticas en carga, edición, clonación y JSON sin alterar la imagen histórica', () => {
    const document: RichTextDocument = { schemaVersion: 2, blocks: [
      { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: 'Anterior', caption: [], captionPolicy: 'explicit', accessibilityIntent: 'pending' },
      { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: '' },
    ] };
    const editor = createEditor({ namespace: 'n1-transport', nodes: [RichTextImageNode], onError: (error) => { throw error; } });
    editor.update(() => $loadWebRichTextDocument(document), { discrete: true });
    const serialized = JSON.stringify(editor.getEditorState().toJSON());
    editor.setEditorState(editor.parseEditorState(serialized));
    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(2); });
    expect(read).toEqual(document);
    expect(serialized).toContain('"captionPolicy":"explicit"');
    expect(serialized).toContain('"accessibilityIntent":"pending"');
    editor.update(() => {
      const node = $getRoot().getFirstChild();
      if (!(node instanceof RichTextImageNode)) throw new Error('Imagen ausente');
      node.setAlt('Actualizada');
    }, { discrete: true });
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(2); });
    expect(read).toEqual({ ...document, blocks: [{ ...document.blocks[0], alt: 'Actualizada' }, document.blocks[1]] });
  });

  it('N1 rechaza JSON de imagen con discriminantes o versión desconocidos', () => {
    const editor = createEditor({ namespace: 'n1-unknown', nodes: [RichTextImageNode], onError: (error) => { throw error; } });
    const document: RichTextDocument = { schemaVersion: 2, blocks: [
      { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: 'Anterior', accessibilityIntent: 'pending' },
    ] };
    editor.update(() => $loadWebRichTextDocument(document), { discrete: true });
    const source = JSON.stringify(editor.getEditorState().toJSON());
    expect(() => editor.parseEditorState(source.replace('"pending"', '"unknown"'))).toThrow('Contrato de imagen no admitido');
    expect(() => editor.parseEditorState(source.replace('"version":1', '"version":2'))).toThrow('Versión de nodo de imagen no admitida');
    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(2); });
    expect(read).toEqual(document);
  });

  it('N1 conserva la versión recibida aunque ya no haya políticas en el cuerpo', () => {
    const editor = createEditor({ namespace: 'n1-version', onError: (error) => { throw error; } });
    const document: RichTextDocument = { ...basicDocument, schemaVersion: 2 };
    editor.update(() => $loadWebRichTextDocument(document), { discrete: true });
    let read: RichTextDocument | null = null;
    editor.getEditorState().read(() => { read = $readWebRichTextDocument(document.schemaVersion); });
    expect(read).toEqual(document);
  });
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
        { type: 'image', assetRef: 'assets/images/uno.png' as AssetRef, alt: 'Plano', caption: [{ type: 'text', text: 'Primera leyenda', marks: ['italic'] }], size: 'medium', alignment: 'right' },
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
          { cells: [{ content: [{ type: 'text', text: 'Idea' }], verticalAlignment: 'center' }, { content: [{ type: 'text', text: 'Activa' }] }, { content: [] }] },
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

it('PDF4 con vecinos y retirada sobrevive al transporte Lexical real y edicion vecina', () => {
  const editor = createEditor({ namespace: 'block8', nodes: [RichTextPdfNode, RichTextRetiredImageNode], onError: (error) => { throw error; } });
  editor.update(() => $loadWebRichTextDocument(block8Document), { discrete: true });
  expect(editor.getEditorState().read(() => $readWebRichTextDocument(4))).toEqual(block8Document);
  editor.update(() => { const paragraph = $getRoot().getFirstChild(); if ($isParagraphNode(paragraph)) paragraph.getFirstChild<import('lexical').TextNode>()?.setTextContent('Editado'); }, { discrete: true });
  const actual = editor.getEditorState().read(() => $readWebRichTextDocument(4));
  expect(actual?.schemaVersion).toBe(4);
  expect(actual?.blocks.slice(1)).toEqual(block8Document.blocks.slice(1));
});
