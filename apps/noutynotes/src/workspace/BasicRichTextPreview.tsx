import type { RichTextDocument, RichTextInline } from '@noutynotes/domain';
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
    return inline.content.map((leaf, leafIndex) => inlineView(leaf, blockIndex, inlineIndex + leafIndex, testID));
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

/** Vista semántica del subconjunto visual P06; Markdown sigue siendo solo la persistencia durable. */
export function BasicRichTextPreview({ document, numberOfLines, color, fontSize, lineHeight, fontFamily, testID }: BasicRichTextPreviewProps) {
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[styles.content, { color, fontSize, lineHeight }, fontFamily === undefined ? null : { fontFamily }]}
    >
      {document.blocks.map((block, blockIndex) => block.type === 'paragraph' ? (
        <Fragment key={blockIndex}>
          {blockIndex > 0 ? '\n\n' : null}
          {block.content.map((inline, inlineIndex) => inlineView(inline, blockIndex, inlineIndex, testID))}
        </Fragment>
      ) : null)}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { flexShrink: 1, overflow: 'hidden' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
});
