import type { Relation } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RelationSegment } from '../board-geometry';

/** Alto invisible del área de toque de la línea, centrado en ella: 2 px reales serían imposibles de tocar. */
const HIT_HEIGHT = 24;

const ARROW_LENGTH = 10;
const ARROW_WIDTH = 7;

/**
 * Punta de flecha (ADR 0034): un triángulo por bordes, sin dependencias nuevas. El contenedor exterior
 * mide 0 × 0 en la punta exacta (`x`, `y`): al rotarlo, gira sobre ese punto y no sobre su propio centro,
 * porque el triángulo interior está descentrado respecto a él.
 */
function Arrowhead({ x, y, angle, color }: { readonly x: number; readonly y: number; readonly angle: number; readonly color: string }) {
  return (
    <View pointerEvents="none" style={[styles.pivot, { left: x, top: y, transform: [{ rotate: `${angle}deg` }] }]}>
      <View style={[styles.arrow, { borderLeftColor: color }]} />
    </View>
  );
}

interface RelationLineProps {
  readonly segment: RelationSegment;
  readonly relation: Relation;
  readonly typeLabel: string;
  readonly highlighted: boolean;
  /** Línea con su menú de conexión abierto (auditoría de interacción, 2026-09-29): borde propio, no
      solo el color que ya usa `highlighted` para «conectada con la tarjeta seleccionada». */
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/**
 * Línea de conexión (ADR 0034): sin punta, con una (hacia `to`) o con dos (`arrow`, independiente de
 * `from`/`to`), y su rótulo como texto legible sobre la línea, sin depender solo del color. Tocarla o
 * pulsarla abre su menú (flechas, tipo, rótulo, desconectar) sin pasar por el inspector completo de
 * ninguna de las dos tarjetas (auditoría de interacción, 2026-09-29).
 */
export function RelationLine({ segment, relation, typeLabel, highlighted, selected, onSelect }: RelationLineProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const color = selected || highlighted ? colors.selection : colors.relationLine;
  const arrow = relation.arrow ?? 'forward';
  const midX = (segment.startX + segment.endX) / 2;
  const midY = (segment.startY + segment.endY) / 2;
  return (
    <View testID={`relation-${segment.relationId}`} style={styles.overlay} pointerEvents="box-none">
      <Pressable
        testID={`relation-line-${segment.relationId}`}
        accessibilityRole="button"
        accessibilityLabel={`Conexión ${typeLabel}${relation.label ? `: ${relation.label}` : ''}`}
        onPress={onSelect}
        hitSlop={8}
        style={[styles.hit, {
          left: segment.left, top: segment.top - HIT_HEIGHT / 2, width: segment.length,
          transform: [{ rotate: `${segment.angle}deg` }],
        }]}
      >
        <View style={[styles.line, { height: selected || highlighted ? 3 : 2, backgroundColor: color }]} />
      </Pressable>
      {arrow !== 'none' ? <Arrowhead x={segment.endX} y={segment.endY} angle={segment.angle} color={color} /> : null}
      {arrow === 'both' ? <Arrowhead x={segment.startX} y={segment.startY} angle={segment.angle + 180} color={color} /> : null}
      {relation.label ? (
        <View testID={`relation-label-${segment.relationId}`} style={[styles.label, { left: midX, top: midY, backgroundColor: colors.surface, borderColor: color }]} pointerEvents="none">
          <Text numberOfLines={1} style={[styles.labelText, { color: colors.textPrimary }]}>{relation.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hit: { position: 'absolute', height: HIT_HEIGHT, justifyContent: 'center' },
  line: { width: '100%' },
  pivot: { position: 'absolute', width: 0, height: 0 },
  arrow: {
    position: 'absolute', left: -ARROW_LENGTH, top: -ARROW_WIDTH, width: 0, height: 0,
    borderTopWidth: ARROW_WIDTH, borderBottomWidth: ARROW_WIDTH, borderLeftWidth: ARROW_LENGTH,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
  },
  label: {
    position: 'absolute', borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2,
    maxWidth: 160, transform: [{ translateX: -80 }, { translateY: -10 }],
  },
  labelText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
