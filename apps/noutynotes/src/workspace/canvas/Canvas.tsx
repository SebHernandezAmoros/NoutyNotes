import type { BoardLayout, CardDisplayMode, CardId, CardPlacement, GridPoint, GridSize, Workspace } from '@noutynotes/domain';
import { footprint } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { ActionButton } from '../../components/controls';
import { describeCode } from '../../session/messages';
import { cardTitle } from '../Board';
import { relationSegments } from '../board-geometry';
import { CanvasCard, ResizeHandles } from './CanvasCard';
import { connectTarget } from './connect';
import { canvasSize, cardBox, checkMove, checkResize, dragTarget, previewBox, resizeTarget } from './geometry';
import type { CanvasMetrics, PlacementCheck, ResizeHandle } from './geometry';
import { clampPan, panToReveal } from './viewport';
import type { Point, Size } from './viewport';

export type CanvasTool = 'select' | 'pan' | 'connect';

export interface GestureController {
  canDragCard(): boolean;
  /** Un toque sin arrastre sobre una tarjeta: lo decide la herramienta activa. */
  tapCard(cardId: CardId): void;
  /**
   * En web, soltar sobre la misma tarjeta genera además un «click» que Pressable convierte en onPress.
   * El gesto ya se atendió: la tarjeta ignora ese onPress si llega justo después.
   */
  gestureEnded(): void;
  justEndedGesture(): boolean;
  canResize(): boolean;
  begin(gesture: { readonly cardId: CardId; readonly kind: 'move' | 'resize'; readonly handle: ResizeHandle }): void;
  update(dx: number, dy: number): void;
  finish(dx: number, dy: number): void;
  abort(): void;
}

interface Gesture {
  readonly cardId: CardId;
  readonly kind: 'move' | 'resize';
  readonly handle: ResizeHandle;
  readonly dx: number;
  readonly dy: number;
}

interface CanvasProps {
  readonly workspace: Workspace;
  readonly layout: BoardLayout | undefined;
  readonly metrics: CanvasMetrics;
  readonly zoom: number;
  readonly pan: Point;
  readonly onPan: (pan: Point) => void;
  readonly tool: CanvasTool;
  readonly snap: boolean;
  readonly showGrid: boolean;
  readonly selectedId: CardId | null;
  readonly connectSource: CardId | null;
  readonly onCardPress: (cardId: CardId) => void;
  readonly onBackgroundPress: () => void;
  readonly onMove: (cardId: CardId, to: GridPoint) => void;
  readonly onResize: (cardId: CardId, size: GridSize) => void;
  readonly onRejected: (message: string) => void;
  readonly onCreateFirst: () => void;
  readonly boardTitle: string;
  /** Títulos de las tarjetas del tablero que su layout no coloca (v1 válido). */
  readonly unplaced: readonly string[];
  /** Vistas previas de imágenes importadas por tarjeta. */
  readonly imageUris: ReadonlyMap<CardId, string>;
  /** Acciones de la tarjeta seleccionada: representación y Papelera (ADR 0014, ADR 0015). */
  readonly onDisplay: (cardId: CardId, display: CardDisplayMode) => void;
  readonly onTrash: (cardId: CardId) => void;
}

const displayActions: readonly { display: CardDisplayMode; label: string }[] = [
  { display: 'expanded', label: 'Expandir' },
  { display: 'collapsed', label: 'Contraer' },
  { display: 'minimized', label: 'Minimizar' },
];
const ACTION_BAR_HEIGHT = 52;

/** Destino de un gesto en curso y su validez según el motor de grilla, antes de guardar nada. */
function evaluate(layout: BoardLayout, placement: CardPlacement, gesture: Gesture, zoom: number, metrics: CanvasMetrics) {
  if (gesture.kind === 'move') {
    const to = dragTarget(placement.rect, gesture.dx, gesture.dy, zoom, metrics);
    return { rect: { ...placement.rect, ...to }, changed: to.x !== placement.rect.x || to.y !== placement.rect.y, check: checkMove(layout, placement.cardId, to) };
  }
  const size = resizeTarget(placement.rect, gesture.handle, gesture.dx, gesture.dy, zoom, metrics);
  return { rect: { ...placement.rect, ...size }, changed: size.w !== placement.rect.w || size.h !== placement.rect.h, check: checkResize(layout, placement.cardId, size) };
}

function rejection(check: PlacementCheck, names: ReadonlyMap<CardId, string>): string {
  if (check.ok) return '';
  const base = describeCode(check.code);
  const with_ = check.colliding.map((cardId) => `«${names.get(cardId) ?? cardId}»`).join(', ');
  return with_ === '' ? base : `${base.replace(/\.$/, '')}: ${with_}.`;
}

/**
 * Lienzo del tablero (ADR 0013): layout canónico de 12 columnas con zoom y desplazamiento, tarjetas
 * que se arrastran y redimensionan con vista previa validada por el dominio, relaciones y grilla.
 * Nunca modifica datos: al soltar un destino válido llama a `onMove`/`onResize`, que usan los casos de uso.
 */
export function Canvas(props: CanvasProps) {
  const { workspace, layout, metrics, zoom, pan, tool, snap, showGrid, selectedId, connectSource, boardTitle } = props;
  const { theme } = useTheme();
  const colors = theme.colors;
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const content = canvasSize(layout, metrics);
  const cards = useMemo(() => new Map(workspace.cards.map((card) => [card.id, card])), [workspace.cards]);
  const names = useMemo(() => new Map(workspace.cards.map((card) => [card.id, cardTitle(card)])), [workspace.cards]);
  const placements = layout?.placements ?? [];

  // Lo que leen los gestores de gestos (creados una vez); se actualiza tras cada render.
  const latest = useRef({ props, viewport, content, names });
  useLayoutEffect(() => {
    latest.current = { props, viewport, content, names };
  });

  // Controlador estable de gestos: las tarjetas y las asas crean sus PanResponder con él.
  const [controller] = useState<GestureController>(() => {
    // Identidad del gesto en curso, síncrona: no depende de que React haya vuelto a renderizar.
    let active: Omit<Gesture, 'dx' | 'dy'> | null = null;
    let cancelled = false;
    let endedAt = -Infinity;
    return {
      gestureEnded: () => { endedAt = Date.now(); },
      justEndedGesture: () => Date.now() - endedAt < 400,
      canDragCard: () => latest.current.props.tool === 'select' && active === null,
      tapCard: (cardId) => latest.current.props.onCardPress(cardId),
      canResize: () => latest.current.props.tool === 'select',
      begin: (next) => {
        cancelled = false;
        active = next;
        setGesture({ ...next, dx: 0, dy: 0 });
      },
      update: (dx, dy) => {
        if (!cancelled) setGesture((current) => (current ? { ...current, dx, dy } : current));
      },
      abort: () => {
        cancelled = true;
        active = null;
        setGesture(null);
      },
      finish: (dx, dy) => {
        const current = latest.current;
        const done = active;
        active = null;
        setGesture(null);
        if (!done || cancelled) return;
        const currentLayout = current.props.layout;
        const placement = currentLayout?.placements.find((candidate) => candidate.cardId === done.cardId);
        if (!currentLayout || !placement) return;
        const result = evaluate(currentLayout, placement, { ...done, dx, dy }, current.props.zoom, current.props.metrics);
        if (!result.changed) return;
        if (!result.check.ok) {
          current.props.onRejected(`No se guardó el cambio. ${rejection(result.check, current.names)}`);
          return;
        }
        if (done.kind === 'move') current.props.onMove(done.cardId, { x: result.rect.x, y: result.rect.y });
        else current.props.onResize(done.cardId, { w: result.rect.w, h: result.rect.h });
      },
    };
  });

  // En web, un elemento que se muestra al enfocarlo (teclado, lector o herramientas) desplaza el
  // contenedor aunque tenga overflow: hidden, y el contenido deja de coincidir con `pan`. El único
  // desplazamiento del lienzo es `pan`: cualquier scroll nativo se deshace al instante. No se convierte
  // en pan: la barra de acciones se coloca según el pan y se perseguiría a sí misma. Mostrar una tarjeta
  // enfocada lo hace `panToReveal` (abajo, en onFocus).
  const viewportRef = useRef<View>(null);
  // El foco que llega de un puntero (clic o toque) no desplaza: moverse al empezar un arrastre lo rompería.
  const pointerDown = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const reset = () => {
      if (node.scrollLeft !== 0) node.scrollLeft = 0;
      if (node.scrollTop !== 0) node.scrollTop = 0;
    };
    const press = () => { pointerDown.current = true; };
    const release = () => { pointerDown.current = false; };
    node.addEventListener('scroll', reset);
    node.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      node.removeEventListener('scroll', reset);
      node.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);

  // Escape cancela el gesto en curso sin guardar (en web; en táctil, soltar en el origen cancela).
  useEffect(() => {
    if (Platform.OS !== 'web' || !gesture) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') controller.abort(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gesture, controller]);

  // Herramienta Mano: todo el lienzo se desplaza y ninguna tarjeta recibe el gesto.
  const [panner] = useState(() => {
    let origin: Point = { x: 0, y: 0 };
    return {
      active: () => latest.current.props.tool === 'pan',
      start: () => { origin = latest.current.props.pan; },
      move: (dx: number, dy: number) => {
        const current = latest.current;
        current.props.onPan(clampPan({ x: origin.x + dx, y: origin.y + dy }, current.content, current.props.zoom, current.viewport));
      },
    };
  });
  const [panHandlers] = useState(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => panner.active(),
    onMoveShouldSetPanResponderCapture: () => panner.active(),
    onPanResponderGrant: () => panner.start(),
    onPanResponderMove: (_event, state) => panner.move(state.dx, state.dy),
    onPanResponderTerminationRequest: () => false,
  }).panHandlers);

  const active = gesture ? placements.find((placement) => placement.cardId === gesture.cardId) : undefined;
  const preview = gesture && active && layout ? evaluate(layout, active, gesture, zoom, metrics) : null;
  const colliding = new Set(preview && !preview.check.ok ? preview.check.colliding : []);
  const boxes = placements.map((placement) => ({ cardId: placement.cardId, ...cardBox(footprint(placement), metrics) }));
  const segments = relationSegments(workspace.relations, boxes);
  const empty = placements.length === 0 && props.unplaced.length === 0;
  const unplacedText = props.unplaced.length === 0 ? null
    : `${props.unplaced.length === 1 ? '1 tarjeta de este tablero no tiene' : `${props.unplaced.length} tarjetas de este tablero no tienen`} posición en la grilla: ${props.unplaced.map((title) => `«${title}»`).join(', ')}. Colocarlas desde aquí llegará más adelante; sus datos no cambian.`;
  const selectedPlacement = placements.find((placement) => placement.cardId === selectedId);
  const status = preview
    ? preview.check.ok
      ? `${gesture?.kind === 'move' ? 'Soltar en' : 'Nuevo tamaño:'} ${gesture?.kind === 'move' ? `columna ${preview.rect.x + 1}, fila ${preview.rect.y + 1}` : `${preview.rect.w} × ${preview.rect.h}`}. Escape cancela.`
      : rejection(preview.check, names)
    : null;

  return (
    <View
      ref={viewportRef}
      testID="board-canvas"
      accessibilityLabel={`Lienzo del tablero ${boardTitle}`}
      onLayout={(event: LayoutChangeEvent) => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      style={[styles.viewport, { backgroundColor: colors.canvas, borderColor: colors.border }, tool === 'pan' ? styles.grab : null]}
      {...panHandlers}
    >
      <View
        testID="canvas-content"
        style={[styles.content, {
          width: content.width, height: content.height,
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }],
        }]}
      >
        {/* Toque en el papel: deselecciona. No es enfocable; el inspector tiene «Cerrar». */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => tool === 'select'}
          onResponderRelease={props.onBackgroundPress}
        />
        {showGrid ? (
          <View testID="canvas-grid" style={styles.overlay}>
            {Array.from({ length: 13 }, (_, index) => (
              <View key={`c${index}`} style={[styles.gridColumn, { left: index * metrics.cell, backgroundColor: colors.gridLine }]} />
            ))}
            {Array.from({ length: content.rows + 1 }, (_, index) => (
              <View key={`r${index}`} style={[styles.gridRow, { top: index * metrics.row, backgroundColor: colors.gridLine }]} />
            ))}
          </View>
        ) : null}
        {segments.map((segment) => {
          const highlighted = selectedId !== null && workspace.relations.some((relation) => relation.id === segment.relationId
            && (relation.from === selectedId || relation.to === selectedId));
          return (
            <View key={segment.relationId} style={styles.overlay}>
              <View
                testID={`relation-line-${segment.relationId}`}
                style={[styles.relationLine, {
                  left: segment.left, top: segment.top - 1, width: segment.length, height: highlighted ? 3 : 2,
                  backgroundColor: highlighted ? colors.selection : colors.relationLine, transform: [{ rotate: `${segment.angle}deg` }],
                }]}
              />
              <View style={[styles.relationEnd, { left: segment.endX - 6, top: segment.endY - 6, backgroundColor: highlighted ? colors.selection : colors.relationLine }]} />
            </View>
          );
        })}
        {placements.map((placement, index) => {
          const card = cards.get(placement.cardId);
          if (!card) return null;
          const cell = footprint(placement);
          const dragging = gesture?.cardId === card.id;
          const box = dragging && preview
            ? gesture.kind === 'move'
              ? previewBox(cell, { x: preview.rect.x, y: preview.rect.y }, gesture.dx, gesture.dy, zoom, snap, metrics)
              : cardBox(footprint({ ...placement, rect: preview.rect }), metrics)
            : cardBox(cell, metrics);
          const selected = selectedId === card.id;
          return (
            <CanvasCard
              key={card.id}
              workspace={workspace}
              card={card}
              number={index + 1}
              box={box}
              display={placement.display}
              selected={selected}
              dragging={dragging}
              colliding={colliding.has(card.id)}
              connectRole={tool === 'connect' ? connectTarget(connectSource, card.id, workspace.relations) : 'none'}
              connectSourceName={connectSource ? names.get(connectSource) ?? '' : ''}
              imageUri={props.imageUris.get(card.id)}
              onPress={() => props.onCardPress(card.id)}
              onFocus={() => {
                if (pointerDown.current) return;
                const current = latest.current;
                const next = panToReveal(current.props.pan, cardBox(cell, metrics), current.content, current.props.zoom, current.viewport);
                if (next !== current.props.pan) current.props.onPan(next);
              }}
              controller={controller}
            />
          );
        })}
        {/* El destino va encima de las tarjetas: su color (válido o no) siempre se ve. */}
        {preview && active ? (
          <View
            testID="drag-target"
            accessibilityLabel={preview.check.ok ? 'Destino válido' : 'Destino no válido'}
            style={[styles.target, cardBox(footprint({ ...active, rect: preview.rect }), metrics), {
              borderColor: preview.check.ok ? colors.selection : colors.danger,
            }]}
          />
        ) : null}
        {selectedPlacement && tool === 'select' ? (
          <ResizeHandles
            key={selectedPlacement.cardId}
            cardId={selectedPlacement.cardId}
            box={gesture?.cardId === selectedPlacement.cardId && preview
              ? cardBox(footprint({ ...selectedPlacement, rect: preview.rect }), metrics)
              : cardBox(footprint(selectedPlacement), metrics)}
            controller={controller}
          />
        ) : null}
      </View>
      {empty ? (
        <View testID="board-empty" style={styles.emptyWrap} pointerEvents="box-none">
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.emptyTitle, { color: colors.textPrimary }]}>Este tablero está vacío</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Empieza con una nota: podrás moverla, cambiar su tamaño y conectarla con otras.
            </Text>
            <ActionButton label="+ Crear la primera nota" accessibilityLabel="Crear la primera nota" tone="primary" onPress={props.onCreateFirst} />
          </View>
        </View>
      ) : null}
      {unplacedText ? (
        <Text testID="board-unplaced" style={[styles.unplaced, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}>
          {unplacedText}
        </Text>
      ) : null}
      {selectedPlacement && tool === 'select' && !gesture ? (() => {
        // Fuera de la escala del zoom: los botones miden siempre 44 px reales.
        const box = cardBox(footprint(selectedPlacement), metrics);
        const screenTop = pan.y + box.top * zoom;
        const preferred = screenTop >= ACTION_BAR_HEIGHT + 4 ? screenTop - ACTION_BAR_HEIGHT : pan.y + (box.top + box.height) * zoom + 6;
        // Siempre dentro del lienzo: fuera, el recorte la ocultaría y mostrarla exigiría un scroll nativo.
        const top = Math.max(4, Math.min(preferred, viewport.height - ACTION_BAR_HEIGHT - 4));
        const left = Math.max(4, Math.min(pan.x + box.left * zoom, viewport.width - 320));
        const title = names.get(selectedPlacement.cardId) ?? 'Sin título';
        return (
          <View testID="card-actions" style={[styles.actions, { top, left, backgroundColor: colors.surface, borderColor: colors.border }]}>
            {displayActions.filter((action) => action.display !== selectedPlacement.display).map((action) => (
              <ActionButton
                key={action.display}
                label={action.label}
                accessibilityLabel={`${action.label} ${title}`}
                onPress={() => props.onDisplay(selectedPlacement.cardId, action.display)}
              />
            ))}
            <ActionButton label="Papelera" accessibilityLabel={`Enviar ${title} a la Papelera`} onPress={() => props.onTrash(selectedPlacement.cardId)} />
          </View>
        );
      })() : null}
      {status ? (
        <Text
          testID="drag-status"
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: preview?.check.ok ? colors.textPrimary : colors.danger, backgroundColor: colors.surface, borderColor: preview?.check.ok ? colors.border : colors.danger }]}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden', borderWidth: 2, position: 'relative' },
  grab: Platform.OS === 'web' ? ({ cursor: 'grab' } as object) : {},
  content: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  gridColumn: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  gridRow: { position: 'absolute', left: 0, right: 0, height: 1 },
  relationLine: { position: 'absolute' },
  relationEnd: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  target: { position: 'absolute', borderWidth: 3, borderStyle: 'dashed', pointerEvents: 'none' },
  emptyWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 16 },
  empty: { maxWidth: 360, width: '100%', borderWidth: 2, padding: 20, gap: 12, alignItems: 'flex-start' },
  emptyTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900' },
  emptyText: { fontSize: 15, lineHeight: 22 },
  actions: { position: 'absolute', flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 2, borderWidth: 2, maxWidth: 360, zIndex: 30 },
  unplaced: { position: 'absolute', left: 12, right: 12, top: 12, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19 },
  status: { position: 'absolute', left: 12, right: 12, bottom: 12, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
