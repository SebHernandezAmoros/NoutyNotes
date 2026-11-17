/** Optional Diary metadata, encoded in one existing text field; never HTML or an Asset copy. */
export interface DocumentQuote {
  readonly version: 1;
  readonly text: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly fingerprint: string;
  readonly kind: 'txt' | 'markdown';
  /** Verified at capture only. Reuse requires the same complete source fingerprint. */
  readonly line?: number;
}
export const DOCUMENT_QUOTE_LIMIT = 4000;
export function isDocumentQuote(value: unknown): value is DocumentQuote {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  return q.version === 1 && typeof q.text === 'string' && q.text.trim().length > 0 && q.text.length <= DOCUMENT_QUOTE_LIMIT
    && typeof q.prefix === 'string' && q.prefix.length <= 128 && typeof q.suffix === 'string' && q.suffix.length <= 128
    && typeof q.fingerprint === 'string' && /^sha256:[a-f0-9]{64}$/.test(q.fingerprint)
    && (q.kind === 'txt' || q.kind === 'markdown')
    && (q.line === undefined || (q.kind === 'txt' && Number.isSafeInteger(q.line) && Number(q.line) > 0));
}
export function readDocumentQuote(value: unknown): DocumentQuote | null {
  if (typeof value !== 'string') return null;
  try { const q: unknown = JSON.parse(value); return isDocumentQuote(q) ? q : null; } catch { return null; }
}
/** Offsets are only offsets in the supplied visible text, never Markdown source positions. */
export function captureDocumentQuote(input: {
  readonly visibleText: string; readonly start: number; readonly end: number;
  readonly sourceText: string; readonly fingerprint: string; readonly kind: 'txt' | 'markdown'; readonly partial: boolean;
  readonly selectedText?: string;
}): { readonly quote: DocumentQuote } | { readonly error: 'empty' | 'long' | 'invalid' } {
  const { visibleText, start, end, sourceText, fingerprint, kind, partial } = input;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > visibleText.length || end < start) return { error: 'invalid' };
  const text = input.selectedText ?? visibleText.slice(start, end);
  if (!text.trim()) return { error: 'empty' };
  if (text.length > DOCUMENT_QUOTE_LIMIT) return { error: 'long' };
  const unique = visibleText.indexOf(text) === visibleText.lastIndexOf(text);
  const line = kind === 'txt' && !partial && visibleText === sourceText && visibleText.slice(start, end) === text && unique
    ? sourceText.slice(0, start).split(/\r\n|\r|\n/).length : undefined;
  const quote: DocumentQuote = { version: 1, text, prefix: visibleText.slice(Math.max(0, start - 128), start),
    suffix: visibleText.slice(end, end + 128), fingerprint, kind, ...(line === undefined ? {} : { line }) };
  return isDocumentQuote(quote) ? { quote } : { error: 'invalid' };
}
export function documentQuoteVerified(quote: DocumentQuote, fingerprint: string | undefined): boolean {
  return quote.kind === 'txt' && quote.line !== undefined && quote.fingerprint === fingerprint;
}
