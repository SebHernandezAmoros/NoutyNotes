import type { PrintEntry } from '@noutynotes/application';
import type { CardId } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { buildPrintHtml } from './printHtml';

const id = (value: string) => value as CardId;

describe('documento de impresiÃ³n (ADR 0031)', () => {
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

  it('incluye las imÃ¡genes resueltas y evita el corte de pÃ¡gina dentro de una tarjeta', () => {
    const html = buildPrintHtml('T', [
      { id: id('a'), number: 1, title: 'A', typeLabel: 'Nota', content: '', tags: [], imageRefs: ['assets/images/x.png'], connections: [] },
    ] satisfies PrintEntry[], new Map([['assets/images/x.png', 'data:image/png;base64,AAA']]));
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('page-break-inside: avoid');
  });

  it('un tablero sin tarjetas produce un documento vÃ¡lido con un aviso, no una pÃ¡gina en blanco confusa', () => {
    const html = buildPrintHtml('VacÃ­o', [], new Map());
    expect(html).toContain('VacÃ­o');
    expect(html).toMatch(/sin tarjetas|no tiene tarjetas/i);
  });

  it('una imagen intercalada en una nota no se duplica como sintaxis Markdown cruda, y el texto no muestra Â«#Â»/Â«-Â» crudos (UX7-C5)', () => {
    const html = buildPrintHtml('T', [
      {
        id: id('a'), number: 1, title: 'A', typeLabel: 'Nota',
        content: '# TÃ­tulo\n\n- uno\n- dos\n\n![mapa](assets/images/x.png)\n\nMÃ¡s texto.',
        tags: [], imageRefs: ['assets/images/x.png'], connections: [],
      },
    ] satisfies PrintEntry[], new Map([['assets/images/x.png', 'data:image/png;base64,AAA']]));
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).not.toContain('![mapa]');
    expect(html).not.toContain('assets/images/x.png</pre>');
    expect(html).not.toMatch(/<pre>[^<]*#\s*TÃ­tulo/);
    expect(html).toContain('TÃ­tulo');
    expect(html).toContain('• uno');
  });

  it('el tÃ­tulo y el cuerpo reflejan el tamaÃ±o semÃ¡ntico de la tarjeta, no un valor fijo (ADR 0050)', () => {
    const html = buildPrintHtml('T', [
      { id: id('a'), number: 1, title: 'A', typeLabel: 'Nota', content: 'Cuerpo', tags: [], imageRefs: [], connections: [], titleSize: 'large', bodySize: 'small' },
    ] satisfies PrintEntry[], new Map());
    expect(html).toMatch(/<h2 style="font-size:20px;line-height:25px;">A<\/h2>/);
    expect(html).toMatch(/<pre style="font-size:11px;line-height:15px;">Cuerpo<\/pre>/);
  });

  it('la posiciÃ³n de la leyenda cambia el orden y, en Â«leftÂ»/Â«rightÂ», convierte la figura en fila (ADR 0051); Â«bottomÂ» por defecto no necesita estilo en lÃ­nea', () => {
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

  it('P09 imprime tablas como celdas legibles y no como tuberÃ­as Markdown', () => {
    const html = buildPrintHtml('T', [{
      id: id('a'), number: 1, title: 'A', typeLabel: 'Nota',
      content: '| Nombre | Estado | Fecha |\n| --- | --- | --- |\n| Idea | Activa | Hoy |\n| Otra | Pausa | MaÃ±ana |',
      tags: [], imageRefs: [], connections: [],
    }], new Map());

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Nombre</th>');
    expect(html).toContain('<td>Activa</td>');
    expect(html).not.toContain('| Nombre |');
  });

  it('P13 imprime texto flotante sin tÃ­tulo inventado y conserva alineaciÃ³n, tamaÃ±o y color', () => {
    const html = buildPrintHtml('T', [{
      id: id('texto'), number: 1, title: 'Sin tÃ­tulo', typeLabel: 'Texto', content: 'Una lÃ­nea\nOtra',
      tags: [], imageRefs: [], connections: [], floatingText: true, bodySize: 'large', textAlign: 'right', textColor: 'blue',
    }], new Map());
    expect(html).toContain('class="entry floating-text"');
    expect(html).toContain('font-size:16px');
    expect(html).toContain('text-align:right');
    expect(html).toContain('color:#2457a6');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('Sin tÃ­tulo');
  });

  it('P14 imprime una forma portable sin tÃ­tulo ni texto inventado', () => {
    const html = buildPrintHtml('T', [{
      id: id('forma'), number: 1, title: 'Sin tÃ­tulo', typeLabel: 'Forma', content: '',
      tags: [], imageRefs: [], connections: [], shapeKind: 'rounded-rectangle', shapeFill: 'orange', shapeStroke: 'blue', shapeStrokeWidth: 'thick',
    }], new Map());
    expect(html).toContain('class="entry shape-entry"');
    expect(html).toContain('border-radius:18px');
    expect(html).toContain('background:#f2c792');
    expect(html).toContain('border:6px solid #2457a6');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('Sin tÃ­tulo');
  });
  it('P15 imprime el estilo y las puntas de un conector decorativo', () => {
    const html = buildPrintHtml('T', [{
      id: id('conector'), number: 1, title: 'Sin título', typeLabel: 'Conector', content: '',
      tags: [], imageRefs: [], connections: [], connectorColor: 'purple', connectorWidth: 'thick',
      connectorDash: 'dashed', connectorArrows: 'both', connectorDirection: 'up',
    }], new Map());
    expect(html).toContain('class="entry connector-entry"');
    expect(html).toContain('border-top:6px dashed #7040a0');
    expect(html).toContain('transform:rotate(-18deg)');
    expect(html).toContain('◀');
    expect(html).toContain('▶');
    expect(html).not.toContain('<h2');
  });
});

