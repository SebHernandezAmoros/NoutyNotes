import { linkDisplay, linkUrlField } from '@noutynotes/domain';
import type { Card, CardDisplayMode, Workspace } from '@noutynotes/domain';
import { parseNoteBlocks } from '@noutynotes/application';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { cardTitle, isImageCard } from '../Board';
import { ImagePlaceholder } from '../ImagePlaceholder';
import { markdownExcerpt } from '../markdownLists';
import type { GestureController } from './Canvas';
import { miniIcon } from './cardChrome';
import { CardIcon } from './CardIcon';
import { NotePreview } from './NotePreview';
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
  /** Fecha de creación visible en el pie (ADR 0029): ya formateada, o undefined. */
  readonly createdLabel?: string | undefined;
  /** Tipografía de las notas (ADR 0030): solo el texto, no el título ni el pie. */
  readonly noteFontFamily?: string | undefined;
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
  readonly noteImages: ReadonlyMap<string, string>;
  /** Ancho, en unidades del lienzo, que ocupan los controles de la cabecera (dibujados fuera del zoom). */
  readonly reserveRight: number;
  /** Con el zoom alejado, los controles de 44 px bajan sobre el cuerpo: el título les deja sitio. */
  readonly controlsOverBody: boolean;
  /** Zoom actual del lienzo: por debajo del umbral, la ficha resume en vez de encoger su texto (ADR 0016). */
  readonly zoom: number;
}

/**
 * Por debajo de este zoom, todo el contenido escala junto con la tarjeta (transform del lienzo) y el
 * texto a tamaño base deja de leerse. En vez de intentar caber el editor completo a escala reducida
 * (imposible de leer bien), la ficha pasa a un resumen: solo cabecera, título más grande (compensado,
 * no proporcional del todo, para no desbordar el hueco) e imagen si la tiene — sin resumen de texto,
 * etiquetas ni pie. Encontrado en la auditoría visual del tablero (2026-09-29).
 */
const ZOOM_SUMMARY_THRESHOLD = 0.75;
const BASE_TITLE_SIZE = 16;
const MAX_SUMMARY_TITLE_SIZE = 24;

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
        controller.gestureEnded(card.id);
        if (dragging) controller.finish(state.dx, state.dy);
        else controller.tapCard(card.id);
        dragging = false;
      },
      onPanResponderTerminate: () => {
        controller.gestureEnded(card.id);
        if (dragging) controller.abort();
        dragging = false;
      },
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  });
  const image = isImageCard(workspace, card);
  // Resumen a zoom bajo (auditoría visual, 2026-09-29): solo cabecera, título e imagen; ver umbral arriba.
  const zoomFactor = Math.min(1, Math.max(props.zoom, 0.1));
  const summarize = display === 'expanded' && zoomFactor < ZOOM_SUMMARY_THRESHOLD;
  const titleSize = summarize ? Math.min(MAX_SUMMARY_TITLE_SIZE, BASE_TITLE_SIZE / zoomFactor) : BASE_TITLE_SIZE;
  // Nota con imágenes intercaladas (ADR 0021): la ficha muestra los bloques en orden.
  const blocks = image || summarize ? [] : parseNoteBlocks(card.content ?? '');
  const mixed = blocks.some((block) => block.kind === 'image');
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  const floatingTitle = card.typeId === 'titulo-flotante';
  const connections = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id).length;
  const hint = connectHints[connectRole];
  const borderColor = colliding ? colors.danger : selected || focused || connectRole === 'source' ? colors.selection : colors.border;
  const tags = card.tags ?? [];
  // Con pie (etiquetas o conexiones), el texto cede sus líneas: relleno, título, hueco y bordes (48) más
  // 22 por línea de pie (hueco + 16). Sin pie se conserva el cálculo anterior.
  // Línea de datos del pie: conexiones y, si se pide, la fecha de creación (ADR 0029).
  const meta = [connections > 0 ? (connections === 1 ? '1 conexión' : `${connections} conexiones`) : '', props.createdLabel ?? ''].filter(Boolean).join(' · ');
  const footerLines = (tags.length > 0 ? 1 : 0) + (meta !== '' ? 1 : 0);
  // Enlace (ADR 0020): una línea con dominio y ruta, sin descargar nada; ocupa una línea del texto.
  const linkKey = linkUrlField(type);
  const linkValue = linkKey ? card.fields[linkKey] : undefined;
  const link = typeof linkValue === 'string' ? linkDisplay(linkValue) : undefined;
  const bodyLines = Math.max(0, Math.floor((box.height - HEADER - (footerLines > 0 ? 48 + footerLines * 22 : 40)) / 18) - (link ? 1 : 0));
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
        onPress={() => { if (!controller.justEndedGesture(card.id)) onPress(); }}
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
              <Text
                numberOfLines={summarize ? 3 : 2}
                style={[styles.title, { color: colors.cardText, fontSize: titleSize, lineHeight: Math.round(titleSize * 1.25) }, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}
              >
                {cardTitle(card)}
              </Text>
              {image ? (props.imageUri ? (
                // «contain», no «cover» (auditoría visual, 2026-09-29): recortar sin que la persona lo
                // pida oculta parte de su imagen; se ve completa, con el fondo de la tarjeta alrededor
                // si su proporción no llena el hueco. Elegir un recorte deliberado queda pendiente.
                <Image
                  testID={`image-preview-${card.id}`}
                  accessibilityRole="image"
                  accessibilityLabel={`Imagen ${cardTitle(card)}`}
                  source={{ uri: props.imageUri }}
                  resizeMode="contain"
                  style={[styles.photo, { borderColor: colors.border, backgroundColor: colors.surface }]}
                />
              ) : (card.assetRefs?.length ?? 0) > 0 ? (
                <Text style={[styles.content, { color: colors.textSecondary }]}>Cargando imagen…</Text>
              ) : <ImagePlaceholder />) : null}
              {!summarize && !image && link ? (
                <Text testID={`card-link-${card.id}`} numberOfLines={1} style={[styles.link, { color: colors.cardText }]}>
                  {`↗ ${link.host}${link.rest}`}
                </Text>
              ) : null}
              {!summarize && mixed ? (
                <NotePreview testID={`note-preview-${card.id}`} blocks={blocks} images={props.noteImages} fontFamily={props.noteFontFamily}
                  height={box.height - HEADER - (footerLines > 0 ? 48 + footerLines * 22 : 40) - (link ? 18 : 0)} />
              ) : null}
              {!summarize && !image && !mixed && bodyLines > 0 ? (
                <Text numberOfLines={bodyLines} style={[styles.content, { color: colors.cardText }, props.noteFontFamily === undefined ? null : { fontFamily: props.noteFontFamily }]}>{markdownExcerpt(card.content ?? '')}</Text>
              ) : null}
              {!summarize && tags.length > 0 ? (
                // Pie de etiquetas (ADR 0019): hasta tres y el resto como «+n»; el nombre completo va en el inspector.
                <Text testID={`card-tags-${card.id}`} numberOfLines={1} style={[styles.tags, { color: colors.cardText }]}>
                  {tags.slice(0, 3).map((tag) => `#${tag}`).join('  ')}{tags.length > 3 ? `  +${tags.length - 3}` : ''}
                </Text>
              ) : null}
              {!summarize && meta !== '' ? (
                <Text testID={`card-meta-${card.id}`} numberOfLines={1} style={[styles.badge, { color: colors.cardText }, tags.length > 0 ? { marginTop: 2 } : null]}>{meta}</Text>
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
  // Si aun así no cabe, cede el texto y no el pie.
  content: { fontSize: 13, lineHeight: 18, flexShrink: 1, overflow: 'hidden' },
  link: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 18, fontWeight: '700', flexShrink: 0 },
  tags: { fontSize: 12, lineHeight: 16, fontWeight: '800', marginTop: 'auto', flexShrink: 0 },
  badge: { fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 'auto', flexShrink: 0 },
  hint: { position: 'absolute', right: 6, bottom: 6, borderWidth: 2, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, fontWeight: '800' },
  handleHit: { position: 'absolute', width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  handleMark: { width: HANDLE_MARK, height: HANDLE_MARK, borderWidth: 2 },
});
