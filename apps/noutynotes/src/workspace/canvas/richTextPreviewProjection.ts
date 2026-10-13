import type { RichTextBlock, RichTextDocument, RichTextInline, RichTextList, RichTextListItem } from '@noutynotes/domain';

function inlineLines(content: readonly RichTextInline[]): number {
  return 1 + content.reduce((total, inline) => {
    if (inline.type === 'hard-break') return total + 1;
    if (inline.type === 'text') return total + (inline.text.match(/\n/g)?.length ?? 0);
    return total + inline.content.reduce((links, leaf) => links + (leaf.type === 'hard-break' ? 1 : leaf.text.match(/\n/g)?.length ?? 0), 0);
  }, 0);
}

function listLines(list: RichTextList): number {
  return list.items.reduce((total, item) => total + inlineLines(item.content)
    + (item.children?.reduce((nested, child) => nested + listLines(child), 0) ?? 0), 0);
}

function blockLines(block: RichTextBlock): number {
  if (block.type === 'paragraph' || block.type === 'heading') return inlineLines(block.content);
  if (block.type === 'opaque-markdown') return Math.max(1, block.source.split('\n').length);
  if (block.type === 'list') return listLines(block);
  if (block.type === 'table') return (block.header ? 1 : 0) + block.rows.length;
  // La imagen del lienzo ocupa aproximadamente cinco renglones del cuerpo.
  return 5;
}

function projectList(list: RichTextList, budget: { value: number }): RichTextList | null {
  const items: RichTextListItem[] = [];
  for (const item of list.items) {
    if (budget.value <= 0) break;
    budget.value -= Math.min(budget.value, inlineLines(item.content));
    const children: RichTextList[] = [];
    const { children: sourceChildren, ...itemWithoutChildren } = item;
    for (const child of sourceChildren ?? []) {
      const projected = projectList(child, budget);
      if (projected) children.push(projected);
      if (budget.value <= 0) break;
    }
    items.push(children.length > 0 ? { ...itemWithoutChildren, children } : itemWithoutChildren);
  }
  return items.length > 0 ? { ...list, items } : null;
}

function projectBlocks(document: RichTextDocument, capacity: number): readonly RichTextBlock[] {
  const budget = { value: Math.max(0, capacity) };
  const blocks: RichTextBlock[] = [];
  for (const block of document.blocks) {
    if (budget.value <= 0) break;
    if (block.type === 'list') {
      const projected = projectList(block, budget);
      if (projected) blocks.push(projected);
      continue;
    }
    if (block.type === 'table') {
      const header = block.header && budget.value > 0 ? block.header : undefined;
      if (header) budget.value -= 1;
      const rows = block.rows.slice(0, budget.value);
      budget.value -= rows.length;
      if (header) blocks.push({ ...block, header, rows });
      else if (rows.length > 0) {
        const { header: sourceHeader, ...tableWithoutHeader } = block;
        void sourceHeader;
        blocks.push({ ...tableWithoutHeader, rows });
      }
      continue;
    }
    blocks.push(block);
    budget.value -= Math.min(budget.value, blockLines(block));
  }
  return blocks;
}

/** Proyecta solo el principio visible de un documento sin alterar el documento durable. */
export function projectRichTextPreview(document: RichTextDocument, capacity: number, reserveOverflowLine = false): {
  readonly document: RichTextDocument;
  readonly hiddenLines: number;
} {
  const totalLines = document.blocks.reduce((total, block) => total + blockLines(block), 0);
  const visibleCapacity = reserveOverflowLine && totalLines > capacity ? Math.max(0, capacity - 1) : Math.max(0, capacity);
  return {
    document: { schemaVersion: document.schemaVersion, blocks: projectBlocks(document, visibleCapacity) },
    hiddenLines: Math.max(0, totalLines - visibleCapacity),
  };
}
