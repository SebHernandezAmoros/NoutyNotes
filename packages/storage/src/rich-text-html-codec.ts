import {
  MAX_RICH_TEXT_LIST_ITEMS,
  RICH_TEXT_SCHEMA_VERSION,
  isLinkUrl,
  normalizeRichTextDocument,
  validateRichTextDocument,
} from '@noutynotes/domain';
import type {
  AssetRef,
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
  RichTextLeaf,
  RichTextList,
  RichTextMark,
  RichTextTableRow,
} from '@noutynotes/domain';
import type { RichTextCodec, RichTextCodecResult } from '@noutynotes/application';

import { isPortableAssetRef } from './paths';

export const HTML_CONTENT_FORMAT = 'html' as const;
export const HTML_CONTENT_VERSION = 1 as const;
export const MAX_HTML_ORDERED_LIST_START = 1_000_000;

type HtmlChild = HtmlNode | string;

interface HtmlNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: HtmlChild[];
}

class HtmlCodecError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
  }
}

const allowedTags = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'br', 'a',
  'ul', 'ol', 'li', 'figure', 'img', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const voidTags = new Set(['br', 'img']);

function failure<T>(path: string, message: string, code = 'invalid-html'): RichTextCodecResult<T> {
  return { ok: false, issues: [{ code, path, message }] };
}

function decodeEntities(value: string, path: string): string {
  let output = '';
  for (let index = 0; index < value.length;) {
    if (value[index] !== '&') {
      output += value[index];
      index += 1;
      continue;
    }
    const end = value.indexOf(';', index + 1);
    if (end < 0 || end - index > 16) throw new HtmlCodecError(path, 'Entidad HTML incompleta o no admitida.');
    const entity = value.slice(index + 1, end);
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    let decoded = named[entity.toLowerCase()];
    if (decoded === undefined && /^#\d+$/.test(entity)) decoded = codePoint(Number(entity.slice(1)), path);
    if (decoded === undefined && /^#x[0-9a-f]+$/i.test(entity)) decoded = codePoint(Number.parseInt(entity.slice(2), 16), path);
    if (decoded === undefined) throw new HtmlCodecError(path, `Entidad HTML no admitida: &${entity};`);
    output += decoded;
    index = end + 1;
  }
  return output;
}

function codePoint(value: number, path: string): string {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)
    || (value < 32 && value !== 9 && value !== 10 && value !== 13) || value === 127) {
    throw new HtmlCodecError(path, 'Entidad numérica fuera del rango Unicode seguro.');
  }
  return String.fromCodePoint(value);
}

function tagEnd(source: string, start: number): number {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] as string;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}

function parseOpening(raw: string): { tag: string; attrs: Record<string, string>; selfClosing: boolean } {
  let source = raw.trim();
  const selfClosing = source.endsWith('/');
  if (selfClosing) source = source.slice(0, -1).trimEnd();
  const tagMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(source);
  if (!tagMatch) throw new HtmlCodecError('html', 'Etiqueta de apertura inválida.');
  const tag = tagMatch[0].toLowerCase();
  if (!allowedTags.has(tag)) throw new HtmlCodecError('html', `Etiqueta no admitida: <${tag}>.`);
  const attrs: Record<string, string> = {};
  let index = tagMatch[0].length;
  while (index < source.length) {
    const whitespace = /^\s+/.exec(source.slice(index));
    if (!whitespace) throw new HtmlCodecError(`html.${tag}`, 'Los atributos deben estar separados por espacios.');
    index += whitespace[0].length;
    if (index >= source.length) break;
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(source.slice(index));
    if (!nameMatch) throw new HtmlCodecError(`html.${tag}`, 'Nombre de atributo inválido.');
    const name = nameMatch[0].toLowerCase();
    index += nameMatch[0].length;
    if (source[index] !== '=') throw new HtmlCodecError(`html.${tag}[${name}]`, 'El atributo necesita un valor entre comillas.');
    index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw new HtmlCodecError(`html.${tag}[${name}]`, 'El atributo necesita comillas.');
    const end = source.indexOf(quote, index + 1);
    if (end < 0) throw new HtmlCodecError(`html.${tag}[${name}]`, 'Valor de atributo incompleto.');
    if (Object.hasOwn(attrs, name)) throw new HtmlCodecError(`html.${tag}[${name}]`, 'Atributo repetido.');
    attrs[name] = decodeEntities(source.slice(index + 1, end), `html.${tag}[${name}]`);
    index = end + 1;
  }
  return { tag, attrs, selfClosing };
}

function parseFragment(input: string): HtmlChild[] {
  const source = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  let index = 0;
  while (index < source.length) {
    if (source[index] !== '<') {
      const end = source.indexOf('<', index);
      const limit = end < 0 ? source.length : end;
      const text = decodeEntities(source.slice(index, limit), 'html.text');
      if (text) stack.at(-1)?.children.push(text);
      index = limit;
      continue;
    }
    if (source.startsWith('<!--', index) || source.startsWith('<!', index) || source.startsWith('<?', index)) {
      throw new HtmlCodecError('html', 'Comentarios y declaraciones no están admitidos.');
    }
    const end = tagEnd(source, index + 1);
    if (end < 0) throw new HtmlCodecError('html', 'Etiqueta sin cierre >.');
    const raw = source.slice(index + 1, end);
    if (raw.startsWith('/')) {
      const closing = raw.slice(1).trim().toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(closing) || voidTags.has(closing)) throw new HtmlCodecError('html', 'Etiqueta de cierre inválida.');
      const current = stack.at(-1);
      if (!current || current.tag !== closing) throw new HtmlCodecError('html', `Cierre </${closing}> fuera de orden.`);
      stack.pop();
    } else {
      const opening = parseOpening(raw);
      if (opening.selfClosing && !voidTags.has(opening.tag)) throw new HtmlCodecError(`html.${opening.tag}`, 'Solo br e img pueden autocerrarse.');
      const node: HtmlNode = { tag: opening.tag, attrs: opening.attrs, children: [] };
      stack.at(-1)?.children.push(node);
      if (!voidTags.has(node.tag)) stack.push(node);
    }
    index = end + 1;
  }
  if (stack.length !== 1) throw new HtmlCodecError('html', `Falta cerrar <${stack.at(-1)?.tag}>.`);
  return root.children;
}

function nodesOnly(children: readonly HtmlChild[], path: string): HtmlNode[] {
  return children.flatMap((child) => {
    if (typeof child !== 'string') return [child];
    if (child.trim() === '') return [];
    throw new HtmlCodecError(path, 'Texto fuera de una estructura admitida.');
  });
}

function exactAttrs(node: HtmlNode, allowed: readonly string[]): void {
  for (const name of Object.keys(node.attrs)) {
    if (!allowed.includes(name)) throw new HtmlCodecError(`html.${node.tag}[${name}]`, 'Atributo no admitido.');
  }
}

function normalizeHref(value: string): string | null {
  if (value !== value.trim() || /[\u0000-\u001f\u007f\s]/.test(value) || !isLinkUrl(value)) return null;
  return value.replace(/^(https?|mailto):/i, (scheme) => scheme.toLowerCase());
}

function safeAsset(value: string): value is AssetRef {
  return value.startsWith('assets/') && !value.includes('%') && isPortableAssetRef(value);
}

function inlineContent(children: readonly HtmlChild[], marks: readonly RichTextMark[] = [], insideLink = false): RichTextInline[] {
  const output: RichTextInline[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      if (child !== '') output.push(marks.length > 0 ? { type: 'text', text: child, marks } : { type: 'text', text: child });
      continue;
    }
    if (child.tag === 'br') {
      exactAttrs(child, []);
      output.push({ type: 'hard-break' });
      continue;
    }
    if (child.tag === 'strong' || child.tag === 'em') {
      exactAttrs(child, []);
      const mark: RichTextMark = child.tag === 'strong' ? 'bold' : 'italic';
      output.push(...inlineContent(child.children, [...new Set([...marks, mark])].sort((a, b) => a === 'bold' ? -1 : b === 'bold' ? 1 : 0), insideLink));
      continue;
    }
    if (child.tag === 'a' && !insideLink) {
      exactAttrs(child, ['href']);
      const href = child.attrs.href === undefined ? null : normalizeHref(child.attrs.href);
      if (!href) throw new HtmlCodecError('html.a[href]', 'El enlace debe usar HTTP, HTTPS o MAILTO de forma segura.');
      const content = inlineContent(child.children, marks, true);
      if (content.length === 0 || content.some((item) => item.type === 'link')) throw new HtmlCodecError('html.a', 'El enlace necesita contenido inline.');
      output.push({ type: 'link', href, content: content as RichTextLeaf[] });
      continue;
    }
    throw new HtmlCodecError(`html.${child.tag}`, 'Estructura inline no admitida.');
  }
  return output;
}

function parseList(node: HtmlNode): RichTextList {
  const checklist = node.tag === 'ul' && node.attrs['data-nouty-list'] === 'checklist';
  exactAttrs(node, node.tag === 'ol' ? ['start'] : checklist ? ['data-nouty-list'] : []);
  if (node.tag === 'ul' && node.attrs['data-nouty-list'] !== undefined && !checklist) {
    throw new HtmlCodecError('html.ul[data-nouty-list]', 'Solo se admite el valor checklist.');
  }
  let start: number | undefined;
  if (node.tag === 'ol' && node.attrs.start !== undefined) {
    if (!/^[1-9]\d*$/.test(node.attrs.start)) throw new HtmlCodecError('html.ol[start]', 'Debe ser un entero positivo.');
    start = Number(node.attrs.start);
    if (!Number.isSafeInteger(start) || start > MAX_HTML_ORDERED_LIST_START) throw new HtmlCodecError('html.ol[start]', 'El inicio supera el límite admitido.');
  }
  const children = nodesOnly(node.children, `html.${node.tag}`);
  if (children.length === 0 || children.length > MAX_RICH_TEXT_LIST_ITEMS || children.some((child) => child.tag !== 'li')) {
    throw new HtmlCodecError(`html.${node.tag}`, 'La lista debe contener elementos li válidos.');
  }
  return {
    type: 'list', style: checklist ? 'checklist' : node.tag === 'ol' ? 'ordered' : 'bullet',
    ...(start === undefined ? {} : { start }),
    items: children.map((item) => {
      exactAttrs(item, checklist ? ['data-nouty-checked'] : []);
      const checkedValue = item.attrs['data-nouty-checked'];
      if (checklist && checkedValue !== 'true' && checkedValue !== 'false') {
        throw new HtmlCodecError('html.li[data-nouty-checked]', 'El checklist debe indicar true o false.');
      }
      const nestedStart = item.children.findIndex((child) => typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'));
      const inlineChildren = nestedStart < 0 ? item.children : item.children.slice(0, nestedStart);
      const nestedChildren = nestedStart < 0 ? [] : item.children.slice(nestedStart);
      const nested = nodesOnly(nestedChildren, 'html.li');
      if (nested.some((child) => child.tag !== 'ul' && child.tag !== 'ol')) throw new HtmlCodecError('html.li', 'Después del texto solo se admiten listas anidadas.');
      return {
        content: inlineContent(inlineChildren),
        ...(checklist ? { checked: checkedValue === 'true' } : {}),
        ...(nested.length === 0 ? {} : { children: nested.map(parseList) }),
      };
    }),
  };
}

function parseFigure(node: HtmlNode): RichTextBlock {
  exactAttrs(node, []);
  const children = nodesOnly(node.children, 'html.figure');
  if (children.length < 1 || children.length > 2 || children[0]?.tag !== 'img' || (children[1] && children[1].tag !== 'figcaption')) {
    throw new HtmlCodecError('html.figure', 'Figure debe contener img y una leyenda opcional.');
  }
  const image = children[0] as HtmlNode;
  exactAttrs(image, ['alt', 'src']);
  if (image.attrs.alt === undefined) throw new HtmlCodecError('html.img[alt]', 'El texto alternativo es obligatorio.');
  if (!image.attrs.src || !safeAsset(image.attrs.src)) throw new HtmlCodecError('html.img[src]', 'La imagen debe ser una referencia portable dentro de assets/.');
  const caption = children[1];
  if (caption) exactAttrs(caption, []);
  return {
    type: 'image', assetRef: image.attrs.src, alt: image.attrs.alt,
    ...(caption ? { caption: inlineContent(caption.children) } : {}),
  };
}

function parseRow(node: HtmlNode, cellTag: 'th' | 'td'): RichTextTableRow {
  exactAttrs(node, []);
  const cells = nodesOnly(node.children, 'html.tr');
  if (cells.length === 0 || cells.some((cell) => cell.tag !== cellTag)) throw new HtmlCodecError('html.tr', `La fila debe contener celdas ${cellTag}.`);
  return { cells: cells.map((cell) => { exactAttrs(cell, []); return { content: inlineContent(cell.children) }; }) };
}

function parseTable(node: HtmlNode): RichTextBlock {
  exactAttrs(node, []);
  const sections = nodesOnly(node.children, 'html.table');
  if (sections.length < 1 || sections.length > 2 || !['thead', 'tbody'].includes(sections[0]?.tag ?? '') || sections.at(-1)?.tag !== 'tbody') {
    throw new HtmlCodecError('html.table', 'Table admite thead opcional seguido de tbody.');
  }
  const head = sections[0]?.tag === 'thead' ? sections[0] : undefined;
  const body = sections.at(-1) as HtmlNode;
  if (head) exactAttrs(head, []);
  exactAttrs(body, []);
  const headRows = head ? nodesOnly(head.children, 'html.thead') : [];
  if (headRows.length > 1 || headRows.some((row) => row.tag !== 'tr')) throw new HtmlCodecError('html.table', 'Thead admite una sola fila.');
  const rows = nodesOnly(body.children, 'html.tbody');
  if (rows.length === 0 || rows.some((row) => row.tag !== 'tr')) throw new HtmlCodecError('html.table', 'Tbody necesita filas tr.');
  const header = headRows[0] ? parseRow(headRows[0], 'th') : undefined;
  const parsedRows = rows.map((row) => parseRow(row, 'td'));
  const width = header?.cells.length ?? parsedRows[0]?.cells.length ?? 0;
  if (parsedRows.some((row) => row.cells.length !== width)) throw new HtmlCodecError('html.table', 'Todas las filas deben tener el mismo número de celdas.');
  return { type: 'table', ...(header ? { header } : {}), rows: parsedRows };
}

function parseBlock(node: HtmlNode): RichTextBlock {
  if (node.tag === 'p') { exactAttrs(node, []); return { type: 'paragraph', content: inlineContent(node.children) }; }
  if (/^h[1-6]$/.test(node.tag)) {
    exactAttrs(node, []);
    return { type: 'heading', level: Number(node.tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, content: inlineContent(node.children) };
  }
  if (node.tag === 'ul' || node.tag === 'ol') return parseList(node);
  if (node.tag === 'figure') return parseFigure(node);
  if (node.tag === 'table') return parseTable(node);
  throw new HtmlCodecError(`html.${node.tag}`, 'Bloque no admitido en la raíz.');
}

export function parseRichTextHtml(html: string): RichTextCodecResult<RichTextDocument> {
  try {
    const blocks = nodesOnly(parseFragment(html), 'html').map(parseBlock);
    if (blocks.length === 0) throw new HtmlCodecError('html', 'El documento debe contener al menos un bloque.');
    return normalizeRichTextDocument({ schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks });
  } catch (error) {
    return error instanceof HtmlCodecError ? failure(error.path, error.message) : failure('html', 'No se pudo interpretar el HTML.');
  }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function serializeInlines(inlines: readonly RichTextInline[]): string {
  return inlines.map((inline) => {
    if (inline.type === 'hard-break') return '<br>';
    if (inline.type === 'link') {
      const href = normalizeHref(inline.href);
      if (!href) throw new HtmlCodecError('document.link.href', 'El enlace no es seguro.');
      return `<a href="${escapeAttribute(href)}">${serializeInlines(inline.content)}</a>`;
    }
    let text = escapeText(inline.text);
    if (inline.marks?.includes('italic')) text = `<em>${text}</em>`;
    if (inline.marks?.includes('bold')) text = `<strong>${text}</strong>`;
    return text;
  }).join('');
}

function serializeList(list: RichTextList): string {
  const checklist = list.style === 'checklist';
  const tag = list.style === 'ordered' ? 'ol' : 'ul';
  const attr = checklist ? ' data-nouty-list="checklist"'
    : list.style === 'ordered' && list.start !== undefined ? ` start="${list.start}"` : '';
  const items = list.items.map((item) => {
    const checked = checklist ? ` data-nouty-checked="${item.checked ? 'true' : 'false'}"` : '';
    return `<li${checked}>${serializeInlines(item.content)}${(item.children ?? []).map(serializeList).join('')}</li>`;
  }).join('');
  return `<${tag}${attr}>${items}</${tag}>`;
}

function serializeRow(row: RichTextTableRow, cell: 'th' | 'td'): string {
  return `<tr>${row.cells.map((item) => `<${cell}>${serializeInlines(item.content)}</${cell}>`).join('')}</tr>`;
}

function serializeBlock(block: RichTextBlock, index: number): string {
  switch (block.type) {
    case 'paragraph': return `<p>${serializeInlines(block.content)}</p>`;
    case 'heading': return `<h${block.level}>${serializeInlines(block.content)}</h${block.level}>`;
    case 'list': return serializeList(block);
    case 'image':
      if (!safeAsset(block.assetRef)) throw new HtmlCodecError(`document.blocks[${index}].assetRef`, 'La imagen debe permanecer dentro de assets/.');
      return `<figure><img alt="${escapeAttribute(block.alt)}" src="${escapeAttribute(block.assetRef)}">${
        block.caption === undefined ? '' : `<figcaption>${serializeInlines(block.caption)}</figcaption>`}</figure>`;
    case 'table': return `<table>${block.header ? `<thead>${serializeRow(block.header, 'th')}</thead>` : ''}<tbody>${block.rows.map((row) => serializeRow(row, 'td')).join('')}</tbody></table>`;
    case 'opaque-markdown': throw new HtmlCodecError(`document.blocks[${index}]`, 'HTML v1 no admite bloques Markdown opacos.');
  }
}

export function serializeRichTextHtml(document: RichTextDocument): RichTextCodecResult<string> {
  const checked = validateRichTextDocument(document);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  try {
    return { ok: true, value: document.blocks.map(serializeBlock).join('\n') };
  } catch (error) {
    if (error instanceof HtmlCodecError) return failure(error.path, error.message, 'unsupported-rich-text');
    return failure('document', 'No se pudo serializar el documento.', 'unsupported-rich-text');
  }
}

export const htmlRichTextCodec: RichTextCodec = {
  parse: parseRichTextHtml,
  serialize: serializeRichTextHtml,
};
