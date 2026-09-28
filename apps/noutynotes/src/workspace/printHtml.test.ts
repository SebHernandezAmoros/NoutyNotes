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
});
