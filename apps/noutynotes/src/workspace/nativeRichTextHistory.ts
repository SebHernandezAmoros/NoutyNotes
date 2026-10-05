const HISTORY_LIMIT = 100;

export interface NativeRichTextHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

export function createNativeHistory(markdown: string): NativeRichTextHistory {
  return { entries: [markdown], index: 0 };
}

export function recordNativeHistory(history: NativeRichTextHistory, markdown: string): NativeRichTextHistory {
  if (history.entries[history.index] === markdown) return history;
  const next = [...history.entries.slice(0, history.index + 1), markdown];
  const entries = next.slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export function stepNativeHistory(history: NativeRichTextHistory, direction: 'undo' | 'redo'):
  { readonly history: NativeRichTextHistory; readonly markdown: string } | null {
  const index = history.index + (direction === 'undo' ? -1 : 1);
  const markdown = history.entries[index];
  if (markdown === undefined) return null;
  return { history: { entries: history.entries, index }, markdown };
}
