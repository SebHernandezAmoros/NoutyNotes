import { markdownExcerpt } from '../markdownLists';

/** Estimación conservadora para anunciar texto que no cabe sin medir el DOM. */
export function estimatePreviewLines(markdown: string, width: number, fontSize: number): number {
  const usableWidth = Math.max(1, width - 16);
  const averageGlyphWidth = Math.max(1, fontSize * 0.55);
  const charactersPerLine = Math.max(8, Math.floor(usableWidth / averageGlyphWidth));
  return markdown.split('\n').reduce((total, line) => {
    const visible = markdownExcerpt(line);
    return total + Math.max(1, Math.ceil(visible.length / charactersPerLine));
  }, 0);
}

export function previewOverflow(markdown: string, width: number, fontSize: number, capacity: number): {
  readonly shownLines: number;
  readonly hiddenLines: number;
} {
  const estimatedLines = estimatePreviewLines(markdown, width, fontSize);
  const hiddenLines = Math.max(0, estimatedLines - capacity);
  return {
    shownLines: hiddenLines > 0 ? Math.max(0, capacity - 1) : capacity,
    hiddenLines,
  };
}
