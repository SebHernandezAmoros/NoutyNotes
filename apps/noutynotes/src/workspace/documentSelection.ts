import { captureDocumentQuote } from '@noutynotes/application';
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
