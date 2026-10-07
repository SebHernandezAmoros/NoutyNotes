import { parseNoteBlocks } from '@noutynotes/application';
import type { PrintEntry } from '@noutynotes/application';
import type { CaptionPosition } from '@noutynotes/domain';
import { parseRichTextMarkdown } from '@noutynotes/storage';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ColorValue } from 'react-native';

import { BasicRichTextPreview } from './BasicRichTextPreview';
import { markdownExcerpt } from './markdownLists';

// Una presentación es un documento de lectura (ADR 0031): a diferencia de `NotePreview`/Lista, nunca
// recorta ni añade «+n bloques más»; este número solo evita que `numberOfLines` trunque un párrafo real.
const UNBOUNDED_LINES = 9999;

function imageBlock(ref: string, alt: string, images: ReadonlyMap<string, string>, position: CaptionPosition, color: ColorValue, key: string) {
  const uri = images.get(ref);
  const sideways = position === 'left' || position === 'right';
  const image = uri ? (
    <Image key="image" accessibilityRole="image" accessibilityLabel={alt || 'Imagen'} source={{ uri }}
      resizeMode="contain" style={[styles.image, sideways ? styles.imageSide : null]} />
  ) : (
    <View key="image" accessibilityLabel={`Imagen no disponible: ${alt || ref}`} style={[styles.image, styles.missing, sideways ? styles.imageSide : null]}>
      <Text style={[styles.missingText, { color }]}>{`▣ ${alt || 'Imagen'}`}</Text>
    </View>
  );
  if (alt === '') return <View key={key} style={styles.imageBlock}>{image}</View>;
  const caption = <Text key="caption" style={[styles.caption, { color }, sideways ? styles.captionSide : null]}>{alt}</Text>;
  if (position === 'top') return <View key={key} style={styles.imageBlock}>{caption}{image}</View>;
  if (position === 'left') return <View key={key} style={styles.imageRow}>{caption}{image}</View>;
  if (position === 'right') return <View key={key} style={styles.imageRow}>{image}{caption}</View>;
  return <View key={key} style={styles.imageBlock}>{image}{caption}</View>;
}

/**
 * Cuerpo completo de una nota en Presentación (P16): mismo orden y mismo criterio que
 * `printHtml.bodyHtml` (UX7-C5) — cada imagen intercalada se dibuja una sola vez, en su sitio, con
 * su leyenda — pero como vista RN en vez de HTML. Delega encabezados, listas, checklist, enlaces y
 * tablas en `BasicRichTextPreview` bloque a bloque, sin duplicar esa lógica.
 */
export function PresentationBody({ entry, images, color, fontSize, lineHeight, testID }: {
  readonly entry: PrintEntry;
  readonly images: ReadonlyMap<string, string>;
  readonly color: ColorValue;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly testID: string;
}) {
  const position = entry.captionPosition ?? 'bottom';
  const parsed = parseRichTextMarkdown(entry.content);
  if (parsed.ok) {
    const inline = new Set<string>(parsed.value.blocks.filter((block) => block.type === 'image').map((block) => block.assetRef));
    const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref, index) => imageBlock(ref, '', images, position, color, `standalone-${index}`));
    const body = parsed.value.blocks.map((block, index) => {
      if (block.type === 'image') return imageBlock(block.assetRef, block.alt, images, position, color, `block-${index}`);
      return (
        <BasicRichTextPreview key={`block-${index}`} document={{ schemaVersion: parsed.value.schemaVersion, blocks: [block] }}
          numberOfLines={UNBOUNDED_LINES} color={color as string} fontSize={fontSize} lineHeight={lineHeight} testID={`${testID}-block-${index}`} />
      );
    });
    return <View testID={testID} style={styles.wrap}>{[...standalone, ...body]}</View>;
  }
  const blocks = parseNoteBlocks(entry.content);
  const inline = new Set<string>(blocks.filter((block) => block.kind === 'image').map((block) => block.ref));
  const standalone = entry.imageRefs.filter((ref) => !inline.has(ref)).map((ref, index) => imageBlock(ref, '', images, position, color, `legacy-standalone-${index}`));
  const body = blocks.map((block, index) => (block.kind === 'image'
    ? imageBlock(block.ref, block.alt, images, position, color, `legacy-${index}`)
    : <Text key={`legacy-${index}`} style={[styles.content, { color, fontSize, lineHeight }]}>{markdownExcerpt(block.text)}</Text>));
  return <View testID={testID} style={styles.wrap}>{[...standalone, ...body]}</View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  content: {},
  imageBlock: { gap: 4 },
  imageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  image: { width: '100%', height: 320 },
  imageSide: { flex: 2, width: undefined, height: 240 },
  missing: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  missingText: { fontSize: 14, fontWeight: '700' },
  caption: { fontSize: 14, fontStyle: 'italic' },
  captionSide: { flex: 1 },
});
