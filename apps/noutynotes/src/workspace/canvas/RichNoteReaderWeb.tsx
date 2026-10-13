import type { CaptionPosition, ContentLayout, RichTextDocument, RichTextInline, RichTextList, TextSize } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { memo, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, UIEvent } from 'react';

import { bodyFontSize, bodyLineHeight } from '../textSizes';

const OVERSCAN = 10;
const IMAGE_HEIGHT = 120;

type RichTextBlock = RichTextDocument['blocks'][number];

function inlineText(inlines: readonly RichTextInline[]): string {
  return inlines.map((inline) => inline.type === 'text' ? inline.text : inline.type === 'hard-break' ? '\n' : inlineText(inline.content)).join('');
}

function inlineNodes(inlines: readonly RichTextInline[], keyPrefix: string): readonly ReactNode[] {
  return inlines.map((inline, index) => {
    if (inline.type === 'hard-break') return <br key={`${keyPrefix}-${index}`} />;
    if (inline.type === 'link') return <span key={`${keyPrefix}-${index}`} style={{ textDecoration: 'underline' }}>{inlineNodes(inline.content, `${keyPrefix}-${index}`)}</span>;
    return <span key={`${keyPrefix}-${index}`} style={{ fontWeight: inline.marks?.includes('bold') ? 700 : undefined, fontStyle: inline.marks?.includes('italic') ? 'italic' : undefined }}>{inline.text}</span>;
  });
}

function listItemCount(list: RichTextList): number {
  return list.items.reduce((total, item) => total + 1 + (item.children?.reduce((sum, child) => sum + listItemCount(child), 0) ?? 0), 0);
}

function estimatedHeight(block: RichTextBlock, lineHeight: number): number {
  if (block.type === 'image') return IMAGE_HEIGHT + (block.caption?.length || block.alt ? 24 : 0) + 8;
  if (block.type === 'table') return ((block.header ? 1 : 0) + block.rows.length) * 34 + 8;
  if (block.type === 'list') return Math.max(1, listItemCount(block)) * lineHeight + 8;
  const text = block.type === 'opaque-markdown' ? block.source : inlineText(block.content);
  const wrappedLines = Math.max(1, Math.ceil(text.length / 42), text.split('\n').length);
  const scale = block.type === 'heading' ? ({ 1: 2, 2: 1.65, 3: 1.4, 4: 1.2, 5: 1.05, 6: 1 } as const)[block.level] : 1;
  return Math.ceil(wrappedLines * lineHeight * scale) + 4;
}

function listNode(list: RichTextList, key: string): ReactNode {
  const Tag = list.style === 'ordered' ? 'ol' : 'ul';
  return (
    <Tag key={key} start={list.style === 'ordered' ? list.start : undefined} style={{ margin: 0, paddingLeft: 24, listStyleType: list.style === 'checklist' ? 'none' : undefined }}>
      {list.items.map((item, index) => (
        <li key={`${key}-${index}`}>
          {list.style === 'checklist' ? `${item.checked ? '☑' : '☐'} ` : null}{inlineNodes(item.content, `${key}-${index}`)}
          {item.children?.map((child, childIndex) => listNode(child, `${key}-${index}-${childIndex}`))}
        </li>
      ))}
    </Tag>
  );
}

function blockNode(block: RichTextBlock, index: number, props: {
  readonly document: RichTextDocument;
  readonly images: ReadonlyMap<string, string>;
  readonly testID: string;
  readonly captionPosition: CaptionPosition;
  readonly layout: ContentLayout;
}) {
  const common = { margin: 0 } satisfies CSSProperties;
  if (block.type === 'paragraph') return <p style={{ ...common, textAlign: block.alignment ?? 'left' }}>{inlineNodes(block.content, `${index}`)}</p>;
  if (block.type === 'heading') {
    const Tag = `h${block.level}` as 'h1';
    return <Tag style={{ ...common, textAlign: block.alignment ?? 'left' }}>{inlineNodes(block.content, `${index}`)}</Tag>;
  }
  if (block.type === 'list') return listNode(block, `${index}`);
  if (block.type === 'opaque-markdown') return <pre style={{ ...common, whiteSpace: 'pre-wrap' }}>{block.source}</pre>;
  if (block.type === 'table') {
    const rows = block.header ? [block.header, ...block.rows] : block.rows;
    return (
      <table data-testid={`${props.testID}-table-${index}`} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={rowIndex}>{row.cells.map((cell, cellIndex) => {
            const Cell = block.header && rowIndex === 0 ? 'th' : 'td';
            return <Cell key={cellIndex} style={{ border: '1px solid currentColor', padding: 4, verticalAlign: cell.verticalAlignment === 'center' ? 'middle' : cell.verticalAlignment ?? 'top' }}>{inlineNodes(cell.content, `${index}-${rowIndex}-${cellIndex}`)}</Cell>;
          })}</tr>
        ))}</tbody>
      </table>
    );
  }
  const source = props.images.get(block.assetRef);
  const caption = block.caption && block.caption.length > 0 ? block.caption : block.alt ? [{ type: 'text' as const, text: block.alt }] : [];
  const width = block.size === 'small' ? '25%' : block.size === 'medium' ? '50%' : block.size === 'large' ? '75%' : '100%';
  const marginInline = block.alignment === 'left' ? '0 auto 0 0' : block.alignment === 'right' ? '0 0 0 auto' : '0 auto';
  const image = source ? <img src={source} alt={block.alt} style={{ width: '100%', height: 'auto', maxHeight: IMAGE_HEIGHT, objectFit: props.layout === 'banner' ? 'cover' : 'contain', display: 'block' }} />
    : <div role="img" aria-label={`Imagen no disponible: ${block.alt || block.assetRef}`} style={{ height: IMAGE_HEIGHT, display: 'grid', placeItems: 'center', border: '1px solid currentColor' }}>{`▣ ${block.alt || 'Imagen'}`}</div>;
  const captionNode = caption.length > 0 ? <figcaption>{inlineNodes(caption, `${index}-caption`)}</figcaption> : null;
  return <figure style={{ margin: marginInline, width, maxWidth: '100%' }}>{props.captionPosition === 'top' || props.captionPosition === 'left' ? captionNode : null}{image}{props.captionPosition === 'bottom' || props.captionPosition === 'right' ? captionNode : null}</figure>;
}

/** Lector web virtualizado: solo monta los bloques cercanos al scroll y conserva altura total mediante espaciadores. */
export const RichNoteReaderWeb = memo(function RichNoteReaderWeb({ document, images, testID, fontFamily, bodySize, captionPosition = 'bottom', layout = 'document' }: {
  readonly document: RichTextDocument;
  readonly images: ReadonlyMap<string, string>;
  readonly testID: string;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  readonly layout?: ContentLayout | undefined;
}) {
  const { theme } = useTheme();
  const fontSize = bodyFontSize(bodySize);
  const lineHeight = bodyLineHeight(fontSize);
  const metrics = useMemo(() => {
    const offsets = [0];
    for (const block of document.blocks) offsets.push(offsets[offsets.length - 1]! + estimatedHeight(block, lineHeight));
    return offsets;
  }, [document, lineHeight]);
  const [window, setWindow] = useState({ top: 0, height: 320 });
  const firstVisible = Math.max(0, metrics.findIndex((offset, index) => index < metrics.length - 1 && metrics[index + 1]! > window.top));
  const lastFound = metrics.findIndex((offset) => offset >= window.top + window.height);
  const lastVisible = lastFound < 0 ? document.blocks.length : lastFound;
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(document.blocks.length, lastVisible + OVERSCAN);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    setWindow((current) => current.top === node.scrollTop && current.height === node.clientHeight ? current : { top: node.scrollTop, height: node.clientHeight });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const delta = event.key === 'ArrowDown' ? lineHeight : event.key === 'ArrowUp' ? -lineHeight
      : event.key === 'PageDown' ? node.clientHeight : event.key === 'PageUp' ? -node.clientHeight : 0;
    if (event.key === 'Home' || event.key === 'End' || delta !== 0) event.preventDefault();
    if (event.key === 'Home') node.scrollTop = 0;
    else if (event.key === 'End') {
      const settleAtEnd = (remaining: number) => requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
        if (remaining > 0) settleAtEnd(remaining - 1);
      });
      node.scrollTop = node.scrollHeight;
      settleAtEnd(3);
    }
    else if (delta !== 0) node.scrollTop += delta;
  };
  return (
    <div
      data-testid={testID}
      aria-label="Contenido completo de la nota"
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      style={{ width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden', color: theme.colors.cardText, fontFamily, fontSize, lineHeight: `${lineHeight}px`, scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}
    >
      <div aria-hidden="true" style={{ height: metrics[start] }} />
      {document.blocks.slice(start, end).map((block, relativeIndex) => {
        const index = start + relativeIndex;
        return <div key={index} data-testid={`${testID}-block-${index}`} style={{ minHeight: estimatedHeight(block, lineHeight), paddingBottom: 4, boxSizing: 'border-box' }}>{blockNode(block, index, { document, images, testID, captionPosition, layout })}</div>;
      })}
      <div aria-hidden="true" style={{ height: metrics[document.blocks.length]! - metrics[end]! }} />
    </div>
  );
});
