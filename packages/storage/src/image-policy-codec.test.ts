import { describe, expect, it } from 'vitest';
import type { AssetRef, RichTextDocument } from '@noutynotes/domain';

import { parseRichTextHtml, serializeRichTextHtml } from './rich-text-html-codec';
import { serializeRichTextMarkdown } from './rich-text-codec';
import { valueOf } from './__fixtures__/helpers';

const historic = { type: 'image', assetRef: 'assets/images/plano.png' as AssetRef, alt: 'Descripción anterior' } as const;
const mixed: RichTextDocument = { schemaVersion: 2, blocks: [
  historic,
  { ...historic, captionPolicy: 'explicit' },
  { ...historic, accessibilityIntent: 'informative', alt: '' },
  { ...historic, accessibilityIntent: 'decorative', caption: [] },
  { ...historic, captionPolicy: 'explicit', accessibilityIntent: 'pending', caption: [{ type: 'text', text: 'Leyenda', marks: ['italic'] }] },
] };

describe('N1: HTML v2 sin degradar el formato histórico', () => {
  it('C02–C05/C12 conserva documento mixto, campos parciales, alt y caption ausente/[]', () => {
    const html = valueOf(serializeRichTextHtml(mixed));
    expect(html).toContain('data-nouty-image-caption-policy="explicit"');
    expect(html).toContain('data-nouty-image-accessibility-intent="pending"');
    expect(valueOf(parseRichTextHtml(html, 2))).toEqual(mixed);
    expect(valueOf(parseRichTextHtml(html))).toEqual(mixed);
  });

  it('C01 conserva v1 y permite conservar v2 sin discriminantes mediante contexto', () => {
    const html = '<figure><img alt="Descripción anterior" src="assets/images/plano.png"></figure>';
    expect(valueOf(parseRichTextHtml(html))).toEqual({ schemaVersion: 1, blocks: [historic] });
    expect(valueOf(parseRichTextHtml(html, 2))).toEqual({ schemaVersion: 2, blocks: [historic] });
  });

  it('C06/C07 rechaza discriminantes desconocidos, versión futura y atributos v2 en envoltura v1', () => {
    const html = '<figure data-nouty-image-caption-policy="explicit"><img alt="" src="assets/images/plano.png"></figure>';
    expect(parseRichTextHtml(html, 1).ok).toBe(false);
    expect(parseRichTextHtml(html, 3).ok).toBe(false);
    expect(parseRichTextHtml(html.replace('explicit', 'legacy'), 2).ok).toBe(false);
    expect(parseRichTextHtml(html.replace('caption-policy="explicit"', 'accessibility-intent="unknown"'), 2).ok).toBe(false);
  });

  it('no degrada silenciosamente un documento v2 a Markdown heredado', () => {
    expect(serializeRichTextMarkdown(mixed).ok).toBe(false);
    expect(serializeRichTextMarkdown({ schemaVersion: 2, blocks: [historic] }).ok).toBe(false);
    expect(serializeRichTextMarkdown({ schemaVersion: 1, blocks: [historic] }).ok).toBe(true);
  });
});
