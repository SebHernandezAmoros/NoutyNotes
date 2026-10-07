import type { ConnectorArrows, ConnectorDash, ConnectorDirection, ShapeStroke, ShapeStrokeWidth } from '@noutynotes/domain';
import { StyleSheet, Text, View } from 'react-native';

import { shapeStrokeColor, shapeStrokePixels } from './shapeStyle';

/** Solo los campos de estilo de P15: una `Card` los cumple, y también una `PrintEntry` (P16). */
export interface ConnectorStyle {
  readonly connectorColor?: ShapeStroke;
  readonly connectorWidth?: ShapeStrokeWidth;
  readonly connectorDash?: ConnectorDash;
  readonly connectorArrows?: ConnectorArrows;
  readonly connectorDirection?: ConnectorDirection;
}

/**
 * Representación autocontenida de un conector (P15) para superficies sin la geometría del lienzo
 * (Lista, Presentación — P16): un trazo con el mismo color/grosor/estilo/puntas que `ConnectorLine`,
 * sin depender de los anclajes reales. No es una `Relation`: solo ilustra la apariencia guardada.
 */
export function ConnectorPreview({ card, surface, strokeFallback, testID }: {
  readonly card: ConnectorStyle;
  readonly surface: string;
  readonly strokeFallback: string;
  readonly testID?: string;
}) {
  const color = shapeStrokeColor(card.connectorColor, strokeFallback, surface);
  const width = shapeStrokePixels(card.connectorWidth);
  const dash = card.connectorDash ?? 'solid';
  const arrows = card.connectorArrows ?? 'end';
  const rotate = (card.connectorDirection ?? 'down') === 'up' ? '-18deg' : '18deg';
  return (
    <View testID={testID} accessibilityRole="image" accessibilityLabel="Conector" style={[styles.row, { transform: [{ rotate }] }]}>
      <Text style={[styles.arrow, { color }]}>{arrows === 'start' || arrows === 'both' ? '◀' : ''}</Text>
      <View style={dash === 'solid'
        ? [styles.solid, { height: width, backgroundColor: color }]
        : [styles.dashed, { borderTopWidth: width, borderTopColor: color, borderStyle: dash === 'dashed' ? 'dashed' : 'dotted' }]} />
      <Text style={[styles.arrow, { color }]}>{arrows === 'end' || arrows === 'both' ? '▶' : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '100%' },
  arrow: { fontSize: 14, fontWeight: '900' },
  solid: { flex: 1, minWidth: 24 },
  dashed: { flex: 1, minWidth: 24, height: 0 },
});
