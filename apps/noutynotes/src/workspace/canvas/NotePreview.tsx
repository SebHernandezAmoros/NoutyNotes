import type { NoteBlock } from '@noutynotes/application';
import { useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';

import { markdownExcerpt } from '../markdownLists';

const LINE = 18;
// La miniatura se adapta al alto que queda (entre 32 y 72 px): en una ficha pequeña también se ve.
const THUMB = 72;
const THUMB_MIN = 32;
const GAP = 6;

/**
 * Ficha de una nota con imágenes (ADR 0021): texto resumido e imágenes en el orden del documento
 * hasta llenar el alto disponible; si quedan bloques, «+n». El texto nunca se interpreta como HTML.
 */
export function NotePreview({ blocks, images, height, testID }: {
  readonly blocks: readonly NoteBlock[];
  readonly images: ReadonlyMap<string, string>;
  /** Alto en píxeles para los bloques (sin título ni pie). */
  readonly height: number;
  readonly testID: string;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const shown: { block: NoteBlock; lines: number; size: number }[] = [];
  let left = height - LINE; // reserva la línea de «+n»
  for (const block of blocks) {
    if (block.kind === 'image') {
      if (left < THUMB_MIN) break;
      const size = Math.min(THUMB, left);
      shown.push({ block, lines: 0, size });
      left -= size + GAP;
    } else {
      const lines = Math.min(markdownExcerpt(block.text).split('\n').length, Math.floor(left / LINE));
      if (lines <= 0) break;
      shown.push({ block, lines, size: 0 });
      left -= lines * LINE + GAP;
    }
  }
  const hidden = blocks.length - shown.length;
  return (
    <View testID={testID} style={styles.wrap}>
      {shown.map(({ block, lines, size }, index) => (block.kind === 'image' ? (
        images.get(block.ref) ? (
          <Image key={index} accessibilityRole="image" accessibilityLabel={block.alt || 'Imagen de la nota'} source={{ uri: images.get(block.ref) }}
            resizeMode="cover" style={[styles.thumb, { height: size, borderColor: colors.border }]} />
        ) : (
          <View key={index} accessibilityLabel={`Imagen no disponible: ${block.alt || block.ref}`} style={[styles.thumb, styles.missing, { height: size, borderColor: colors.border }]}>
            <Text numberOfLines={2} style={[styles.missingText, { color: colors.cardText }]}>{`▣ ${block.alt || 'Imagen'}`}</Text>
          </View>
        )
      ) : (
        // Se recortan las líneas en vez de usar solo numberOfLines: con 1, RN Web pone nowrap y juntaría los renglones de una lista.
        <Text key={index} numberOfLines={lines} style={[styles.text, { color: colors.cardText }]}>{markdownExcerpt(block.text).split('\n').slice(0, lines).join('\n')}</Text>
      )))}
      {hidden > 0 ? <Text style={[styles.more, { color: colors.cardText }]}>{`+${hidden} ${hidden === 1 ? 'bloque' : 'bloques'} más`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: GAP, flexShrink: 1, overflow: 'hidden' },
  text: { fontSize: 13, lineHeight: LINE },
  thumb: { height: THUMB, width: '100%', borderWidth: 1 },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  more: { fontSize: 12, lineHeight: LINE, fontWeight: '800' },
});
