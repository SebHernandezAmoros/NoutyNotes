import type { CaptionPosition, ImageFit, RichTextDocument, RichTextImage, RichTextInline, TextSize } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { BasicRichTextPreview } from '../BasicRichTextPreview';
import { bodyFontSize, bodyLineHeight } from '../textSizes';
import type { ImageResourceState } from '../imageResources';
import { BANNER_BLOCK_GAP, BANNER_CAPTION_GAP, BANNER_CAPTION_LINE, BANNER_OVERFLOW_HEIGHT, projectBannerPreview } from './bannerImageHeight';
import { blockLines, projectRichTextPreview } from './richTextPreviewProjection';

const IMAGE_HEIGHT = 88;

/**
 * Vista acotada de una nota enriquecida que conserva imágenes, tablas y texto en su orden. En
 * composición `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1), la imagen aprovecha el espacio que el texto ya
 * seleccionado para la previsualización no necesita, en vez de quedar fija en `IMAGE_HEIGHT`;
 * `document` conserva exactamente el alto histórico.
 */
export function RichNotePreview({ document, imageResources, height, width, testID, fontFamily, bodySize, captionPosition, imageFit, banner, onOpenDocument }: {
  readonly document: RichTextDocument;
  readonly imageResources: ReadonlyMap<string, ImageResourceState>;
  readonly height: number;
  /** Ancho real disponible (OBS-N2-28/G1, corrección de regresión): permite estimar renglones reales
   * por envoltorio visual, no solo por saltos de línea explícitos. */
  readonly width: number;
  readonly testID: string;
  readonly fontFamily?: string | undefined;
  readonly bodySize?: TextSize | undefined;
  readonly captionPosition?: CaptionPosition | undefined;
  /** Ajuste efectivo ya resuelto por el llamador (OBS-N2-IMAGE-FIT-F2, `resolveCardImageFit`). */
  readonly imageFit: ImageFit;
  /** Si la composición efectiva es `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1). */
  readonly banner: boolean;
  readonly onOpenDocument: () => void;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const fontSize = bodyFontSize(bodySize);
  const lineHeight = bodyLineHeight(fontSize);
  const captionSize = 11;
  const captionLineHeight = BANNER_CAPTION_LINE;
  const auxiliarySize = 12;
  const auxiliaryLineHeight = 16;
  const lines = Math.max(1, Math.floor(height / lineHeight));
  const position = captionPosition ?? 'bottom';
  const [innerWidth, setInnerWidth] = useState(width);
  const [overflowFocused, setOverflowFocused] = useState(false);
  const availableWidth = Math.min(width, innerWidth);
  const metricKey = `${availableWidth}:${fontSize}:${fontFamily ?? ''}`;
  const [measured, setMeasured] = useState<{ document: RichTextDocument; key: string; revision: number; heights: Readonly<Record<number, number>> }>({ document, key: metricKey, revision: 0, heights: {} });
  // A width/content change may leave a block's height unchanged, so onLayout alone will not
  // report it again. Invalidate the cache and remount its measuring nodes in the same render.
  if (measured.document !== document || measured.key !== metricKey) {
    setMeasured({ document, key: metricKey, revision: measured.revision + 1, heights: {} });
  }
  const textHeights = measured.document === document && measured.key === metricKey ? measured.heights : {};
  const bannerPreview = banner ? projectBannerPreview(document, {
    height, width: availableWidth, fontSize, lineHeight, imageMinimum: IMAGE_HEIGHT, captionPosition: position, textHeights,
  }) : null;
  const preview = bannerPreview ?? projectRichTextPreview(document, lines, width, fontSize, true);
  const imageHeight = bannerPreview?.imageHeight ?? IMAGE_HEIGHT;
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
    <View testID={testID} onLayout={banner ? (event) => setInnerWidth(event.nativeEvent.layout.width) : undefined}
      style={[styles.wrap, { maxHeight: Math.max(0, height) }]}>
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
      ) : banner ? (
        <View key={`${blockIndex}:${measured.revision}`} testID={`${testID}-block-${blockIndex}`} style={styles.wholeBlock}
          onLayout={(event) => {
            const blockHeight = event.nativeEvent.layout.height;
            setMeasured((current) => {
              const heights = current.document === document && current.key === metricKey ? current.heights : {};
              return heights[blockIndex] === blockHeight ? current : { document, key: metricKey, revision: current.revision, heights: { ...heights, [blockIndex]: blockHeight } };
            });
          }}>
          <BasicRichTextPreview document={{ schemaVersion: document.schemaVersion, blocks: [block] }}
            numberOfLines={Math.max(1, blockLines(block, availableWidth, fontSize))} unclamped
            color={theme.colors.cardText} fontSize={fontSize} lineHeight={lineHeight} fontFamily={fontFamily}
            testID={`${testID}-text-${blockIndex}`} />
        </View>
      ) : (
        <BasicRichTextPreview
          key={blockIndex}
          document={{ schemaVersion: document.schemaVersion, blocks: [block] }}
          // OBS-N2-28/G1, corrección de regresión: el límite de renglones de CADA bloque es el que ese
          // bloque necesita de verdad (el mismo que ya usó la selección), no el presupuesto total de la
          // tarjeta — con el total, un párrafo podía reclamar más renglones de los que le correspondían
          // y empujar fuera del área visible al contenido que venía después.
          numberOfLines={Math.max(1, blockLines(block, width, fontSize))}
          color={theme.colors.cardText}
          fontSize={fontSize}
          lineHeight={lineHeight}
          fontFamily={fontFamily}
          testID={`${testID}-block-${blockIndex}`}
        />
      ))}
      {banner && preview.hiddenLines > 0 ? (
        <Pressable testID={`${testID}-overflow-action`} accessibilityRole="link" accessibilityLabel="Ver documento completo"
          accessibilityHint="La vista previa no muestra todo el contenido"
          onFocus={() => setOverflowFocused(true)} onBlur={() => setOverflowFocused(false)}
          onPress={(event) => { event.stopPropagation(); onOpenDocument(); }}
          style={({ pressed }) => [styles.overflowAction, { borderColor: overflowFocused ? theme.colors.selection : theme.colors.border, backgroundColor: overflowFocused || pressed ? theme.colors.surface : 'transparent' }]}>
          <Text numberOfLines={2} style={{ color: theme.colors.cardText, fontSize: auxiliarySize, lineHeight: auxiliaryLineHeight }}>Ver documento completo</Text>
        </Pressable>
      ) : preview.hiddenLines > 0 ? (
        <Text testID={`${testID}-overflow`} numberOfLines={1} style={[styles.more, { color: theme.colors.cardText, fontSize: auxiliarySize, lineHeight: auxiliaryLineHeight }]}>
          {`Ver documento completo · ${preview.hiddenLines} ${preview.hiddenLines === 1 ? 'línea adicional' : 'líneas adicionales'}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', flexShrink: 1, gap: BANNER_BLOCK_GAP, overflow: 'hidden' },
  wholeBlock: { flexShrink: 0 },
  overflowAction: { height: BANNER_OVERFLOW_HEIGHT, flexShrink: 0, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 4 },
  imageBlock: { flexShrink: 0, gap: BANNER_CAPTION_GAP },
  imageRow: { flexShrink: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  image: { width: '100%', height: IMAGE_HEIGHT, borderWidth: 1 },
  imageSide: { flex: 2, width: undefined },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 12, fontWeight: '700' },
  captionSide: { flex: 1 },
  more: { flexShrink: 0, fontSize: 12, fontWeight: '800' },
});
