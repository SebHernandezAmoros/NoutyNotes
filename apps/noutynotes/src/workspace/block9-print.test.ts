import { expect, it } from 'vitest';
import type { PrintEntry } from '@noutynotes/application';
import type { AssetRef, CardId } from '@noutynotes/domain';
import { buildPrintHtml } from './printHtml';

const ref = 'assets/images/lab.png' as AssetRef;
const entry: PrintEntry = { id: 'lab' as CardId, number: 1, title: 'Usuario <local>', typeLabel: 'Nota', content: '', tags: [], imageRefs: [], connections: [],
  contentDocument: { schemaVersion: 2, blocks: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Antes' }] },
    { type: 'image', assetRef: ref, alt: 'Descripción independiente', captionPolicy: 'explicit', accessibilityIntent: 'informative', caption: [{ type: 'text', text: 'Leyenda exacta', marks: ['bold'] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Después' }] },
  ] } };

it('B9: localiza el documento y aplica papel/orientación sin inyectar opciones arbitrarias', () => {
  const options = { locale: 'en' as const, paper: 'Letter' as const, orientation: 'landscape' as const };
  const html = buildPrintHtml('Tablero', [], new Map(), options);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('size: Letter landscape');
  expect(html).toContain('margin: 12mm');
  expect(html).toContain('This board has no cards to print.');
  const invalid = { ...options, paper: 'A4; color:red' as 'Letter' };
  expect(buildPrintHtml('T', [], new Map(), invalid)).not.toContain('A4; color:red');
});

it('B9: recurso ausente deja aviso en su lugar, sin perder vecinos ni modificar el documento', () => {
  const original = JSON.stringify(entry);
  const html = buildPrintHtml('T', [entry], new Map(), { locale: 'en' });
  expect(html).toContain('Image unavailable');
  expect(html.indexOf('Antes')).toBeLessThan(html.indexOf('Image unavailable'));
  expect(html.indexOf('Image unavailable')).toBeLessThan(html.indexOf('Después'));
  expect(html).toContain('Leyenda exacta');
  expect(JSON.stringify(entry)).toBe(original);
});

it('B9: respeta alt, leyenda enriquecida e intención sin romper imágenes históricas', () => {
  const images = new Map([[ref, 'data:image/png;base64,AAAA']]);
  const html = buildPrintHtml('T', [entry], images);
  expect(html).toContain('alt="Descripción independiente"');
  expect(html).toMatch(/<figcaption[^>]*>.*<strong>Leyenda exacta<\/strong>.*<\/figcaption>/);
  expect(html).not.toContain('<figcaption>Descripción independiente</figcaption>');
  const historical: PrintEntry = { id: entry.id, number: 1, title: 'Histórica', typeLabel: 'Nota', content: `![Histórica](${ref})`, imageRefs: [ref], tags: [], connections: [] };
  expect(buildPrintHtml('T', [historical], images)).toContain('<figcaption>Histórica</figcaption>');
});

it('B9-OBS-02: el modo visual conserva el contenido y añade superficie y cabecera de Nota', () => {
  const report = buildPrintHtml('T', [entry], new Map(), { style: 'report' });
  const visual = buildPrintHtml('T', [entry], new Map(), { style: 'visual' });
  expect(report).not.toContain('<article class="entry visual-note');
  expect(visual).toContain('<article class="entry visual-note');
  expect(visual).toContain('<div class="visual-note-header">');
  expect(visual).toContain('Antes');
  expect(visual).toContain('Después');
  expect(visual).toContain('Leyenda exacta');
});
