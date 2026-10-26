import { cardContentPresentation, isFloatingTextCard, linkDisplay, linkUrlField, resolveCardImageFit, resolveNoteBackground } from '@noutynotes/domain';
import type { RichTextCodec } from '@noutynotes/application';
import type { Card, CardDisplayMode, RichTextDocument, RichTextList, Workspace } from '@noutynotes/domain';
import { parseNoteBlocks } from '@noutynotes/application';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { View as RNView } from 'react-native';

import { t } from '../../i18n';
import { cardDisplayTitle, cardTitle, isImageCard } from '../Board';
import { BasicRichTextPreview } from '../BasicRichTextPreview';
import { parseWebRichText } from '../basicRichText';
import { ImagePlaceholder } from '../ImagePlaceholder';
import { RetiredCardResource } from '../RetiredCardResource';
import type { ImageResourceState } from '../imageResources';
import { markdownExcerpt, parseChecklistLine } from '../markdownLists';
import { bodyFontSize, titleFontSize } from '../textSizes';
import { floatingTextColor } from '../floatingText';
import { ShapePreview } from '../ShapePreview';
import type { GestureController } from './Canvas';
import { miniIcon } from './cardChrome';
import { CardIcon } from './CardIcon';
import { canvasTextMetrics } from './canvasTypography';
import { NotePreview } from './NotePreview';
import { previewOverflow } from './previewOverflow';
import { IMAGE_BLOCK_LINES, inlinePlainText } from './richTextPreviewProjection';
import { RichNotePreview } from './RichNotePreview';
import { RichNoteReader } from './RichNoteReader';
import type { ConnectRole } from './connect';
import { isDrag } from './geometry';
import { handlesFor, headerlessGripLayout, isCardDragTarget } from './cardInteraction';
import type { PixelBox, ResizeHandle } from './geometry';

/** Alto de la cabecera a zoom 100 %: aloja los controles de 44 px (ADR 0016). */
export const HEADER = 44;
/** Área táctil de cada asa; el cuadrado visible es menor. */
const HANDLE_HIT = 44;
const HANDLE_MARK = 14;

/** Explicit preview actions must receive the pointer instead of beginning a card drag. */
function hitsPreviewAction(target: unknown): boolean {
  if (!target || typeof target !== 'object' || !('closest' in target)) return false;
  return typeof target.closest === 'function' && target.closest('[data-testid$="-overflow-action"]') !== null;
}

function listContainsChecklist(list: RichTextList): boolean {
  return list.style === 'checklist' || list.items.some((item) => item.children?.some(listContainsChecklist));
}

function checklistTextsOf(list: RichTextList): readonly string[] {
  return list.items.flatMap((item) => [
    ...(list.style === 'checklist' ? [inlinePlainText(item.content)] : []),
    ...(item.children?.flatMap(checklistTextsOf) ?? []),
  ]);
}

type PreviewBodyBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'check'; readonly lineIndex: number; readonly checked: boolean; readonly indent: string; readonly text: string };

/** Texto plano de un documento HTML seguro (ADR 0066), una línea aproximada por bloque/elemento: base
 * para estimar desbordamiento y para el resumen de texto plano de la ficha, igual que se hace con las
 * líneas de Markdown en el resto de este archivo. Un bloque de imagen reserva `IMAGE_BLOCK_LINES`
 * renglones en blanco (OBS-N2-28/G1, corrección de regresión de texto omitido): antes no aportaba
 * ningún renglón a esta estimación, así que `previewOverflow` podía concluir que una Nota con imagen
 * cabía entera en la vista compacta justo cuando, por el alto real que G1 le da a la imagen, no cabía
 * — enviándola a `RichNotePreview`, que entonces sí la recortaba. */
function richDocumentPlainText(document: RichTextDocument): string {
  const lines: string[] = [];
  const walkList = (list: RichTextList) => {
    for (const item of list.items) {
      lines.push(inlinePlainText(item.content));
      for (const child of item.children ?? []) walkList(child);
    }
  };
  for (const block of document.blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') lines.push(inlinePlainText(block.content));
    else if (block.type === 'list') walkList(block);
    else if (block.type === 'table') {
      for (const row of block.header ? [block.header, ...block.rows] : block.rows) {
        for (const cell of row.cells) lines.push(inlinePlainText(cell.content));
      }
    } else if (block.type === 'retired-image') lines.push('Imagen retirada', block.alt, inlinePlainText(block.caption ?? []), '');
    else if (block.type === 'image') lines.push('\n'.repeat(IMAGE_BLOCK_LINES - 1));
  }
  return lines.join('\n');
}

/** Bloques de resumen (texto o casilla) de un documento HTML seguro, en el mismo orden visible que el
 * editor Visual. `lineIndex` de una casilla es su posición entre casillas (orden de documento), no una
 * línea de texto: el único consumidor (`onToggleCheck`) resuelve el índice según la fuente de la nota. */
function richDocumentBodyBlocks(document: RichTextDocument, limit: number): readonly PreviewBodyBlock[] {
  const out: PreviewBodyBlock[] = [];
  let checklistIndex = 0;
  const pushList = (list: RichTextList) => {
    for (const item of list.items) {
      if (list.style === 'checklist') {
        out.push({ kind: 'check', lineIndex: checklistIndex, checked: item.checked ?? false, indent: '', text: inlinePlainText(item.content) });
        checklistIndex += 1;
      } else out.push({ kind: 'text', text: inlinePlainText(item.content) });
      for (const child of item.children ?? []) pushList(child);
    }
  };
  for (const block of document.blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') out.push({ kind: 'text', text: inlinePlainText(block.content) });
    else if (block.type === 'list') pushList(block);
  }
  return out.slice(0, limit);
}

interface CanvasCardProps {
  readonly onOpenDocument: () => void;
  readonly richTextCodec: RichTextCodec;
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
  /** Estado de disponibilidad de la imagen importada (OBS-N2-IMAGE-FIT-F2); sin ninguna referencia, una tarjeta de imagen es de ejemplo. */
  readonly imageResource: ImageResourceState | undefined;
  /** Estado de disponibilidad de las imágenes intercaladas en la nota, por ruta (OBS-N2-IMAGE-FIT-F2). */
  readonly noteImageResources: ReadonlyMap<string, ImageResourceState>;
  /** Ancho, en unidades del lienzo, que ocupan los controles de la cabecera (dibujados fuera del zoom). */
  readonly reserveRight: number;
  /** Con el zoom alejado, los controles de 44 px bajan sobre el cuerpo: el título les deja sitio. */
  readonly controlsOverBody: boolean;
  /** UX7-B2: marca o desmarca la línea de checklist `lineIndex` de `card.content` directamente en el lienzo. */
  readonly onToggleCheck: (cardId: Card['id'], lineIndex: number) => void;
  /** Sin marco en reposo (preferencia global u override por ficha, ADR 0049); selección/foco/arrastre/edición lo mantienen. */
  readonly hideFrame: boolean;
  readonly zoom: number;
  readonly enableGrip: boolean;
}

interface ChecklistHit { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }

const displayNames: Readonly<Record<CardDisplayMode, string>> = { expanded: '', collapsed: ', contraída', minimized: ', minimizada' };

const connectHints: Readonly<Record<ConnectRole, string | null>> = {
  none: null,
  source: 'Origen · toca otra tarjeta',
  connect: '+ Conectar',
  disconnect: '× Desconectar',
};

/** Ficha de papel del lienzo: cabecera por tipo, título, resumen y estado. Solo representa. */
export function CanvasCard(props: CanvasCardProps) {
  const { workspace, card, number, box, display, selected, dragging, colliding, connectRole, connectSourceName, onPress, hideFrame } = props;
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const [contextPress] = useState(() => {
    let held = false;
    return { reset: () => { held = false; }, hold: () => { held = true; }, held: () => held };
  });
  const { controller } = props;
  // UX7-B2: filas de checklist medidas en pantalla (coordenadas absolutas, como `gestureState.x0/y0`)
  // para que el PanResponder de abajo las excluya y el toque llegue al Pressable de la fila, no al arrastre.
  const checklistHitsRef = useRef<ReadonlyMap<number, ChecklistHit>>(new Map());
  const checklistRowRefs = useRef<Map<number, RNView>>(new Map());
  const readerHitRef = useRef<ChecklistHit | null>(null);
  const readerRef = useRef<RNView | null>(null);
  // Igual que `areaSelect`/`panner` en Canvas.tsx: la función que mira la ref vive en su propia
  // fábrica, separada de la que la usa; así ESLint no confunde el acceso (diferido al evento) con
  // una lectura de ref durante el pintado. `hitsChecklist` también la usa el Pressable de la ficha
  // de abajo: en react-native-web, nada garantiza que un Pressable anidado detenga por sí solo la
  // detección de toque del Pressable que lo envuelve (no es una simple burbuja de clic del DOM), así
  // que ambos preguntan lo mismo por coordenadas en vez de depender de `stopPropagation`.
  const [checklistGuard] = useState(() => ({
    hitsChecklist: (x: number, y: number) => {
      for (const hit of checklistHitsRef.current.values()) {
        if (x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom) return true;
      }
      return false;
    },
    hitsReader: (x: number, y: number) => {
      const hit = readerHitRef.current;
      return hit !== null && x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom;
    },
  }));
  // Un PanResponder estable por tarjeta. Con Seleccionar captura al pulsar, para no perder un arrastre
  // rápido que sale de la tarjeta; el arrastre empieza al superar el umbral y, sin él, es un toque.
  // Con Mano o Conectar no captura: el lienzo desplaza o el Pressable recibe el toque. Una fila de
  // checklist tampoco captura: el toque debe marcarla, no mover ni seleccionar la ficha entera.
  const [dragHandlers] = useState(() => {
    let dragging = false;
    // Recuerda la decisión del gesto en curso: algunos manejadores (p. ej. el toque sin arrastre, más
    // abajo) pueden seguir llamándose aunque la captura se haya declinado.
    let blocked = false;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        // `gestureState.x0/y0` no es fiable para un toque simple en web (puede llegar en 0,0 sin que
        // haya habido movimiento); se usa la posición del evento nativo, como hace el Pressable de la
        // ficha para la misma decisión.
        const { pageX, pageY } = event.nativeEvent;
        blocked = !controller.canDragCard() || (Platform.OS === 'web' && !isCardDragTarget(event.nativeEvent.target)) || hitsPreviewAction(event.nativeEvent.target) || checklistGuard.hitsChecklist(pageX, pageY) || checklistGuard.hitsReader(pageX, pageY);
        return !blocked;
      },
      onPanResponderGrant: () => { dragging = false; controller.begin({ cardId: card.id, kind: 'move', handle: 'se' }); },
      onPanResponderMove: (_event, state) => {
        if (blocked) return;
        if (!dragging && isDrag(state.dx, state.dy)) {
          dragging = true;
        }
        if (dragging) controller.update(state.dx, state.dy);
      },
      onPanResponderRelease: (_event, state) => {
        if (blocked) { blocked = false; return; }
        controller.gestureEnded(card.id);
        if (dragging) controller.finish(state.dx, state.dy);
        else { controller.abort(); controller.tapCard(card.id); }
        dragging = false;
      },
      onPanResponderTerminate: () => {
        if (blocked) { blocked = false; return; }
        controller.gestureEnded(card.id);
        if (dragging) controller.abort();
        dragging = false;
      },
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  });
  const image = isImageCard(workspace, card) && card.content === undefined;
  // Las medidas internas permanecen en unidades normales del lienzo. El transform común escala la
  // Nota y todo su contenido en la misma proporción, sin compensación tipográfica inversa.
  const titleBase = titleFontSize(card.titleSize);
  const bodyBase = bodyFontSize(card.bodySize);
  const typography = canvasTextMetrics({ titleSize: titleBase, bodySize: bodyBase });
  const titleSize = typography.titleSize;
  const contentSize = typography.bodySize;
  const headerTextSize = typography.headerSize;
  const contentLine = typography.bodyLineHeight;
  // Nota con imágenes intercaladas (ADR 0021): la ficha muestra los bloques en orden. El cuerpo HTML
  // seguro (ADR 0066) sustituye `content` de forma excluyente (dominio): sin él no hay nada que
  // parsear como Markdown, así que estos bloques heredados solo aplican a notas aún no migradas.
  const htmlAuthored = card.contentDocument !== undefined;
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  const legacyPreviewContent = !htmlAuthored && type?.base === 'note'
    ? props.richTextCodec.projectLegacyNotePreview?.(card.content ?? '') ?? card.content ?? ''
    : card.content ?? '';
  const blocks = image || htmlAuthored ? [] : parseNoteBlocks(legacyPreviewContent);
  const mixedLegacy = blocks.some((block) => block.kind === 'image');
  const richDocument = image ? null : (card.contentDocument ?? parseWebRichText(props.richTextCodec, card.content ?? ''));
  const hasImageBlock = htmlAuthored && (richDocument?.blocks.some((block) => block.type === 'image') ?? false);
  const mixed = mixedLegacy || hasImageBlock;
  // El visor enriquecido es necesario cuando el legado perdería estructura (tabla + imagen). Para
  // imagen + texto Markdown se conserva NotePreview, que ya cubre las cuatro posiciones de leyenda;
  // una nota HTML con imagen no tiene bloques de NotePreview que mostrar (arriba quedan vacíos), así
  // que siempre usa el visor enriquecido.
  const mixedRich = (mixedLegacy && (richDocument?.blocks.some((block) => block.type === 'table') ?? false)) || hasImageBlock;
  const hasChecklist = richDocument?.blocks.some((block) => block.type === 'list' && listContainsChecklist(block)) ?? false;
  const previewDocument = hasChecklist ? null : richDocument;
  const checklistTexts = richDocument?.blocks.flatMap((block) => block.type === 'list' ? checklistTextsOf(block) : []) ?? [];
  const floatingTitle = card.typeId === 'titulo-flotante';
  const floatingText = isFloatingTextCard(card, type?.base) && (type?.base !== 'note' || resolveNoteBackground(card, type.base) === 'transparent');
  const presentation = cardContentPresentation(card, type?.base);
  const imageFit = resolveCardImageFit(card, type?.base);
  const unifiedFloating = type?.base === 'note' && resolveNoteBackground(card, type.base) === 'transparent';
  // Una Nota sin superficie hereda el contraste del lienzo efectivo. `textColor` sigue ganando cuando
  // la persona eligió un color manual; `default` usa el texto primario del tema, no `cardText`, que fue
  // diseñado para la superficie clara y opaca de la tarjeta incluso en modo oscuro.
  const noteTextColor = unifiedFloating ? floatingTextColor(card.textColor, colors.textPrimary) : colors.cardText;
  const shape = type?.base === 'shape';
  const connector = type?.base === 'connector';
  const note = type?.base === 'note';
  // UX7.1-A4: una tarjeta de documento referencia un PDF ya catalogado (sin copiarlo) y solo muestra su
  // identidad (icono + nombre) — el visor real se abre con doble toque, reutilizando `PdfPreview`.
  const document = type?.base === 'file';
  const hint = connectHints[connectRole];
  const borderColor = colliding ? colors.danger : selected || focused || connectRole === 'source' ? colors.selection : colors.border;
  // Sin marco en reposo (ADR 0049): selección, foco, colisión, arrastre y conexión en curso lo mantienen
  // perceptible (criterio de aceptación de UX7-D3); solo desaparece cuando la ficha está, en efecto, en reposo.
  const activeBorder = selected || colliding || focused || connectRole === 'source' || dragging;
  const tags = card.tags ?? [];
  // Con pie (etiquetas o fecha), el texto cede sus líneas: relleno, título, hueco y bordes (48) más
  // 22 por línea de pie (hueco + 16). Sin pie se conserva el cálculo anterior.
  // Las relaciones se consultan en Inspector/detalles y se representan por sus líneas; el pie de la
  // Nota reserva esta fila únicamente para la fecha de creación opcional (ADR 0029).
  const meta = props.createdLabel ?? '';
  const footerLines = (tags.length > 0 ? 1 : 0) + (meta !== '' ? 1 : 0);
  const imageHasTitle = presentation.title === 'visible' && Boolean(cardDisplayTitle(card));
  const imageTitleLines = Math.min(2, Math.max(1, Math.floor((box.height - HEADER - 16 - 40 - 6 - 6 - footerLines * 22) / typography.titleLineHeight)));
  const minimumContentHeight = card.primaryResourceState ? 112 : document ? 46 + 24 + 8 + typography.titleLineHeight + 6
    : image ? HEADER + 16 + 40 + 6 + footerLines * 22 + (imageHasTitle ? typography.titleLineHeight + 6 : 0)
      : HEADER + 24 + contentLine;
  // Enlace (ADR 0020): una línea con dominio y ruta, sin descargar nada; ocupa una línea del texto.
  const linkKey = linkUrlField(type);
  const linkValue = linkKey ? card.fields[linkKey] : undefined;
  const link = typeof linkValue === 'string' ? linkDisplay(linkValue) : undefined;
  const bodyLines = Math.max(0, Math.floor((box.height - HEADER - (footerLines > 0 ? 48 + footerLines * 22 : 40)) / contentLine) - (link ? 1 : 0));
  const collapsedBodyLines = Math.max(0, Math.floor((box.height - HEADER - 12) / contentLine));
  const overflow = previewOverflow(htmlAuthored ? (richDocument ? richDocumentPlainText(richDocument) : '') : legacyPreviewContent, box.width, contentSize, bodyLines);
  const fullReader = note && display === 'expanded' && richDocument !== null && overflow.hiddenLines > 0;
  // UX7-B2: cada línea mostrada es texto agrupado o una fila de checklist propia (marcable sin abrir
  // el editor). El recorte por `bodyLines` es el mismo que el bloque único anterior.
  const bodyBlocks: PreviewBodyBlock[] = [];
  if (!image && !mixed && previewDocument === null) {
    if (htmlAuthored && richDocument) {
      bodyBlocks.push(...richDocumentBodyBlocks(richDocument, overflow.shownLines));
    } else {
      const shown = (card.content ?? '').split('\n').slice(0, overflow.shownLines);
      let checklistIndex = 0;
      for (const [lineIndex, line] of shown.entries()) {
        const check = parseChecklistLine(line);
        if (check) {
          bodyBlocks.push({ kind: 'check', lineIndex, checked: check.checked, indent: check.indent, text: checklistTexts[checklistIndex] ?? markdownExcerpt(check.text) });
          checklistIndex += 1;
          continue;
        }
        const last = bodyBlocks[bodyBlocks.length - 1];
        const text = markdownExcerpt(line);
        if (last?.kind === 'text') bodyBlocks[bodyBlocks.length - 1] = { kind: 'text', text: `${last.text}\n${text}` };
        else bodyBlocks.push({ kind: 'text', text });
      }
    }
  }
  // Mide cada fila de checklist en pantalla tras pintar: su posición real no depende de lo que haya
  // antes (texto que puede ajustar su alto), así que no se calcula a mano.
  useLayoutEffect(() => {
    const next = new Map<number, ChecklistHit>();
    let pending = checklistRowRefs.current.size;
    if (pending === 0) { checklistHitsRef.current = next; return; }
    for (const [lineIndex, node] of checklistRowRefs.current) {
      node.measureInWindow((x, y, width, height) => {
        next.set(lineIndex, { top: y, bottom: y + height, left: x, right: x + width });
        pending -= 1;
        if (pending === 0) checklistHitsRef.current = next;
      });
    }
  });
  useLayoutEffect(() => {
    const node = readerRef.current;
    if (!node) { readerHitRef.current = null; return; }
    node.measureInWindow((x, y, width, height) => {
      readerHitRef.current = { top: y, bottom: y + height, left: x, right: x + width };
    });
  });
  const headerColor = image ? colors.headerImage : colors.headerNote;
  const compactContent = display === 'expanded' && (box.height < minimumContentHeight || box.width < 64);
  const headerless = display === 'expanded' && !connector && (compactContent || card.primaryResourceState || unifiedFloating || floatingTitle || floatingText || shape || document);
  const grip = props.enableGrip && headerless ? headerlessGripLayout({ width: box.width - props.reserveRight, height: box.height }, props.zoom) : null;
  const contentTop = grip ? (grip.contentLeft ? 2 : Math.max(36, grip.contentTop)) : 36;
  const contentInset = grip ? { paddingTop: contentTop, ...(grip.contentLeft ? { paddingLeft: grip.contentLeft } : {}) } : null;
  const extraTop = contentTop - 36;
  const compactWithGrip = compactContent || Boolean(grip?.contentLeft) || (headerless && box.height < minimumContentHeight + extraTop);
  const documentTitleLines = Math.min(3, Math.max(1, Math.floor((box.height - extraTop - 46 - 24 - 8 - 6) / typography.titleLineHeight)));
  const icon = card.icon ?? miniIcon(type?.base);
  const number3 = String(number).padStart(3, '0');
  // El nombre de una Nota es metadato: la pestaña lo identifica de forma compacta y truncable, sin
  // convertirlo en un segundo encabezado encima del cuerpo. Los demás tipos conservan su etiqueta.
  const tabLabel = note
    ? `${number3} // ${cardDisplayTitle(card) || type?.label || 'Nota'}`
    : box.width - props.reserveRight - 16 >= 110 ? `${number3} // ${(type?.label ?? 'Tarjeta').toUpperCase()}` : number3;
  const accessibilityHint = connectRole === 'connect' ? `Conectar ${connectSourceName} con esta tarjeta`
    : connectRole === 'disconnect' ? `Desconectar ${connectSourceName} de esta tarjeta`
      : connectRole === 'source' ? 'Cancelar la conexión'
        : selected && Platform.OS === 'web'
          ? 'Doble toque para editar; arrastra o usa las flechas para mover; Mayús más flecha cambia el tamaño'
          : 'Selecciona la tarjeta; doble toque para editar; arrastra para mover';
  return (
    <View
      style={[styles.wrap, { left: box.left, top: box.top, width: box.width, height: box.height }, dragging ? styles.lifted : null]}
      {...dragHandlers}
    >
      <Pressable
        testID={`card-${card.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Tarjeta ${cardTitle(card, locale)}${displayNames[display]}${card.primaryResourceState ? `. ${t('card.resourceRetired', locale)}` : ''}`}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected }}
        {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
        onPress={(event) => {
          if (contextPress.held()) return;
          // Igual que la decisión de captura de arriba: un toque que empezó en una fila de checklist
          // no debe seleccionar ni abrir la ficha entera.
          const { pageX, pageY } = event.nativeEvent;
          if (hitsPreviewAction(event.nativeEvent.target) || checklistGuard.hitsChecklist(pageX, pageY) || checklistGuard.hitsReader(pageX, pageY)) return;
          if (!controller.justEndedGesture(card.id)) {
            const native = event.nativeEvent;
            const keyboard = ('key' in native && typeof native.key === 'string') || ('type' in native && native.type === 'click' && 'detail' in native && native.detail === 0);
            // The body no longer acquires the drag responder, but keeps the same double-tap action.
            if (Platform.OS === 'web' && !keyboard && controller.canDragCard()) controller.tapCard(card.id);
            else onPress();
          }
        }}
        onPressIn={contextPress.reset}
        onPressOut={() => {
          if (contextPress.held()) { controller.gestureEnded(card.id); controller.openMenu(card.id); }
        }}
        onLongPress={(event) => {
          const { pageX, pageY, target } = event.nativeEvent;
          if (Platform.OS !== 'web' || !controller.canDragCard() || hitsPreviewAction(target) || checklistGuard.hitsChecklist(pageX, pageY) || checklistGuard.hitsReader(pageX, pageY)) return;
          contextPress.hold();
        }}
        onFocus={() => { setFocused(true); props.onFocus(); }}
        onBlur={() => setFocused(false)}
        style={[styles.card, {
          backgroundColor: (unifiedFloating || floatingTitle || floatingText || shape || connector) && display === 'expanded' ? 'transparent' : colors.cardSurface,
          borderColor: hideFrame && !activeBorder ? 'transparent' : borderColor,
          borderWidth: activeBorder ? 3 : hideFrame ? 0 : 2,
          opacity: dragging ? 0.85 : 1,
        }]}
      >
        {compactWithGrip ? (
          <View testID={`compact-card-${card.id}`} style={[{ flex: 1, minHeight: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', padding: 2 }, contentInset]}>
            <Text numberOfLines={1} style={{ color: unifiedFloating ? noteTextColor : colors.cardText, fontSize: 11, lineHeight: 14 }}>{card.primaryResourceState ? '⊘' : document ? 'PDF' : image ? '▧' : number3}</Text>
          </View>
        ) : card.primaryResourceState ? (
          <View style={[styles.documentWrap, contentInset, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>
            <RetiredCardResource card={card} color={colors.cardText} compact={display !== 'expanded' || box.height < 180 || box.width < 160} showBody={!props.controlsOverBody} testID={`retired-card-${card.id}`} />
          </View>
        ) : display === 'minimized' ? (
          // Ficha mínima 2 × 2: conserva identidad, nombre y una pista de expansión legibles.
          <View testID={`minimized-${card.id}`} style={[styles.mini, { backgroundColor: headerColor, ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) }]}>
            {icon ? <CardIcon kind={icon} testID={`minimized-icon-${card.id}`} /> : null}
            {/* UX7-A4: título borrado conscientemente no dibuja relleno; el nombre accesible del botón ya anuncia «Nota sin título». */}
            {cardDisplayTitle(card) ? (
              <Text testID={`minimized-title-${card.id}`} numberOfLines={icon ? (box.height >= 56 ? 2 : 1) : 3}
                style={[styles.miniTitle, { color: colors.headerText, fontSize: headerTextSize, lineHeight: typography.headerLineHeight }]}>{cardDisplayTitle(card)}</Text>
            ) : null}
            {/* UX7-CONSOLIDATION (Hito D): pista visual de que hay más contenido al expandir — el
                nombre accesible ya anuncia «, minimizada», pero no había ninguna señal visible en la
                propia tarjeta. Puramente decorativa (oculta a lectores de pantalla, que ya tienen el
                anuncio real). */}
            {box.height >= 40 ? (
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.expandHint, { color: colors.headerText, fontSize: typography.auxiliarySize, lineHeight: typography.auxiliaryLineHeight }]}>⌄</Text>
            ) : null}
          </View>
        ) : unifiedFloating && display === 'expanded' ? (
          <View testID={`unified-content-${card.id}`} style={[styles.floatingTextWrap, contentInset, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>
            {!note && presentation.title === 'visible' && cardDisplayTitle(card) ? (
              card.titleRichText ? (
                // ADR 0030: el título mantiene la tipografía del sistema, no la elegida para las notas.
                <BasicRichTextPreview document={{ schemaVersion: 1, blocks: [{ type: 'paragraph', content: card.titleRichText }] }} numberOfLines={3}
                  color={colors.textPrimary} fontSize={typography.floatingTitleSize} lineHeight={typography.floatingTitleLineHeight} testID={`card-rich-title-${card.id}`} />
              ) : <Text numberOfLines={3} style={[styles.floatingTitle, { color: colors.textPrimary, fontSize: typography.floatingTitleSize, lineHeight: typography.floatingTitleLineHeight }]}>{cardDisplayTitle(card)}</Text>
            ) : null}
            <View testID={`card-body-content-${card.id}`} style={[styles.bodyContent, {
              justifyContent: fullReader || overflow.hiddenLines > 0 ? 'flex-start'
                : card.noteVerticalAlignment === 'center' ? 'center'
                  : card.noteVerticalAlignment === 'bottom' ? 'flex-end' : 'flex-start',
            }]}>
              {presentation.body === 'visible' && fullReader && richDocument ? (
                <View ref={readerRef} style={styles.readerShell}>
                  <RichNoteReader testID={`card-reader-${card.id}`} document={richDocument} imageResources={props.noteImageResources}
                    color={noteTextColor} fontFamily={props.noteFontFamily} bodySize={card.bodySize}
                    captionPosition={card.captionPosition} imageFit={imageFit} />
                </View>
              ) : presentation.body === 'visible' && previewDocument ? (
                <BasicRichTextPreview document={previewDocument} numberOfLines={Math.max(1, bodyLines)} color={noteTextColor}
                  fontSize={contentSize} lineHeight={contentLine} fontFamily={props.noteFontFamily} testID={`card-rich-text-${card.id}`} />
              ) : null}
            </View>
          </View>
        ) : floatingTitle && display === 'expanded' ? (
          <View testID={`floating-title-${card.id}`} style={[styles.floatingTitleWrap, contentInset]}>
            {cardDisplayTitle(card) ? (
              <Text numberOfLines={Math.max(1, Math.floor((box.height - 36) / typography.floatingTitleLineHeight))} style={[styles.floatingTitle, { color: colors.textPrimary, fontSize: typography.floatingTitleSize, lineHeight: typography.floatingTitleLineHeight, paddingRight: box.height >= 100 ? 0 : props.reserveRight }]}>{cardDisplayTitle(card)}</Text>
            ) : null}
          </View>
        ) : floatingText && display === 'expanded' ? (
          <View testID={`floating-text-${card.id}`} style={[styles.floatingTextWrap, contentInset, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>
            <Text numberOfLines={Math.max(1, bodyLines)} style={[styles.content, {
              color: floatingTextColor(card.textColor, colors.textPrimary),
              fontSize: contentSize,
              lineHeight: contentLine,
              textAlign: card.textAlign ?? 'left',
            }, props.noteFontFamily === undefined ? null : { fontFamily: props.noteFontFamily }]}>
              {card.content ?? ''}
            </Text>
          </View>
        ) : shape && display === 'expanded' ? (
          <View style={[styles.shapeWrap, box.height < 80 ? styles.shapeWrapCompact : null, contentInset, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>
            <ShapePreview card={card} surface={colors.canvas} strokeFallback={colors.border} testID={`shape-${card.id}`} />
          </View>
        ) : connector && display === 'expanded' ? (
          <View testID={`connector-hit-${card.id}`} style={[styles.shapeWrap, box.height < 80 ? styles.shapeWrapCompact : null]} />
        ) : document && display === 'expanded' ? (
          <View testID={`document-${card.id}`} style={[styles.documentWrap, contentInset, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}>
            {/* UX7.1-A4-FIX: esta cara no tiene cabecera de color propio — se dibuja directamente sobre
                `cardSurface`, que se mantiene clara en ambos temas. El icono por defecto usa el texto
                general de la interfaz (claro en tema oscuro) y se volvía invisible; `cardText` es el
                mismo tono oscuro constante que ya usa el nombre del archivo justo debajo. */}
            {icon ? <CardIcon kind={icon} color={colors.cardText} testID={`document-icon-${card.id}`} /> : null}
            {cardDisplayTitle(card) ? (
              <Text testID={`document-title-${card.id}`} numberOfLines={documentTitleLines} style={[styles.title, styles.documentTitle, { color: colors.cardText, fontSize: titleSize, lineHeight: typography.titleLineHeight }]}>
                {cardDisplayTitle(card)}
              </Text>
            ) : null}
          </View>
        ) : display === 'collapsed' ? (
          <View testID={`collapsed-${card.id}`} style={styles.collapsedShell}>
            <View testID={`card-header-${card.id}`} style={[styles.header, styles.headerCollapsed, collapsedBodyLines < 1 ? styles.headerCollapsedOnly : null, { backgroundColor: headerColor, paddingRight: props.reserveRight + 8, ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) }]}>
              {icon ? <CardIcon kind={icon} testID={`collapsed-icon-${card.id}`} /> : null}
              <Text numberOfLines={1} style={[styles.headerText, { color: colors.headerText, fontSize: headerTextSize, lineHeight: typography.headerLineHeight }]}>{number3}</Text>
              {cardDisplayTitle(card) ? (
                <Text testID={`collapsed-title-${card.id}`} numberOfLines={1}
                  style={[styles.collapsedTitle, { color: colors.headerText, fontSize: typography.collapsedTitleSize, lineHeight: typography.collapsedTitleLineHeight }]}>{cardDisplayTitle(card)}</Text>
              ) : null}
              {/* La acción real continúa en el menú contextual y por teclado; este glifo no crea un
                  segundo control ni entra en el árbol accesible. */}
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.expandHint, { color: colors.headerText, fontSize: typography.auxiliarySize, lineHeight: typography.auxiliaryLineHeight }]}>⌄</Text>
            </View>
            {collapsedBodyLines > 0 && previewDocument ? (
              <View style={styles.collapsedPreview}>
                <BasicRichTextPreview document={previewDocument} numberOfLines={collapsedBodyLines} color={colors.cardText}
                  fontSize={contentSize} lineHeight={contentLine} fontFamily={props.noteFontFamily} testID={`collapsed-preview-${card.id}`} />
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {/* Cabecera en forma de pestaña de carpeta: número y tipo; los controles se dibujan encima. */}
            <View testID={`card-header-${card.id}`} style={[styles.header, { borderColor: colors.border, backgroundColor: headerColor, paddingRight: props.reserveRight + 8, ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) }]}>
              <View testID={`card-tab-${card.id}`} style={[styles.tab, { backgroundColor: headerColor }]}>
                <Text testID={`card-tab-label-${card.id}`} numberOfLines={1}
                  style={[styles.headerText, { color: colors.headerText, fontSize: headerTextSize, lineHeight: typography.headerLineHeight }]}>
                  {tabLabel}
                </Text>
              </View>
            </View>
            <View style={styles.body}>
              <View testID={`card-body-content-${card.id}`} style={[styles.bodyContent, {
                justifyContent: fullReader || overflow.hiddenLines > 0 ? 'flex-start'
                  : card.noteVerticalAlignment === 'center' ? 'center'
                    : card.noteVerticalAlignment === 'bottom' ? 'flex-end' : 'flex-start',
              }]}>
              {!note && presentation.title === 'visible' && cardDisplayTitle(card) ? (
                <Text
                  numberOfLines={image ? imageTitleLines : 2}
                  style={[styles.title, { color: colors.cardText, fontSize: titleSize, lineHeight: typography.titleLineHeight }, props.controlsOverBody ? { paddingRight: props.reserveRight } : null]}
                >
                  {cardDisplayTitle(card)}
                </Text>
              ) : null}
              {presentation.body === 'visible' && image ? (props.imageResource?.status === 'ready' ? (
                // OBS-N2-IMAGE-FIT-F2: el ajuste (contain/cover) ya viene resuelto por `resolveCardImageFit`;
                // «contain» es el valor histórico (auditoría visual, 2026-09-29) que ese resolver conserva
                // cuando no hay una elección explícita — ya no es un literal fijo en este componente.
                <Image
                  testID={`image-preview-${card.id}`}
                  accessibilityRole="image"
                  accessibilityLabel={`Imagen ${cardTitle(card, locale)}`}
                  source={{ uri: props.imageResource.uri }}
                  resizeMode={imageFit}
                  style={[styles.photo, { borderColor: colors.border, backgroundColor: colors.surface, objectFit: imageFit }]}
                />
              ) : (card.assetRefs?.length ?? 0) > 0 ? (
                <Text testID={`image-status-${card.id}`} style={[styles.content, { color: colors.textSecondary, fontSize: contentSize, lineHeight: contentLine }]}>
                  {props.imageResource?.status === 'loading' ? t('image.loading', locale) : t('image.unavailable', locale)}
                </Text>
              ) : <ImagePlaceholder />) : null}
              {presentation.body === 'visible' && !image && link ? (
                <Text testID={`card-link-${card.id}`} numberOfLines={1} style={[styles.link, { color: colors.cardText, fontSize: typography.auxiliarySize, lineHeight: typography.bodyLineHeight }]}>
                  {`↗ ${link.host}${link.rest}`}
                </Text>
              ) : null}
              {presentation.body === 'visible' && fullReader && richDocument ? (
                <View ref={readerRef} style={styles.readerShell}>
                  <RichNoteReader testID={`card-reader-${card.id}`} document={richDocument} imageResources={props.noteImageResources} fontFamily={props.noteFontFamily} bodySize={card.bodySize} captionPosition={card.captionPosition} imageFit={imageFit} />
                </View>
              ) : presentation.body === 'visible' && mixedRich && richDocument ? (
                <RichNotePreview testID={`rich-note-preview-${card.id}`} document={richDocument} imageResources={props.noteImageResources} fontFamily={props.noteFontFamily} bodySize={card.bodySize} captionPosition={card.captionPosition} imageFit={imageFit}
                  onOpenDocument={props.onOpenDocument}
                  banner={presentation.layout === 'banner'} width={box.width} height={box.height - HEADER - (footerLines > 0 ? 48 + footerLines * 22 : 40) - (link ? 18 : 0)} />
              ) : presentation.body === 'visible' && mixed ? (
                <NotePreview testID={`note-preview-${card.id}`} blocks={blocks} imageResources={props.noteImageResources} fontFamily={props.noteFontFamily} bodySize={card.bodySize} captionPosition={card.captionPosition} imageFit={imageFit}
                  banner={presentation.layout === 'banner'} width={box.width} height={box.height - HEADER - (footerLines > 0 ? 48 + footerLines * 22 : 40) - (link ? 18 : 0)} />
              ) : null}
              {presentation.body === 'visible' && !fullReader && !image && !mixed && previewDocument && bodyLines > 0 ? (
                <BasicRichTextPreview
                  document={previewDocument}
                  numberOfLines={overflow.shownLines}
                  color={colors.cardText}
                  fontSize={contentSize}
                  lineHeight={contentLine}
                  fontFamily={props.noteFontFamily}
                  testID={`card-rich-text-${card.id}`}
                />
              ) : null}
              {presentation.body === 'visible' && !fullReader && !image && !mixed && bodyBlocks.length > 0 ? (
                <View style={styles.bodyBlocks}>
                  {bodyBlocks.map((block, index) => block.kind === 'text' ? (
                    <Text key={index} numberOfLines={block.text.split('\n').length}
                      style={[styles.content, { color: colors.cardText, fontSize: contentSize, lineHeight: contentLine }, props.noteFontFamily === undefined ? null : { fontFamily: props.noteFontFamily }]}>
                      {block.text}
                    </Text>
                  ) : (
                    <Pressable
                      key={index}
                      ref={(node) => { if (node) checklistRowRefs.current.set(block.lineIndex, node); else checklistRowRefs.current.delete(block.lineIndex); }}
                      testID={`check-${card.id}-${block.lineIndex}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: block.checked }}
                      {...(Platform.OS === 'web' ? { 'aria-checked': block.checked } : {})}
                      accessibilityLabel={block.text || 'Elemento de la lista'}
                      onPress={() => props.onToggleCheck(card.id, block.lineIndex)}
                      style={styles.checkRow}
                    >
                      <Text style={[styles.checkGlyph, { color: colors.cardText, fontSize: contentSize, lineHeight: contentLine }]}>{block.checked ? '☑' : '☐'}</Text>
                      <Text numberOfLines={1} style={[styles.content, styles.checkText, { color: colors.cardText, fontSize: contentSize, lineHeight: contentLine }, props.noteFontFamily === undefined ? null : { fontFamily: props.noteFontFamily }]}>
                        {block.text}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!fullReader && !image && !mixed && overflow.hiddenLines > 0 ? (
                <Text testID={`card-overflow-${card.id}`} numberOfLines={1} style={[styles.more, { color: colors.cardText, fontSize: typography.auxiliarySize, lineHeight: typography.auxiliaryLineHeight }]}>
                  {`+${overflow.hiddenLines} ${overflow.hiddenLines === 1 ? 'línea' : 'líneas'} más`}
                </Text>
              ) : null}
              </View>
              {tags.length > 0 ? (
                // Pie de etiquetas (ADR 0019): hasta tres y el resto como «+n»; el nombre completo va en el inspector.
                <Text testID={`card-tags-${card.id}`} numberOfLines={1} style={[styles.tags, { color: colors.cardText, fontSize: typography.auxiliarySize, lineHeight: typography.auxiliaryLineHeight }]}>
                  {tags.slice(0, 3).map((tag) => `#${tag}`).join('  ')}{tags.length > 3 ? `  +${tags.length - 3}` : ''}
                </Text>
              ) : null}
              {meta !== '' ? (
                <Text testID={`card-meta-${card.id}`} numberOfLines={1} style={[styles.badge, { color: colors.cardText, fontSize: typography.badgeSize, lineHeight: typography.badgeLineHeight }, tags.length > 0 ? { marginTop: 2 } : null]}>{meta}</Text>
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
              fontSize: typography.auxiliarySize,
              lineHeight: typography.auxiliaryLineHeight,
            }]}
          >
            {hint}
          </Text>
        ) : null}
      </Pressable>
      {grip ? <CardDragGrip cardId={card.id} title={cardTitle(card, locale)} left={grip.inset} top={grip.inset} size={grip.size} zoom={props.zoom}
        ink={unifiedFloating || floatingTitle || floatingText || shape ? colors.textPrimary : colors.cardText} controller={controller} /> : null}
    </View>
  );
}

/** Asas de la tarjeta seleccionada, encima de todas las tarjetas (no compiten con su arrastre). */
export function ResizeHandles({ cardId, box, controller, zoom, display }: { readonly cardId: Card['id']; readonly box: PixelBox; readonly controller: GestureController; readonly zoom: number; readonly display: CardDisplayMode }) {
  return (
    <View pointerEvents="box-none" style={[styles.handles, { left: box.left, top: box.top, width: box.width, height: box.height }]}>
      {handlesFor(box, zoom, display).map((handle) => <ResizeHandleView key={handle} cardId={cardId} handle={handle} controller={controller} zoom={zoom} />)}
    </View>
  );
}

/** Asa de puntero/dedo; el teclado y el menú contextual conservan alternativas de tamaño. */
function ResizeHandleView({ cardId, handle, controller, zoom }: { readonly cardId: Card['id']; readonly handle: ResizeHandle; readonly controller: GestureController; readonly zoom: number }) {
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
      style={[styles.handleHit, { width: HANDLE_HIT / zoom, height: HANDLE_HIT / zoom, ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) }, handleSpot(handle, HANDLE_HIT / zoom)]}
      {...handlers}
    >
      <View style={[styles.handleMark, handleMarkSpot(handle, HANDLE_MARK / zoom), { width: HANDLE_MARK / zoom, height: HANDLE_MARK / zoom, backgroundColor: colors.selection, borderColor: colors.cardSurface }]} />
    </View>
  );
}

function handleSpot(handle: ResizeHandle, hit: number) {
  return {
    ...(handle.includes('w') ? { left: -hit } : handle.includes('e') ? { right: -hit } : { left: '50%' as const, marginLeft: -hit / 2 }),
    ...(handle.includes('n') ? { top: -hit } : handle.includes('s') ? { bottom: -hit } : { top: '50%' as const, marginTop: -hit / 2 }),
  };
}

function handleMarkSpot(handle: ResizeHandle, mark: number) {
  return {
    position: 'absolute' as const,
    ...(handle.includes('w') ? { right: 0 } : handle.includes('e') ? { left: 0 } : { left: '50%' as const, marginLeft: -mark / 2 }),
    ...(handle.includes('n') ? { bottom: 0 } : handle.includes('s') ? { top: 0 } : { top: '50%' as const, marginTop: -mark / 2 }),
  };
}

/** Pista interior de arrastre; las acciones usan las rutas contextuales de la tarjeta. */
function CardDragGrip({ cardId, title, left, top, size, zoom, ink, controller }: { readonly cardId: Card['id']; readonly title: string; readonly left: number; readonly top: number; readonly size: number; readonly zoom: number; readonly ink: string; readonly controller: GestureController }) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  // Web-only cursor, following the existing Canvas grab style; not a native ViewStyle property.
  const dragCursor = Platform.OS === 'web' ? ({ cursor: 'move' } as object) : {};
  const [focus, setFocus] = useState<'move' | null>(null);
  const [handlers] = useState(() => {
    let moving = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => controller.canDragCard(),
      onStartShouldSetPanResponderCapture: () => controller.canDragCard(),
      onPanResponderGrant: () => { moving = false; controller.begin({ cardId, kind: 'move', handle: 'se' }); },
      onPanResponderMove: (_event, state) => {
        if (!moving && isDrag(state.dx, state.dy)) moving = true;
        if (moving) controller.update(state.dx, state.dy);
      },
      onPanResponderRelease: (_event, state) => {
        controller.gestureEnded(cardId);
        if (moving) controller.finish(state.dx, state.dy);
        else controller.abort();
        moving = false;
      },
      onPanResponderTerminate: () => { controller.abort(); moving = false; },
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  });
  return <View {...handlers} style={{ position: 'absolute', left, top, width: size, height: size, zIndex: 31, ...dragCursor, ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) }}>
    <Pressable testID={`card-move-${cardId}`} accessibilityRole="button" accessibilityLabel={`${locale === 'es' ? 'Mover' : 'Move'} ${title}`}
      accessibilityHint={locale === 'es' ? 'Arrastra o usa las flechas para mover. Mayús más F10 abre acciones.' : 'Drag or use arrow keys to move. Shift plus F10 opens actions.'}
      onPress={(event) => event.stopPropagation()}
      onFocus={(event) => {
        const target: unknown = event.nativeEvent.target;
        setFocus(Platform.OS === 'web' && target instanceof HTMLElement && target.matches(':focus-visible') ? 'move' : null);
      }} onBlur={() => setFocus(null)}
      style={{ width: size, height: size, borderWidth: 2 / zoom, borderColor: focus === 'move' ? theme.colors.selection : 'transparent', padding: 4 / zoom, alignItems: 'flex-start', justifyContent: 'flex-start', ...dragCursor }}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: ink, fontSize: 14 / zoom, lineHeight: 18 / zoom }}>✥</Text>
    </Pressable>
  </View>;
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  handles: { position: 'absolute', zIndex: 20 },
  mini: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 3 },
  miniTitle: { fontSize: 11, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
  expandHint: { fontSize: 12, lineHeight: 12, fontWeight: '900', opacity: 0.7 },
  photo: { flex: 1, minHeight: 40, borderWidth: 1 },
  lifted: { zIndex: 10 },
  card: { flex: 1, overflow: 'hidden' },
  header: { height: HEADER, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 0, borderBottomWidth: 2 },
  collapsedShell: { flex: 1 },
  headerCollapsed: { alignItems: 'center', gap: 8, paddingLeft: 8 },
  headerCollapsedOnly: { height: '100%' },
  collapsedPreview: { flex: 1, minHeight: 0, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' },
  tab: { height: 30, justifyContent: 'center', paddingHorizontal: 8, maxWidth: '100%' },
  collapsedTitle: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
  headerText: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  body: { flex: 1, padding: 8, gap: 6 },
  bodyContent: { flex: 1, minHeight: 0, gap: 6 },
  readerShell: { flex: 1, minHeight: 0 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  floatingTitleWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 8, paddingTop: 36, paddingBottom: 8 },
  floatingTitle: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  floatingTextWrap: { flex: 1, padding: 8, paddingTop: 36 },
  shapeWrap: { flex: 1, padding: 10, paddingTop: 36 },
  documentWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, paddingTop: 36 },
  documentTitle: { textAlign: 'center' },
  // En una sola fila no se añade relleno vertical: RN Web lo suma al tamaño flex y deformaba la grilla.
  shapeWrapCompact: { padding: 0, paddingTop: 0, paddingHorizontal: 0, minHeight: 0, minWidth: 0 },
  // Si aun así no cabe, cede el texto y no el pie.
  content: { fontSize: 13, lineHeight: 18, flexShrink: 1, overflow: 'hidden' },
  // UX7-B2: envoltorio de texto agrupado + filas de checklist; sin relleno propio, ya lo da `body`.
  bodyBlocks: { flexShrink: 1, overflow: 'hidden' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  checkGlyph: { flexShrink: 0 },
  checkText: { flex: 1 },
  link: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 18, fontWeight: '700', flexShrink: 0 },
  more: { flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  tags: { fontSize: 12, lineHeight: 16, fontWeight: '800', marginTop: 'auto', flexShrink: 0 },
  badge: { fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 'auto', flexShrink: 0 },
  hint: { position: 'absolute', right: 6, bottom: 6, borderWidth: 2, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, fontWeight: '800' },
  handleHit: { position: 'absolute', width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  handleMark: { width: HANDLE_MARK, height: HANDLE_MARK, borderWidth: 2 },
});
