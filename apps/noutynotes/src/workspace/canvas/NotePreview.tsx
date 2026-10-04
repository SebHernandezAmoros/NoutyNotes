import type { NoteBlock } from '@noutynotes/application';
import type { CaptionPosition, TextSize } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ColorValue } from 'react-native';

import { markdownExcerpt } from '../markdownLists';
import { bodyFontSize, bodyLineHeight } from '../textSizes';

// La miniatura se adapta al alto que queda (entre 32 y 72 px): en una ficha pequeña también se ve.
const THUMB = 72;
const THUMB_MIN = 32;
const GAP = 6;

/**
 * Ficha de una nota con imágenes (ADR 0021): texto resumido e imágenes en el orden del documento
 * hasta llenar el alto disponible; si quedan bloques, «+n». El texto nunca se interpreta como HTML.
 */
export function NotePreview({ blocks, images, height, testID, fontFamily, bodySize, captionPosition }: {
  readonly blocks: readonly NoteBlock[];
  readonly images: ReadonlyMap<string, string>;
  /** Alto en píxeles para los bloques (sin título ni pie). */
  readonly height: number;
  readonly testID: string;
  /** Tipografía de las notas (ADR 0030); sin ella, la de la app. */
  readonly fontFamily?: string | undefined;
  /** Tamaño semántico del cuerpo (ADR 0050); sin él, `'medium'`. */
  readonly bodySize?: TextSize | undefined;
  /** Posición de la leyenda de imagen (ADR 0051); sin ella, `'bottom'`. */
  readonly captionPosition?: CaptionPosition | undefined;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const textSize = bodyFontSize(bodySize);
  const LINE = bodyLineHeight(textSize);
  const position = captionPosition ?? 'bottom';
  // «left»/«right» ponen la leyenda junto a la imagen, en una fila: no compite por el presupuesto
  // vertical de bloques (solo por ancho), así que la imagen no necesita encogerse para hacerle sitio
  // como sí hace «bottom»/«top».
  const sideways = position === 'left' || position === 'right';
  const shown: { block: NoteBlock; lines: number; size: number; caption: boolean }[] = [];
  let left = height - LINE; // reserva la línea de «+n»
  for (const block of blocks) {
    if (block.kind === 'image') {
      if (left < THUMB_MIN) break;
      const maxSize = Math.min(THUMB, left);
      // UX7-C4/ADR 0051: el texto alternativo ya existía (se guarda en el propio Markdown) pero nunca
      // se veía, solo servía de nombre accesible; ahora se muestra también como leyenda. Casi toda
      // imagen tiene un valor (el nombre del archivo, si no se escribió uno propio), así que reservarle
      // una línea fija habría podido dejar fuera una imagen que antes cabía entera: en vez de eso, con
      // «bottom»/«top» la leyenda encoge la imagen (nunca por debajo de `THUMB_MIN`) y, si ni así cabe,
      // se omite la leyenda — la imagen nunca se omite por su culpa.
      const wantsCaption = block.alt !== '';
      const size = !sideways && wantsCaption && left - maxSize < LINE ? Math.max(THUMB_MIN, Math.min(maxSize, left - LINE)) : maxSize;
      const caption = sideways ? wantsCaption : wantsCaption && left - size >= LINE;
      shown.push({ block, lines: 0, size, caption });
      left -= size + (!sideways && caption ? LINE : 0) + GAP;
    } else {
      const lines = Math.min(markdownExcerpt(block.text).split('\n').length, Math.floor(left / LINE));
      if (lines <= 0) break;
      shown.push({ block, lines, size: 0, caption: false });
      left -= lines * LINE + GAP;
    }
  }
  const hidden = blocks.length - shown.length;
  const imageNode = (block: Extract<NoteBlock, { kind: 'image' }>, size: number, flexStyle: { flex: number } | null) => (
    images.get(block.ref) ? (
      <Image accessibilityRole="image" accessibilityLabel={block.alt || 'Imagen de la nota'} source={{ uri: images.get(block.ref) }}
        // «contain», no «cover» (UX7-C2, mismo criterio que la ficha de imagen única en CanvasCard):
        // recortar sin que la persona lo pida oculta parte de su imagen.
        resizeMode="contain" style={[styles.thumb, { height: size, borderColor: colors.border, backgroundColor: colors.surface }, flexStyle]} />
    ) : (
      <View accessibilityLabel={`Imagen no disponible: ${block.alt || block.ref}`} style={[styles.thumb, styles.missing, { height: size, borderColor: colors.border }, flexStyle]}>
        <Text numberOfLines={2} style={[styles.missingText, { color: colors.cardText }]}>{`▣ ${block.alt || 'Imagen'}`}</Text>
      </View>
    )
  );
  const captionNode = (block: Extract<NoteBlock, { kind: 'image' }>, size: number, color: ColorValue) => (
    sideways ? (
      <Text numberOfLines={Math.max(1, Math.floor(size / LINE))} style={[styles.caption, styles.captionSide, { color }]}>{block.alt}</Text>
    ) : (
      <Text numberOfLines={1} style={[styles.caption, { color, lineHeight: LINE }]}>{block.alt}</Text>
    )
  );
  return (
    <View testID={testID} style={styles.wrap}>
      {shown.map(({ block, lines, size, caption }, index) => (block.kind === 'image' ? (
        sideways && caption ? (
          <View key={index} style={styles.imageRow}>
            {position === 'left' ? captionNode(block, size, colors.cardText) : null}
            {imageNode(block, size, { flex: 2 })}
            {position === 'right' ? captionNode(block, size, colors.cardText) : null}
          </View>
        ) : (
          <View key={index} style={styles.imageBlock}>
            {position === 'top' && caption ? captionNode(block, size, colors.cardText) : null}
            {imageNode(block, size, null)}
            {position !== 'top' && caption ? captionNode(block, size, colors.cardText) : null}
          </View>
        )
      ) : (
        // Se recortan las líneas en vez de usar solo numberOfLines: con 1, RN Web pone nowrap y juntaría los renglones de una lista.
        <Text key={index} numberOfLines={lines} style={[{ color: colors.cardText, fontSize: textSize, lineHeight: LINE }, fontFamily === undefined ? null : { fontFamily }]}>{markdownExcerpt(block.text).split('\n').slice(0, lines).join('\n')}</Text>
      )))}
      {hidden > 0 ? <Text style={[styles.more, { color: colors.cardText, lineHeight: LINE }]}>{`+${hidden} ${hidden === 1 ? 'bloque' : 'bloques'} más`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: GAP, flexShrink: 1, overflow: 'hidden' },
  imageBlock: { gap: 2 },
  imageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: GAP },
  thumb: { height: THUMB, width: '100%', borderWidth: 1 },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  missingText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  caption: { fontSize: 11, fontStyle: 'italic' },
  captionSide: { flex: 1 },
  more: { fontSize: 12, fontWeight: '800' },
});
