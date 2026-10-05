import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
} from 'lexical';

import { RICH_TEXT_SCHEMA_VERSION } from '@noutynotes/domain';
import type { RichTextDocument, RichTextInline, RichTextMark } from '@noutynotes/domain';

import { isBasicRichTextDocument } from './basicRichText';

/** Debe ejecutarse dentro de `editor.update`. */
export function $loadBasicRichTextDocument(document: RichTextDocument): void {
  if (!isBasicRichTextDocument(document)) throw new Error('El documento contiene bloques fuera del alcance del editor visual básico.');
  const root = $getRoot();
  root.clear();
  for (const block of document.blocks) {
    if (block.type !== 'paragraph') continue;
    const paragraph = $createParagraphNode();
    for (const inline of block.content) {
      if (inline.type === 'hard-break') {
        paragraph.append($createLineBreakNode());
        continue;
      }
      if (inline.type !== 'text') continue;
      const text = $createTextNode(inline.text);
      for (const mark of inline.marks ?? []) text.toggleFormat(mark);
      paragraph.append(text);
    }
    root.append(paragraph);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

/** Debe ejecutarse dentro de `EditorState.read` o `editor.update`. */
export function $readBasicRichTextDocument(): RichTextDocument | null {
  const blocks: RichTextDocument['blocks'][number][] = [];
  for (const node of $getRoot().getChildren()) {
    if (!$isParagraphNode(node)) return null;
    const content: RichTextInline[] = [];
    for (const child of node.getChildren()) {
      if ($isLineBreakNode(child)) {
        content.push({ type: 'hard-break' });
        continue;
      }
      if (!$isTextNode(child)) return null;
      const marks: RichTextMark[] = [];
      if (child.hasFormat('bold')) marks.push('bold');
      if (child.hasFormat('italic')) marks.push('italic');
      content.push(marks.length === 0
        ? { type: 'text', text: child.getTextContent() }
        : { type: 'text', text: child.getTextContent(), marks });
    }
    blocks.push({ type: 'paragraph', content });
  }
  return {
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    blocks: blocks.length === 0 ? [{ type: 'paragraph', content: [] }] : blocks,
  };
}
