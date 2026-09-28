import type { Relation } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';

import type { RelationSegment } from '../board-geometry';

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
}

/**
 * Línea de conexión (ADR 0034): sin punta, con una (hacia `to`) o con dos (`arrow`, independiente de
 * `from`/`to`), y su rótulo como texto legible sobre la línea, sin depender solo del color.
 */
export function RelationLine({ segment, relation, typeLabel, highlighted }: RelationLineProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const color = highlighted ? colors.selection : colors.relationLine;
  const arrow = relation.arrow ?? 'forward';
  const midX = (segment.startX + segment.endX) / 2;
  const midY = (segment.startY + segment.endY) / 2;
  return (
    <View testID={`relation-${segment.relationId}`} style={styles.overlay}>
      <View
        testID={`relation-line-${segment.relationId}`}
        accessibilityLabel={`Conexión ${typeLabel}${relation.label ? `: ${relation.label}` : ''}`}
        style={[styles.line, {
          left: segment.left, top: segment.top - 1, width: segment.length, height: highlighted ? 3 : 2,
          backgroundColor: color, transform: [{ rotate: `${segment.angle}deg` }],
        }]}
      />
      {arrow !== 'none' ? <Arrowhead x={segment.endX} y={segment.endY} angle={segment.angle} color={color} /> : null}
      {arrow === 'both' ? <Arrowhead x={segment.startX} y={segment.startY} angle={segment.angle + 180} color={color} /> : null}
      {relation.label ? (
        <View testID={`relation-label-${segment.relationId}`} style={[styles.label, { left: midX, top: midY, backgroundColor: colors.surface, borderColor: color }]}>
          <Text numberOfLines={1} style={[styles.labelText, { color: colors.textPrimary }]}>{relation.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  line: { position: 'absolute' },
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
