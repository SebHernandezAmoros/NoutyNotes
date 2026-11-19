import { captureDocumentQuote } from '@noutynotes/application';
import type { DocumentQuote } from '@noutynotes/application';

/** Conservative lookup in rendered text only: no fuzzy match or Markdown source offsets. */
export function documentQuotePosition(text: string, quote: DocumentQuote, source: {
  readonly fingerprint?: string | undefined; readonly kind: 'txt' | 'markdown'; readonly partial: boolean;
}): { start: number; end: number } | null {
  if (source.partial || source.fingerprint !== quote.fingerprint || source.kind !== quote.kind) return null;
  const start = text.indexOf(quote.text);
  if (start < 0 || start !== text.lastIndexOf(quote.text)) return null;
  const end = start + quote.text.length;
  if (!text.slice(0, start).endsWith(quote.prefix) || !text.slice(end).startsWith(quote.suffix)) return null;
  return { start, end };
}

export function documentQuoteRange(root: HTMLElement, quote: DocumentQuote, source: Parameters<typeof documentQuotePosition>[2]): Range | null {
  const position = documentQuotePosition(root.textContent ?? '', quote, source);
  if (!position) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = root.ownerDocument.createRange();
  let offset = 0, started = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const end = offset + (node.textContent?.length ?? 0);
    if (!started && position.start < end) { range.setStart(node, position.start - offset); started = true; }
    if (started && position.end <= end) { range.setEnd(node, position.end - offset); return range; }
    offset = end;
  }
  return null;
}
/** Both endpoints must belong to this reader. UI/panel text is never a quote source. */
export function quoteFromSelection(root: HTMLElement, selection: Selection | null, source: {
  readonly sourceText: string; readonly fingerprint: string; readonly kind: 'txt' | 'markdown'; readonly partial: boolean;
}) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  return captureDocumentQuote({ ...source, visibleText: root.textContent ?? '', start, end: start + text.length, selectedText: selection.toString() });
}
