import { isLinkUrl, normalizeRichTextDocument, RICH_TEXT_SCHEMA_VERSION } from '@noutynotes/domain';
import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
  RichTextLeaf,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextTableCell,
  RichTextTableRow,
} from '@noutynotes/domain';

const ACTIVE_ELEMENTS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE',
  'FORM', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'AUDIO', 'VIDEO', 'SOURCE',
  'TRACK', 'IMG', 'PICTURE', 'CANVAS', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE',
]);
const MAX_TABLE_ROWS = 20;
const MAX_TABLE_COLUMNS = 12;

function marksOf(marks: ReadonlySet<RichTextMark>): readonly RichTextMark[] | undefined {
  const result: RichTextMark[] = [];
  if (marks.has('bold')) result.push('bold');
  if (marks.has('italic')) result.push('italic');
  return result.length === 0 ? undefined : result;
}

function leavesOf(node: Node, marks = new Set<RichTextMark>()): RichTextLeaf[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text === '') return [];
    const leafMarks = marksOf(marks);
    return [leafMarks ? { type: 'text', text, marks: leafMarks } : { type: 'text', text }];
  }
  if (!(node instanceof HTMLElement) || ACTIVE_ELEMENTS.has(node.tagName)) return [];
  if (node.tagName === 'BR') return [{ type: 'hard-break' }];
  const nested = new Set(marks);
  if (node.tagName === 'STRONG' || node.tagName === 'B') nested.add('bold');
  if (node.tagName === 'EM' || node.tagName === 'I') nested.add('italic');
  return Array.from(node.childNodes).flatMap((child) => leavesOf(child, nested));
}

function inlinesOf(node: Node, marks = new Set<RichTextMark>()): RichTextInline[] {
  if (node.nodeType === Node.TEXT_NODE) return leavesOf(node, marks);
  if (!(node instanceof HTMLElement) || ACTIVE_ELEMENTS.has(node.tagName)) return [];
  if (node.tagName === 'A') {
    const content = Array.from(node.childNodes).flatMap((child) => leavesOf(child, marks));
    const href = node.getAttribute('href')?.trim() ?? '';
    return isLinkUrl(href) && content.length > 0 ? [{ type: 'link', href, content }] : content;
  }
  const nested = new Set(marks);
  if (node.tagName === 'STRONG' || node.tagName === 'B') nested.add('bold');
  if (node.tagName === 'EM' || node.tagName === 'I') nested.add('italic');
  if (node.tagName === 'BR') return [{ type: 'hard-break' }];
  return Array.from(node.childNodes).flatMap((child) => inlinesOf(child, nested));
}

function listOf(node: HTMLElement): RichTextList | null {
  const style: RichTextList['style'] = node.tagName === 'OL' ? 'ordered' : 'bullet';
  const items: RichTextListItem[] = [];
  for (const item of Array.from(node.children)) {
    if (!(item instanceof HTMLElement) || item.tagName !== 'LI') continue;
    const nestedLists = Array.from(item.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL'));
    const content = Array.from(item.childNodes)
      .filter((child) => !(child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')))
      .flatMap((child) => inlinesOf(child));
    const children = nestedLists.map(listOf).filter((child): child is RichTextList => child !== null);
    items.push({ content, ...(children.length > 0 ? { children } : {}) });
  }
  if (items.length === 0) return null;
  const start = node.tagName === 'OL' ? Number(node.getAttribute('start') ?? '1') : 1;
  return {
    type: 'list', style,
    ...(style === 'ordered' && Number.isInteger(start) && start > 1 ? { start } : {}),
    items,
  };
}

function rowOf(row: HTMLTableRowElement): RichTextTableRow | null {
  const cells = Array.from(row.cells);
  if (cells.length === 0 || cells.length > MAX_TABLE_COLUMNS) return null;
  return { cells: cells.map((cell): RichTextTableCell => ({ content: inlinesOf(cell) })) };
}

function tableOf(table: HTMLTableElement): RichTextBlock | null {
  const rows = Array.from(table.rows).slice(0, MAX_TABLE_ROWS + 1);
  if (rows.length === 0 || rows.length > MAX_TABLE_ROWS) return null;
  const mapped = rows.map(rowOf);
  if (mapped.some((row) => row === null)) return null;
  const safeRows = mapped as RichTextTableRow[];
  const width = safeRows[0]?.cells.length ?? 0;
  if (width === 0 || safeRows.some((row) => row.cells.length !== width)) return null;
  const firstIsHeader = Array.from(rows[0]?.cells ?? []).every((cell) => cell.tagName === 'TH');
  if (firstIsHeader && safeRows.length > 1) return { type: 'table', header: safeRows[0] as RichTextTableRow, rows: safeRows.slice(1) };
  return { type: 'table', rows: safeRows };
}

function textParagraph(node: Node): RichTextBlock | null {
  const content = inlinesOf(node);
  return content.length > 0 ? { type: 'paragraph', content } : null;
}

function blocksOf(body: HTMLElement): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  let loose: RichTextInline[] = [];
  const flushLoose = () => {
    if (loose.length > 0) blocks.push({ type: 'paragraph', content: loose });
    loose = [];
  };
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { loose.push(...inlinesOf(child)); continue; }
    if (!(child instanceof HTMLElement) || ACTIVE_ELEMENTS.has(child.tagName)) continue;
    if (/^H[1-6]$/.test(child.tagName)) {
      flushLoose();
      blocks.push({ type: 'heading', level: Number(child.tagName.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, content: inlinesOf(child) });
      continue;
    }
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      flushLoose();
      const list = listOf(child);
      if (list) blocks.push(list);
      continue;
    }
    if (child.tagName === 'TABLE') {
      flushLoose();
      const table = tableOf(child as HTMLTableElement);
      const fallback = table ?? textParagraph(child);
      if (fallback) blocks.push(fallback);
      continue;
    }
    if (['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE'].includes(child.tagName)) {
      flushLoose();
      const paragraph = textParagraph(child);
      if (paragraph) blocks.push(paragraph);
      continue;
    }
    loose.push(...inlinesOf(child));
  }
  flushLoose();
  return blocks;
}

function plainTextDocument(text: string): RichTextDocument {
  const blocks: RichTextBlock[] = text.replaceAll('\r\n', '\n').split('\n').map((line) => ({
    type: 'paragraph', content: line === '' ? [] : [{ type: 'text', text: line }],
  }));
  return { schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', content: [] }] };
}

/** Convierte el portapapeles web mediante lista blanca; nunca devuelve HTML ni atributos activos. */
export function parsePastedRichText(html: string, plainText: string): RichTextDocument {
  if (html.trim() === '') return plainTextDocument(plainText);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const candidate: RichTextDocument = { schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks: blocksOf(parsed.body) };
  const normalized = normalizeRichTextDocument(candidate.blocks.length > 0 ? candidate : plainTextDocument(plainText));
  return normalized.ok ? normalized.value : plainTextDocument(plainText);
}
