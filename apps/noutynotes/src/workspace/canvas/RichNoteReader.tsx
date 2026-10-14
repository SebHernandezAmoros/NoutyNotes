import type { CaptionPosition, ContentLayout, RichTextDocument, RichTextImage, RichTextInline, TextSize } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { FlatList, Image, Platform, StyleSheet, Text, View } from 'react-native';

import { BasicRichTextPreview } from '../BasicRichTextPreview';
import { bodyFontSize, bodyLineHeight } from '../textSizes';
import { RichNoteReaderWeb } from './RichNoteReaderWeb';

const IMAGE_HEIGHT = 120;

type RichTextBlock = RichTextDocument['blocks'][number];

/**
 * Lector completo y virtualizado para una Nota extensa dentro del lienzo.
 * No crea una segunda sesión Lexical ni transforma el documento durable: FlatList monta únicamente
 * la ventana visible y cada bloque reutiliza el renderizador semántico de la vista previa.
 */
export function RichNoteReader(props: {
  readonly document: RichTextDocument;
  readonly images: ReadonlyMap<string, string>;
  readonly testID: string;
  readonly color?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  readonly layout?: ContentLayout | undefined;
}) {
  if (Platform.OS === 'web') return <RichNoteReaderWeb {...props} />;
  return <RichNoteReaderNative {...props} />;
}

function RichNoteReaderNative(props: {
  readonly document: RichTextDocument;
  readonly images: ReadonlyMap<string, string>;
  readonly testID: string;
  readonly color?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  readonly layout?: ContentLayout | undefined;
}) {
  const { document, images, testID, color, fontFamily, bodySize, captionPosition, layout = 'document' } = props;
  const { theme } = useTheme();
  const fontSize = bodyFontSize(bodySize);
  const lineHeight = bodyLineHeight(fontSize);
  const position = captionPosition ?? 'bottom';
  const sideways = position === 'left' || position === 'right';

  const captionOf = (block: RichTextImage): readonly RichTextInline[] => block.caption && block.caption.length > 0
    ? block.caption
    : block.alt ? [{ type: 'text', text: block.alt }] : [];
  const imageBlock = (block: RichTextImage, blockIndex: number) => {
    const caption = captionOf(block);
    const captionNode = caption.length === 0 ? null : (
      <View style={sideways ? styles.captionSide : null}>
        <BasicRichTextPreview
          document={{ schemaVersion: document.schemaVersion, blocks: [{ type: 'paragraph', content: caption }] }}
          numberOfLines={sideways ? 4 : 1}
          color={color ?? theme.colors.cardText}
          fontSize={11}
          lineHeight={14}
          fontFamily={fontFamily}
          testID={`${testID}-caption-${blockIndex}`}
        />
      </View>
    );
    return (
      <View style={[sideways ? styles.imageRow : styles.imageBlock, {
        width: block.size === 'small' ? '25%' : block.size === 'medium' ? '50%' : block.size === 'large' ? '75%' : '100%',
        alignSelf: block.alignment === 'left' ? 'flex-start' : block.alignment === 'right' ? 'flex-end' : 'center',
      }]}>
        {position === 'top' || position === 'left' ? captionNode : null}
        {images.get(block.assetRef) ? (
          <Image
            testID={`${testID}-image-${blockIndex}`}
            accessibilityRole="image"
            accessibilityLabel={block.alt || 'Imagen de la nota'}
            resizeMode={layout === 'banner' ? 'cover' : 'contain'}
            source={{ uri: images.get(block.assetRef) }}
            style={[styles.image, sideways ? styles.imageSide : null, {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              objectFit: layout === 'banner' ? 'cover' : 'contain',
            }]}
          />
        ) : (
          <View accessibilityLabel={`Imagen no disponible: ${block.alt || block.assetRef}`} style={[styles.image, styles.missing, sideways ? styles.imageSide : null, { borderColor: theme.colors.border }]}>
            <Text numberOfLines={1} style={[styles.missingText, { color: theme.colors.cardText }]}>{`▣ ${block.alt || 'Imagen'}`}</Text>
          </View>
        )}
        {position === 'bottom' || position === 'right' ? captionNode : null}
      </View>
    );
  };

  const renderBlock = ({ item, index }: { readonly item: RichTextBlock; readonly index: number }) => (
    <View style={styles.block}>
      {item.type === 'image' ? imageBlock(item, index) : (
        <BasicRichTextPreview
          document={{ schemaVersion: document.schemaVersion, blocks: [item] }}
          numberOfLines={Number.MAX_SAFE_INTEGER}
          color={color ?? theme.colors.cardText}
          fontSize={fontSize}
          lineHeight={lineHeight}
          fontFamily={fontFamily}
          testID={`${testID}-block-${index}`}
        />
      )}
    </View>
  );

  return (
    <FlatList
      testID={testID}
      data={document.blocks}
      renderItem={renderBlock}
      keyExtractor={(_block, index) => String(index)}
      initialNumToRender={12}
      maxToRenderPerBatch={18}
      windowSize={7}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
      accessibilityLabel="Contenido completo de la nota"
      style={styles.reader}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  reader: { flex: 1, minHeight: 0, width: '100%' },
  content: { paddingRight: 4, paddingBottom: 4 },
  block: { marginBottom: 4 },
  imageBlock: { gap: 2 },
  imageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  image: { width: '100%', height: IMAGE_HEIGHT, borderWidth: 1 },
  imageSide: { flex: 2, width: undefined },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 12, fontWeight: '700' },
  captionSide: { flex: 1 },
});
