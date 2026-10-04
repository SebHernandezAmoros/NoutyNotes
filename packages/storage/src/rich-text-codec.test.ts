import { describe, expect, it } from 'vitest';

import type { RichTextCodec } from '@noutynotes/application';
import { parseAssetRef } from '@noutynotes/domain';
import type { AssetRef, RichTextDocument } from '@noutynotes/domain';

import { markdownRichTextCodec, parseRichTextMarkdown, serializeRichTextMarkdown } from './rich-text-codec';

function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error('Se esperaba un resultado válido.');
  return result.value;
}

function assetRef(value: string): AssetRef {
  return valueOf(parseAssetRef(value));
}

const markdown = `# Café **fuerte** y *suave*

Primera línea  
segunda con [fuente](https://example.com).

- viñeta
  - hija

3. tercero
4. cuarto

- [ ] pendiente
- [x] listo

![Portada](assets/images/portada.png "Leyenda")

| Nombre | Estado |
| --- | --- |
| Diseño | **Listo** |

\`\`\`ts
const literal = "<script>";
\`\`\`

<script>no se ejecuta</script>`;

describe('codec Markdown ↔ RichTextDocument (UX7 P03)', () => {
  it('implementa el puerto de application sin exponer el parser', () => {
    const codec: RichTextCodec = markdownRichTextCodec;
    expect(codec.parse).toBe(parseRichTextMarkdown);
    expect(codec.serialize).toBe(serializeRichTextMarkdown);
  });

  it('abre CommonMark/GFM representativo con orden, Unicode, marcas, listas, imagen y tabla', () => {
    const document = valueOf(parseRichTextMarkdown(markdown));

    expect(document.schemaVersion).toBe(1);
    expect(document.blocks.map((block) => block.type)).toEqual([
      'heading', 'paragraph', 'list', 'list', 'list', 'image', 'table', 'opaque-markdown', 'opaque-markdown',
    ]);
    expect(document.blocks[0]).toEqual({
      type: 'heading', level: 1,
      content: [
        { type: 'text', text: 'Café ' },
        { type: 'text', text: 'fuerte', marks: ['bold'] },
        { type: 'text', text: ' y ' },
        { type: 'text', text: 'suave', marks: ['italic'] },
      ],
    });
    expect(document.blocks[1]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Primera línea' },
        { type: 'hard-break' },
        { type: 'text', text: 'segunda con ' },
        { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'fuente' }] },
        { type: 'text', text: '.' },
      ],
    });
    expect(document.blocks[3]).toMatchObject({ type: 'list', style: 'ordered', start: 3 });
    expect(document.blocks[4]).toEqual({
      type: 'list', style: 'checklist',
      items: [
        { checked: false, content: [{ type: 'text', text: 'pendiente' }] },
        { checked: true, content: [{ type: 'text', text: 'listo' }] },
      ],
    });
    expect(document.blocks[5]).toEqual({
      type: 'image', assetRef: 'assets/images/portada.png', alt: 'Portada',
      caption: [{ type: 'text', text: 'Leyenda' }],
    });
    expect(document.blocks[6]).toMatchObject({ type: 'table' });
  });

  it('serializa y vuelve a abrir un documento canónico sin perder contenido', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Texto ', marks: ['bold', 'italic'] },
            { type: 'link', href: 'mailto:ana@example.com', content: [{ type: 'text', text: 'correo', marks: ['italic'] }] },
          ],
        },
        {
          type: 'image', assetRef: assetRef('assets/images/ñandú.png'), alt: 'Ave',
          caption: [
            { type: 'text', text: 'Leyenda ', marks: ['bold'] },
            { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'externa' }] },
          ],
        },
        {
          type: 'table',
          header: { cells: [{ content: [{ type: 'text', text: 'A' }] }, { content: [{ type: 'text', text: 'B' }] }] },
          rows: [{ cells: [{ content: [{ type: 'text', text: '1' }] }, { content: [{ type: 'text', text: '2', marks: ['italic'] }] }] }],
        },
      ],
    };

    const encoded = valueOf(serializeRichTextMarkdown(document));
    expect(encoded).toContain('<!-- nouty-caption:v1:');
    expect(valueOf(parseRichTextMarkdown(encoded))).toEqual(document);
  });

  it('conserva una tabla sin encabezado mediante una extensión versionada', () => {
    const document: RichTextDocument = {
      schemaVersion: 1,
      blocks: [{
        type: 'table',
        rows: [{ cells: [{ content: [{ type: 'text', text: 'A' }] }, { content: [{ type: 'text', text: 'B' }] }] }],
      }],
    };

    const encoded = valueOf(serializeRichTextMarkdown(document));
    expect(encoded).toContain('<!-- nouty-table:v1:no-header -->');
    expect(valueOf(parseRichTextMarkdown(encoded))).toEqual(document);
  });

  it('conserva exactamente cada bloque no soportado y nunca interpreta HTML activo', () => {
    const document = valueOf(parseRichTextMarkdown(markdown));
    const opaque = document.blocks.filter((block) => block.type === 'opaque-markdown');
    expect(opaque).toEqual([
      { type: 'opaque-markdown', source: '```ts\nconst literal = "<script>";\n```' },
      { type: 'opaque-markdown', source: '<script>no se ejecuta</script>' },
    ]);

    const encoded = valueOf(serializeRichTextMarkdown(document));
    expect(encoded).toContain('```ts\nconst literal = "<script>";\n```');
    expect(encoded).toContain('<script>no se ejecuta</script>');
  });

  it('alcanza una forma canónica estable después del primer guardado', () => {
    const once = valueOf(serializeRichTextMarkdown(valueOf(parseRichTextMarkdown(markdown))));
    const twice = valueOf(serializeRichTextMarkdown(valueOf(parseRichTextMarkdown(once))));
    expect(twice).toBe(once);
  });

  it('devuelve incidencias de dominio al intentar guardar un documento inválido', () => {
    const invalid = { schemaVersion: 1, blocks: [{ type: 'table', rows: [] }] } as unknown as RichTextDocument;
    const result = serializeRichTextMarkdown(invalid);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((found) => `${found.code}@${found.path}`)).toContain('invalid-value@document.blocks[0].rows');
  });
});
