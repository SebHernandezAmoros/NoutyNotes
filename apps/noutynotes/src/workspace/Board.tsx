import type { BoardLayout, Card, CardId, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import type { LayoutMode } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BOARD_ROW_HEIGHT, boardBoxes, relationSegments } from './board-geometry';
import type { CardBox } from './board-geometry';
import { ImagePlaceholder } from './ImagePlaceholder';

const BOARD_BORDER = 2;

export function cardTitle(card: Card): string {
  return card.title ?? 'Sin título';
}

export function isImageCard(workspace: Workspace, card: Card): boolean {
  return workspace.cardTypes.find((type) => type.id === card.typeId)?.base === 'image';
}

interface BoardProps {
  readonly workspace: Workspace;
  readonly layout: BoardLayout | undefined;
  readonly mode: LayoutMode;
  readonly selectedId: CardId | null;
  readonly onSelect: (cardId: CardId) => void;
}

/**
 * Vista de lista (ADR 0013): la proyección de una columna del layout canónico, en orden de lectura.
 * Solo representa y selecciona; mover y redimensionar se hacen en el lienzo o con el inspector.
 */
export function Board({ workspace, layout, mode, selectedId, onSelect }: BoardProps) {
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
  readonly box: CardBox;
  readonly card: Card;
  readonly image: boolean;
  readonly connections: number;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function CardView({ box, card, image, connections, selected, onPress }: CardViewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const textColor = image ? colors.textPrimary : colors.noteText;
  return (
    <Pressable
      testID={`card-${card.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Tarjeta ${cardTitle(card)}`}
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
      <Text numberOfLines={2} style={[styles.cardTitle, { color: textColor }]}>{cardTitle(card)}</Text>
      {image ? <ImagePlaceholder /> : (
        <Text numberOfLines={Math.max(1, Math.floor((box.height - 56) / 18))} style={[styles.cardContent, { color: textColor }]}>
          {card.content ?? ''}
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
  badge: { fontSize: 11, fontWeight: '700', marginTop: 'auto' },
});
