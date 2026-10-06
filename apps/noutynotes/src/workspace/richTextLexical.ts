import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list';
import type { ListNode, ListType } from '@lexical/list';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
} from 'lexical';
import type { ElementNode, LexicalNode } from 'lexical';

import { RICH_TEXT_SCHEMA_VERSION } from '@noutynotes/domain';
import type { RichTextDocument, RichTextInline, RichTextLeaf, RichTextList, RichTextListItem, RichTextMark } from '@noutynotes/domain';

import { isBasicRichTextDocument } from './basicRichText';
import { $createRichTextImageNode, $isRichTextImageNode } from './RichTextImageNode.web';

function lexicalLeaf(leaf: RichTextLeaf): LexicalNode {
  if (leaf.type === 'hard-break') return $createLineBreakNode();
  const text = $createTextNode(leaf.text);
  for (const mark of leaf.marks ?? []) text.toggleFormat(mark);
  return text;
}

function appendInlines(parent: ElementNode, inlines: readonly RichTextInline[]): void {
  for (const inline of inlines) {
    if (inline.type === 'link') {
      const link = $createLinkNode(inline.href);
      link.append(...inline.content.map(lexicalLeaf));
      parent.append(link);
    } else parent.append(lexicalLeaf(inline));
  }
}

const lexicalListType: Readonly<Record<RichTextList['style'], ListType>> = {
  bullet: 'bullet', ordered: 'number', checklist: 'check',
};

function createList(list: RichTextList): ListNode {
  const node = $createListNode(lexicalListType[list.style], list.start ?? 1);
  for (const item of list.items) {
    const itemNode = $createListItemNode(list.style === 'checklist' ? item.checked ?? false : undefined);
    appendInlines(itemNode, item.content);
    for (const child of item.children ?? []) itemNode.append(createList(child));
    node.append(itemNode);
  }
  return node;
}

/** Carga el alcance visual web P07 dentro de `editor.update`. */
export function $loadWebRichTextDocument(document: RichTextDocument): void {
  const root = $getRoot();
  root.clear();
  for (const block of document.blocks) {
    if (block.type === 'paragraph') {
      const paragraph = $createParagraphNode();
      appendInlines(paragraph, block.content);
      root.append(paragraph);
    } else if (block.type === 'heading') {
      const heading = $createHeadingNode(`h${block.level}`);
      appendInlines(heading, block.content);
      root.append(heading);
    } else if (block.type === 'list') root.append(createList(block));
    else if (block.type === 'image') root.append($createRichTextImageNode(block));
    else throw new Error('El documento contiene bloques fuera del alcance del editor visual web.');
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

function readMarks(node: ReturnType<typeof $createTextNode>): readonly RichTextMark[] | undefined {
  const marks: RichTextMark[] = [];
  if (node.hasFormat('bold')) marks.push('bold');
  if (node.hasFormat('italic')) marks.push('italic');
  return marks.length === 0 ? undefined : marks;
}

function readLeaf(node: LexicalNode): RichTextLeaf | null {
  if ($isLineBreakNode(node)) return { type: 'hard-break' };
  if (!$isTextNode(node)) return null;
  const marks = readMarks(node);
  return marks ? { type: 'text', text: node.getTextContent(), marks } : { type: 'text', text: node.getTextContent() };
}

function readInlines(parent: ElementNode, excludeLists = false): readonly RichTextInline[] | null {
  const output: RichTextInline[] = [];
  for (const child of parent.getChildren()) {
    if (excludeLists && $isListNode(child)) continue;
    if ($isLinkNode(child)) {
      const content: RichTextLeaf[] = [];
      for (const linkChild of child.getChildren()) {
        const leaf = readLeaf(linkChild);
        if (!leaf) return null;
        content.push(leaf);
      }
      output.push({ type: 'link', href: child.getURL(), content });
      continue;
    }
    const leaf = readLeaf(child);
    if (!leaf) return null;
    output.push(leaf);
  }
  return output;
}

function readList(node: ListNode): RichTextList | null {
  const listType = node.getListType();
  const style: RichTextList['style'] = listType === 'number' ? 'ordered' : listType === 'check' ? 'checklist' : 'bullet';
  const items: RichTextListItem[] = [];
  for (const child of node.getChildren()) {
    if (!$isListItemNode(child)) return null;
    const content = readInlines(child, true);
    if (!content) return null;
    const children: RichTextList[] = [];
    for (const nested of child.getChildren()) {
      if (!$isListNode(nested)) continue;
      const converted = readList(nested);
      if (!converted) return null;
      children.push(converted);
    }
    items.push({
      ...(style === 'checklist' ? { checked: child.getChecked() ?? false } : {}),
      content,
      ...(children.length === 0 ? {} : { children }),
    });
  }
  return {
    type: 'list', style,
    ...(style === 'ordered' && node.getStart() !== 1 ? { start: node.getStart() } : {}),
    items,
  };
}

/** Lee el alcance visual web P07 dentro de `EditorState.read` o `editor.update`. */
export function $readWebRichTextDocument(): RichTextDocument | null {
  const blocks: RichTextDocument['blocks'][number][] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isParagraphNode(node) || $isHeadingNode(node)) {
      const content = readInlines(node);
      if (!content) return null;
      blocks.push($isHeadingNode(node)
        ? { type: 'heading', level: Number(node.getTag().slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, content }
        : { type: 'paragraph', content });
      continue;
    }
    if ($isListNode(node)) {
      const list = readList(node);
      if (!list) return null;
      blocks.push(list);
      continue;
    }
    if ($isRichTextImageNode(node)) {
      blocks.push(node.image());
      continue;
    }
    return null;
  }
  return { schemaVersion: RICH_TEXT_SCHEMA_VERSION, blocks: blocks.length === 0 ? [{ type: 'paragraph', content: [] }] : blocks };
}

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
