import type { Frame } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { isDrag } from './geometry';
import type { PixelBox } from './geometry';

/** Lo que el lienzo hace con el título del marco: seleccionar o arrastrar (ADR 0027). */
export interface FrameGestures {
  canDrag(): boolean;
  press(frameId: string): void;
  begin(frameId: string): void;
  update(dx: number, dy: number): void;
  finish(dx: number, dy: number): void;
  abort(): void;
}

interface CanvasFrameProps {
  readonly frame: Frame;
  readonly box: PixelBox;
  /** Alto de la fila del título, en píxeles del mundo. */
  readonly headerHeight: number;
  readonly members: number;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly colliding: boolean;
  readonly gestures: FrameGestures;
}

/**
 * Marco del tablero (ADR 0027), bajo las tarjetas. Su cuerpo no recibe toques: el fondo del lienzo
 * sigue funcionando dentro. La fila del título selecciona el marco con un toque y lo mueve (con sus
 * tarjetas) al arrastrarla.
 */
export function CanvasFrame({ frame, box, headerHeight, members, selected, dragging, colliding, gestures }: CanvasFrameProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  // Un toque que ya atendió el PanResponder no debe repetirse con el «click» de web.
  const [{ handlers, justHandled }] = useState(() => {
    let moving = false;
    let handledAt = -Infinity;
    const created = PanResponder.create({
      onStartShouldSetPanResponderCapture: () => gestures.canDrag(),
      onPanResponderGrant: () => { moving = false; },
      onPanResponderMove: (_event, state) => {
        if (!moving && isDrag(state.dx, state.dy)) {
          moving = true;
          gestures.begin(frame.id);
        }
        if (moving) gestures.update(state.dx, state.dy);
      },
      onPanResponderRelease: (_event, state) => {
        handledAt = Date.now();
        if (moving) gestures.finish(state.dx, state.dy);
        else gestures.press(frame.id);
        moving = false;
      },
      onPanResponderTerminate: () => {
        if (moving) gestures.abort();
        moving = false;
      },
      onPanResponderTerminationRequest: () => false,
    });
    return { handlers: created.panHandlers, justHandled: () => Date.now() - handledAt < 400 };
  });
  const border = colliding ? colors.danger : selected || focused ? colors.selection : colors.border;
  return (
    <View
      testID={`frame-${frame.id}`}
      pointerEvents="box-none"
      style={[styles.frame, { left: box.left, top: box.top, width: box.width, height: box.height, borderColor: border, borderWidth: selected || colliding ? 3 : 2 }, dragging ? styles.lifted : null]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceRaised, opacity: 0.45 }]} />
      <View {...handlers} style={[styles.headerWrap, { height: Math.max(28, headerHeight - 4) }]}>
        <Pressable
          testID={`frame-header-${frame.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Marco ${frame.title}, ${members === 1 ? '1 tarjeta' : `${members} tarjetas`}`}
          accessibilityHint="Selecciona para editar; arrastra el título para mover el marco con sus tarjetas"
          accessibilityState={{ selected }}
          {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
          onPress={() => { if (!justHandled()) gestures.press(frame.id); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.header, { backgroundColor: selected ? colors.selection : colors.surface, borderColor: border }]}
        >
          <Text numberOfLines={1} style={[styles.title, { color: selected ? colors.cardSurface : colors.textPrimary }]}>{frame.title}</Text>
          <Text style={[styles.count, { color: selected ? colors.cardSurface : colors.textSecondary }]}>{members}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  frame: { position: 'absolute', borderStyle: 'dashed' },
  lifted: { opacity: 0.8 },
  headerWrap: { alignSelf: 'flex-start', maxWidth: '100%', padding: 4 },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderWidth: 2, minWidth: 44 },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '900' },
  count: { fontFamily: mono, fontSize: 12, fontWeight: '800' },
});
