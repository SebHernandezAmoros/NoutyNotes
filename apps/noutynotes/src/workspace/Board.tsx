import { parseNoteBlocks } from '@noutynotes/application';
import type { RichTextCodec } from '@noutynotes/application';
import type { BoardLayout, Card, CardId, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import type { Locale, LayoutMode } from '@noutynotes/ui';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BOARD_ROW_HEIGHT, boardBoxes, relationSegments } from './board-geometry';
import type { CardBox } from './board-geometry';
import { ImagePlaceholder } from './ImagePlaceholder';
import { t } from '../i18n';
import { markdownExcerpt } from './markdownLists';
import { bodyFontSize, bodyLineHeight, titleFontSize, titleLineHeight } from './textSizes';
import { NotePreview } from './canvas/NotePreview';
import { BasicRichTextPreview } from './BasicRichTextPreview';
import { parseWebRichText } from './basicRichText';

const BOARD_BORDER = 2;
const emptyNoteImages: ReadonlyMap<string, string> = new Map();

/** Etiqueta útil (búsquedas, menús, listas, accesibilidad): localizada, nunca vacía. */
export function cardTitle(card: Card, locale: Locale): string {
  if (card.typeId === 'forma') {
    const labels = locale === 'es'
      ? { rectangle: 'Rectángulo', 'rounded-rectangle': 'Rectángulo redondeado', ellipse: 'Elipse', line: 'Línea' }
      : { rectangle: 'Rectangle', 'rounded-rectangle': 'Rounded rectangle', ellipse: 'Ellipse', line: 'Line' };
    return labels[card.shapeKind ?? 'rectangle'];
  }
  if (card.typeId === 'texto-flotante') {
    const summary = (card.content ?? '').split('\n').find((line) => line.trim() !== '')?.trim();
    return summary ? summary.slice(0, 80) : (locale === 'es' ? 'Texto vacío' : 'Empty text');
  }
  return card.title ?? t('card.untitled', locale);
}

/** Texto visible sobre la propia ficha (UX7-A4): vacío si no hay título, sin «Sin título» de relleno. */
export function cardDisplayTitle(card: Card): string {
  return card.title ?? '';
}

export function isImageCard(workspace: Workspace, card: Card): boolean {
  return workspace.cardTypes.find((type) => type.id === card.typeId)?.base === 'image';
}

interface BoardProps {
  readonly richTextCodec: RichTextCodec;
  readonly workspace: Workspace;
  readonly layout: BoardLayout | undefined;
  readonly mode: LayoutMode;
  readonly selectedId: CardId | null;
  readonly onSelect: (cardId: CardId) => void;
  /** Vista previa de una ficha de imagen única; sin ella, de ejemplo (UX7-C3, igual que el lienzo). */
  readonly imageUris?: ReadonlyMap<CardId, string>;
  /** Imágenes intercaladas en una nota (UX7-C3, igual que `CanvasCard`/`NotePreview`). */
  readonly noteImages?: ReadonlyMap<string, string>;
}

/**
 * Vista de lista (ADR 0013): la proyección de una columna del layout canónico, en orden de lectura.
 * Solo representa y selecciona; mover y redimensionar se hacen en el lienzo o con el inspector.
 */
export function Board({ workspace, layout, mode, selectedId, onSelect, imageUris, noteImages, richTextCodec }: BoardProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [width, setWidth] = useState(0);
  const geometry = boardBoxes(layout ?? { boardId: '' as BoardLayout['boardId'], placements: [] }, mode, width);
  const cards = new Map(workspace.cards.map((card) => [card.id, card]));
  const segments = mode === 'wide' && geometry ? relationSegments(workspace.relations, geometry.boxes) : [];
  const empty = !layout || layout.placements.length === 0;

  return (
    <View
      testID="board-list"
      accessibilityLabel={`Lista del tablero en ${mode === 'wide' ? 'grilla de 12 columnas' : 'una columna'}`}
      onLayout={(event) => setWidth(Math.max(0, event.nativeEvent.layout.width - 2 * BOARD_BORDER))}
      style={[styles.board, { height: (geometry?.height ?? 3 * BOARD_ROW_HEIGHT) + 2 * BOARD_BORDER, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {mode === 'wide' && width > 0
        ? Array.from({ length: 11 }, (_, index) => (
          <View key={index} style={[styles.columnLine, { left: ((index + 1) * width) / 12, backgroundColor: colors.gridLine }]} />
        ))
        : null}
      {empty ? (
        <View testID="board-empty" style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Este tablero está vacío. Añade una nota o una imagen de ejemplo para empezar.
          </Text>
        </View>
      ) : null}
      {geometry?.boxes.map((box) => {
        const card = cards.get(box.cardId);
        return card ? (
          <CardView
            key={box.cardId}
            box={box}
            card={card}
            image={isImageCard(workspace, card)}
            imageUri={imageUris?.get(card.id)}
            noteImages={noteImages ?? emptyNoteImages}
            richTextCodec={richTextCodec}
            connections={workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id).length}
            selected={selectedId === card.id}
            onPress={() => onSelect(card.id)}
          />
        ) : null;
      })}
      {/* Encima de las tarjetas pero sin capturar toques; el punto marca el destino. */}
      {segments.map((segment) => (
        <View key={segment.relationId} style={styles.overlay}>
          <View
            testID={`relation-line-${segment.relationId}`}
            style={[styles.relationLine, {
              left: segment.left, top: segment.top - 1, width: segment.length,
              backgroundColor: colors.relationLine, transform: [{ rotate: `${segment.angle}deg` }],
            }]}
          />
          <View style={[styles.relationEnd, { left: segment.endX - 5, top: segment.endY - 5, backgroundColor: colors.relationLine }]} />
        </View>
      ))}
    </View>
  );
}

interface CardViewProps {
  readonly richTextCodec: RichTextCodec;
  readonly box: CardBox;
  readonly card: Card;
  readonly image: boolean;
  /** Vista previa real de una ficha de imagen única; sin ella, de ejemplo (UX7-C3). */
  readonly imageUri: string | undefined;
  /** Imágenes intercaladas en una nota (UX7-C3): mismo mapa que usa el lienzo. */
  readonly noteImages: ReadonlyMap<string, string>;
  readonly connections: number;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function CardView({ box, card, image, imageUri, noteImages, connections, selected, onPress, richTextCodec }: CardViewProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const textColor = image ? colors.textPrimary : colors.noteText;
  // UX7-C3: antes, Lista mostraba el Markdown crudo de la nota (incluida la sintaxis `![...](...)`
  // de una imagen) o siempre un marcador de ejemplo para una ficha de imagen única, sin la imagen real.
  const bodyHeight = Math.max(0, box.height - 56);
  const blocks = image ? [] : parseNoteBlocks(card.content ?? '');
  const mixed = blocks.some((block) => block.kind === 'image');
  const richDocument = image || mixed ? null : parseWebRichText(richTextCodec, card.content ?? '');
  // Tamaño semántico por ficha (ADR 0050): mismo mapa que el lienzo y la impresión.
  const titleSize = titleFontSize(card.titleSize);
  const bodySize = bodyFontSize(card.bodySize);
  const bodyLine = bodyLineHeight(bodySize);
  return (
    <Pressable
      testID={`card-${card.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Tarjeta ${cardTitle(card, locale)}`}
      accessibilityState={{ selected }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.card, {
        left: box.left, top: box.top, width: box.width, height: box.height,
        backgroundColor: image ? colors.surfaceRaised : colors.note,
        borderColor: selected || focused ? colors.selection : colors.border,
        borderWidth: selected ? 4 : focused ? 3 : 2,
      }]}
    >
      <Text numberOfLines={2} style={[styles.cardTitle, { color: textColor, fontSize: titleSize, lineHeight: titleLineHeight(titleSize) }]}>{cardTitle(card, locale)}</Text>
      {image ? (
        imageUri ? (
          <Image testID={`list-image-${card.id}`} accessibilityRole="image" accessibilityLabel={`Imagen ${cardTitle(card, locale)}`}
            source={{ uri: imageUri }} resizeMode="contain" style={[styles.cardImage, { borderColor: colors.border, backgroundColor: colors.surface }]} />
        ) : <ImagePlaceholder />
      ) : mixed ? (
        <NotePreview testID={`list-note-preview-${card.id}`} blocks={blocks} images={noteImages} height={bodyHeight} bodySize={card.bodySize} captionPosition={card.captionPosition} />
      ) : richDocument ? (
        <BasicRichTextPreview
          document={richDocument}
          numberOfLines={Math.max(1, Math.floor(bodyHeight / bodyLine))}
          color={textColor}
          fontSize={bodySize}
          lineHeight={bodyLine}
          testID={`list-rich-text-${card.id}`}
        />
      ) : (
        <Text numberOfLines={Math.max(1, Math.floor(bodyHeight / bodyLine))} style={[styles.cardContent, { color: textColor, fontSize: bodySize, lineHeight: bodyLine }]}>
          {markdownExcerpt(card.content ?? '')}
        </Text>
      )}
      {connections > 0 ? (
        <Text style={[styles.badge, { color: textColor }]}>{connections === 1 ? '1 conexión' : `${connections} conexiones`}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  board: { position: 'relative', width: '100%', borderWidth: BOARD_BORDER, overflow: 'hidden' },
  columnLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  relationLine: { position: 'absolute', height: 2 },
  relationEnd: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  emptyState: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 16 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  card: { position: 'absolute', padding: 8, gap: 6, overflow: 'hidden' },
  cardTitle: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  cardContent: { fontSize: 13, lineHeight: 18 },
  cardImage: { flex: 1, minHeight: 24, borderWidth: 1 },
  badge: { fontSize: 11, fontWeight: '700', marginTop: 'auto' },
});
