import { captureDocumentQuote } from '@noutynotes/application';
import type { DocumentQuote } from '@noutynotes/application';

/** Conservative lookup in rendered text only: no fuzzy match or Markdown source offsets. */
export function documentQuotePosition(text: string, quote: DocumentQuote, source: {
  readonly fingerprint?: string | undefined; readonly kind: 'txt' | 'markdown'; readonly partial: boolean;
}, blockBreaks: ReadonlySet<number> = new Set()): { start: number; end: number } | null {
  if (source.partial || source.fingerprint !== quote.fingerprint || source.kind !== quote.kind) return null;
  const candidates = new Map<number, number>();
  const collect = (needle: string, breaks: readonly number[]) => {
    if (!needle) return;
    for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + 1)) {
      if (breaks.every(offset => blockBreaks.has(start + offset))) candidates.set(start, start + needle.length);
    }
  };
  collect(quote.text, []);
  if (source.kind === 'markdown' && blockBreaks.size > 0 && /\r?\n/.test(quote.text)) {
    // Browser Selection adds separators between rendered blocks that Range/textContent omit.
    // Only accept them at actual DOM block boundaries; never normalize spaces or source Markdown.
    const breaks: number[] = []; let needle = ''; let offset = 0;
    for (const match of quote.text.matchAll(/\r?\n+/g)) {
      needle += quote.text.slice(offset, match.index);
      breaks.push(needle.length); offset = match.index + match[0].length;
    }
    needle += quote.text.slice(offset);
    collect(needle, breaks);
  }
  if (candidates.size !== 1) return null;
  const [start, end] = [...candidates][0]!;
  if (!text.slice(0, start).endsWith(quote.prefix) || !text.slice(end).startsWith(quote.suffix)) return null;
  return { start, end };
}

export function documentQuoteRange(root: HTMLElement, quote: DocumentQuote, source: Parameters<typeof documentQuotePosition>[2]): Range | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number; end: number }[] = [];
  const blockBreaks = new Set<number>();
  let offset = 0; let previousBlock: Element | null = null; let node: Node | null;
  while ((node = walker.nextNode())) {
    let block = node.parentElement;
    while (block && block !== root && !['block', 'flex', 'grid', 'list-item', 'table-cell'].includes(root.ownerDocument.defaultView!.getComputedStyle(block).display)) block = block.parentElement;
    if (previousBlock && block !== previousBlock) blockBreaks.add(offset);
    previousBlock = block;
    const end = offset + (node.textContent?.length ?? 0);
    nodes.push({ node, start: offset, end }); offset = end;
  }
  const position = documentQuotePosition(root.textContent ?? '', quote, source, blockBreaks);
  if (!position) return null;
  const range = root.ownerDocument.createRange();
  let started = false;
  for (const { node, start, end } of nodes) {
    if (!started && position.start < end) { range.setStart(node, position.start - start); started = true; }
    if (started && position.end <= end) { range.setEnd(node, position.end - start); return range; }
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
