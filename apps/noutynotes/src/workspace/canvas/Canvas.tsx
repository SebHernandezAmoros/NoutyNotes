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
import { CONTROL_SIZE, chromeFor } from './cardChrome';
import type { CardAction, Chrome } from './cardChrome';
import { CardControls, CardMenu } from './CardControls';
import { connectTarget } from './connect';
import { cardBox, checkMove, checkResize, dragTarget, previewBox, resizeTarget } from './geometry';
import type { CanvasMetrics, PlacementCheck, ResizeHandle } from './geometry';
import { panToRevealWorld, renderBase, visibleGridLines, worldPan } from './viewport';
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
  /** Distribución compacta: el menú «⋯» se abre como hoja inferior. */
  readonly compact: boolean;
  /** Tamaño visible del lienzo: la pantalla coloca las tarjetas nuevas dentro de lo que se ve (P2). */
  readonly onViewport?: (size: Size) => void;
}


/** Tipo del título flotante (ADR 0018): rótulo sin marco, sin número y con controles solo seleccionado. */
const FLOATING_TITLE = 'titulo-flotante';

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
 * Lienzo del tablero (ADR 0017): coordenadas del mundo con zoom y desplazamiento, tarjetas
 * que se arrastran y redimensionan con vista previa validada por el dominio, relaciones y grilla.
 * Nunca modifica datos: al soltar un destino válido llama a `onMove`/`onResize`, que usan los casos de uso.
 */
export function Canvas(props: CanvasProps) {
  const { workspace, layout, metrics, zoom, pan, tool, snap, showGrid, selectedId, connectSource, boardTitle } = props;
  const { theme } = useTheme();
  const colors = theme.colors;
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // Tarjeta estrecha cuyo menú «⋯» está abierto.
  const [menuFor, setMenuFor] = useState<CardId | null>(null);
  const cards = useMemo(() => new Map(workspace.cards.map((card) => [card.id, card])), [workspace.cards]);
  const names = useMemo(() => new Map(workspace.cards.map((card) => [card.id, cardTitle(card)])), [workspace.cards]);
  const placements = layout?.placements ?? [];

  // Lo que leen los gestores de gestos (creados una vez); se actualiza tras cada render.
  const latest = useRef({ props, viewport, names });
  useLayoutEffect(() => {
    latest.current = { props, viewport, names };
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
    // Un arrastre nativo del navegador (de una selección de texto que quedó en la página o de una
    // <img> de tarjeta) cancela el puntero con `pointercancel` y deja la Mano o el arrastre de la
    // tarjeta a medias. En el lienzo nunca se quiere: se anula.
    const noNativeDrag = (event: Event) => event.preventDefault();
    node.addEventListener('dragstart', noNativeDrag, true);
    node.addEventListener('scroll', reset);
    node.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      node.removeEventListener('dragstart', noNativeDrag, true);
      node.removeEventListener('scroll', reset);
      node.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);

  // Rueda y trackpad desplazan el mundo en ambos ejes. Shift+rueda permite desplazamiento lateral
  // con un ratón de una sola rueda; el listener no es pasivo para evitar que la página robe el scroll.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node) return;
    node.tabIndex = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.viewport.height : 1;
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      current.props.onPan(worldPan({ x: current.props.pan.x - dx * factor, y: current.props.pan.y - dy * factor }));
    };
    const keys = (event: KeyboardEvent) => {
      if (event.target !== node || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 192 : 64;
      const current = latest.current;
      current.props.onPan(worldPan({
        x: current.props.pan.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        y: current.props.pan.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
      }));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('keydown', keys);
    return () => { node.removeEventListener('wheel', wheel); node.removeEventListener('keydown', keys); };
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
        current.props.onPan(worldPan({ x: origin.x + dx, y: origin.y + dy }));
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
  // Lo que se pinta dentro de la capa escalada se dibuja respecto a una base cerca de la cámara: así los
  // números pintados son pequeños aunque las tarjetas estén a un millón de celdas (ADR 0017).
  const base = renderBase(pan, zoom);
  const local = <T extends { readonly left: number; readonly top: number }>(box: T): T => ({ ...box, left: box.left - base.x, top: box.top - base.y });
  const boxes = placements.map((placement) => ({ cardId: placement.cardId, ...local(cardBox(footprint(placement), metrics)) }));
  const segments = relationSegments(workspace.relations, boxes);
  const empty = placements.length === 0 && props.unplaced.length === 0;
  // Numeración de las fichas (001, 002…) en orden del layout, sin contar los títulos flotantes.
  const numbers = new Map<CardId, number>();
  for (const placement of placements) {
    if (cards.get(placement.cardId)?.typeId !== FLOATING_TITLE) numbers.set(placement.cardId, numbers.size);
  }
  const unplacedText = props.unplaced.length === 0 ? null
    : `${props.unplaced.length === 1 ? '1 tarjeta de este tablero no tiene' : `${props.unplaced.length} tarjetas de este tablero no tienen`} posición en la grilla: ${props.unplaced.map((title) => `«${title}»`).join(', ')}. Colocarlas desde aquí llegará más adelante; sus datos no cambian.`;
  const selectedPlacement = placements.find((placement) => placement.cardId === selectedId);
  // La selección abre el inspector y reduce la ventana del lienzo. Revelar la tarjeta seleccionada
  // evita que la recién creada quede recortada; también responde a un resize posterior y a mover o
  // redimensionar esa tarjeta (por ejemplo, con los botones del inspector). Ni el zoom ni la cámara
  // la disparan: «Restablecer vista» vuelve al origen aunque haya una tarjeta seleccionada.
  const selectedRect = (() => {
    const found = placements.find((placement) => placement.cardId === selectedId);
    return found ? `${found.rect.x},${found.rect.y},${found.rect.w},${found.rect.h},${found.display}` : '';
  })();
  useEffect(() => {
    if (!selectedId || selectedRect === '' || viewport.width <= 0 || viewport.height <= 0) return;
    const current = latest.current;
    const placement = current.props.layout?.placements.find((candidate) => candidate.cardId === selectedId);
    if (!placement) return;
    const next = panToRevealWorld(current.props.pan, cardBox(footprint(placement), current.props.metrics), current.props.zoom, current.viewport);
    if (next.x !== current.props.pan.x || next.y !== current.props.pan.y) current.props.onPan(next);
  }, [selectedId, selectedRect, viewport.width, viewport.height]);
  // Controles de cabecera (ADR 0016): en píxeles de pantalla, fuera de la escala del zoom.
  const chrome = new Map<CardId, Chrome>();
  if (tool === 'select') {
    for (const placement of placements) {
      if (gesture?.cardId === placement.cardId) continue;
      // Un título flotante es un rótulo editorial: sus controles solo aparecen con él seleccionado.
      if (cards.get(placement.cardId)?.typeId === FLOATING_TITLE && placement.cardId !== selectedId) continue;
      const box = cardBox(footprint(placement), metrics);
      const screen = { left: pan.x + box.left * zoom, top: pan.y + box.top * zoom, width: box.width * zoom, height: box.height * zoom };
      const found = chromeFor(placement.display, screen, placement.cardId === selectedId, viewport);
      if (found) chrome.set(placement.cardId, found);
    }
  }
  const runAction = (cardId: CardId, action: CardAction) => {
    if (action.kind === 'trash') props.onTrash(cardId);
    else props.onDisplay(cardId, action.kind);
  };
  // Foco sin puntero en una tarjeta o en sus controles: el pan la muestra (ADR 0014).
  const reveal = (cardId: CardId) => {
    if (pointerDown.current) return;
    const current = latest.current;
    const placement = current.props.layout?.placements.find((candidate) => candidate.cardId === cardId);
    if (!placement) return;
    const next = panToRevealWorld(current.props.pan, cardBox(footprint(placement), current.props.metrics), current.props.zoom, current.viewport);
    if (next !== current.props.pan) current.props.onPan(next);
  };
  const menuPlacement = menuFor ? placements.find((placement) => placement.cardId === menuFor) : undefined;
  const status = preview
    ? preview.check.ok
      ? `${gesture?.kind === 'move' ? 'Soltar en' : 'Nuevo tamaño:'} ${gesture?.kind === 'move'
        ? preview.rect.x < 0 || preview.rect.y < 0 ? `X ${preview.rect.x}, Y ${preview.rect.y}` : `columna ${preview.rect.x + 1}, fila ${preview.rect.y + 1}`
        : `${preview.rect.w} × ${preview.rect.h}`}. Escape cancela.`
      : rejection(preview.check, names)
    : null;

  return (
    <View
      ref={viewportRef}
      testID="board-canvas"
      accessibilityLabel={`Lienzo del tablero ${boardTitle}`}
      accessibilityHint="Usa las flechas para desplazar el lienzo; Mayús desplaza más distancia."
      onLayout={(event: LayoutChangeEvent) => {
        const size = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
        setViewport(size);
        props.onViewport?.(size);
      }}
      style={[styles.viewport, { backgroundColor: colors.canvas, borderColor: colors.border }, tool === 'pan' ? styles.grab : null]}
      {...panHandlers}
    >
      {/* El papel y la grilla pertenecen al viewport: nunca terminan en la última tarjeta. */}
      <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => tool === 'select'} onResponderRelease={props.onBackgroundPress} />
      {showGrid ? (
        <View testID="canvas-grid" style={styles.overlay} pointerEvents="none">
          {visibleGridLines(pan.x, zoom, metrics.cell / 4, viewport.width).map((left) => (
            <View key={`sc${left}`} style={[styles.gridColumn, { left, backgroundColor: colors.gridLine, opacity: 0.32 }]} />
          ))}
          {visibleGridLines(pan.y, zoom, metrics.row / 4, viewport.height).map((top) => (
            <View key={`sr${top}`} style={[styles.gridRow, { top, backgroundColor: colors.gridLine, opacity: 0.32 }]} />
          ))}
          {visibleGridLines(pan.x, zoom, metrics.cell, viewport.width).map((left) => (
            <View key={`c${left}`} style={[styles.gridColumn, { left, backgroundColor: colors.gridLine }]} />
          ))}
          {visibleGridLines(pan.y, zoom, metrics.row, viewport.height).map((top) => (
            <View key={`r${top}`} style={[styles.gridRow, { top, backgroundColor: colors.gridLine }]} />
          ))}
        </View>
      ) : null}
      <View
        testID="canvas-content"
        pointerEvents="box-none"
        style={[styles.content, {
          width: viewport.width, height: viewport.height,
          transform: [{ translateX: pan.x + base.x * zoom }, { translateY: pan.y + base.y * zoom }, { scale: zoom }],
        }]}
      >
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
        {placements.map((placement) => {
          const card = cards.get(placement.cardId);
          if (!card) return null;
          const index = numbers.get(card.id) ?? 0;
          const cell = footprint(placement);
          const dragging = gesture?.cardId === card.id;
          const box = local(dragging && preview
            ? gesture.kind === 'move'
              ? previewBox(cell, { x: preview.rect.x, y: preview.rect.y }, gesture.dx, gesture.dy, zoom, snap, metrics)
              : cardBox(footprint({ ...placement, rect: preview.rect }), metrics)
            : cardBox(cell, metrics));
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
              onFocus={() => reveal(card.id)}
              reserveRight={(() => {
                const found = chrome.get(card.id);
                return found && found.kind !== 'strip' ? (found.count * CONTROL_SIZE + 4) / zoom : 0;
              })()}
              controlsOverBody={zoom < 1}
              controller={controller}
            />
          );
        })}
        {/* El destino va encima de las tarjetas: su color (válido o no) siempre se ve. */}
        {preview && active ? (
          <View
            testID="drag-target"
            accessibilityLabel={preview.check.ok ? 'Destino válido' : 'Destino no válido'}
            style={[styles.target, local(cardBox(footprint({ ...active, rect: preview.rect }), metrics)), {
              borderColor: preview.check.ok ? colors.selection : colors.danger,
            }]}
          />
        ) : null}
        {/* Una ficha minimizada no se redimensiona desde el lienzo: su tamaño expandido queda oculto y la tira de
            controles va a su lado (ADR 0016). El inspector conserva «Más ancha/estrecha». */}
        {selectedPlacement && tool === 'select' && selectedPlacement.display !== 'minimized' ? (
          <ResizeHandles
            key={selectedPlacement.cardId}
            cardId={selectedPlacement.cardId}
            box={local(gesture?.cardId === selectedPlacement.cardId && preview
              ? cardBox(footprint({ ...selectedPlacement, rect: preview.rect }), metrics)
              : cardBox(footprint(selectedPlacement), metrics))}
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
      {placements.map((placement) => {
        const found = chrome.get(placement.cardId);
        if (!found) return null;
        return (
          <CardControls
            key={placement.cardId}
            cardId={placement.cardId}
            title={names.get(placement.cardId) ?? 'Sin título'}
            display={placement.display}
            floating={cards.get(placement.cardId)?.typeId === FLOATING_TITLE}
            chrome={found}
            onAction={(action) => runAction(placement.cardId, action)}
            onMenu={() => setMenuFor(placement.cardId)}
            onFocus={() => reveal(placement.cardId)}
          />
        );
      })}
      {menuPlacement ? (
        <CardMenu
          title={names.get(menuPlacement.cardId) ?? 'Sin título'}
          display={menuPlacement.display}
          compact={props.compact}
          onAction={(action) => runAction(menuPlacement.cardId, action)}
          onClose={() => setMenuFor(null)}
        />
      ) : null}
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
  // Superficie de gestos, no de texto: sin selección que el navegador pueda arrastrar.
  viewport: { flex: 1, overflow: 'hidden', borderWidth: 2, position: 'relative', userSelect: 'none' },
  grab: Platform.OS === 'web' ? ({ cursor: 'grab' } as object) : {},
  content: { position: 'absolute', left: 0, top: 0, overflow: 'visible', transformOrigin: 'left top' },
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
  unplaced: { position: 'absolute', left: 12, right: 12, top: 12, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19 },
  status: { position: 'absolute', left: 12, right: 12, bottom: 12, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
