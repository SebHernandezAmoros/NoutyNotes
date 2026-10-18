import type { NoteBlock } from '@noutynotes/application';
import type { CaptionPosition, ImageFit, TextSize } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ColorValue } from 'react-native';

import { t } from '../../i18n';
import { markdownExcerpt } from '../markdownLists';
import { bodyFontSize, bodyLineHeight } from '../textSizes';
import type { ImageResourceState } from '../imageResources';
import { bannerImageBudget } from './bannerImageBudget';

// La miniatura se adapta al alto que queda (entre 32 y 72 px): en una ficha pequeña también se ve.
const THUMB = 72;
const THUMB_MIN = 32;
const GAP = 6;

/**
 * Ficha de una nota con imágenes (ADR 0021): texto resumido e imágenes en el orden del documento
 * hasta llenar el alto disponible; si quedan bloques, «+n». El texto nunca se interpreta como HTML.
 * En composición `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1), la imagen aprovecha el espacio que el texto
 * no necesita en vez de quedar fija en `THUMB`; `document` no cambia.
 */
export function NotePreview({ blocks, imageResources, height, testID, fontFamily, bodySize, captionPosition, imageFit, banner }: {
  readonly blocks: readonly NoteBlock[];
  readonly imageResources: ReadonlyMap<string, ImageResourceState>;
  /** Alto en píxeles para los bloques (sin título ni pie). */
  readonly height: number;
  readonly testID: string;
  /** Tipografía de las notas (ADR 0030); sin ella, la de la app. */
  readonly fontFamily?: string | undefined;
  /** Tamaño semántico del cuerpo (ADR 0050); sin él, `'medium'`. */
  readonly bodySize?: TextSize | undefined;
  /** Posición de la leyenda de imagen (ADR 0051); sin ella, `'bottom'`. */
  readonly captionPosition?: CaptionPosition | undefined;
  /** Ajuste efectivo ya resuelto por el llamador (OBS-N2-IMAGE-FIT-F2, `resolveCardImageFit`). */
  readonly imageFit: ImageFit;
  /** Si la composición efectiva es `banner` (OBS-N2-28/IMAGE-GEOMETRY-G1): la imagen puede crecer más
   * allá del histórico `THUMB`, cediendo solo lo que el texto realmente necesita. Una Nota `document`
   * conserva exactamente el reparto histórico. */
  readonly banner: boolean;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const textSize = bodyFontSize(bodySize);
  const LINE = bodyLineHeight(textSize);
  const captionSize = 11;
  const auxiliarySize = 12;
  const position = captionPosition ?? 'bottom';
  // «left»/«right» ponen la leyenda junto a la imagen, en una fila: no compite por el presupuesto
  // vertical de bloques (solo por ancho), así que la imagen no necesita encogerse para hacerle sitio
  // como sí hace «bottom»/«top».
  const sideways = position === 'left' || position === 'right';
  const shown: { block: NoteBlock; lines: number; size: number; caption: boolean }[] = [];
  let left = height - LINE; // reserva la línea de «+n»
  // OBS-N2-28/G1: solo para la composición banner, la imagen recibe lo que el texto no necesita; una
  // Nota document conserva el techo histórico `THUMB` sin ningún cálculo adicional.
  const imageBudget = banner ? bannerImageBudget(blocks, left, LINE, GAP, THUMB) : THUMB;
  for (const block of blocks) {
    if (block.kind === 'image') {
      if (left < THUMB_MIN) break;
      const maxSize = Math.min(imageBudget, left);
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
  const imageNode = (block: Extract<NoteBlock, { kind: 'image' }>, size: number, flexStyle: { flex: number } | null, blockIndex: number) => {
    const resource = imageResources.get(block.ref);
    if (resource?.status === 'ready') {
      return (
        <Image testID={`${testID}-image-${blockIndex}`} accessibilityRole="image" accessibilityLabel={block.alt || 'Imagen de la nota'} source={{ uri: resource.uri }}
          // OBS-N2-IMAGE-FIT-F2: el ajuste ya viene resuelto por el llamador (`resolveCardImageFit`), nunca se recalcula aquí.
          resizeMode={imageFit} style={[styles.thumb, {
            height: size, borderColor: colors.border, backgroundColor: colors.surface,
            objectFit: imageFit,
          }, flexStyle]} />
      );
    }
    const text = resource?.status === 'loading' ? t('image.loading', locale) : t('image.unavailable', locale);
    const label = resource?.status === 'loading' ? text : `${text}: ${block.alt || block.ref}`;
    return (
      <View accessibilityLabel={label} style={[styles.thumb, styles.missing, { height: size, borderColor: colors.border }, flexStyle]}>
        <Text numberOfLines={2} style={[styles.missingText, { color: colors.cardText, fontSize: auxiliarySize, lineHeight: LINE }]}>{text}</Text>
      </View>
    );
  };
  const captionNode = (block: Extract<NoteBlock, { kind: 'image' }>, size: number, color: ColorValue) => (
    sideways ? (
      <Text numberOfLines={Math.max(1, Math.floor(size / LINE))} style={[styles.caption, styles.captionSide, { color, fontSize: captionSize, lineHeight: LINE }]}>{block.alt}</Text>
    ) : (
      <Text numberOfLines={1} style={[styles.caption, { color, fontSize: captionSize, lineHeight: LINE }]}>{block.alt}</Text>
    )
  );
  return (
    <View testID={testID} style={styles.wrap}>
      {shown.map(({ block, lines, size, caption }, index) => (block.kind === 'image' ? (
        sideways && caption ? (
          <View key={index} style={styles.imageRow}>
            {position === 'left' ? captionNode(block, size, colors.cardText) : null}
            {imageNode(block, size, { flex: 2 }, index)}
            {position === 'right' ? captionNode(block, size, colors.cardText) : null}
          </View>
        ) : (
          <View key={index} style={styles.imageBlock}>
            {position === 'top' && caption ? captionNode(block, size, colors.cardText) : null}
            {imageNode(block, size, null, index)}
            {position !== 'top' && caption ? captionNode(block, size, colors.cardText) : null}
          </View>
        )
      ) : (
        // Se recortan las líneas en vez de usar solo numberOfLines: con 1, RN Web pone nowrap y juntaría los renglones de una lista.
        <Text key={index} numberOfLines={lines} style={[{ color: colors.cardText, fontSize: textSize, lineHeight: LINE }, fontFamily === undefined ? null : { fontFamily }]}>{markdownExcerpt(block.text).split('\n').slice(0, lines).join('\n')}</Text>
      )))}
      {hidden > 0 ? <Text style={[styles.more, { color: colors.cardText, fontSize: auxiliarySize, lineHeight: LINE }]}>{`+${hidden} ${hidden === 1 ? 'bloque' : 'bloques'} más`}</Text> : null}
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
