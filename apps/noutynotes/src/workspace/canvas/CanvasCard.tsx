import type { Card, CardDisplayMode, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { cardTitle, isImageCard } from '../Board';
import { ImagePlaceholder } from '../ImagePlaceholder';
import { markdownExcerpt } from '../markdownLists';
import type { GestureController } from './Canvas';
import { miniIcon } from './cardChrome';
import { CardIcon } from './CardIcon';
import type { ConnectRole } from './connect';
import { isDrag } from './geometry';
import type { PixelBox, ResizeHandle } from './geometry';

/** Alto de la cabecera a zoom 100 %: aloja los controles de 44 px (ADR 0016). */
export const HEADER = 44;
/** Área táctil de cada asa; el cuadrado visible es menor. */
const HANDLE_HIT = 44;
const HANDLE_MARK = 14;

interface CanvasCardProps {
  readonly workspace: Workspace;
  readonly card: Card;
  readonly number: number;
  readonly box: PixelBox;
  readonly display: CardDisplayMode;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly colliding: boolean;
  readonly connectRole: ConnectRole;
  readonly connectSourceName: string;
  readonly onPress: () => void;
  /** Al recibir el foco (teclado o lector), el lienzo la muestra desplazando el pan. */
  readonly onFocus: () => void;
  readonly controller: GestureController;
  /** Vista previa de una imagen importada; sin ella, una tarjeta de imagen es de ejemplo. */
  readonly imageUri: string | undefined;
  /** Ancho, en unidades del lienzo, que ocupan los controles de la cabecera (dibujados fuera del zoom). */
  readonly reserveRight: number;
  /** Con el zoom alejado, los controles de 44 px bajan sobre el cuerpo: el título les deja sitio. */
  readonly controlsOverBody: boolean;
}

const displayNames: Readonly<Record<CardDisplayMode, string>> = { expanded: '', collapsed: ', contraída', minimized: ', minimizada' };

const connectHints: Readonly<Record<ConnectRole, string | null>> = {
  none: null,
  source: 'Origen · toca otra tarjeta',
  connect: '+ Conectar',
  disconnect: '× Desconectar',
};

/** Ficha de papel del lienzo: cabecera por tipo, título, resumen y estado. Solo representa. */
export function CanvasCard(props: CanvasCardProps) {
  const { workspace, card, number, box, display, selected, dragging, colliding, connectRole, connectSourceName, onPress } = props;
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const { controller } = props;
  // Un PanResponder estable por tarjeta. Con Seleccionar captura al pulsar, para no perder un arrastre
  // rápido que sale de la tarjeta; el arrastre empieza al superar el umbral y, sin él, es un toque.
  // Con Mano o Conectar no captura: el lienzo desplaza o el Pressable recibe el toque.
  const [dragHandlers] = useState(() => {
    let dragging = false;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => controller.canDragCard(),
      onPanResponderGrant: () => { dragging = false; },
      onPanResponderMove: (_event, state) => {
        if (!dragging && isDrag(state.dx, state.dy)) {
          dragging = true;
          controller.begin({ cardId: card.id, kind: 'move', handle: 'se' });
        }
        if (dragging) controller.update(state.dx, state.dy);
      },
      onPanResponderRelease: (_event, state) => {
        controller.gestureEnded();
        if (dragging) controller.finish(state.dx, state.dy);
        else controller.tapCard(card.id);
        dragging = false;
      },
      onPanResponderTerminate: () => {
        controller.gestureEnded();
        if (dragging) controller.abort();
        dragging = false;
      },
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  });
  const image = isImageCard(workspace, card);
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  const floatingTitle = card.typeId === 'titulo-flotante';
  const connections = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id).length;
  const hint = connectHints[connectRole];
  const borderColor = colliding ? colors.danger : selected || focused || connectRole === 'source' ? colors.selection : colors.border;
  const bodyLines = Math.max(0, Math.floor((box.height - HEADER - 40) / 18));
  const headerColor = image ? colors.headerImage : colors.headerNote;
  const icon = miniIcon(type?.base);
  const number3 = String(number).padStart(3, '0');
  // Con los controles ocupando la cabecera, si no cabe «001 // TIPO» se muestra solo el número.
  const tabLabel = box.width - props.reserveRight - 16 >= 110 ? `${number3} // ${(type?.label ?? 'Tarjeta').toUpperCase()}` : number3;
  const accessibilityHint = connectRole === 'connect' ? `Conectar ${connectSourceName} con esta tarjeta`
    : connectRole === 'disconnect' ? `Desconectar ${connectSourceName} de esta tarjeta`
      : connectRole === 'source' ? 'Cancelar la conexión' : 'Selecciona para editar; arrastra para mover';

  return (
    <View
      style={[styles.wrap, { left: box.left, top: box.top, width: box.width, height: box.height }, dragging ? styles.lifted : null]}
      {...dragHandlers}
    >
      <Pressable
        testID={`card-${card.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Tarjeta ${cardTitle(card)}${displayNames[display]}`}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
        onPress={() => { if (!controller.justEndedGesture()) onPress(); }}
        onFocus={() => { setFocused(true); props.onFocus(); }}
        onBlur={() => setFocused(false)}
        style={[styles.card, {
          backgroundColor: floatingTitle && display === 'expanded' ? 'transparent' : colors.cardSurface,
          borderColor: floatingTitle && !(selected || colliding || focused || connectRole === 'source') ? 'transparent' : borderColor,
          borderWidth: selected || colliding || focused || connectRole === 'source' ? 3 : floatingTitle && display === 'expanded' ? 0 : 2,
          opacity: dragging ? 0.85 : 1,
        }]}
      >
        {display === 'minimized' ? (
          // Ficha mínima (1 × 1): icono del tipo y título; sin icono propio, solo el título (ADR 0016).
          <View testID={`minimized-${card.id}`} style={[styles.mini, { backgroundColor: headerColor }]}>
            {icon ? <CardIcon kind={icon} testID={`minimized-icon-${card.id}`} /> : null}
            <Text numberOfLines={icon ? (box.height >= 56 ? 2 : 1) : 3} style={[styles.miniTitle, { color: colors.headerText }]}>{cardTitle(card)}</Text>
          </View>
        ) : floatingTitle && display === 'expanded' ? (
          <View testID={`floating-title-${card.id}`} style={styles.floatingTitleWrap}>
            <Text numberOfLines={Math.max(1, Math.floor((box.height - 36) / 38))} style={[styles.floatingTitle, { color: colors.textPrimary, paddingRight: box.height >= 100 ? 0 : props.reserveRight }]}>{cardTitle(card)}</Text>
          </View>
        ) : display === 'collapsed' ? (
          // Contraída: una barra de título con los controles a la derecha.
          <View style={[styles.header, styles.headerCollapsed, { backgroundColor: headerColor, paddingRight: props.reserveRight + 8 }]}>
            <Text numberOfLines={1} style={[styles.headerText, { color: colors.headerText }]}>{number3}</Text>
            <Text numberOfLines={1} style={[styles.collapsedTitle, { color: colors.headerText }]}>{cardTitle(card)}</Text>
          </View>
        ) : (
          <>
            {/* Cabecera en forma de pestaña de carpeta: número y tipo; los controles se dibujan encima. */}
            <View style={[styles.header, { borderColor: colors.border, paddingRight: props.reserveRight + 8 }]}>
              <View style={[styles.tab, { backgroundColor: headerColor, borderColor: colors.border }]}>
                <Text numberOfLines={1} style={[styles.headerText, { color: colors.headerText }]}>
                  {tabLabel}
                </Text>
              </View>
            </View>
            <View style={styles.body}>
              <Text numberOfLines={2} style={[styles.title, { color: colors.cardText }, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>{cardTitle(card)}</Text>
              {image ? (props.imageUri ? (
                <Image
                  testID={`image-preview-${card.id}`}
                  accessibilityRole="image"
                  accessibilityLabel={`Imagen ${cardTitle(card)}`}
                  source={{ uri: props.imageUri }}
                  resizeMode="cover"
                  style={[styles.photo, { borderColor: colors.border }]}
                />
              ) : (card.assetRefs?.length ?? 0) > 0 ? (
                <Text style={[styles.content, { color: colors.textSecondary }]}>Cargando imagen…</Text>
              ) : <ImagePlaceholder />) : bodyLines > 0 ? (
                <Text numberOfLines={bodyLines} style={[styles.content, { color: colors.cardText }]}>{markdownExcerpt(card.content ?? '')}</Text>
              ) : null}
              {connections > 0 ? (
                <Text style={[styles.badge, { color: colors.textSecondary }]}>{connections === 1 ? '1 conexión' : `${connections} conexiones`}</Text>
              ) : null}
            </View>
          </>
        )}
        {hint ? (
          <Text
            testID={`connect-hint-${card.id}`}
            style={[styles.hint, {
              color: connectRole === 'disconnect' ? colors.danger : colors.accentText,
              backgroundColor: connectRole === 'disconnect' ? colors.surface : colors.accent,
              borderColor: connectRole === 'disconnect' ? colors.danger : colors.border,
            }]}
          >
            {hint}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Asas de la tarjeta seleccionada, encima de todas las tarjetas (no compiten con su arrastre). */
export function ResizeHandles({ cardId, box, controller }: { readonly cardId: Card['id']; readonly box: PixelBox; readonly controller: GestureController }) {
  return (
    <View pointerEvents="box-none" style={[styles.handles, { left: box.left, top: box.top, width: box.width, height: box.height }]}>
      {(['e', 's', 'se'] as const).map((handle) => <ResizeHandleView key={handle} cardId={cardId} handle={handle} controller={controller} />)}
    </View>
  );
}

/** Asa de redimensionado: solo puntero o dedo; el teclado usa los botones del inspector. */
function ResizeHandleView({ cardId, handle, controller }: { readonly cardId: Card['id']; readonly handle: ResizeHandle; readonly controller: GestureController }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [handlers] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => controller.canResize(),
    onStartShouldSetPanResponderCapture: () => controller.canResize(),
    onPanResponderGrant: () => controller.begin({ cardId, kind: 'resize', handle }),
    onPanResponderMove: (_event, state) => controller.update(state.dx, state.dy),
    onPanResponderRelease: (_event, state) => controller.finish(state.dx, state.dy),
    onPanResponderTerminate: () => controller.abort(),
    onPanResponderTerminationRequest: () => false,
  }).panHandlers);
  return (
    <View
      testID={`resize-${handle}-${cardId}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.handleHit, handleSpot(handle)]}
      {...handlers}
    >
      <View style={[styles.handleMark, { backgroundColor: colors.selection, borderColor: colors.cardSurface }]} />
    </View>
  );
}

function handleSpot(handle: ResizeHandle) {
  const offset = -HANDLE_HIT / 2;
  if (handle === 'e') return { right: offset, top: '50%', marginTop: offset } as const;
  if (handle === 's') return { bottom: offset, left: '50%', marginLeft: offset } as const;
  return { right: offset, bottom: offset } as const;
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  handles: { position: 'absolute', zIndex: 20 },
  mini: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 3 },
  miniTitle: { fontSize: 11, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
  photo: { flex: 1, minHeight: 40, borderWidth: 1 },
  lifted: { zIndex: 10 },
  card: { flex: 1, overflow: 'hidden' },
  header: { height: HEADER, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 0, borderBottomWidth: 2 },
  headerCollapsed: { flex: 1, height: undefined, alignItems: 'center', gap: 8, paddingLeft: 8, borderBottomWidth: 0 },
  tab: { height: 30, justifyContent: 'center', paddingHorizontal: 8, borderRightWidth: 2, borderTopWidth: 0, maxWidth: '100%' },
  collapsedTitle: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
  headerText: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  body: { flex: 1, padding: 8, gap: 6 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  floatingTitleWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 8, paddingTop: 36, paddingBottom: 8 },
  floatingTitle: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  content: { fontSize: 13, lineHeight: 18 },
  badge: { fontSize: 11, fontWeight: '700', marginTop: 'auto' },
  hint: { position: 'absolute', right: 6, bottom: 6, borderWidth: 2, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, fontWeight: '800' },
  handleHit: { position: 'absolute', width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  handleMark: { width: HANDLE_MARK, height: HANDLE_MARK, borderWidth: 2 },
});
