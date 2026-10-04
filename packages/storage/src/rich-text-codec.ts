import type { RichTextCodec, RichTextCodecResult } from '@noutynotes/application';
import {
  RICH_TEXT_SCHEMA_VERSION,
  createEmptyRichTextDocument,
  isLinkUrl,
  isValidAssetRef,
  normalizeRichTextDocument,
  validateRichTextDocument,
} from '@noutynotes/domain';
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
import type {
  Break,
  Emphasis,
  Heading,
  Image,
  Link,
  List as MdList,
  ListItem as MdListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Table as MdTable,
  TableCell as MdTableCell,
  TableRow as MdTableRow,
  Text,
} from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';

const CAPTION_PREFIX = '<!-- nouty-caption:v1:';
const CAPTION_PATTERN = /^<!-- nouty-caption:v1:([^\s]+) -->$/;
const TABLE_WITHOUT_HEADER = '<!-- nouty-table:v1:no-header -->';

function sourceOf(node: RootContent, markdown: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === 'number' && typeof end === 'number' ? markdown.slice(start, end) : '';
}

function canonicalMarks(marks: ReadonlySet<RichTextMark>): readonly RichTextMark[] | undefined {
  const result: RichTextMark[] = [];
  if (marks.has('bold')) result.push('bold');
  if (marks.has('italic')) result.push('italic');
  return result.length === 0 ? undefined : result;
}

function mapLeafNodes(nodes: readonly PhrasingContent[], marks: ReadonlySet<RichTextMark>): RichTextLeaf[] | null {
  const result: RichTextLeaf[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const canonical = canonicalMarks(marks);
      result.push(canonical ? { type: 'text', text: node.value, marks: canonical } : { type: 'text', text: node.value });
      continue;
    }
    if (node.type === 'break') {
      result.push({ type: 'hard-break' });
      continue;
    }
    if (node.type === 'strong' || node.type === 'emphasis') {
      const nested = new Set(marks);
      nested.add(node.type === 'strong' ? 'bold' : 'italic');
      const children = mapLeafNodes(node.children, nested);
      if (!children) return null;
      result.push(...children);
      continue;
    }
    return null;
  }
  return result;
}

function mapInlineNodes(nodes: readonly PhrasingContent[], marks = new Set<RichTextMark>()): RichTextInline[] | null {
  const result: RichTextInline[] = [];
  for (const node of nodes) {
    if (node.type === 'link') {
      if (!isLinkUrl(node.url)) return null;
      const content = mapLeafNodes(node.children, marks);
      if (!content || content.length === 0) return null;
      result.push({ type: 'link', href: node.url, content });
      continue;
    }
    if (node.type === 'strong' || node.type === 'emphasis') {
      const nested = new Set(marks);
      nested.add(node.type === 'strong' ? 'bold' : 'italic');
      const children = mapInlineNodes(node.children, nested);
      if (!children) return null;
      result.push(...children);
      continue;
    }
    if (node.type === 'text') {
      const canonical = canonicalMarks(marks);
      result.push(canonical ? { type: 'text', text: node.value, marks: canonical } : { type: 'text', text: node.value });
      continue;
    }
    if (node.type === 'break') {
      result.push({ type: 'hard-break' });
      continue;
    }
    return null;
  }
  return result;
}

function mapList(node: MdList): RichTextList | null {
  const checks = node.children.map((item) => item.checked);
  const hasChecks = checks.some((checked) => typeof checked === 'boolean');
  if (hasChecks && checks.some((checked) => typeof checked !== 'boolean')) return null;
  const style: RichTextList['style'] = node.ordered ? 'ordered' : hasChecks ? 'checklist' : 'bullet';
  const items: RichTextListItem[] = [];
  for (const item of node.children) {
    const paragraph = item.children[0];
    if (paragraph?.type !== 'paragraph') return null;
    const content = mapInlineNodes(paragraph.children);
    if (!content) return null;
    const children: RichTextList[] = [];
    for (const child of item.children.slice(1)) {
      if (child.type !== 'list') return null;
      const nested = mapList(child);
      if (!nested) return null;
      children.push(nested);
    }
    items.push({
      content,
      ...(style === 'checklist' ? { checked: item.checked as boolean } : {}),
      ...(children.length === 0 ? {} : { children }),
    });
  }
  return {
    type: 'list',
    style,
    ...(style === 'ordered' && node.start !== null && node.start !== undefined ? { start: node.start } : {}),
    items,
  };
}

function mapTableCell(cell: MdTableCell): RichTextTableCell | null {
  const content = mapInlineNodes(cell.children);
  return content ? { content } : null;
}

function mapTableRow(row: MdTableRow): RichTextTableRow | null {
  const cells: RichTextTableCell[] = [];
  for (const cell of row.children) {
    const mapped = mapTableCell(cell);
    if (!mapped) return null;
    cells.push(mapped);
  }
  return { cells };
}

function mapTable(node: MdTable, requireBody = true): RichTextBlock | null {
  if (node.align?.some((alignment) => alignment !== null) || node.children.length < (requireBody ? 2 : 1)) return null;
  const header = mapTableRow(node.children[0] as MdTableRow);
  if (!header) return null;
  const rows: RichTextTableRow[] = [];
  for (const row of node.children.slice(1)) {
    const mapped = mapTableRow(row);
    if (!mapped) return null;
    rows.push(mapped);
  }
  return { type: 'table', header, rows };
}

function mapImage(node: Image): RichTextBlock | null {
  if (!isValidAssetRef(node.url)) return null;
  return {
    type: 'image',
    assetRef: node.url,
    alt: node.alt ?? '',
    ...(node.title ? { caption: [{ type: 'text', text: node.title }] } : {}),
  };
}

function mapBlock(node: RootContent): RichTextBlock | null {
  switch (node.type) {
    case 'paragraph': {
      if (node.children.length === 1 && node.children[0]?.type === 'image') return mapImage(node.children[0]);
      const content = mapInlineNodes(node.children);
      return content ? { type: 'paragraph', content } : null;
    }
    case 'heading': {
      const content = mapInlineNodes(node.children);
      return content ? { type: 'heading', level: node.depth, content } : null;
    }
    case 'list': return mapList(node);
    case 'table': return mapTable(node);
    default: return null;
  }
}

function captionFrom(node: RootContent): readonly RichTextInline[] | null {
  if (node.type !== 'html') return null;
  const match = CAPTION_PATTERN.exec(node.value);
  if (!match?.[1]) return null;
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(match[1]));
    return Array.isArray(decoded) ? decoded as readonly RichTextInline[] : null;
  } catch {
    return null;
  }
}

export function parseRichTextMarkdown(markdown: string): RichTextCodecResult<RichTextDocument> {
  if (markdown === '') return { ok: true, value: createEmptyRichTextDocument() };
  const root = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const blocks: RichTextBlock[] = [];
  for (let index = 0; index < root.children.length; index += 1) {
    const node = root.children[index] as RootContent;
    if (node.type === 'html' && node.value === TABLE_WITHOUT_HEADER) {
      const next = root.children[index + 1] as RootContent | undefined;
      const table = next?.type === 'table' ? mapTable(next, false) : null;
      if (table?.type === 'table' && table.header) {
        blocks.push({ type: 'table', rows: [table.header, ...table.rows] });
        index += 1;
        continue;
      }
    }
    const mapped = mapBlock(node);
    if (mapped?.type === 'image') {
      const next = root.children[index + 1] as RootContent | undefined;
      const caption = next ? captionFrom(next) : null;
      if (caption) {
        blocks.push({ ...mapped, caption });
        index += 1;
        continue;
      }
    }
    const source = sourceOf(node, markdown);
    blocks.push(mapped ?? { type: 'opaque-markdown', source });
  }
  const richText: RichTextDocument = { schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks };
  return normalizeRichTextDocument(richText);
}

function textNode(value: string): Text {
  return { type: 'text', value };
}

function leafToMdast(leaf: RichTextLeaf): PhrasingContent {
  if (leaf.type === 'hard-break') return { type: 'break' } satisfies Break;
  let node: PhrasingContent = textNode(leaf.text);
  if (leaf.marks?.includes('italic')) node = { type: 'emphasis', children: [node] } satisfies Emphasis;
  if (leaf.marks?.includes('bold')) node = { type: 'strong', children: [node] } satisfies Strong;
  return node;
}

function inlineToMdast(inline: RichTextInline): PhrasingContent {
  if (inline.type !== 'link') return leafToMdast(inline);
  return {
    type: 'link', url: inline.href, title: null, children: inline.content.map(leafToMdast),
  } satisfies Link;
}

function listToMdast(list: RichTextList): MdList {
  const children: MdListItem[] = list.items.map((item) => ({
    type: 'listItem',
    spread: false,
    checked: list.style === 'checklist' ? item.checked ?? false : null,
    children: [
      { type: 'paragraph', children: item.content.map(inlineToMdast) } satisfies Paragraph,
      ...(item.children ?? []).map(listToMdast),
    ],
  }));
  return {
    type: 'list',
    ordered: list.style === 'ordered',
    start: list.style === 'ordered' ? list.start ?? 1 : null,
    spread: false,
    children,
  };
}

function tableCellToMdast(cell: RichTextTableCell): MdTableCell {
  return { type: 'tableCell', children: cell.content.map(inlineToMdast) };
}

function tableRowToMdast(row: RichTextTableRow): MdTableRow {
  return { type: 'tableRow', children: row.cells.map(tableCellToMdast) };
}

function blockToMdast(block: Exclude<RichTextBlock, { readonly type: 'opaque-markdown' }>): RootContent {
  switch (block.type) {
    case 'paragraph': return { type: 'paragraph', children: block.content.map(inlineToMdast) } satisfies Paragraph;
    case 'heading': return { type: 'heading', depth: block.level, children: block.content.map(inlineToMdast) } satisfies Heading;
    case 'list': return listToMdast(block);
    case 'image': return {
      type: 'paragraph',
      children: [{ type: 'image', url: block.assetRef, alt: block.alt, title: null } satisfies Image],
    } satisfies Paragraph;
    case 'table': {
      const rows = [
        ...(block.header ? [tableRowToMdast(block.header)] : []),
        ...block.rows.map(tableRowToMdast),
      ];
      const width = rows[0]?.children.length ?? 0;
      return { type: 'table', align: Array.from({ length: width }, () => null), children: rows } satisfies MdTable;
    }
  }
}

function supportedMarkdown(block: Exclude<RichTextBlock, { readonly type: 'opaque-markdown' }>): string {
  const root: Root = { type: 'root', children: [blockToMdast(block)] };
  const output = toMarkdown(root, { extensions: [gfmToMarkdown()] });
  return output.endsWith('\n') ? output.slice(0, -1) : output;
}

function captionExtension(caption: readonly RichTextInline[]): string {
  const encoded = encodeURIComponent(JSON.stringify(caption)).replaceAll('-', '%2D');
  return `${CAPTION_PREFIX}${encoded} -->`;
}

export function serializeRichTextMarkdown(richText: RichTextDocument): RichTextCodecResult<string> {
  const checked = validateRichTextDocument(richText);
  if (!checked.ok) return checked;
  const output = checked.value.blocks.map((block) => {
    if (block.type === 'opaque-markdown') return block.source;
    const markdown = supportedMarkdown(block);
    if (block.type === 'table' && block.header === undefined) {
      return `${TABLE_WITHOUT_HEADER}\n\n${markdown}`;
    }
    return block.type === 'image' && block.caption !== undefined
      ? `${markdown}\n\n${captionExtension(block.caption)}`
      : markdown;
  }).join('\n\n');
  return { ok: true, value: output };
}

export const markdownRichTextCodec: RichTextCodec = {
  parse: parseRichTextMarkdown,
  serialize: serializeRichTextMarkdown,
};
