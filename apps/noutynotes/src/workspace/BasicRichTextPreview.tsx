import type { RichTextDocument, RichTextInline, RichTextList, RichTextTableRow } from '@noutynotes/domain';
import type { ReactNode } from 'react';
import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';

import { projectRichTextPreview } from './canvas/richTextPreviewProjection';

// Ancho muy generoso para los llamadores de este componente que no necesitan una estimación precisa
// de envoltorio visual (títulos, vista previa del editor, `PresentationBody`): con un ancho así de
// grande, `estimatePreviewLines` nunca cuenta más de un renglón por salto de línea explícito, igual
// que el cálculo histórico — preserva su comportamiento sin ampliar el alcance de OBS-N2-28/G1 (esa
// corrección solo exige precisión real en `RichNotePreview`/`NotePreview`, que sí pasan un `width`).
const UNBOUNDED_WIDTH = 10_000;

interface BasicRichTextPreviewProps {
  readonly document: RichTextDocument;
  readonly numberOfLines: number;
  readonly color: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: string | undefined;
  readonly testID: string;
  /** Ancho real disponible, si el llamador ya lo conoce y le importa una estimación precisa de
   * envoltorio visual (OBS-N2-28/G1). Sin él, se asume un ancho prácticamente ilimitado. */
  readonly width?: number | undefined;
  /** Intrinsic block height for the Banner budget; other previews retain their clamp. */
  readonly unclamped?: boolean | undefined;
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
  readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
  readonly alignment: 'left' | 'center' | 'right' | 'justify';
}

function listLines(list: RichTextList, blockIndex: number, depth = 0, path = ''): readonly PreviewLine[] {
  const lines: PreviewLine[] = [];
  list.items.forEach((item, itemIndex) => {
    const ordinal = (list.start ?? 1) + itemIndex;
    const marker = list.style === 'ordered' ? `${ordinal}. ` : list.style === 'checklist' ? `${item.checked ? '☑' : '☐'} ` : '• ';
    lines.push({ key: `${blockIndex}-list-${path}${itemIndex}`, prefix: `${'  '.repeat(depth)}${marker}`, content: item.content, headingLevel: null, alignment: 'left' });
    item.children?.forEach((child, childIndex) => lines.push(...listLines(child, blockIndex, depth + 1, `${path}${itemIndex}-${childIndex}-`)));
  });
  return lines;
}

function previewLines(document: RichTextDocument): readonly PreviewLine[] {
  return document.blocks.flatMap((block, blockIndex): readonly PreviewLine[] => {
    if (block.type === 'paragraph') return [{ key: `${blockIndex}`, prefix: '', content: block.content, headingLevel: null, alignment: block.alignment ?? 'left' }];
    if (block.type === 'heading') return [{ key: `${blockIndex}`, prefix: '', content: block.content, headingLevel: block.level, alignment: block.alignment ?? 'left' }];
    if (block.type === 'list') return listLines(block, blockIndex);
    if (block.type === 'opaque-markdown') return [{
      key: `${blockIndex}-opaque`, prefix: '',
      content: [{ type: 'text', text: block.source }], headingLevel: null, alignment: 'left',
    }];
    return [];
  });
}

/** Vista semántica P07; Markdown sigue siendo únicamente la persistencia durable. */
export function BasicRichTextPreview({ document, numberOfLines, color, fontSize, lineHeight, fontFamily, testID, width, unclamped }: BasicRichTextPreviewProps) {
  const { theme } = useTheme();
  const projectedDocument = unclamped ? document : projectRichTextPreview(document, numberOfLines, width ?? UNBOUNDED_WIDTH, fontSize).document;
  if (projectedDocument.blocks.some((block) => block.type === 'table')) {
    return (
      <View testID={testID} style={styles.tableDocument}>
        {projectedDocument.blocks.map((block, blockIndex) => {
          if (block.type !== 'table') {
            return <BasicRichTextPreview key={blockIndex} document={{ schemaVersion: document.schemaVersion, blocks: [block] }} numberOfLines={numberOfLines}
              color={color} fontSize={fontSize} lineHeight={lineHeight} fontFamily={fontFamily} testID={`${testID}-block-${blockIndex}`} width={width} unclamped={unclamped} />;
          }
          const rows: readonly { readonly row: RichTextTableRow; readonly header: boolean }[] = [
            ...(block.header ? [{ row: block.header, header: true }] : []),
            ...block.rows.map((row) => ({ row, header: false })),
          ];
          return (
            <View key={blockIndex} testID={`${testID}-table-${blockIndex}`} style={[styles.table, { borderColor: color }]}>
              {rows.map(({ row, header }, rowIndex) => (
                <View key={rowIndex} style={styles.tableRow}>
                  {row.cells.map((cell, cellIndex) => (
                    <Text key={cellIndex} testID={`${testID}-table-${blockIndex}-${header ? 'header' : `row-${rowIndex}`}-${cellIndex}`} numberOfLines={unclamped ? undefined : 2} style={[
                      styles.tableCell, header ? styles.tableHeader : null,
                      { color, borderColor: color, fontSize, lineHeight },
                      header ? { backgroundColor: theme.colors.surfaceRaised, color: theme.colors.textPrimary } : null,
                      fontFamily === undefined ? null : { fontFamily },
                    ]}>
                      {cell.content.map((inline, inlineIndex) => inlineView(inline, rowIndex, inlineIndex, testID))}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          );
        })}
      </View>
    );
  }
  const lines = previewLines(projectedDocument);
  return (
    <View testID={testID} style={styles.content}>
      {(unclamped ? lines : lines.slice(0, numberOfLines)).map((line, lineIndex) => (
        <Text key={line.key} numberOfLines={unclamped ? undefined : Math.max(1, numberOfLines - lineIndex)} style={[
          { color, fontSize, lineHeight, textAlign: line.alignment },
          line.headingLevel === null ? null : [styles.heading, {
            fontSize: fontSize * headingScale[line.headingLevel],
            lineHeight: Math.round(fontSize * headingScale[line.headingLevel] * 1.15),
          }],
          fontFamily === undefined ? null : { fontFamily },
        ]}>
          {line.prefix}
          {line.content.map((inline, inlineIndex) => inlineView(inline, lineIndex, inlineIndex, testID))}
        </Text>
      ))}
    </View>
  );
}

const headingScale: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, number>> = {
  1: 2,
  2: 1.65,
  3: 1.4,
  4: 1.2,
  5: 1.05,
  6: 1,
};

const styles = StyleSheet.create({
  content: { flexShrink: 1, overflow: 'hidden' },
  tableDocument: { width: '100%', flexShrink: 1, gap: 6, overflow: 'hidden' },
  table: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1 },
  tableRow: { width: '100%', flexDirection: 'row' },
  tableCell: { flex: 1, minWidth: 0, minHeight: 30, borderRightWidth: 1, borderBottomWidth: 1, padding: 4 },
  tableHeader: { fontWeight: '800' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  heading: { fontWeight: '800' },
  link: { textDecorationLine: 'underline' },
});
