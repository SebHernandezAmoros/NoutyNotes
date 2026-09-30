import type { BoardLayout, CardDisplayMode, CardId, CardPlacement, GridPoint, GridRect, GridSize, RelationArrow, RelationId, Workspace } from '@noutynotes/domain';
import { footprint, frameMembers } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { ActionButton } from '../../components/controls';
import { describeCode } from '../../session/messages';
import { cardTitle } from '../Board';
import { relationSegments } from '../board-geometry';
import { RelationLine } from './RelationLine';
import { RelationMenu } from './RelationMenu';
import { CanvasCard, ResizeHandles } from './CanvasCard';
import { CanvasFrame } from './CanvasFrame';
import { CanvasOverview } from './CanvasOverview';
import type { FrameGestures } from './CanvasFrame';
import { CONTROL_SIZE, chromeFor, editChromeFor } from './cardChrome';
import type { CardAction, Chrome, EditChrome } from './cardChrome';
import { CardControls, CardMenu, EditButton } from './CardControls';
import { connectTarget } from './connect';
import { cardBox, checkFrameMove, checkMove, checkMoveMany, checkResize, dragTarget, isDrag, previewBox, resizeTarget } from './geometry';
import { cardsInArea, contentBounds, fitView } from './overview';
import type { CanvasMetrics, PlacementCheck, ResizeHandle } from './geometry';
import { formatDay } from '../dates';
import { clampZoom, panToRevealWorld, renderBase, visibleGridLines, worldPan, zoomAroundPoint, zoomIn, zoomOut } from './viewport';
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
  gestureEnded(cardId: CardId): void;
  /** Solo para esa tarjeta: una pulsación de teclado en otra no se descarta. */
  justEndedGesture(cardId: CardId): boolean;
  /** Una acción explícita rompe la secuencia de doble toque anterior. */
  resetTap(): void;
  canResize(): boolean;
  begin(gesture: { readonly cardId: CardId; readonly kind: 'move' | 'resize'; readonly handle: ResizeHandle }): void;
  update(dx: number, dy: number): void;
  finish(dx: number, dy: number): void;
  /** `fromEscape`: el botón sigue pulsado y su soltar no debe contar como toque. */
  abort(fromEscape?: boolean): void;
}

interface Gesture {
  readonly cardId: CardId;
  readonly kind: 'move' | 'resize';
  readonly handle: ResizeHandle;
  readonly dx: number;
  readonly dy: number;
  /** Mover el conjunto seleccionado (ADR 0025): todas las tarjetas con el desplazamiento de la arrastrada. */
  readonly group?: readonly CardId[];
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
  /** Selección múltiple (ADR 0025): se resaltan y se arrastran juntas. */
  readonly selectedIds: ReadonlySet<CardId>;
  /** Ctrl, ⌘ o Mayús + clic: añade o quita la tarjeta de la selección. */
  readonly onCardToggle: (cardId: CardId) => void;
  readonly onMoveMany: (cardIds: readonly CardId[], delta: GridPoint) => void;
  /** Marcos (ADR 0027): el seleccionado, tocar su título y soltar un arrastre válido. */
  readonly selectedFrameId: string | null;
  readonly onFramePress: (frameId: string) => void;
  readonly onFrameMove: (frameId: string, delta: GridPoint) => void;
  /** Vista general (ADR 0028): cambiar zoom y cámara juntos, restablecer y seleccionar por área. */
  readonly onZoom: (zoom: number) => void;
  readonly onView: (zoom: number, pan: Point) => void;
  readonly onResetView: () => void;
  readonly onAreaSelect: (cardIds: readonly CardId[]) => void;
  /** Fecha de creación en el pie de las fichas (ADR 0029). */
  readonly showDates: boolean;
  /** Tipografía de las notas (ADR 0030), ya resuelta para esta plataforma. */
  readonly noteFontFamily?: string | undefined;
  readonly connectSource: CardId | null;
  readonly onCardPress: (cardId: CardId) => void;
  readonly onBackgroundPress: () => void;
  readonly onMove: (cardId: CardId, to: GridPoint) => void;
  readonly onResize: (cardId: CardId, size: GridSize) => void;
  /** Posición/tamaño optimistas mientras se guarda (auditoría de interacción, 2026-09-29): sin esto, un
   * redibujado antes de que `layout` refleje el guardado mostraba la tarjeta un instante en su sitio
   * anterior («salto al soltar», reproducido con guardado lento y una segunda acción de por medio). */
  readonly pendingRects: ReadonlyMap<CardId, GridRect>;
  readonly onRejected: (message: string) => void;
  readonly onCreateFirst: () => void;
  readonly boardTitle: string;
  /** Títulos de las tarjetas del tablero que su layout no coloca (v1 válido). */
  readonly unplaced: readonly string[];
  /** Vistas previas de imágenes importadas por tarjeta. */
  readonly imageUris: ReadonlyMap<CardId, string>;
  /** Imágenes intercaladas en notas, por ruta (ADR 0021). */
  readonly noteImages: ReadonlyMap<string, string>;
  /** Doble toque o doble clic en una tarjeta: editor enfocado (ADR 0021). */
  readonly onCardOpen: (cardId: CardId) => void;
  /** Botón «Editar» de la tarjeta seleccionada (auditoría de interacción, 2026-09-29): un solo clic ya
   * no abre el editor por sí solo; esta es la vía explícita para llegar a él sin doble clic/toque. */
  readonly onCardEdit: (cardId: CardId) => void;
  /** Atajo del menú contextual: inicia una conexión desde esta tarjeta. */
  readonly onCardStartConnect: (cardId: CardId) => void;
  /** Acciones de la tarjeta seleccionada: representación y Papelera (ADR 0014, ADR 0015). */
  readonly onDisplay: (cardId: CardId, display: CardDisplayMode) => void;
  readonly onTrash: (cardId: CardId) => void;
  readonly onArchive: (cardId: CardId) => void;
  readonly onSelectMany: (cardId: CardId) => void;
  /** Menú de la línea de conexión seleccionada (auditoría de interacción, 2026-09-29): flechas, tipo,
   * rótulo y desconectar sin abrir el inspector completo de ninguna de las dos tarjetas. */
  readonly onRelationArrow: (relationId: RelationId, arrow: RelationArrow) => void;
  readonly onRelationUpdate: (relationId: RelationId, changes: { readonly typeLabel?: string; readonly label?: string }) => void;
  readonly onRelationDisconnect: (relationId: RelationId) => void;
  /** Distribución compacta: el menú «⋯» se abre como hoja inferior. */
  readonly compact: boolean;
  /** Tamaño visible del lienzo: la pantalla coloca las tarjetas nuevas dentro de lo que se ve (P2). */
  readonly onViewport?: (size: Size) => void;
}


/** Tipo del título flotante (ADR 0018): rótulo sin marco, sin número y con controles solo seleccionado. */
const FLOATING_TITLE = 'titulo-flotante';

/** Destino de un gesto en curso y su validez según el motor de grilla, antes de guardar nada. */
function evaluate(layout: BoardLayout, placement: CardPlacement, gesture: Gesture, zoom: number, metrics: CanvasMetrics) {
  if (gesture.kind === 'move' && gesture.group) {
    const to = dragTarget(placement.rect, gesture.dx, gesture.dy, zoom, metrics);
    const delta = { x: to.x - placement.rect.x, y: to.y - placement.rect.y };
    return { rect: { ...placement.rect, ...to }, delta, changed: delta.x !== 0 || delta.y !== 0, check: checkMoveMany(layout, gesture.group, delta) };
  }
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
  const { locale } = useLocale();
  const colors = theme.colors;
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // Puente local al soltar (auditoría de interacción, 2026-09-29): `setGesture(null)` de aquí y el
  // `pendingRects` que llega por props desde `WorkspaceScreen` no tienen garantizado el mismo ciclo de
  // render (son componentes distintos). Reproducido: sin este puente, un redibujado entre ambos mostraba
  // la tarjeta un instante en su sitio anterior («salto al soltar»). Al fijarlo en la misma función
  // síncrona que limpia `gesture`, ese primer redibujado ya usa el destino correcto; se libera en cuanto
  // `props.pendingRects` lo confirma (con éxito o con rechazo: en ambos casos dejó de hacer falta).
  const [justFinished, setJustFinished] = useState<ReadonlyMap<CardId, GridRect>>(new Map());
  // Se libera desde el propio gesto que lo creó (más abajo), no reactivamente a props: 100 ms bastan de
  // sobra para que `WorkspaceScreen` reciba el `pendingRects` que releva al puente (se fija en la misma
  // llamada síncrona que hace `run()`, mucho antes de que el guardado en sí termine).
  const releaseJustFinished = (cardId: CardId) => {
    setTimeout(() => setJustFinished((current) => {
      if (!current.has(cardId)) return current;
      const next = new Map(current);
      next.delete(cardId);
      return next;
    }), 100);
  };
  // Minimapa abierto (ADR 0028): estado de la sesión, cerrado por defecto.
  const [minimapOpen, setMinimapOpen] = useState(false);
  // Rectángulo de selección por área, en píxeles de la ventana del lienzo.
  const [marquee, setMarquee] = useState<{ readonly x: number; readonly y: number; readonly dx: number; readonly dy: number } | null>(null);
  // Arrastre del título de un marco (ADR 0027).
  const [frameDrag, setFrameDrag] = useState<{ readonly frameId: string; readonly dx: number; readonly dy: number } | null>(null);
  // Tarjeta estrecha cuyo menú «⋯» está abierto.
  const [menuFor, setMenuFor] = useState<CardId | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ readonly left: number; readonly top: number } | null>(null);
  // Línea de conexión seleccionada, con su menú compacto abierto (auditoría de interacción, 2026-09-29).
  const [selectedRelationId, setSelectedRelationId] = useState<RelationId | null>(null);
  const cards = useMemo(() => new Map(workspace.cards.map((card) => [card.id, card])), [workspace.cards]);
  const names = useMemo(() => new Map(workspace.cards.map((card) => [card.id, cardTitle(card)])), [workspace.cards]);
  const relationById = useMemo(() => new Map(workspace.relations.map((relation) => [relation.id, relation])), [workspace.relations]);
  const relationTypeLabel = useMemo(() => new Map(workspace.relationTypes.map((type) => [type.id, type.label])), [workspace.relationTypes]);
  const placements = layout?.placements ?? [];

  // Lo que leen los gestores de gestos (creados una vez); se actualiza tras cada render.
  const latest = useRef({ props, viewport, names });
  useLayoutEffect(() => {
    latest.current = { props, viewport, names };
  });

  // Ctrl, ⌘ o Mayús pulsadas al empezar el último puntero (web): el toque añade o quita de la selección.
  const modifierDown = useRef(false);
  // Controlador estable de gestos: las tarjetas y las asas crean sus PanResponder con él.
  const [controller] = useState<GestureController>(() => {
    // Identidad del gesto en curso, síncrona: no depende de que React haya vuelto a renderizar.
    let active: Omit<Gesture, 'dx' | 'dy'> | null = null;
    let cancelled = false;
    let ended: { cardId: CardId; at: number } | null = null;
    // Doble toque o doble clic con Seleccionar (ADR 0021): el primero selecciona y el segundo, sobre la
    // misma tarjeta en menos de 400 ms, abre el editor enfocado.
    let lastTap: { cardId: CardId; at: number } | null = null;
    // Escape cancela un arrastre con el botón aún pulsado: al soltar, esa pulsación llega como un toque
    // limpio. Selecciona como siempre, pero no cuenta para el doble toque.
    let swallowTap = false;
    return {
      gestureEnded: (cardId) => { ended = { cardId, at: Date.now() }; },
      justEndedGesture: (cardId) => ended !== null && ended.cardId === cardId && Date.now() - ended.at < 400,
      resetTap: () => { lastTap = null; },
      canDragCard: () => latest.current.props.tool === 'select' && active === null,
      tapCard: (cardId) => {
        if (swallowTap) {
          // Como antes, selecciona la tarjeta; pero no cuenta para el doble toque.
          swallowTap = false;
          lastTap = null;
          latest.current.props.onCardPress(cardId);
          return;
        }
        if (modifierDown.current) {
          lastTap = null;
          latest.current.props.onCardToggle(cardId);
          return;
        }
        const now = Date.now();
        const double = lastTap !== null && lastTap.cardId === cardId && now - lastTap.at < 400;
        lastTap = double ? null : { cardId, at: now };
        if (double) latest.current.props.onCardOpen(cardId);
        else latest.current.props.onCardPress(cardId);
      },
      canResize: () => latest.current.props.tool === 'select',
      begin: (next) => {
        cancelled = false;
        swallowTap = false;
        const { selectedIds } = latest.current.props;
        const group = next.kind === 'move' && selectedIds.size > 1 && selectedIds.has(next.cardId) ? [...selectedIds] : undefined;
        active = group ? { ...next, group } : next;
        setGesture({ ...active, dx: 0, dy: 0 });
      },
      update: (dx, dy) => {
        if (!cancelled) setGesture((current) => (current ? { ...current, dx, dy } : current));
      },
      abort: (fromEscape = false) => {
        cancelled = true;
        if (fromEscape) swallowTap = true;
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
        if (done.group && 'delta' in result && result.delta) {
          const delta = result.delta;
          const members = done.group ?? [];
          setJustFinished((prev) => {
            const next = new Map(prev);
            for (const cardId of members) {
              const memberPlacement = currentLayout.placements.find((candidate) => candidate.cardId === cardId);
              if (memberPlacement) next.set(cardId, { ...memberPlacement.rect, x: memberPlacement.rect.x + delta.x, y: memberPlacement.rect.y + delta.y });
            }
            return next;
          });
          for (const cardId of members) releaseJustFinished(cardId);
          current.props.onMoveMany(done.group, delta);
        } else if (done.kind === 'move') {
          setJustFinished((prev) => new Map(prev).set(done.cardId, result.rect));
          releaseJustFinished(done.cardId);
          current.props.onMove(done.cardId, { x: result.rect.x, y: result.rect.y });
        } else {
          setJustFinished((prev) => new Map(prev).set(done.cardId, result.rect));
          releaseJustFinished(done.cardId);
          current.props.onResize(done.cardId, { w: result.rect.w, h: result.rect.h });
        }
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
    const press = (event: PointerEvent) => {
      pointerDown.current = true;
      modifierDown.current = event.ctrlKey || event.metaKey || event.shiftKey;
      // Con el lienzo enfocado, pulsar una tarjeta le quita el foco al lienzo y RN Web termina el
      // responder de la tarjeta («ancestor blur»): el toque no seleccionaba. Se suelta antes del mousedown.
      if (document.activeElement === node && event.target !== node) node.blur();
    };
    const release = () => { pointerDown.current = false; };
    // Un arrastre nativo del navegador (de una selección de texto que quedó en la página o de una
    // <img> de tarjeta) cancela el puntero con `pointercancel` y deja la Mano o el arrastre de la
    // tarjeta a medias. En el lienzo nunca se quiere: se anula.
    const noNativeDrag = (event: Event) => event.preventDefault();
    // Ctrl + clic (ADR 0025): el sistema de respuesta de RN Web descarta las pulsaciones con Ctrl o Alt
    // (en macOS abren el menú contextual), así que no llega a `tapCard`. Se atiende aquí y no sigue:
    // el onPress de la tarjeta no debe seleccionarla además.
    const ctrlClick = (event: MouseEvent) => {
      if (!event.ctrlKey || event.button !== 0) return;
      const ids = new Set(latest.current.props.layout?.placements.map((placement) => placement.cardId) ?? []);
      for (let element = event.target as HTMLElement | null; element && element !== node; element = element.parentElement) {
        const testId = element.getAttribute('data-testid') ?? '';
        const cardId = testId.startsWith('card-') ? (testId.slice(5) as CardId) : null;
        if (cardId && ids.has(cardId)) {
          event.preventDefault();
          event.stopPropagation();
          if (latest.current.props.tool === 'select') latest.current.props.onCardToggle(cardId);
          return;
        }
      }
    };
    node.addEventListener('click', ctrlClick, true);
    node.addEventListener('dragstart', noNativeDrag, true);
    node.addEventListener('scroll', reset);
    node.addEventListener('pointerdown', press as EventListener, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      node.removeEventListener('dragstart', noNativeDrag, true);
      node.removeEventListener('click', ctrlClick, true);
      node.removeEventListener('scroll', reset);
      node.removeEventListener('pointerdown', press as EventListener, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);

  // Rueda y trackpad desplazan el mundo en ambos ejes. Shift+rueda permite desplazamiento lateral
  // con un ratón de una sola rueda; el listener no es pasivo para evitar que la página robe el scroll.
  // Ctrl/⌘ + rueda (o el gesto de pellizco del trackpad, que el navegador expone como wheel+ctrlKey)
  // hace zoom alrededor del cursor en vez de desplazar (auditoría de interacción, 2026-09-29): antes
  // secuestraba la rueda para paneo incluso con Ctrl pulsado, sin ofrecer forma de acercar con ella.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = viewportRef.current as unknown as HTMLElement | null;
    if (!node) return;
    node.tabIndex = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.viewport.height : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect();
        const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const nextZoom = clampZoom(current.props.zoom * Math.exp((-event.deltaY * factor) / 1200));
        if (nextZoom === current.props.zoom) return;
        current.props.onView(nextZoom, worldPan(zoomAroundPoint(current.props.pan, current.props.zoom, nextZoom, cursor)));
        return;
      }
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
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') controller.abort(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gesture, controller]);

  // Título de un marco: tocar lo selecciona; arrastrar mueve el marco con sus tarjetas (ADR 0027).
  const [frameGestures] = useState<FrameGestures>(() => {
    let active: string | null = null;
    const evaluateFrame = (frameId: string, dx: number, dy: number) => {
      const { props: current } = latest.current;
      const frame = current.layout?.frames?.find((candidate) => candidate.id === frameId);
      if (!current.layout || !frame) return null;
      const to = dragTarget(frame.rect, dx, dy, current.zoom, current.metrics);
      const delta = { x: to.x - frame.rect.x, y: to.y - frame.rect.y };
      return { delta, check: checkFrameMove(current.layout, frameId, delta) };
    };
    return {
      canDrag: () => latest.current.props.tool === 'select' && active === null,
      press: (frameId) => { if (latest.current.props.tool === 'select') latest.current.props.onFramePress(frameId); },
      begin: (frameId) => { active = frameId; setFrameDrag({ frameId, dx: 0, dy: 0 }); },
      update: (dx, dy) => { if (active) setFrameDrag((current) => (current ? { ...current, dx, dy } : current)); },
      abort: () => { active = null; setFrameDrag(null); },
      finish: (dx, dy) => {
        const frameId = active;
        active = null;
        setFrameDrag(null);
        if (!frameId) return;
        const result = evaluateFrame(frameId, dx, dy);
        if (!result || (result.delta.x === 0 && result.delta.y === 0)) return;
        if (!result.check.ok) {
          latest.current.props.onRejected(`No se guardó el cambio. ${rejection(result.check, latest.current.names)}`);
          return;
        }
        latest.current.props.onFrameMove(frameId, result.delta);
      },
    };
  });
  // Escape cancela el arrastre del marco sin guardar.
  useEffect(() => {
    if (Platform.OS !== 'web' || !frameDrag) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') frameGestures.abort(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frameDrag, frameGestures]);

  // Fondo con Seleccionar (ADR 0028): un toque cierra el editor o la selección; arrastrar dibuja un
  // rectángulo y, al soltar, las tarjetas que toca pasan a la selección múltiple.
  const [areaSelect] = useState(() => {
    let start = { x: 0, y: 0 };
    let area = false;
    return {
      active: () => latest.current.props.tool === 'select',
      grant: (x: number, y: number) => { start = { x, y }; area = false; },
      move: (dx: number, dy: number) => {
        if (!area && isDrag(dx, dy)) area = true;
        if (area) setMarquee({ ...start, dx, dy });
      },
      release: (dx: number, dy: number) => {
        setMarquee(null);
        const { props: current } = latest.current;
        if (!area) {
          setSelectedRelationId(null);
          current.onBackgroundPress();
          return;
        }
        area = false;
        // De la ventana al mundo: (pantalla − desplazamiento) / zoom.
        const ids = cardsInArea(current.layout, current.metrics, {
          left: (start.x - current.pan.x) / current.zoom, top: (start.y - current.pan.y) / current.zoom,
          width: dx / current.zoom, height: dy / current.zoom,
        });
        if (ids.length > 0) current.onAreaSelect(ids);
      },
      cancel: () => { area = false; setMarquee(null); },
    };
  });
  const [background] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => areaSelect.active(),
    onPanResponderGrant: (event) => areaSelect.grant(event.nativeEvent.locationX, event.nativeEvent.locationY),
    onPanResponderMove: (_event, state) => areaSelect.move(state.dx, state.dy),
    onPanResponderRelease: (_event, state) => areaSelect.release(state.dx, state.dy),
    onPanResponderTerminate: () => areaSelect.cancel(),
  }).panHandlers);

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
  const draggedFrame = frameDrag ? layout?.frames?.find((frame) => frame.id === frameDrag.frameId) : undefined;
  const framePreview = frameDrag && draggedFrame && layout ? (() => {
    const to = dragTarget(draggedFrame.rect, frameDrag.dx, frameDrag.dy, zoom, metrics);
    const delta = { x: to.x - draggedFrame.rect.x, y: to.y - draggedFrame.rect.y };
    return { delta, check: checkFrameMove(layout, draggedFrame.id, delta), members: frameMembers(layout, draggedFrame.id) };
  })() : null;
  for (const cardId of framePreview && !framePreview.check.ok ? framePreview.check.colliding : []) colliding.add(cardId);
  const groupMoving = new Set(framePreview ? framePreview.members : gesture?.group ?? []);
  const groupDelta = framePreview ? framePreview.delta : preview && 'delta' in preview && preview.delta ? preview.delta : null;
  // Píxeles del puntero del arrastre que mueve varias (sin imán, las fichas lo siguen).
  const pointer = frameDrag ?? gesture;
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
    : `${props.unplaced.length === 1 ? '1 tarjeta de este tablero no tiene' : `${props.unplaced.length} tarjetas de este tablero no tienen`} posición en la grilla: ${props.unplaced.map((title) => `«${title}»`).join(', ')}. Para colocar una, búscala con «Buscar» y pulsa «Ir»; sus datos no cambian.`;
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
  // Marco seleccionado (ADR 0027): se revela su título, que es donde se toca y se agarra.
  const selectedFrameRect = (() => {
    const found = layout?.frames?.find((frame) => frame.id === props.selectedFrameId);
    return found ? `${found.rect.x},${found.rect.y},${found.rect.w}` : '';
  })();
  useEffect(() => {
    if (selectedFrameRect === '' || viewport.width <= 0 || viewport.height <= 0) return;
    const current = latest.current;
    const frame = current.props.layout?.frames?.find((candidate) => candidate.id === current.props.selectedFrameId);
    if (!frame) return;
    const title = cardBox({ x: frame.rect.x, y: frame.rect.y, w: Math.min(frame.rect.w, 3), h: 1 }, current.props.metrics);
    const next = panToRevealWorld(current.props.pan, title, current.props.zoom, current.viewport);
    if (next.x !== current.props.pan.x || next.y !== current.props.pan.y) current.props.onPan(next);
  }, [selectedFrameRect, viewport.width, viewport.height]);
  // Controles de cabecera (ADR 0016): en píxeles de pantalla, fuera de la escala del zoom.
  const chrome = new Map<CardId, Chrome>();
  const editChrome = new Map<CardId, EditChrome>();
  if (tool === 'select') {
    for (const rawPlacement of placements) {
      if (gesture?.cardId === rawPlacement.cardId || gesture?.group?.includes(rawPlacement.cardId) || (framePreview && groupMoving.has(rawPlacement.cardId))) continue;
      // Un título flotante es un rótulo editorial: sus controles solo aparecen con él seleccionado.
      if (cards.get(rawPlacement.cardId)?.typeId === FLOATING_TITLE && rawPlacement.cardId !== selectedId) continue;
      // Mismo sitio optimista que el cuerpo de la tarjeta mientras se guarda (ver `pendingRects` arriba).
      const pendingRect = props.pendingRects.get(rawPlacement.cardId) ?? justFinished.get(rawPlacement.cardId);
      const placement = pendingRect ? { ...rawPlacement, rect: pendingRect } : rawPlacement;
      const box = cardBox(footprint(placement), metrics);
      const screen = { left: pan.x + box.left * zoom, top: pan.y + box.top * zoom, width: box.width * zoom, height: box.height * zoom };
      const isSelected = placement.cardId === selectedId;
      const found = chromeFor(placement.display, screen, isSelected, viewport);
      if (found) chrome.set(placement.cardId, found);
      const foundEdit = editChromeFor(placement.display, screen, isSelected);
      if (foundEdit) editChrome.set(placement.cardId, foundEdit);
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
  const status = framePreview && draggedFrame
    ? framePreview.check.ok
      ? `Mover el marco «${draggedFrame.title}» con ${framePreview.members.length === 1 ? '1 tarjeta' : `${framePreview.members.length} tarjetas`}: ${framePreview.delta.x >= 0 ? '+' : ''}${framePreview.delta.x} columnas, ${framePreview.delta.y >= 0 ? '+' : ''}${framePreview.delta.y} filas. Escape cancela.`
      : rejection(framePreview.check, names)
    : preview
    ? preview.check.ok
      ? gesture?.group ? `Mover ${gesture.group.length} tarjetas: ${groupDelta ? `${groupDelta.x >= 0 ? '+' : ''}${groupDelta.x} columnas, ${groupDelta.y >= 0 ? '+' : ''}${groupDelta.y} filas` : ''}. Escape cancela.`
      : `${gesture?.kind === 'move' ? 'Soltar en' : 'Nuevo tamaño:'} ${gesture?.kind === 'move'
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
      <View testID="canvas-background" style={StyleSheet.absoluteFill} {...background} />
      {showGrid ? (
        <View testID="canvas-grid" style={styles.overlay} pointerEvents="none">
          {/* Solo se dibujan destinos que el motor puede guardar. La antigua subgrilla de cuartos era
              decorativa y prometía puntos de ajuste inexistentes. */}
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
        {(layout?.frames ?? []).map((frame) => {
          const moving = framePreview && frame.id === draggedFrame?.id;
          const rect = moving ? { ...frame.rect, x: frame.rect.x + framePreview.delta.x, y: frame.rect.y + framePreview.delta.y } : frame.rect;
          const box = local(moving && !snap && frameDrag
            ? { ...cardBox(frame.rect, metrics), left: cardBox(frame.rect, metrics).left + frameDrag.dx / zoom, top: cardBox(frame.rect, metrics).top + frameDrag.dy / zoom }
            : cardBox(rect, metrics));
          return (
            <CanvasFrame
              key={frame.id}
              frame={frame}
              box={box}
              headerHeight={metrics.row - metrics.gap}
              members={layout ? frameMembers(layout, frame.id).length : 0}
              selected={props.selectedFrameId === frame.id}
              dragging={Boolean(moving)}
              colliding={Boolean(moving && framePreview && !framePreview.check.ok)}
              gestures={frameGestures}
            />
          );
        })}
        {placements.map((rawPlacement) => {
          const card = cards.get(rawPlacement.cardId);
          if (!card) return null;
          // Mientras se guarda, se dibuja en el sitio esperado en vez del que todavía tiene `layout»
          // (ver `pendingRects`/`justFinished` y la auditoría de interacción del 2026-09-29).
          const pendingRect = props.pendingRects.get(rawPlacement.cardId) ?? justFinished.get(rawPlacement.cardId);
          const placement = pendingRect ? { ...rawPlacement, rect: pendingRect } : rawPlacement;
          const index = numbers.get(card.id) ?? 0;
          const cell = footprint(placement);
          const dragging = gesture?.cardId === card.id || groupMoving.has(card.id);
          const box = local(dragging && pointer && groupDelta && (framePreview || preview)
            ? previewBox(cell, { x: placement.rect.x + groupDelta.x, y: placement.rect.y + groupDelta.y }, pointer.dx, pointer.dy, zoom, snap, metrics)
            : dragging && preview && gesture
            ? gesture.kind === 'move'
              ? previewBox(cell, { x: preview.rect.x, y: preview.rect.y }, gesture.dx, gesture.dy, zoom, snap, metrics)
              : cardBox(footprint({ ...placement, rect: preview.rect }), metrics)
            : cardBox(cell, metrics));
          const selected = selectedId === card.id || props.selectedIds.has(card.id);
          return (
            <CanvasCard
              key={card.id}
              workspace={workspace}
              card={card}
              number={index + 1}
              box={box}
              display={placement.display}
              selected={selected}
              createdLabel={props.showDates && card.createdAt ? formatDay(card.createdAt, new Date(card.createdAt).getTimezoneOffset(), locale) : undefined}
              noteFontFamily={props.noteFontFamily}
              dragging={dragging}
              colliding={colliding.has(card.id)}
              connectRole={tool === 'connect' ? connectTarget(connectSource, card.id, workspace.relations) : 'none'}
              connectSourceName={connectSource ? names.get(connectSource) ?? '' : ''}
              imageUri={props.imageUris.get(card.id)}
              noteImages={props.noteImages}
              onPress={() => props.onCardPress(card.id)}
              onFocus={() => reveal(card.id)}
              reserveRight={(() => {
                const found = chrome.get(card.id);
                return found ? (found.count * CONTROL_SIZE + 4) / zoom : 0;
              })()}
              controlsOverBody={zoom < 1}
              zoom={zoom}
              controller={controller}
            />
          );
        })}
        {/* Encima de las tarjetas: si dos fichas conectadas quedan pegadas, la línea y el rótulo
            igual se ven, en vez de quedar tapados por el fondo opaco de la tarjeta (ADR 0034). */}
        {segments.flatMap((segment) => {
          const relation = relationById.get(segment.relationId);
          if (!relation) return [];
          const highlighted = selectedId !== null && (relation.from === selectedId || relation.to === selectedId);
          return [
            <RelationLine
              key={segment.relationId}
              segment={segment}
              relation={relation}
              typeLabel={relationTypeLabel.get(relation.typeId) ?? ''}
              highlighted={highlighted}
              selected={selectedRelationId === relation.id}
              onSelect={() => setSelectedRelationId(relation.id)}
            />,
          ];
        })}
        {(() => {
          const relation = selectedRelationId ? relationById.get(selectedRelationId) : undefined;
          if (!relation) return null;
          return (
            <RelationMenu
              relation={relation}
              fromTitle={names.get(relation.from) ?? 'Sin título'}
              toTitle={names.get(relation.to) ?? 'Sin título'}
              typeLabel={relationTypeLabel.get(relation.typeId) ?? ''}
              compact={props.compact}
              onArrow={(arrow) => props.onRelationArrow(relation.id, arrow)}
              onSave={(nextTypeLabel, nextLabel) => props.onRelationUpdate(relation.id, { typeLabel: nextTypeLabel, label: nextLabel })}
              onDisconnect={() => { props.onRelationDisconnect(relation.id); setSelectedRelationId(null); }}
              onClose={() => setSelectedRelationId(null)}
            />
          );
        })()}
        {/* El destino va encima de las tarjetas: su color (válido o no) siempre se ve. */}
        {preview && groupDelta ? placements.filter((placement) => groupMoving.has(placement.cardId) && placement.cardId !== active?.cardId).map((placement) => (
          <View
            key={`target-${placement.cardId}`}
            pointerEvents="none"
            style={[styles.target, local(cardBox(footprint({ ...placement, rect: { ...placement.rect, x: placement.rect.x + groupDelta.x, y: placement.rect.y + groupDelta.y } }), metrics)), {
              borderColor: preview.check.ok ? colors.selection : colors.danger,
            }]}
          />
        )) : null}
        {preview && active ? (
          <View
            testID="drag-target"
            accessibilityLabel={preview.check.ok ? 'Destino válido' : 'Destino no válido'}
            style={[styles.target, local(cardBox(footprint({ ...active, rect: preview.rect }), metrics)), {
              borderColor: preview.check.ok ? colors.selection : colors.danger,
            }]}
          />
        ) : null}
        {/* Una ficha minimizada no se redimensiona desde el lienzo: su tamaño expandido queda oculto y
            sus acciones se abren desde un único menú al lado. El editor conserva «Más ancha/estrecha». */}
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
            onMenu={() => {
              controller.resetTap();
              if (Platform.OS === 'web') {
                const node = viewportRef.current as unknown as HTMLElement | null;
                const bounds = node?.getBoundingClientRect();
                setMenuAnchor(bounds ? { left: bounds.left + found.left, top: bounds.top + found.top } : null);
              }
              setMenuFor(placement.cardId);
            }}
            onFocus={() => reveal(placement.cardId)}
          />
        );
      })}
      {placements.map((placement) => {
        const found = editChrome.get(placement.cardId);
        if (!found) return null;
        return (
          <EditButton
            key={`edit-${placement.cardId}`}
            cardId={placement.cardId}
            title={names.get(placement.cardId) ?? 'Sin título'}
            chrome={found}
            onPress={() => { controller.resetTap(); props.onCardEdit(placement.cardId); }}
            onFocus={() => reveal(placement.cardId)}
          />
        );
      })}
      {menuPlacement ? (
        <CardMenu
          title={names.get(menuPlacement.cardId) ?? 'Sin título'}
          display={menuPlacement.display}
          compact={props.compact}
          anchor={menuAnchor}
          onEdit={() => props.onCardEdit(menuPlacement.cardId)}
          onTags={() => props.onCardEdit(menuPlacement.cardId)}
          onConnect={() => props.onCardStartConnect(menuPlacement.cardId)}
          onSelectMany={() => props.onSelectMany(menuPlacement.cardId)}
          onArchive={() => props.onArchive(menuPlacement.cardId)}
          onAction={(action) => runAction(menuPlacement.cardId, action)}
          onClose={() => setMenuFor(null)}
        />
      ) : null}
      {marquee ? (
        <View testID="selection-area" pointerEvents="none" style={[styles.marquee, {
          left: Math.min(marquee.x, marquee.x + marquee.dx), top: Math.min(marquee.y, marquee.y + marquee.dy),
          width: Math.abs(marquee.dx), height: Math.abs(marquee.dy), borderColor: colors.selection,
        }]} />
      ) : null}
      {tool !== 'connect' && viewport.width > 0 ? (
        <CanvasOverview
          layout={layout}
          metrics={metrics}
          zoom={zoom}
          pan={pan}
          viewport={viewport}
          showZoom={props.compact}
          minimapOpen={minimapOpen}
          onToggleMinimap={() => setMinimapOpen((open) => !open)}
          onZoomIn={() => props.onZoom(zoomIn(zoom))}
          onZoomOut={() => props.onZoom(zoomOut(zoom))}
          onZoomReset={props.onResetView}
          onFit={() => {
            const bounds = contentBounds(layout, metrics);
            if (!bounds) {
              props.onResetView();
              return;
            }
            // Los controles inferiores ocupan unos 64 px de la esquina de abajo: se deja ese alto libre.
            const fitted = fitView(bounds, viewport, 64);
            props.onView(fitted.zoom, fitted.pan);
          }}
          onPan={props.onPan}
        />
      ) : null}
      {status ? (
        <Text
          testID="drag-status"
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: (framePreview ?? preview)?.check.ok ? colors.textPrimary : colors.danger, backgroundColor: colors.surface, borderColor: (framePreview ?? preview)?.check.ok ? colors.border : colors.danger }]}
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
  target: { position: 'absolute', borderWidth: 3, borderStyle: 'dashed', pointerEvents: 'none' },
  emptyWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 16 },
  empty: { maxWidth: 360, width: '100%', borderWidth: 2, padding: 20, gap: 12, alignItems: 'flex-start' },
  emptyTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900' },
  emptyText: { fontSize: 15, lineHeight: 22 },
  unplaced: { position: 'absolute', left: 12, right: 12, top: 12, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19 },
  marquee: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed' },
  // Encima de los controles inferiores (ADR 0028), que ocupan la esquina de abajo.
  status: { position: 'absolute', left: 12, right: 12, bottom: 72, borderWidth: 2, padding: 10, fontSize: 14, lineHeight: 19, fontWeight: '700' },
});
