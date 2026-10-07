import type { Card } from '@noutynotes/domain';
import { StyleSheet, View } from 'react-native';

import { shapeFillColor, shapeStrokeColor, shapeStrokePixels } from './shapeStyle';

/** Representación común de P14 para lienzo y futuras superficies, sin semántica de Relation. */
export function ShapePreview({ card, surface, strokeFallback, testID }: {
  readonly card: Card;
  readonly surface: string;
  readonly strokeFallback: string;
  readonly testID?: string;
}) {
  const kind = card.shapeKind ?? 'rectangle';
  const stroke = shapeStrokeColor(card.shapeStroke, strokeFallback, surface);
  const width = shapeStrokePixels(card.shapeStrokeWidth);
  if (kind === 'line') {
    return <View testID={testID} accessibilityRole="image" accessibilityLabel="Línea" style={styles.lineWrap}>
      <View style={[styles.line, { height: width, backgroundColor: stroke }]} />
    </View>;
  }
  return <View
    testID={testID}
    accessibilityRole="image"
    accessibilityLabel={kind === 'ellipse' ? 'Elipse' : kind === 'rounded-rectangle' ? 'Rectángulo redondeado' : 'Rectángulo'}
    style={[styles.shape, {
      backgroundColor: shapeFillColor(card.shapeFill, surface),
      borderColor: stroke,
      borderWidth: width,
      borderRadius: kind === 'ellipse' ? 999 : kind === 'rounded-rectangle' ? 18 : 0,
    }]}
  />;
}

const styles = StyleSheet.create({
  shape: { flex: 1, minWidth: 24, minHeight: 24 },
  lineWrap: { flex: 1, justifyContent: 'center' },
  line: { width: '100%' },
});
