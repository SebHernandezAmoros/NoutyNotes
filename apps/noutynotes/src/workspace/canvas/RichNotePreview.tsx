import type { CaptionPosition, ContentLayout, RichTextDocument, RichTextImage, RichTextInline, TextSize } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';

import { BasicRichTextPreview } from '../BasicRichTextPreview';
import { bodyFontSize, bodyLineHeight } from '../textSizes';

const IMAGE_HEIGHT = 88;

/** Vista acotada de una nota enriquecida que conserva imágenes, tablas y texto en su orden. */
export function RichNotePreview({ document, images, height, testID, fontFamily, bodySize, captionPosition, layout = 'document' }: {
  readonly document: RichTextDocument;
  readonly images: ReadonlyMap<string, string>;
  readonly height: number;
  readonly testID: string;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  readonly layout?: ContentLayout | undefined;
}) {
  const { theme } = useTheme();
  const fontSize = bodyFontSize(bodySize);
  const lineHeight = bodyLineHeight(fontSize);
  const lines = Math.max(1, Math.floor(height / lineHeight));
  const position = captionPosition ?? 'bottom';
  const sideways = position === 'left' || position === 'right';
  const captionOf = (block: RichTextImage): readonly RichTextInline[] => block.caption && block.caption.length > 0
    ? block.caption
    : block.alt ? [{ type: 'text', text: block.alt }] : [];
  const captionNode = (block: RichTextImage, blockIndex: number) => {
    const caption = captionOf(block);
    return caption.length === 0 ? null : (
      <View style={sideways ? styles.captionSide : null}>
        <BasicRichTextPreview
          document={{ schemaVersion: document.schemaVersion, blocks: [{ type: 'paragraph', content: caption }] }}
          numberOfLines={sideways ? 4 : 1}
          color={theme.colors.cardText}
          fontSize={11}
          lineHeight={14}
          fontFamily={fontFamily}
          testID={`${testID}-caption-${blockIndex}`}
        />
      </View>
    );
  };
  return (
    <View testID={testID} style={[styles.wrap, { maxHeight: Math.max(0, height) }]}>
      {document.blocks.map((block, blockIndex) => block.type === 'image' ? (
        <View key={blockIndex} style={sideways ? styles.imageRow : styles.imageBlock}>
          {position === 'top' || position === 'left' ? captionNode(block, blockIndex) : null}
          {images.get(block.assetRef) ? (
            <Image
              testID={`${testID}-image-${blockIndex}`}
              accessibilityRole="image"
              accessibilityLabel={block.alt || 'Imagen de la nota'}
              resizeMode={layout === 'banner' ? 'cover' : 'contain'}
              source={{ uri: images.get(block.assetRef) }}
              style={[styles.image, sideways ? styles.imageSide : null, {
                borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
                objectFit: layout === 'banner' ? 'cover' : 'contain',
              }]}
            />
          ) : (
            <View accessibilityLabel={`Imagen no disponible: ${block.alt || block.assetRef}`} style={[styles.image, styles.missing, sideways ? styles.imageSide : null, { borderColor: theme.colors.border }]}>
              <Text numberOfLines={1} style={[styles.missingText, { color: theme.colors.cardText }]}>{`▣ ${block.alt || 'Imagen'}`}</Text>
            </View>
          )}
          {position === 'bottom' || position === 'right' ? captionNode(block, blockIndex) : null}
        </View>
      ) : (
        <BasicRichTextPreview
          key={blockIndex}
          document={{ schemaVersion: document.schemaVersion, blocks: [block] }}
          numberOfLines={lines}
          color={theme.colors.cardText}
          fontSize={fontSize}
          lineHeight={lineHeight}
          fontFamily={fontFamily}
          testID={`${testID}-block-${blockIndex}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', flexShrink: 1, gap: 6, overflow: 'hidden' },
  imageBlock: { flexShrink: 0, gap: 2 },
  imageRow: { flexShrink: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  image: { width: '100%', height: IMAGE_HEIGHT, borderWidth: 1 },
  imageSide: { flex: 2, width: undefined },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 12, fontWeight: '700' },
  captionSide: { flex: 1 },
});
