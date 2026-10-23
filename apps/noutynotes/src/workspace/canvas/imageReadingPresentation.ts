import type { RichTextImage, RichTextInline } from '@noutynotes/domain';

/** Read-only interpretation of N1 per image; neither stored text is rewritten. */
export function resolveImageReading(image: RichTextImage): {
  readonly caption: readonly RichTextInline[];
  readonly alt: string;
  readonly intent: NonNullable<RichTextImage['accessibilityIntent']> | 'legacy';
  readonly hideImageFromAccessibility: boolean;
} {
  const intent = image.accessibilityIntent ?? 'legacy';
  const hideImageFromAccessibility = intent === 'decorative' || intent === 'pending';
  return {
    caption: image.caption?.length ? image.caption
      : image.captionPolicy !== 'explicit' && image.alt ? [{ type: 'text', text: image.alt }] : [],
    alt: hideImageFromAccessibility ? '' : image.alt,
    intent,
    hideImageFromAccessibility,
  };
}
