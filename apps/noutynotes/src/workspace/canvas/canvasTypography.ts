import { bodyLineHeight, titleLineHeight } from '../textSizes';

export function canvasTextMetrics({ titleSize, bodySize }: {
  readonly titleSize: number;
  readonly bodySize: number;
}) {
  return {
    // Unidades normales del lienzo: `canvas-content` escala después la Nota completa.
    titleSize,
    titleLineHeight: titleLineHeight(titleSize),
    bodySize,
    bodyLineHeight: bodyLineHeight(bodySize),
    headerSize: 11,
    headerLineHeight: 14,
    collapsedTitleSize: 15,
    collapsedTitleLineHeight: 18,
    captionSize: 11,
    captionLineHeight: 14,
    auxiliarySize: 12,
    auxiliaryLineHeight: 16,
    badgeSize: 11,
    badgeLineHeight: 16,
    floatingTitleSize: 28,
    floatingTitleLineHeight: 34,
  } as const;
}
