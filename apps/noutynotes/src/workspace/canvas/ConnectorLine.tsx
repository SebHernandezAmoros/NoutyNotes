import type { Card } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';

import type { ConnectorRouteGeometry } from '../board-geometry';
import { shapeStrokeColor, shapeStrokePixels } from '../shapeStyle';

const ARROW_LENGTH = 10;
const ARROW_WIDTH = 7;
const MIN_TARGET = 44;

function Arrowhead({ x, y, angle, color }: { readonly x: number; readonly y: number; readonly angle: number; readonly color: string }) {
  return <View pointerEvents="none" style={[styles.pivot, { left: x, top: y, transform: [{ rotate: `${angle}deg` }] }]}>
    <View style={[styles.arrow, { borderLeftColor: color }]} />
  </View>;
}

function PointHandle(props: {
  readonly cardId: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly color: string;
  readonly onMove: (index: number, dx: number, dy: number) => void;
}) {
  const [responder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, state) => props.onMove(props.index, state.dx, state.dy),
  }));
  const target = MIN_TARGET / props.zoom;
  const visible = 10 / props.zoom;
  return <View
    testID={`connector-point-${props.cardId}-${props.index}`}
    accessibilityRole="adjustable"
    accessibilityLabel={props.index === 0 ? 'Extremo inicial del conector' : `Punto ${props.index + 1} del conector`}
    accessibilityHint="Arrastra para mover este punto; la ruta conservará ángulos rectos."
    focusable
    style={[styles.pointTarget, { left: props.x - target / 2, top: props.y - target / 2, width: target, height: target }]}
    {...responder.panHandlers}
  >
    <View style={{ width: visible, height: visible, backgroundColor: props.color, borderColor: '#ffffff', borderWidth: 1 }} />
  </View>;
}

/** Ruta decorativa P18-D: el propio trazo y sus puntos son la superficie de interacción. */
export function ConnectorLine(props: {
  readonly route: ConnectorRouteGeometry;
  readonly card: Card;
  readonly selected: boolean;
  readonly zoom: number;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
  readonly onPointMove: (index: number, dx: number, dy: number) => void;
}) {
  const { route, card } = props;
  const { theme } = useTheme();
  const color = shapeStrokeColor(card.connectorColor, theme.colors.border, theme.colors.canvas);
  const width = shapeStrokePixels(card.connectorWidth);
  const dash = card.connectorDash ?? 'solid';
  const arrows = card.connectorArrows ?? 'end';
  const lastTap = useRef(0);
  const press = () => {
    const now = Date.now();
    if (now - lastTap.current < 400) {
      lastTap.current = 0;
      props.onOpen();
    } else {
      lastTap.current = now;
      props.onSelect();
    }
  };
  const first = route.segments[0];
  const last = route.segments[route.segments.length - 1];
  return <View testID={`connector-${card.id}`} style={styles.overlay} pointerEvents="box-none">
    {route.segments.map((segment) => {
      const target = Math.max(MIN_TARGET / props.zoom, width);
      return <Pressable
        key={`${card.id}-${segment.index}`}
        testID={`connector-segment-${card.id}-${segment.index}`}
        accessibilityRole="button"
        accessibilityLabel={`Conector, tramo ${segment.index + 1} de ${route.segments.length}`}
        accessibilityHint="Toca para seleccionar; toca dos veces o mantén pulsado para editar."
        onPress={press}
        onLongPress={props.onOpen}
        style={[styles.lineTarget, { left: segment.left, top: segment.top - target / 2, width: segment.length, height: target, transform: [{ rotate: `${segment.angle}deg` }] }]}
      >
        <View style={dash === 'solid'
          ? [styles.solid, { height: width, backgroundColor: color }]
          : [styles.dashed, { borderTopWidth: width, borderTopColor: color, borderStyle: dash === 'dashed' ? 'dashed' : 'dotted' }]} />
      </Pressable>;
    })}
    {first && (arrows === 'start' || arrows === 'both') ? <Arrowhead x={first.startX} y={first.startY} angle={first.angle + 180} color={color} /> : null}
    {last && (arrows === 'end' || arrows === 'both') ? <Arrowhead x={last.endX} y={last.endY} angle={last.angle} color={color} /> : null}
    {props.selected && !route.legacy ? route.points.map((point, index) => (
      <PointHandle key={`${card.id}-point-${index}-${point.x}-${point.y}`} cardId={card.id} index={index} x={point.x} y={point.y}
        zoom={props.zoom} color={theme.colors.selection} onMove={props.onPointMove} />
    )) : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  lineTarget: { position: 'absolute', justifyContent: 'center' },
  solid: { width: '100%' },
  dashed: { width: '100%', height: 0 },
  pointTarget: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  pivot: { position: 'absolute', width: 0, height: 0 },
  arrow: { position: 'absolute', left: -ARROW_LENGTH, top: -ARROW_WIDTH, width: 0, height: 0,
    borderTopWidth: ARROW_WIDTH, borderBottomWidth: ARROW_WIDTH, borderLeftWidth: ARROW_LENGTH,
    borderTopColor: 'transparent', borderBottomColor: 'transparent' },
});
