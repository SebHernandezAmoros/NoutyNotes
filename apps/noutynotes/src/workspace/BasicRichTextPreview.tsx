import type { RichTextDocument, RichTextInline, RichTextList } from '@noutynotes/domain';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

interface BasicRichTextPreviewProps {
  readonly document: RichTextDocument;
  readonly numberOfLines: number;
  readonly color: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: string | undefined;
  readonly testID: string;
}

function inlineView(inline: RichTextInline, blockIndex: number, inlineIndex: number, testID: string): ReactNode {
  if (inline.type === 'hard-break') return '\n';
  if (inline.type === 'link') {
    return (
      <Text key={`${blockIndex}-${inlineIndex}`} style={styles.link}>
        {inline.content.map((leaf, leafIndex) => inlineView(leaf, blockIndex, inlineIndex + leafIndex, testID))}
      </Text>
    );
  }
  return (
    <Text
      key={`${blockIndex}-${inlineIndex}`}
      testID={`${testID}-run-${blockIndex}-${inlineIndex}`}
      style={[
        inline.marks?.includes('bold') ? styles.bold : null,
        inline.marks?.includes('italic') ? styles.italic : null,
      ]}
    >
      {inline.text}
    </Text>
  );
}

interface PreviewLine {
  readonly key: string;
  readonly prefix: string;
  readonly content: readonly RichTextInline[];
  readonly heading: boolean;
}

function listLines(list: RichTextList, blockIndex: number, depth = 0, path = ''): readonly PreviewLine[] {
  const lines: PreviewLine[] = [];
  list.items.forEach((item, itemIndex) => {
    const ordinal = (list.start ?? 1) + itemIndex;
    const marker = list.style === 'ordered' ? `${ordinal}. ` : list.style === 'checklist' ? `${item.checked ? '☑' : '☐'} ` : '• ';
    lines.push({ key: `${blockIndex}-list-${path}${itemIndex}`, prefix: `${'  '.repeat(depth)}${marker}`, content: item.content, heading: false });
    item.children?.forEach((child, childIndex) => lines.push(...listLines(child, blockIndex, depth + 1, `${path}${itemIndex}-${childIndex}-`)));
  });
  return lines;
}

function previewLines(document: RichTextDocument): readonly PreviewLine[] {
  return document.blocks.flatMap((block, blockIndex): readonly PreviewLine[] => {
    if (block.type === 'paragraph') return [{ key: `${blockIndex}`, prefix: '', content: block.content, heading: false }];
    if (block.type === 'heading') return [{ key: `${blockIndex}`, prefix: '', content: block.content, heading: true }];
    if (block.type === 'list') return listLines(block, blockIndex);
    return [];
  });
}

/** Vista semántica P07; Markdown sigue siendo únicamente la persistencia durable. */
export function BasicRichTextPreview({ document, numberOfLines, color, fontSize, lineHeight, fontFamily, testID }: BasicRichTextPreviewProps) {
  const lines = previewLines(document);
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[styles.content, { color, fontSize, lineHeight }, fontFamily === undefined ? null : { fontFamily }]}
    >
      {lines.map((line, lineIndex) => (
        <Fragment key={line.key}>
          {lineIndex > 0 ? '\n' : null}
          {line.prefix}
          <Text style={line.heading ? styles.heading : null}>
            {line.content.map((inline, inlineIndex) => inlineView(inline, lineIndex, inlineIndex, testID))}
          </Text>
        </Fragment>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { flexShrink: 1, overflow: 'hidden' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  heading: { fontWeight: '800' },
  link: { textDecorationLine: 'underline' },
});
