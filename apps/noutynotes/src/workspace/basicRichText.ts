import type { RichTextCodec } from '@noutynotes/application';
import type { RichTextDocument, RichTextInline } from '@noutynotes/domain';

/** Alcance visual compartido por los editores básicos de P04/P05. */
export function isBasicRichTextDocument(document: RichTextDocument): boolean {
  return document.blocks.every((block) => block.type === 'paragraph'
    && block.content.every((inline) => inline.type === 'text' || inline.type === 'hard-break'));
}

function supportsWebInline(inline: RichTextInline): boolean {
  if (inline.type === 'text' || inline.type === 'hard-break') return true;
  return inline.type === 'link' && 'content' in inline && Array.isArray(inline.content)
    && inline.content.every((leaf) => leaf.type === 'text' || leaf.type === 'hard-break');
}

function supportsWebList(list: Extract<RichTextDocument['blocks'][number], { readonly type: 'list' }>): boolean {
  return list.items.every((item) => item.content.every(supportsWebInline)
    && (item.children ?? []).every(supportsWebList));
}

function supportsWebTable(table: Extract<RichTextDocument['blocks'][number], { readonly type: 'table' }>): boolean {
  const rows = [...(table.header ? [table.header] : []), ...table.rows];
  const width = rows[0]?.cells.length ?? 0;
  return table.rows.length > 0 && width > 0
    && rows.every((row) => row.cells.length === width && row.cells.every((cell) => cell.content.every(supportsWebInline)));
}

/** Alcance visual web de P07. Android conserva el subconjunto básico de P05. */
export function isWebRichTextDocument(document: RichTextDocument): boolean {
  return document.blocks.every((block) => {
    if (block.type === 'paragraph' || block.type === 'heading') return block.content.every(supportsWebInline);
    if (block.type === 'list') return supportsWebList(block);
    if (block.type === 'table') return supportsWebTable(block);
    return block.type === 'image' && (block.caption ?? []).every(supportsWebInline);
  });
}

/** Android edita el subconjunto básico y muestra sin transformar el alcance web avanzado. */
export function isNativeRichTextDocument(document: RichTextDocument): boolean {
  return document.blocks.every((block) => block.type === 'opaque-markdown'
    || isWebRichTextDocument({ schemaVersion: document.schemaVersion, blocks: [block] }));
}

/**
 * Convierte el Markdown durable al subconjunto que el editor visual básico puede representar sin
 * perder información. Las estructuras avanzadas siguen usando su vista Markdown existente.
 */
export function parseBasicRichText(codec: RichTextCodec, markdown: string): RichTextDocument | null {
  const parsed = codec.parse(markdown);
  return parsed.ok && isBasicRichTextDocument(parsed.value) ? parsed.value : null;
}

/** Convierte el Markdown al alcance de lectura/edición web P07 sin aceptar imágenes, tablas u opacos. */
export function parseWebRichText(codec: RichTextCodec, markdown: string): RichTextDocument | null {
  const parsed = codec.parse(markdown);
  return parsed.ok && isWebRichTextDocument(parsed.value) ? parsed.value : null;
}
