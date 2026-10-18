import type { CaptionPosition, ImageFit, RichTextDocument, RichTextImage, RichTextInline, TextSize } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { BasicRichTextPreview } from '../BasicRichTextPreview';
import { bodyFontSize, bodyLineHeight } from '../textSizes';
import type { ImageResourceState } from '../imageResources';
import { bannerImageHeight } from './bannerImageHeight';
import { projectRichTextPreview } from './richTextPreviewProjection';

const IMAGE_HEIGHT = 88;

/**
 * Vista acotada de una nota enriquecida que conserva imágenes, tablas y texto en su orden. En
 * composición `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1), la imagen aprovecha el espacio que el texto ya
 * seleccionado para la previsualización no necesita, en vez de quedar fija en `IMAGE_HEIGHT`;
 * `document` conserva exactamente el alto histórico.
 */
export function RichNotePreview({ document, imageResources, height, testID, fontFamily, bodySize, captionPosition, imageFit, banner }: {
  readonly document: RichTextDocument;
  readonly imageResources: ReadonlyMap<string, ImageResourceState>;
  readonly height: number;
  readonly testID: string;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  /** Ajuste efectivo ya resuelto por el llamador (OBS-N2-IMAGE-FIT-F2, `resolveCardImageFit`). */
  readonly imageFit: ImageFit;
  /** Si la composición efectiva es `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1). */
  readonly banner: boolean;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const fontSize = bodyFontSize(bodySize);
  const lineHeight = bodyLineHeight(fontSize);
  const captionSize = 11;
  const captionLineHeight = 14;
  const auxiliarySize = 12;
  const auxiliaryLineHeight = 16;
  const lines = Math.max(1, Math.floor(height / lineHeight));
  const preview = projectRichTextPreview(document, lines, true);
  // OBS-N2-28/G1: solo para banner; document conserva IMAGE_HEIGHT sin ningún cálculo adicional.
  const imageHeight = banner ? bannerImageHeight(preview.document.blocks, height, lineHeight, IMAGE_HEIGHT) : IMAGE_HEIGHT;
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
          fontSize={captionSize}
          lineHeight={captionLineHeight}
          fontFamily={fontFamily}
          testID={`${testID}-caption-${blockIndex}`}
        />
      </View>
    );
  };
  return (
    <View testID={testID} style={[styles.wrap, { maxHeight: Math.max(0, height) }]}>
      {preview.document.blocks.map((block, blockIndex) => block.type === 'image' ? (
        <View key={blockIndex} style={[sideways ? styles.imageRow : styles.imageBlock, {
          width: block.size === 'small' ? '25%' : block.size === 'medium' ? '50%' : block.size === 'large' ? '75%' : '100%',
          alignSelf: block.alignment === 'left' ? 'flex-start' : block.alignment === 'right' ? 'flex-end' : 'center',
        }]}>
          {position === 'top' || position === 'left' ? captionNode(block, blockIndex) : null}
          {(() => {
            const resource = imageResources.get(block.assetRef);
            if (resource?.status === 'ready') {
              return (
                <Image
                  testID={`${testID}-image-${blockIndex}`}
                  accessibilityRole="image"
                  accessibilityLabel={block.alt || 'Imagen de la nota'}
                  resizeMode={imageFit}
                  source={{ uri: resource.uri }}
                  style={[styles.image, sideways ? styles.imageSide : null, {
                    height: imageHeight, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
                    objectFit: imageFit,
                  }]}
                />
              );
            }
            const text = resource?.status === 'loading' ? t('image.loading', locale) : t('image.unavailable', locale);
            const label = resource?.status === 'loading' ? text : `${text}: ${block.alt || block.assetRef}`;
            return (
              <View accessibilityLabel={label} style={[styles.image, styles.missing, sideways ? styles.imageSide : null, { height: imageHeight, borderColor: theme.colors.border }]}>
                <Text numberOfLines={1} style={[styles.missingText, { color: theme.colors.cardText, fontSize: auxiliarySize, lineHeight: auxiliaryLineHeight }]}>{text}</Text>
              </View>
            );
          })()}
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
      {preview.hiddenLines > 0 ? (
        <Text testID={`${testID}-overflow`} numberOfLines={1} style={[styles.more, { color: theme.colors.cardText, fontSize: auxiliarySize, lineHeight: auxiliaryLineHeight }]}>
          {`Ver documento completo · ${preview.hiddenLines} ${preview.hiddenLines === 1 ? 'línea adicional' : 'líneas adicionales'}`}
        </Text>
      ) : null}
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
  more: { flexShrink: 0, fontSize: 12, fontWeight: '800' },
});
