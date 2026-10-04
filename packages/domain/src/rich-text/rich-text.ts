import { checkAssetRef } from '../assets/asset-ref';
import type { AssetRef } from '../assets/asset-ref';
import { isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { isLinkUrl } from '../cards/field-values';
import { collectPlainDataIssues } from '../shared/plain-data';

export const RICH_TEXT_SCHEMA_VERSION = 1 as const;
export const MAX_RICH_TEXT_BLOCKS = 10_000;
export const MAX_RICH_TEXT_INLINES = 10_000;
export const MAX_RICH_TEXT_TEXT_LENGTH = 1_000_000;
export const MAX_RICH_TEXT_LIST_ITEMS = 10_000;
export const MAX_RICH_TEXT_LIST_DEPTH = 8;
export const MAX_RICH_TEXT_TABLE_ROWS = 1_000;
export const MAX_RICH_TEXT_TABLE_COLUMNS = 100;

export const richTextMarks = ['bold', 'italic'] as const;
export type RichTextMark = (typeof richTextMarks)[number];
export type RichTextHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type RichTextListStyle = 'bullet' | 'ordered' | 'checklist';

export interface RichTextDocument {
  readonly schemaVersion: typeof RICH_TEXT_SCHEMA_VERSION;
  readonly blocks: readonly RichTextBlock[];
}

export interface RichTextTextRun {
  readonly type: 'text';
  readonly text: string;
  readonly marks?: readonly RichTextMark[];
}

export interface RichTextHardBreak {
  readonly type: 'hard-break';
}

export interface RichTextLink {
  readonly type: 'link';
  readonly href: string;
  readonly content: readonly RichTextLeaf[];
}

export type RichTextLeaf = RichTextTextRun | RichTextHardBreak;
export type RichTextInline = RichTextLeaf | RichTextLink;

export interface RichTextParagraph {
  readonly type: 'paragraph';
  readonly content: readonly RichTextInline[];
}

export interface RichTextHeading {
  readonly type: 'heading';
  readonly level: RichTextHeadingLevel;
  readonly content: readonly RichTextInline[];
}

export interface RichTextListItem {
  readonly content: readonly RichTextInline[];
  readonly checked?: boolean;
  readonly children?: readonly RichTextList[];
}

export interface RichTextList {
  readonly type: 'list';
  readonly style: RichTextListStyle;
  readonly start?: number;
  readonly items: readonly RichTextListItem[];
}

export interface RichTextImage {
  readonly type: 'image';
  readonly assetRef: AssetRef;
  readonly alt: string;
  readonly caption?: readonly RichTextInline[];
}

export interface RichTextTableCell {
  readonly content: readonly RichTextInline[];
}

export interface RichTextTableRow {
  readonly cells: readonly RichTextTableCell[];
}

export interface RichTextTable {
  readonly type: 'table';
  readonly header?: RichTextTableRow;
  readonly rows: readonly RichTextTableRow[];
}

export interface RichTextOpaqueMarkdown {
  readonly type: 'opaque-markdown';
  /** Fragmento exacto: el codec de P03 debe devolverlo sin reinterpretarlo. */
  readonly source: string;
}

export type RichTextBlock =
  | RichTextParagraph
  | RichTextHeading
  | RichTextList
  | RichTextImage
  | RichTextTable
  | RichTextOpaqueMarkdown;

const documentKeys = ['schemaVersion', 'blocks'];
const documentPath = 'document';
const paragraphKeys = ['type', 'content'];
const headingKeys = ['type', 'level', 'content'];
const imageKeys = ['type', 'assetRef', 'alt', 'caption'];
const tableKeys = ['type', 'header', 'rows'];
const tableRowKeys = ['cells'];
const tableCellKeys = ['content'];
const opaqueKeys = ['type', 'source'];
const textKeys = ['type', 'text', 'marks'];
const breakKeys = ['type'];
const linkKeys = ['type', 'href', 'content'];

function checkKnownKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], path: string, issues: DomainIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue('unknown-property', `${path}.${key}`, `Propiedad no admitida: "${key}".`));
  }
}

function checkArray(value: unknown, path: string, issues: DomainIssue[], maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    issues.push(issue('invalid-value', path, 'Debe ser una lista.'));
    return [];
  }
  if (value.length > maximum) issues.push(issue('invalid-value', path, `No puede superar ${maximum} elementos.`));
  return value;
}

function checkText(value: unknown, path: string, issues: DomainIssue[], allowEmpty: boolean): void {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    issues.push(issue('invalid-value', path, allowEmpty ? 'Debe ser texto.' : 'Debe ser texto no vacío.'));
    return;
  }
  if (value.length > MAX_RICH_TEXT_TEXT_LENGTH) {
    issues.push(issue('invalid-value', path, `No puede superar ${MAX_RICH_TEXT_TEXT_LENGTH} caracteres.`));
  }
}

function collectTextRunIssues(input: Readonly<Record<string, unknown>>, path: string, issues: DomainIssue[]): void {
  checkKnownKeys(input, textKeys, path, issues);
  checkText(input.text, `${path}.text`, issues, false);
  if (input.marks === undefined) return;
  const marks = checkArray(input.marks, `${path}.marks`, issues, richTextMarks.length);
  let previous = -1;
  marks.forEach((mark, index) => {
    const position = richTextMarks.indexOf(mark as RichTextMark);
    if (position < 0) issues.push(issue('invalid-value', `${path}.marks[${index}]`, 'Debe ser "bold" o "italic".'));
    else if (position <= previous) issues.push(issue('invalid-value', `${path}.marks`, 'Las marcas deben ser únicas y estar en orden canónico.'));
    previous = position;
  });
}

function collectLeafIssues(input: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('invalid-value', path, 'Debe ser un nodo inline.'));
    return;
  }
  if (input.type === 'text') collectTextRunIssues(input, path, issues);
  else if (input.type === 'hard-break') checkKnownKeys(input, breakKeys, path, issues);
  else issues.push(issue('invalid-value', `${path}.type`, 'Debe ser texto o salto explícito.'));
}

function collectInlineIssues(input: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('invalid-value', path, 'Debe ser un nodo inline.'));
    return;
  }
  if (input.type !== 'link') {
    collectLeafIssues(input, path, issues);
    return;
  }
  checkKnownKeys(input, linkKeys, path, issues);
  if (!isLinkUrl(input.href)) issues.push(issue('invalid-value', `${path}.href`, 'Debe ser un enlace http(s) o mailto.'));
  const content = checkArray(input.content, `${path}.content`, issues, MAX_RICH_TEXT_INLINES);
  if (content.length === 0) issues.push(issue('invalid-value', `${path}.content`, 'El enlace debe tener contenido.'));
  content.forEach((child, index) => collectLeafIssues(child, `${path}.content[${index}]`, issues));
}

function collectInlineListIssues(value: unknown, path: string, issues: DomainIssue[]): void {
  checkArray(value, path, issues, MAX_RICH_TEXT_INLINES)
    .forEach((inline, index) => collectInlineIssues(inline, `${path}[${index}]`, issues));
}

function collectListIssues(input: Readonly<Record<string, unknown>>, path: string, issues: DomainIssue[], depth: number): void {
  if (depth > MAX_RICH_TEXT_LIST_DEPTH) {
    issues.push(issue('invalid-value', path, `La anidación de listas no puede superar ${MAX_RICH_TEXT_LIST_DEPTH} niveles.`));
    return;
  }
  const style = input.style;
  const ordered = style === 'ordered';
  checkKnownKeys(input, ordered ? ['type', 'style', 'start', 'items'] : ['type', 'style', 'items'], path, issues);
  if (style !== 'bullet' && style !== 'ordered' && style !== 'checklist') {
    issues.push(issue('invalid-value', `${path}.style`, 'Debe ser "bullet", "ordered" o "checklist".'));
  }
  if (ordered && input.start !== undefined && (!Number.isSafeInteger(input.start) || (input.start as number) < 1)) {
    issues.push(issue('invalid-value', `${path}.start`, 'Debe ser un entero positivo.'));
  }
  const items = checkArray(input.items, `${path}.items`, issues, MAX_RICH_TEXT_LIST_ITEMS);
  if (items.length === 0) issues.push(issue('invalid-value', `${path}.items`, 'La lista debe contener al menos un elemento.'));
  items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isRecord(item)) {
      issues.push(issue('invalid-value', itemPath, 'Debe ser un elemento de lista.'));
      return;
    }
    checkKnownKeys(item, style === 'checklist' ? ['content', 'checked', 'children'] : ['content', 'children'], itemPath, issues);
    if (style === 'checklist' && typeof item.checked !== 'boolean') {
      issues.push(issue('invalid-value', `${itemPath}.checked`, 'Un checklist debe indicar su estado.'));
    }
    collectInlineListIssues(item.content, `${itemPath}.content`, issues);
    if (item.children !== undefined) {
      const children = checkArray(item.children, `${itemPath}.children`, issues, MAX_RICH_TEXT_LIST_ITEMS);
      if (children.length === 0) issues.push(issue('invalid-value', `${itemPath}.children`, 'La lista anidada no puede estar vacía.'));
      children.forEach((child, childIndex) => {
        const childPath = `${itemPath}.children[${childIndex}]`;
        if (!isRecord(child) || child.type !== 'list') {
          issues.push(issue('invalid-value', childPath, 'Debe ser una lista anidada.'));
          return;
        }
        collectListIssues(child, childPath, issues, depth + 1);
      });
    }
  });
}

function collectTableRowIssues(input: unknown, path: string, issues: DomainIssue[]): number {
  if (!isRecord(input)) {
    issues.push(issue('invalid-value', path, 'Debe ser una fila.'));
    return 0;
  }
  checkKnownKeys(input, tableRowKeys, path, issues);
  const cells = checkArray(input.cells, `${path}.cells`, issues, MAX_RICH_TEXT_TABLE_COLUMNS);
  if (cells.length === 0) issues.push(issue('invalid-value', `${path}.cells`, 'La fila debe contener al menos una celda.'));
  cells.forEach((cell, index) => {
    const cellPath = `${path}.cells[${index}]`;
    if (!isRecord(cell)) {
      issues.push(issue('invalid-value', cellPath, 'Debe ser una celda.'));
      return;
    }
    checkKnownKeys(cell, tableCellKeys, cellPath, issues);
    collectInlineListIssues(cell.content, `${cellPath}.content`, issues);
  });
  return cells.length;
}

function collectBlockIssues(input: unknown, path: string, issues: DomainIssue[]): void {
  if (!isRecord(input)) {
    issues.push(issue('invalid-value', path, 'Debe ser un bloque.'));
    return;
  }
  switch (input.type) {
    case 'paragraph':
      checkKnownKeys(input, paragraphKeys, path, issues);
      collectInlineListIssues(input.content, `${path}.content`, issues);
      return;
    case 'heading':
      checkKnownKeys(input, headingKeys, path, issues);
      if (!Number.isInteger(input.level) || (input.level as number) < 1 || (input.level as number) > 6) {
        issues.push(issue('invalid-value', `${path}.level`, 'Debe ser un nivel entre 1 y 6.'));
      }
      collectInlineListIssues(input.content, `${path}.content`, issues);
      return;
    case 'list':
      collectListIssues(input, path, issues, 1);
      return;
    case 'image':
      checkKnownKeys(input, imageKeys, path, issues);
      checkAssetRef(input.assetRef, `${path}.assetRef`, issues);
      checkText(input.alt, `${path}.alt`, issues, true);
      if (input.caption !== undefined) collectInlineListIssues(input.caption, `${path}.caption`, issues);
      return;
    case 'table': {
      checkKnownKeys(input, tableKeys, path, issues);
      const rows = checkArray(input.rows, `${path}.rows`, issues, MAX_RICH_TEXT_TABLE_ROWS);
      if (rows.length === 0) issues.push(issue('invalid-value', `${path}.rows`, 'La tabla debe contener al menos una fila.'));
      let width = input.header === undefined ? 0 : collectTableRowIssues(input.header, `${path}.header`, issues);
      rows.forEach((row, index) => {
        const rowPath = `${path}.rows[${index}]`;
        const rowWidth = collectTableRowIssues(row, rowPath, issues);
        if (width === 0) width = rowWidth;
        else if (rowWidth !== 0 && rowWidth !== width) issues.push(issue('invalid-value', `${rowPath}.cells`, `Debe tener ${width} celdas.`));
      });
      return;
    }
    case 'opaque-markdown':
      checkKnownKeys(input, opaqueKeys, path, issues);
      checkText(input.source, `${path}.source`, issues, false);
      return;
    default:
      issues.push(issue('invalid-value', `${path}.type`, 'Tipo de bloque no admitido.'));
  }
}

/** Valida datos externos sin transformarlos ni ejecutar contenido. */
export function validateRichTextDocument(input: unknown): ValidationResult<RichTextDocument> {
  const document = input as RichTextDocument;
  const issues: DomainIssue[] = [];
  collectPlainDataIssues(input, documentPath, issues);
  if (issues.length > 0) return resultOf(document, issues);
  if (!isRecord(input)) return resultOf(document, [issue('invalid-value', documentPath, 'Debe ser un objeto.')]);
  checkKnownKeys(input, documentKeys, documentPath, issues);
  if (input.schemaVersion !== RICH_TEXT_SCHEMA_VERSION) {
    issues.push(issue('unsupported-schema-version', `${documentPath}.schemaVersion`, `Solo se admite la versión ${RICH_TEXT_SCHEMA_VERSION}.`));
  }
  const blocksPath = `${documentPath}.blocks`;
  const blocks = checkArray(input.blocks, blocksPath, issues, MAX_RICH_TEXT_BLOCKS);
  if (blocks.length === 0) issues.push(issue('invalid-value', blocksPath, 'El documento debe contener al menos un bloque.'));
  blocks.forEach((block, index) => collectBlockIssues(block, `${blocksPath}[${index}]`, issues));
  return resultOf(document, issues);
}

export function createEmptyRichTextDocument(): RichTextDocument {
  return { schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks: [{ type: 'paragraph', content: [] }] };
}

function canonicalMarks(marks: readonly RichTextMark[] | undefined): readonly RichTextMark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const result = richTextMarks.filter((mark) => marks.includes(mark));
  return result.length === 0 ? undefined : result;
}

function sameMarks(left: readonly RichTextMark[] | undefined, right: readonly RichTextMark[] | undefined): boolean {
  return (left?.length ?? 0) === (right?.length ?? 0) && (left ?? []).every((mark, index) => mark === right?.[index]);
}

function normalizeLeaf(leaf: RichTextLeaf): RichTextLeaf | undefined {
  if (leaf.type === 'hard-break') return leaf;
  if (leaf.text.length === 0) return undefined;
  const marks = canonicalMarks(leaf.marks);
  return marks ? { type: 'text', text: leaf.text, marks } : { type: 'text', text: leaf.text };
}

function normalizeInlines(inlines: readonly RichTextInline[]): readonly RichTextInline[] {
  const output: RichTextInline[] = [];
  for (const inline of inlines) {
    const normalized = inline.type === 'link'
      ? { ...inline, content: inline.content.map(normalizeLeaf).filter((leaf): leaf is RichTextLeaf => leaf !== undefined) }
      : normalizeLeaf(inline);
    if (!normalized) continue;
    const previous = output.at(-1);
    if (previous?.type === 'text' && normalized.type === 'text' && sameMarks(previous.marks, normalized.marks)) {
      output[output.length - 1] = normalized.marks
        ? { type: 'text', text: previous.text + normalized.text, marks: normalized.marks }
        : { type: 'text', text: previous.text + normalized.text };
    } else output.push(normalized);
  }
  return output;
}

function normalizeList(list: RichTextList): RichTextList {
  return {
    ...list,
    items: list.items.map((item) => ({
      ...item,
      content: normalizeInlines(item.content),
      ...(item.children === undefined ? {} : { children: item.children.map(normalizeList) }),
    })),
  };
}

function normalizeRow(row: RichTextTableRow): RichTextTableRow {
  return { cells: row.cells.map((cell) => ({ content: normalizeInlines(cell.content) })) };
}

function normalizeBlock(block: RichTextBlock): RichTextBlock {
  switch (block.type) {
    case 'paragraph':
    case 'heading': return { ...block, content: normalizeInlines(block.content) };
    case 'list': return normalizeList(block);
    case 'image': return block.caption === undefined ? block : { ...block, caption: normalizeInlines(block.caption) };
    case 'table': return {
      ...block,
      ...(block.header === undefined ? {} : { header: normalizeRow(block.header) }),
      rows: block.rows.map(normalizeRow),
    };
    case 'opaque-markdown': return block;
  }
}

/** Canonicaliza nodos ya tipados y valida el resultado; no interpreta Markdown ni HTML. */
export function normalizeRichTextDocument(richText: RichTextDocument): ValidationResult<RichTextDocument> {
  const plainIssues: DomainIssue[] = [];
  collectPlainDataIssues(richText, documentPath, plainIssues);
  if (plainIssues.length > 0) return resultOf(richText, plainIssues);
  const normalized: RichTextDocument = {
    schemaVersion: richText.schemaVersion,
    blocks: richText.blocks.map(normalizeBlock),
  };
  return validateRichTextDocument(normalized);
}
