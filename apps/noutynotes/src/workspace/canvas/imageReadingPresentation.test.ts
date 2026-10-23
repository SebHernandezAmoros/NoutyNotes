import type { RichTextDocument, RichTextImage } from '@noutynotes/domain';
import { describe, expect, it } from 'vitest';

import { resolveImageReading } from './imageReadingPresentation';
import { projectRichTextPreview } from './richTextPreviewProjection';
import { projectBannerPreview } from './bannerImageHeight';

const image: RichTextImage = { type: 'image', assetRef: 'assets/images/shared.png' as RichTextImage['assetRef'], alt: 'Descripción guardada' };
const caption = [{ type: 'text', text: 'Leyenda distinta', marks: ['bold'] }] as const;

describe('N3 lectura por imagen', () => {
  it('conserva fallback histórico con caption ausente o vacía', () => {
    expect(resolveImageReading(image).caption).toEqual([{ type: 'text', text: image.alt }]);
    expect(resolveImageReading({ ...image, caption: [] }).caption).toEqual(resolveImageReading(image).caption);
    expect(resolveImageReading(image).alt).toBe(image.alt);
    expect(resolveImageReading(image).intent).toBe('legacy');
  });
  it('conserva precedencia y estructura exacta de caption rica histórica o explícita', () => {
    expect(resolveImageReading({ ...image, caption }).caption).toBe(caption);
    expect(resolveImageReading({ ...image, caption, captionPolicy: 'explicit' }).caption).toBe(caption);
  });
  it('explicit sin caption o con [] no usa alt como leyenda', () => {
    expect(resolveImageReading({ ...image, captionPolicy: 'explicit' }).caption).toEqual([]);
    expect(resolveImageReading({ ...image, captionPolicy: 'explicit', caption: [] }).caption).toEqual([]);
  });
  it('informative usa solo alt y permite descripción incompleta sin sustituirla por caption', () => {
    expect(resolveImageReading({ ...image, accessibilityIntent: 'informative', caption }).alt).toBe(image.alt);
    expect(resolveImageReading({ ...image, accessibilityIntent: 'informative', alt: '', caption }).alt).toBe('');
  });
  it.each(['decorative', 'pending'] as const)('%s desactiva alt sin borrar texto ni caption conservada', (accessibilityIntent) => {
    const source = Object.freeze({ ...image, accessibilityIntent, captionPolicy: 'explicit' as const, caption });
    const result = resolveImageReading(source);
    expect(result.alt).toBe('');
    expect(result.hideImageFromAccessibility).toBe(true);
    expect(result.caption).toBe(caption);
    expect(source.alt).toBe(image.alt);
  });
  it('política de leyenda e intención son independientes', () => {
    expect(resolveImageReading({ ...image, captionPolicy: 'explicit' })).toMatchObject({ caption: [], alt: image.alt, intent: 'legacy' });
    expect(resolveImageReading({ ...image, accessibilityIntent: 'pending' })).toMatchObject({ caption: [{ type: 'text', text: image.alt }], alt: '' });
  });
  it('ambas proyecciones conservan discriminantes por imagen en un documento mixto', () => {
    const explicit = Object.freeze({ ...image, captionPolicy: 'explicit' as const, accessibilityIntent: 'pending' as const, caption });
    const document: RichTextDocument = { schemaVersion: 2, blocks: [image, explicit] };
    const projected = projectRichTextPreview(document, 20, 400, 13).document;
    const banner = projectBannerPreview(document, { height: 400, width: 400, fontSize: 13, lineHeight: 18, imageMinimum: 88, captionPosition: 'bottom', textHeights: {} }).document;
    for (const result of [projected, banner]) {
      expect(result.blocks[0]).toBe(image);
      expect(result.blocks[1]).toBe(explicit);
    }
    expect(resolveImageReading(image).caption).not.toEqual(resolveImageReading(explicit).caption);
  });
  it('Banner reserva únicamente leyendas que realmente se representan', () => {
    const options = { height: 240, width: 400, fontSize: 13, lineHeight: 18, imageMinimum: 88, captionPosition: 'bottom' as const, textHeights: {} };
    const preview = (block: RichTextImage) => projectBannerPreview({ schemaVersion: 2, blocks: [block] }, options);
    expect(preview({ ...image, captionPolicy: 'explicit' }).imageHeight).toBe(preview({ ...image, alt: '' }).imageHeight);
    expect(preview({ ...image, captionPolicy: 'explicit', caption }).imageHeight).toBe(preview(image).imageHeight);
  });
});
