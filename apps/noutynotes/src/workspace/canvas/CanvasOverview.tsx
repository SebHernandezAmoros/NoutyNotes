import { footprint } from '@noutynotes/domain';
import type { BoardLayout } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

import { ActionButton } from '../../components/controls';
import { cardBox } from './geometry';
import type { CanvasMetrics } from './geometry';
import { contentBounds, minimap, panToCenter, visibleWorld } from './overview';
import { MAX_ZOOM, MIN_ZOOM, formatZoom } from './viewport';
import type { Point, Size } from './viewport';

interface CanvasOverviewProps {
  readonly layout: BoardLayout | undefined;
  readonly metrics: CanvasMetrics;
  readonly zoom: number;
  readonly pan: Point;
  readonly viewport: Size;
  /** Móvil: el zoom va aquí (en escritorio ya está en la barra). */
  readonly showZoom: boolean;
  readonly minimapOpen: boolean;
  readonly onToggleMinimap: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
  readonly onFit: () => void;
  readonly onPan: (pan: Point) => void;
}

const MAP_PADDING = 6;

/**
 * Controles inferiores del lienzo (ADR 0028): «Ver todo», minimapa y, en móvil, el zoom. El minimapa
 * dibuja tarjetas y marcos a escala y la zona visible; tocar un punto centra la vista ahí.
 */
export function CanvasOverview(props: CanvasOverviewProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { layout, metrics, zoom, pan, viewport } = props;
  const mapSize: Size = props.showZoom ? { width: 150, height: 96 } : { width: 190, height: 120 };
  const bounds = contentBounds(layout, metrics);
  const view = visibleWorld(pan, zoom, viewport);
  const map = minimap(bounds, view, mapSize, MAP_PADDING);
  const cards = layout?.placements.length ?? 0;
  const frames = layout?.frames?.length ?? 0;
  const go = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    props.onPan(panToCenter(map.toWorld({ x: locationX, y: locationY }), zoom, viewport));
  };
  const viewBox = map.toMap(view);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {props.minimapOpen ? (
        <View
          testID="canvas-minimap"
          accessibilityRole="button"
          accessibilityLabel={`Minimapa: ${cards === 1 ? '1 tarjeta' : `${cards} tarjetas`}${frames > 0 ? ` y ${frames === 1 ? '1 marco' : `${frames} marcos`}` : ''}; toca para ir a esa zona`}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderRelease={go}
          style={[styles.map, { width: mapSize.width, height: mapSize.height, backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {(layout?.frames ?? []).map((frame) => (
            <View key={frame.id} pointerEvents="none" style={[styles.box, map.toMap(cardBox(frame.rect, metrics)), { borderColor: colors.textSecondary, borderWidth: 1 }]} />
          ))}
          {(layout?.placements ?? []).map((placement) => (
            <View key={placement.cardId} pointerEvents="none" style={[styles.box, map.toMap(cardBox(footprint(placement), metrics)), { backgroundColor: colors.textSecondary }]} />
          ))}
          <View testID="minimap-view" pointerEvents="none" style={[styles.box, viewBox, { borderColor: colors.selection, borderWidth: 2 }]} />
        </View>
      ) : null}
      <View testID="canvas-controls" style={[styles.controls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {props.showZoom ? (
          <>
            <ActionButton label="−" accessibilityLabel="Alejar la vista" disabled={zoom <= MIN_ZOOM} onPress={props.onZoomOut} style={styles.button} />
            <ActionButton testID="canvas-zoom" label={formatZoom(zoom)} accessibilityLabel={`Zoom ${formatZoom(zoom)}, restablecer la vista`} onPress={props.onZoomReset} style={styles.button} />
            <ActionButton label="+" accessibilityLabel="Acercar la vista" disabled={zoom >= MAX_ZOOM} onPress={props.onZoomIn} style={styles.button} />
          </>
        ) : null}
        <ActionButton label="⌖" accessibilityLabel="Ver todo el tablero" onPress={props.onFit} style={styles.button} />
        <ActionButton label="▦" accessibilityLabel={props.minimapOpen ? 'Ocultar el minimapa' : 'Mostrar el minimapa'} pressed={props.minimapOpen} onPress={props.onToggleMinimap} style={styles.button} />
      </View>
      {bounds === null && props.minimapOpen ? <Text style={[styles.empty, { color: colors.textSecondary }]}>Tablero vacío</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Por encima de los controles de las tarjetas (zIndex 30), que si no taparían el minimapa.
  wrap: { position: 'absolute', right: 8, bottom: 8, alignItems: 'flex-end', gap: 6, zIndex: 40 },
  map: { borderWidth: 2, overflow: 'hidden' },
  box: { position: 'absolute' },
  controls: { flexDirection: 'row', gap: 4, padding: 4, borderWidth: 2 },
  button: { paddingHorizontal: 8 },
  empty: { fontSize: 12 },
});
