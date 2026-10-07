import type { Card } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { StyleSheet, View } from 'react-native';

import type { ConnectorSegment } from '../board-geometry';
import { shapeStrokeColor, shapeStrokePixels } from '../shapeStyle';

const ARROW_LENGTH = 10;
const ARROW_WIDTH = 7;

function Arrowhead({ x, y, angle, color }: { readonly x: number; readonly y: number; readonly angle: number; readonly color: string }) {
  return <View pointerEvents="none" style={[styles.pivot, { left: x, top: y, transform: [{ rotate: `${angle}deg` }] }]}>
    <View style={[styles.arrow, { borderLeftColor: color }]} />
  </View>;
}

/** Trazo decorativo P15: no es interactivo ni semántico; la caja transparente de su Card lo selecciona. */
export function ConnectorLine({ segment, card }: { readonly segment: ConnectorSegment; readonly card: Card }) {
  const { theme } = useTheme();
  const color = shapeStrokeColor(card.connectorColor, theme.colors.border, theme.colors.canvas);
  const width = shapeStrokePixels(card.connectorWidth);
  const dash = card.connectorDash ?? 'solid';
  const arrows = card.connectorArrows ?? 'end';
  return <View testID={`connector-${card.id}`} style={styles.overlay} pointerEvents="none">
    <View style={[styles.lineBox, { left: segment.left, top: segment.top - width / 2, width: segment.length, height: width, transform: [{ rotate: `${segment.angle}deg` }] }]}>
      <View style={dash === 'solid'
        ? [styles.solid, { height: width, backgroundColor: color }]
        : [styles.dashed, { borderTopWidth: width, borderTopColor: color, borderStyle: dash === 'dashed' ? 'dashed' : 'dotted' }]} />
    </View>
    {arrows === 'start' || arrows === 'both' ? <Arrowhead x={segment.startX} y={segment.startY} angle={segment.angle + 180} color={color} /> : null}
    {arrows === 'end' || arrows === 'both' ? <Arrowhead x={segment.endX} y={segment.endY} angle={segment.angle} color={color} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  lineBox: { position: 'absolute', justifyContent: 'center' },
  solid: { width: '100%' },
  dashed: { width: '100%', height: 0 },
  pivot: { position: 'absolute', width: 0, height: 0 },
  arrow: { position: 'absolute', left: -ARROW_LENGTH, top: -ARROW_WIDTH, width: 0, height: 0,
    borderTopWidth: ARROW_WIDTH, borderBottomWidth: ARROW_WIDTH, borderLeftWidth: ARROW_LENGTH,
    borderTopColor: 'transparent', borderBottomColor: 'transparent' },
});
