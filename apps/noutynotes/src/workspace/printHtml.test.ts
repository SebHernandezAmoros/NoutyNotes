import type { PrintEntry } from '@noutynotes/application';
import type { CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { buildPrintHtml } from './printHtml';

const id = (value: string) => value as CardId;

describe('documento de impresión (ADR 0031)', () => {
  it('escapa el contenido de la tarjeta: nunca se ejecuta como HTML', () => {
    const html = buildPrintHtml('Mi tablero', [
      {
        id: id('a'), number: 1, title: '<script>alert(1)</script>', typeLabel: 'Nota', content: 'Texto & "cita".',
        tags: ['<b>x</b>'], imageRefs: [], connections: [{ direction: 'from', label: 'Relacionada con', otherTitle: 'B' }],
      },
    ] satisfies PrintEntry[], new Map());
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Texto &amp; &quot;cita&quot;.');
    expect(html).toContain('#&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('Relacionada con');
    expect(html).toContain('Mi tablero');
  });

  it('incluye las imágenes resueltas y evita el corte de página dentro de una tarjeta', () => {
    const html = buildPrintHtml('T', [
      { id: id('a'), number: 1, title: 'A', typeLabel: 'Nota', content: '', tags: [], imageRefs: ['assets/images/x.png'], connections: [] },
    ] satisfies PrintEntry[], new Map([['assets/images/x.png', 'data:image/png;base64,AAA']]));
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('page-break-inside: avoid');
  });

  it('un tablero sin tarjetas produce un documento válido con un aviso, no una página en blanco confusa', () => {
    const html = buildPrintHtml('Vacío', [], new Map());
    expect(html).toContain('Vacío');
    expect(html).toMatch(/sin tarjetas|no tiene tarjetas/i);
  });

  it('una imagen intercalada en una nota no se duplica como sintaxis Markdown cruda, y el texto no muestra «#»/«-» crudos (UX7-C5)', () => {
    const html = buildPrintHtml('T', [
      {
        id: id('a'), number: 1, title: 'A', typeLabel: 'Nota',
        content: '# Título\n\n- uno\n- dos\n\n![mapa](assets/images/x.png)\n\nMás texto.',
        tags: [], imageRefs: ['assets/images/x.png'], connections: [],
      },
    ] satisfies PrintEntry[], new Map([['assets/images/x.png', 'data:image/png;base64,AAA']]));
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).not.toContain('![mapa]');
    expect(html).not.toContain('assets/images/x.png</pre>');
    expect(html).not.toMatch(/<pre>[^<]*#\s*Título/);
    expect(html).toContain('Título');
    expect(html).toContain('• uno');
  });

  it('el título y el cuerpo reflejan el tamaño semántico de la tarjeta, no un valor fijo (ADR 0050)', () => {
    const html = buildPrintHtml('T', [
      { id: id('a'), number: 1, title: 'A', typeLabel: 'Nota', content: 'Cuerpo', tags: [], imageRefs: [], connections: [], titleSize: 'large', bodySize: 'small' },
    ] satisfies PrintEntry[], new Map());
    expect(html).toMatch(/<h2 style="font-size:20px;line-height:25px;">A<\/h2>/);
    expect(html).toMatch(/<pre style="font-size:11px;line-height:15px;">Cuerpo<\/pre>/);
  });

  it('la posición de la leyenda cambia el orden y, en «left»/«right», convierte la figura en fila (ADR 0051); «bottom» por defecto no necesita estilo en línea', () => {
    const entry = (captionPosition: PrintEntry['captionPosition']): PrintEntry => ({
      id: id('a'), number: 1, title: 'A', typeLabel: 'Nota', content: '![mapa](assets/images/x.png)', tags: [], imageRefs: ['assets/images/x.png'], connections: [],
      ...(captionPosition === undefined ? {} : { captionPosition }),
    });
    const images = new Map([['assets/images/x.png', 'data:image/png;base64,AAA']]);
    const bottom = buildPrintHtml('T', [entry(undefined)], images);
    expect(bottom).toMatch(/<figure><img[^>]*\/><figcaption>mapa<\/figcaption><\/figure>/);
    const top = buildPrintHtml('T', [entry('top')], images);
    expect(top).toMatch(/<figure><figcaption[^>]*>mapa<\/figcaption><img[^>]*\/><\/figure>/);
    const left = buildPrintHtml('T', [entry('left')], images);
    expect(left).toMatch(/<figure style="display:flex;[^"]*"><figcaption[^>]*>mapa<\/figcaption><img[^>]*flex:2[^>]*\/><\/figure>/);
    const right = buildPrintHtml('T', [entry('right')], images);
    expect(right).toMatch(/<figure style="display:flex;[^"]*"><img[^>]*flex:2[^>]*\/><figcaption[^>]*>mapa<\/figcaption><\/figure>/);
  });
});
