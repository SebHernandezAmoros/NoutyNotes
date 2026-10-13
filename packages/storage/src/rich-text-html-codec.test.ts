import { describe, expect, it } from 'vitest';

import type { AssetRef, RichTextDocument } from '@noutynotes/domain';

import { parseRichTextHtml, serializeRichTextHtml } from './rich-text-html-codec';
import { problems, valueOf } from './__fixtures__/helpers';

const ref = (value: string) => value as AssetRef;

const complete: RichTextDocument = {
  schemaVersion: 1,
  blocks: [
    { type: 'heading', level: 2, content: [{ type: 'text', text: 'Mapa & café', marks: ['bold', 'italic'] }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Antes  ' }, { type: 'hard-break' },
      { type: 'link', href: 'https://example.com/a?x=1&y=2', content: [{ type: 'text', text: 'enlace', marks: ['italic'] }] },
    ] },
    { type: 'list', style: 'ordered', start: 3, items: [
      { content: [{ type: 'text', text: 'Uno' }], children: [{ type: 'list', style: 'bullet', items: [{ content: [{ type: 'text', text: 'Hijo' }] }] }] },
    ] },
    { type: 'list', style: 'checklist', items: [{ checked: false, content: [{ type: 'text', text: 'Pendiente' }] }] },
    { type: 'image', assetRef: ref('assets/images/uno.png'), alt: 'Uno', caption: [{ type: 'text', text: 'Leyenda ñ' }] },
    { type: 'image', assetRef: ref('assets/images/dos.webp'), alt: '' },
    {
      type: 'table',
      header: { cells: [{ content: [{ type: 'text', text: 'Nombre' }] }, { content: [{ type: 'text', text: 'Estado' }] }] },
      rows: [{ cells: [{ content: [{ type: 'text', text: 'Idea' }] }, { content: [{ type: 'text', text: 'Activa' }] }] }],
    },
  ],
};

describe('HTML seguro v1 ↔ RichTextDocument (P18-E2)', () => {
  it('conserva todas las estructuras soportadas y produce HTML canónico idempotente', () => {
    const html = valueOf(serializeRichTextHtml(complete));
    expect(html).toContain('<h2><strong><em>Mapa &amp; café</em></strong></h2>');
    expect(html).toContain('<img alt="Uno" src="assets/images/uno.png">');
    expect(html).toContain('<ul data-nouty-list="checklist"><li data-nouty-checked="false">');
    expect(valueOf(parseRichTextHtml(html))).toEqual(complete);
    expect(valueOf(serializeRichTextHtml(valueOf(parseRichTextHtml(html))))).toBe(html);
  });

  it('canonicaliza entidades, comillas, etiquetas y saltos sin perder espacios significativos', () => {
    const parsed = valueOf(parseRichTextHtml("<P>  Café &#x2615; &amp; <STRONG>pan</STRONG><BR/></P>\r\n"));
    expect(parsed.blocks[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '  Café ☕ & ' }, { type: 'text', text: 'pan', marks: ['bold'] }, { type: 'hard-break' }],
    });
    expect(valueOf(serializeRichTextHtml(parsed))).toBe('<p>  Café ☕ &amp; <strong>pan</strong><br></p>');
  });

  it('conserva alineación de párrafos y encabezados mediante un atributo seguro enumerado', () => {
    const source = '<h2 data-nouty-align="center">Centro</h2>\n<p data-nouty-align="right">Derecha</p>\n<p data-nouty-align="justify">Justificado</p>';
    const parsed = valueOf(parseRichTextHtml(source));
    expect(parsed.blocks).toEqual([
      { type: 'heading', level: 2, alignment: 'center', content: [{ type: 'text', text: 'Centro' }] },
      { type: 'paragraph', alignment: 'right', content: [{ type: 'text', text: 'Derecha' }] },
      { type: 'paragraph', alignment: 'justify', content: [{ type: 'text', text: 'Justificado' }] },
    ]);
    expect(valueOf(serializeRichTextHtml(parsed))).toBe(source);
    expect(problems(parseRichTextHtml('<p data-nouty-align="left; color:red">x</p>'))).toEqual(['invalid-html@html.p[data-nouty-align]']);
  });

  it('conserva tamaño y alineación de imagen y alineación vertical de celda con atributos enumerados', () => {
    const source = '<figure data-nouty-image-size="medium" data-nouty-image-align="right"><img alt="Plano" src="assets/images/uno.png"></figure>\n<table><tbody><tr><td data-nouty-valign="bottom">Final</td></tr></tbody></table>';
    const parsed = valueOf(parseRichTextHtml(source));
    expect(parsed.blocks).toEqual([
      { type: 'image', assetRef: ref('assets/images/uno.png'), alt: 'Plano', size: 'medium', alignment: 'right' },
      { type: 'table', rows: [{ cells: [{ content: [{ type: 'text', text: 'Final' }], verticalAlignment: 'bottom' }] }] },
    ]);
    expect(valueOf(serializeRichTextHtml(parsed))).toBe(source);
    expect(problems(parseRichTextHtml('<figure data-nouty-image-size="calc(1px)" ><img alt="x" src="assets/images/uno.png"></figure>'))[0]).toBe('invalid-html@html.figure[data-nouty-image-size]');
  });

  it.each([
    ['script', '<p>bien</p><script>alert(1)</script>'],
    ['evento', '<p onclick="alert(1)">texto</p>'],
    ['estilo', '<p style="color:red">texto</p>'],
    ['etiqueta desconocida', '<div>texto</div>'],
    ['comentario', '<p>texto</p><!-- oculto -->'],
    ['HTML mal cerrado', '<p><strong>texto</p></strong>'],
    ['reparación estructural', '<table><tbody><td>x</td></tbody></table>'],
    ['atributo desconocido', '<a href="https://example.com" target="_blank">x</a>'],
    ['entidad desconocida', '<p>&copy;</p>'],
  ])('rechaza %s sin sanearlo silenciosamente', (_case, html) => {
    expect(problems(parseRichTextHtml(html))[0]).toMatch(/^invalid-html@html/);
  });

  it.each([
    'javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'java&#x73;cript:alert(1)',
    'data:text/html,x', 'blob:https://example.com/id', 'file:///tmp/x', 'https://exa mple.com',
  ])('rechaza el enlace peligroso o mal formado %s', (href) => {
    expect(problems(parseRichTextHtml(`<p><a href="${href}">x</a></p>`))).toEqual(['invalid-html@html.a[href]']);
  });

  it.each([
    'https://example.com/a.png', '/assets/a.png', '../assets/a.png', 'assets/../a.png',
    'assets\\a.png', 'data:image/png;base64,x', 'other/a.png', 'assets/%2e%2e/a.png',
  ])('rechaza la imagen fuera del paquete %s', (src) => {
    expect(problems(parseRichTextHtml(`<figure><img alt="x" src="${src}"></figure>`))).toEqual(['invalid-html@html.img[src]']);
  });

  it('rechaza tablas irregulares, celdas combinadas y documentos opacos', () => {
    expect(problems(parseRichTextHtml('<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>'))[0]).toMatch(/^invalid-html@html.table/);
    expect(problems(parseRichTextHtml('<table><tbody><tr><td colspan="2">a</td></tr></tbody></table>'))).toEqual(['invalid-html@html.td[colspan]']);
    expect(problems(serializeRichTextHtml({ schemaVersion: 1, blocks: [{ type: 'opaque-markdown', source: '**x**' }] }))[0]).toMatch(/^unsupported-rich-text@document.blocks\[0\]/);
  });
});
