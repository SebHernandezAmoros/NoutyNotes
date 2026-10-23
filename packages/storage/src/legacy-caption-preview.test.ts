import { describe, expect, it } from 'vitest';
import { parseAssetRef, parseNoteBlocks } from '@noutynotes/domain';
import type { RichTextCodec } from '@noutynotes/application';
import type { RichTextDocument } from '@noutynotes/domain';
import { markdownRichTextCodec } from './rich-text-codec';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error('Fixture inválido');
  return result.value;
}
const codec: RichTextCodec = markdownRichTextCodec;
const project = (source: string) => codec.projectLegacyNotePreview?.(source) ?? source;
const image = '![Alt histórico](assets/images/a.png)';
const marker = '<!-- nouty-caption:v1:%5B%7B%22type%22%3A%22text%22%2C%22text%22%3A%22Leyenda%22%7D%5D -->';

describe('Marcadores históricos: proyección de lectura, sin reescritura durable', () => {
  it('FIX01/02/03/04/11 separa metadatos válidos de párrafos y conserva orden, alt y caption', () => {
    const source = `Antes\n\n${image}\n\n${marker}\n\nEntre\n\n${image}\n\n${marker}\n\nDespués`;
    const original = value(markdownRichTextCodec.parse(source));
    const visible = project(source);
    expect(visible).toBe(`Antes\n\n${image}\n\nEntre\n\n${image}\n\nDespués`);
    expect(parseNoteBlocks(visible).map((block) => block.kind === 'text' ? block.text : block.alt)).toEqual(['Antes', 'Alt histórico', 'Entre', 'Alt histórico', 'Después']);
    expect(original.blocks.filter((block) => block.type === 'image')).toEqual([
      { type: 'image', assetRef: 'assets/images/a.png', alt: 'Alt histórico', caption: [{ type: 'text', text: 'Leyenda' }] },
      { type: 'image', assetRef: 'assets/images/a.png', alt: 'Alt histórico', caption: [{ type: 'text', text: 'Leyenda' }] },
    ]);
    expect(value(markdownRichTextCodec.parse(source))).toEqual(original);
  });

  it('FIX03 conserva leyenda rica Unicode y offsets CRLF, sin modificar el codec durable', () => {
    const document: RichTextDocument = { schemaVersion: 1, blocks: [{ type: 'image', assetRef: value(parseAssetRef('assets/images/a.png')), alt: 'Ñandú', caption: [{ type: 'text', text: '🦜 ñ < &', marks: ['bold'] }] }] };
    const source = value(markdownRichTextCodec.serialize(document)).replaceAll('\n', '\r\n');
    expect(project(source)).toBe('![Ñandú](assets/images/a.png)');
    expect(value(markdownRichTextCodec.parse(source))).toEqual(document);
  });

  it.each([
    '<!-- nouty-caption:v1:%ZZ -->',
    '<!-- nouty-caption:v1:%5B%7B%22type%22%3A%22desconocido%22%7D%5D -->',
    '<!-- nouty-caption:v2:%5B%5D -->',
    '<!-- otro comentario -->',
  ])('FIX09 conserva comentarios inválidos o ajenos: %s', (comment) => {
    const source = `${image}\n\n${comment}`;
    expect(project(source)).toBe(source);
  });

  it('FIX09 conserva un marcador huérfano; FIX02 conserva texto inmediatamente posterior a una caption válida', () => {
    const orphan = `${marker}\n\n${image}`;
    const joined = `${image}\n\n${marker}\nTexto del mismo bloque HTML`;
    expect(project(orphan)).toBe(orphan);
    expect(value(markdownRichTextCodec.parse(joined)).blocks).toHaveLength(2);
    expect(project(joined)).toBe(`${image}\nTexto del mismo bloque HTML`);
  });

  it.each([
    (text: string) => `\\${text}`,
    (text: string) => text.replace('<', '&lt;'),
    (text: string) => '`' + text + '`',
    (text: string) => '````\n' + text + '\n````',
    (text: string) => `    ${text}`,
    (text: string) => `Escribí literalmente ${text}`,
  ])('FIX10 conserva texto literal/escapado/código según el parser canónico (%#)', (literal) => {
    const source = `${image}\n\n${literal(marker)}`;
    expect(project(source)).toBe(source);
  });

  it('FIX01 acepta caption vacía sin convertirla en texto ni alterar alt', () => {
    const source = `${image}\n\n<!-- nouty-caption:v1:%5B%5D -->`;
    expect(project(source)).toBe(image);
    expect(value(markdownRichTextCodec.parse(source)).blocks[0]).toMatchObject({ alt: 'Alt histórico', caption: [] });
  });
});
