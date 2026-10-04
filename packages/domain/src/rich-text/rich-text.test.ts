import { describe, expect, it } from 'vitest';

import { problems, unsafe } from '../__fixtures__/workspace';
import { parseAssetRef } from '../assets/asset-ref';
import type { AssetRef } from '../assets/asset-ref';
import {
  MAX_RICH_TEXT_LIST_DEPTH,
  createEmptyRichTextDocument,
  normalizeRichTextDocument,
  validateRichTextDocument,
} from './rich-text';
import type { RichTextDocument } from './rich-text';

const imageRef = (): AssetRef => {
  const parsed = parseAssetRef('assets/images/portada.png');
  if (!parsed.ok) throw new Error('Fixture inválido');
  return parsed.value;
};

function representativeDocument(): RichTextDocument {
  return {
    schemaVersion: 1,
    blocks: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Plan', marks: ['bold'] }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Consulta ' },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'la fuente', marks: ['italic'] }] },
          { type: 'hard-break' },
          { type: 'text', text: 'y continúa.' },
        ],
      },
      {
        type: 'list',
        style: 'checklist',
        items: [
          { checked: false, content: [{ type: 'text', text: 'Revisar' }] },
          {
            checked: true,
            content: [{ type: 'text', text: 'Publicar' }],
            children: [{
              type: 'list', style: 'bullet',
              items: [{ content: [{ type: 'text', text: 'Anexo' }] }],
            }],
          },
        ],
      },
      { type: 'image', assetRef: imageRef(), alt: 'Portada', caption: [{ type: 'text', text: 'Versión final' }] },
      {
        type: 'table',
        header: { cells: [{ content: [{ type: 'text', text: 'Nombre' }] }, { content: [{ type: 'text', text: 'Estado' }] }] },
        rows: [{ cells: [{ content: [{ type: 'text', text: 'Diseño' }] }, { content: [{ type: 'text', text: 'Listo' }] }] }],
      },
      { type: 'opaque-markdown', source: ':::extension\nvalor: exacto\n:::' },
    ],
  };
}

describe('RichTextDocument (ADR 0053, UX7 P02)', () => {
  it('acepta el documento representativo con todos los nodos de P02 y conserva su identidad', () => {
    const document = representativeDocument();
    expect(validateRichTextDocument(document)).toEqual({ ok: true, value: document });
  });

  it('crea un borrador editable mínimo con un párrafo vacío', () => {
    expect(createEmptyRichTextDocument()).toEqual({
      schemaVersion: 1,
      blocks: [{ type: 'paragraph', content: [] }],
    });
  });

  it('normaliza marcas y une tramos de texto contiguos equivalentes sin tocar bloques opacos', () => {
    const opaque = { type: 'opaque-markdown', source: '<custom exact="yes">' } as const;
    const document = unsafe<RichTextDocument>({
      schemaVersion: 1,
      blocks: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'uno', marks: ['italic', 'bold', 'italic'] },
            { type: 'text', text: ' dos', marks: ['bold', 'italic'] },
          ],
        },
        opaque,
      ],
    });

    const result = normalizeRichTextDocument(document);
    expect(result.ok && result.value.blocks[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'uno dos', marks: ['bold', 'italic'] }],
    });
    expect(result.ok && result.value.blocks[1]).toBe(opaque);
  });

  it.each([
    ['versión desconocida', { schemaVersion: 2 }, 'unsupported-schema-version@document.schemaVersion'],
    ['documento sin bloques', { blocks: [] }, 'invalid-value@document.blocks'],
    ['nivel de encabezado', { blocks: [{ type: 'heading', level: 7, content: [] }] }, 'invalid-value@document.blocks[0].level'],
    ['marca desconocida', { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: ['underline'] }] }] }, 'invalid-value@document.blocks[0].content[0].marks[0]'],
    ['enlace activo', { blocks: [{ type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'x' }] }] }] }, 'invalid-value@document.blocks[0].content[0].href'],
    ['asset absoluto', { blocks: [{ type: 'image', assetRef: '/tmp/a.png', alt: 'a' }] }, 'invalid-asset-ref@document.blocks[0].assetRef'],
    ['tabla irregular', { blocks: [{ type: 'table', rows: [{ cells: [{ content: [] }] }, { cells: [{ content: [] }, { content: [] }] }] }] }, 'invalid-value@document.blocks[0].rows[1].cells'],
    ['bloque desconocido', { blocks: [{ type: 'video', src: 'x' }] }, 'invalid-value@document.blocks[0].type'],
    ['propiedad privada de editor', { blocks: [{ type: 'paragraph', content: [], nodeId: 'lexical-1' }] }, 'unknown-property@document.blocks[0].nodeId'],
  ])('rechaza %s', (_case, patch, expected) => {
    const document = unsafe<RichTextDocument>({ ...representativeDocument(), ...patch });
    expect(problems(validateRichTextDocument(document))).toContain(expected);
  });

  it('aplica las reglas propias de listas ordenadas y checklist', () => {
    const document = unsafe<RichTextDocument>({
      schemaVersion: 1,
      blocks: [{ type: 'list', style: 'bullet', start: 2, items: [{ checked: true, content: [] }] }],
    });
    expect(problems(validateRichTextDocument(document))).toEqual([
      'unknown-property@document.blocks[0].start',
      'unknown-property@document.blocks[0].items[0].checked',
    ]);
  });

  it('limita la anidación de listas', () => {
    let nested: Record<string, unknown> = {
      type: 'list', style: 'bullet', items: [{ content: [{ type: 'text', text: 'fin' }] }],
    };
    for (let depth = 0; depth < MAX_RICH_TEXT_LIST_DEPTH; depth += 1) {
      nested = { type: 'list', style: 'bullet', items: [{ content: [], children: [nested] }] };
    }
    const document = unsafe<RichTextDocument>({ schemaVersion: 1, blocks: [nested] });
    expect(problems(validateRichTextDocument(document)).some((problem) =>
      problem.startsWith('invalid-value@document.blocks[0]') && problem.includes('children'),
    )).toBe(true);
  });

  it('rechaza datos ejecutables sin evaluar getters y trata código literal como texto inerte', () => {
    let evaluated = false;
    const calculated = Object.defineProperty({ type: 'paragraph' }, 'content', {
      enumerable: true,
      get: () => { evaluated = true; return []; },
    });
    const unsafeDocument = unsafe<RichTextDocument>({ schemaVersion: 1, blocks: [calculated] });
    expect(problems(validateRichTextDocument(unsafeDocument))).toEqual(['executable-content@document.blocks[0].content']);
    expect(evaluated).toBe(false);

    const inert = unsafe<RichTextDocument>({
      schemaVersion: 1,
      blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }],
    });
    expect(validateRichTextDocument(inert).ok).toBe(true);
  });
});
