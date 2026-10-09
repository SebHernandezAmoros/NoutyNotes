import {
  PROTOTYPE_BOARD, addBoardShortcut, addBoardToWorkspace, addCardToBoard, archiveSelectionForExport, assetsOf, connectCards, createDraftKey, disconnectCards, draftRevision, duplicateSelection, editCardContent, editConnectorPath, importImageCard,
  groupCardsInFrame, moveBoardToArchive, moveFrameOnBoard, moveCardOnBoard, moveCardToArchive, moveCardToTrash, moveCardsOnBoard, moveCardsToArchive, moveCardsToTrash, pasteSnapshot, placeCardOnBoard, printableDocument, purgeCardFromTrash, removeTagEverywhere, renameBoardInWorkspace, renameTag, resizeCardOnBoard, restoreBoardFromArchive, restoreCardFromArchive, restoreCardFromTrash, restoreCardsFromArchive, searchAllWorkspaces, sendArchivedCardsToTrash, sendArchivedToTrash, setCardDisplay, snapshotSelection, updateConnection,
} from '@noutynotes/application';
import type { ClipboardSnapshot, DraftGeneration, EditorialDraft, EditorialSessionLease, PrototypeCardKind, SearchResult, WorkspaceSummary } from '@noutynotes/application';
import type { AssetRef, BoardId, CardDisplayMode, CardId, GridPoint, GridRect, GridSize, RelationArrow, RelationId, RichTextDocument, Workspace, WorkspaceId } from '@noutynotes/domain';
import { cardTitleText, createOrthogonalConnectorPath, frameMembers } from '@noutynotes/domain';
import { markdownRichTextCodec, serializeWorkspace, writeWorkspaceArchive } from '@noutynotes/storage';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { AppIcon } from '../components/AppIcon';
import type { AppIconName } from '../components/AppIcon';
import { Dialog } from '../components/Dialog';
import { ActionButton, ToolButton } from '../components/controls';
import { useKeyboardInset, useRevealFocusedInput } from '../components/useKeyboardInset';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { noteFontFamily } from './fonts';
import { PresentView } from './PresentView';
import { buildPrintHtml } from './printHtml';
import { downloadFile } from '../session/archiveFiles';
import { activateCustomFont, customFontFamilyName, supportsCustomFont } from '../session/customFont';
import { describeFailure } from '../session/messages';
import { printHtmlNative, supportsNativePrint } from '../session/printNative';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { loadViewPreferences, saveViewPreferences } from '../session/viewPreferencesStore';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { Board } from './Board';
import { BoardRail } from './BoardTabs';
import { BoardActionsDialog } from './BoardActionsDialog';
import { OpenTabs } from './OpenTabs';
import { Canvas } from './canvas/Canvas';
import type { CanvasTool } from './canvas/Canvas';
import { unplacedCardIds } from './canvas/boardCards';
import { connectTap } from './canvas/connect';
import { toggleChecklistLine } from './markdownLists';
import { DEFAULT_PREFERENCES, metricsFor, parsePreferences } from './canvas/preferences';
import type { ViewPreferences } from './canvas/preferences';
import { visibleCells, zoomIn, zoomOut } from './canvas/viewport';
import type { Point } from './canvas/viewport';
import { CardInspector } from './CardInspector';
import { FrameInspector } from './FrameInspector';
import { ProjectSheet } from './ProjectTabs';
import { SettingsPanel } from './SettingsPanel';
import { ArchiveView } from './ArchiveView';
import { DiaryView } from './DiaryView';
import { AssetsView } from './AssetsView';
import { LinkDialog } from './LinkDialog';
import { InsertMenu } from './InsertMenu';
import { SearchPanel } from './SearchPanel';
import { TrashPanel } from './TrashPanel';
import { useImagePreviews } from './useImagePreviews';
import { Toolbar } from './Toolbar';
import type { BoardView } from './Toolbar';
import { saveStatus } from './saveStatus';
import { useWorkspaceEditor } from './useWorkspaceEditor';
import type { ActionSuccess } from './useWorkspaceEditor';
import { composeSavedWithNotes } from './actionFeedback';

/** Desde este ancho la navegación de espacios y tableros va en una barra lateral. */
const SIDEBAR_MIN_WIDTH = 1100;
const START_PAN: Point = { x: 16, y: 16 };
// UX7-D1: el 100 % es ahora el tamaño normal de trabajo (antes 75 %, ADR 0048); la densidad visual
// equivalente la da el nuevo `rowHeight` por defecto (48 px, en `preferences.ts`), no el zoom.
const DEFAULT_ZOOM = 1;
const tableDocument = (rows: number, columns: number): RichTextDocument => ({
  schemaVersion: 1,
  blocks: [{
    type: 'table',
    header: { cells: Array.from({ length: columns }, () => ({ content: [] })) },
    rows: Array.from({ length: rows - 1 }, () => ({ cells: Array.from({ length: columns }, () => ({ content: [] })) })),
  }],
});

const displayMessages: Readonly<Record<CardDisplayMode, ActionSuccess>> = {
  expanded: 'action.cardExpanded',
  collapsed: 'action.cardCollapsed',
  minimized: 'action.cardMinimized',
};

type InsertablePrototypeKind = Exclude<PrototypeCardKind, 'image'>;

const additions: Readonly<Record<InsertablePrototypeKind, ActionSuccess>> = {
  note: 'action.noteAdded',
  text: { label: 'Texto flotante añadido' },
  shape: { label: 'Forma añadida' },
  connector: { label: 'Conector añadido' },
  title: 'action.floatingTitleAdded',
  link: 'action.linkAdded',
};

/** Selección múltiple (ADR 0025): la etiqueta «uno» para una sola tarjeta, «muchos» (con `{count}`) para el resto. */
const pluralAction = (count: number, one: ActionSuccess, many: TranslationKey): ActionSuccess =>
  (count === 1 ? one : { key: many, params: { count: String(count) } });

export function WorkspaceScreen() {
  const params = useLocalSearchParams<{ id?: string; notice?: string; card?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  // Cambiar de espacio desde la barra lateral reinicia todo el estado de pantalla.
  return <WorkspaceView key={id ?? ''} id={id} notice={typeof params.notice === 'string' ? params.notice : ''} initialCard={typeof params.card === 'string' ? params.card : ''} />;
}

function useSessionSummaries(refresh: unknown): readonly WorkspaceSummary[] {
  const { storage } = useWorkspaceSession();
  const [summaries, setSummaries] = useState<readonly WorkspaceSummary[]>([]);
  useEffect(() => {
    let active = true;
    void storage.list().then((listed) => { if (active && listed.ok) setSummaries(listed.value); });
    return () => { active = false; };
  }, [storage, refresh]);
  return summaries;
}

function WorkspaceView({ id, notice, initialCard }: { readonly id: string | undefined; readonly notice: string; readonly initialCard: string }) {
  const session = useWorkspaceSession();
  const storageMode = session.mode;
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const width = useWindowWidth();
  const compact = resolveLayoutMode(width) === 'compact';
  const sidebar = width !== null && width >= SIDEBAR_MIN_WIDTH;
  // Preferencias de vista de este dispositivo (ADR 0014): nunca se escriben en el workspace.
  const [preferences, setPreferences] = useState<ViewPreferences>(() => parsePreferences(loadViewPreferences()));
  useEffect(() => { saveViewPreferences(JSON.stringify(preferences)); }, [preferences]);
  const metrics = metricsFor(compact ? 'compact' : 'wide', preferences);
  const { showGrid, snap } = preferences;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Vista de trabajo a pantalla completa (ADR 0036), no un diálogo superpuesto; reemplaza diaryOpen,
  // assetsOpen y archiveOpen.
  type MainView = 'board' | 'diary' | 'assets' | 'archive';
  const [mainView, setMainView] = useState<MainView>('board');
  // Una vista visitada se queda montada (oculta, no desmontada) para conservar su estado —búsqueda,
  // pestaña, selección— al volver, igual que ya hacía Dialog con `visible`; no se monta antes de la
  // primera visita, para no pagar su coste si nunca se abre.
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<MainView>>(new Set());
  const openView = (next: MainView) => {
    setMainView(next);
    setVisitedViews((current) => (current.has(next) ? current : new Set(current).add(next)));
  };
  const [presentOpen, setPresentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [boardActionsId, setBoardActionsId] = useState<BoardId | null>(null);
  // Tarjeta del tablero sin posición a la que se llegó desde la búsqueda: se ofrece colocarla (ADR 0020).
  const [placeOffer, setPlaceOffer] = useState<{ readonly cardId: CardId; readonly boardId: BoardId; readonly title: string } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Expandir falló por colisión: se ofrece, sin hacerlo por su cuenta, expandir en un hueco libre.
  const [relocateOffer, setRelocateOffer] = useState<CardId | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(
    notice !== '' ? { tone: 'success', text: notice } : null,
  );
  const {
    view, feedback, saving, saveState, pendingCount, run, setFeedback, undo, redo, retry, recoverExternal,
    flush: flushWorkspace, revision, undoLabel, redoLabel,
  } = useWorkspaceEditor(id);
  const [selectedId, setSelectedId] = useState<CardId | null>(null);
  // Editor visible (auditoría de interacción, 2026-09-29): separado de `selectedId» a propósito.
  // Seleccionar una tarjeta ya no abre su editor ni reduce el lienzo; solo «Editar» (doble clic/toque,
  // o el botón que aparece junto a la seleccionada) lo hace. `null` mientras solo hay selección.
  const [editingId, setEditingId] = useState<CardId | null>(null);
  /** `true`: editor breve sobre la ficha; `false`: editor completo (ADR 0047). */
  const [inlineEditing, setInlineEditing] = useState(false);
  // Selección múltiple (ADR 0025): null fuera del modo; en el modo, tocar una tarjeta la añade o la quita.
  const [multi, setMulti] = useState<readonly CardId[] | null>(null);
  // Portapapeles interno (ADR 0052): de interfaz, no persistido; se pierde al recargar o cambiar de pestaña.
  const [clipboard, setClipboard] = useState<ClipboardSnapshot | null>(null);
  // Marco seleccionado (ADR 0027): excluye la tarjeta abierta y la selección múltiple.
  const [frameId, setFrameId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<BoardId | null>(null);
  const [openBoardIds, setOpenBoardIds] = useState<readonly BoardId[]>([]);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [connectSource, setConnectSource] = useState<CardId | null>(null);
  const [connectorStart, setConnectorStart] = useState<{ readonly point: GridPoint; readonly cardId?: CardId } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState<Point>(START_PAN);
  const [boardView, setBoardView] = useState<BoardView>('canvas');
  // Posición/tamaño optimistas mientras se guarda un movimiento o redimensionado (auditoría de
  // interacción, 2026-09-29): reproducido que, si otra acción vuelve a renderizar el lienzo antes de
  // que el guardado termine, la tarjeta se ve un instante en su sitio anterior («salto al soltar», el
  // layout todavía no refleja el destino). Se mantiene el valor esperado hasta que el guardado termina
  // (con o sin éxito), en vez de depender de `layout`, que solo se actualiza tras recargar.
  const [pendingRects, setPendingRects] = useState<ReadonlyMap<CardId, GridRect>>(new Map());
  // Móvil: el editor puede ocultarse para usar el lienzo (y las asas) sin perder el borrador.
  const [sheetHidden, setSheetHidden] = useState(false);
  // Editor enfocado (ADR 0021): el mismo editor ocupa el sitio del lienzo; el borrador no se pierde.
  const [focus, setFocus] = useState(false);
  const workspace = view.kind === 'ready' ? view.workspace : null;
  const boardActions = workspace?.boards.find((candidate) => candidate.id === boardActionsId) ?? null;
  const archiveCount = workspace?.archive?.length ?? 0;
  const summaries = useSessionSummaries(workspace);
  const previews = useImagePreviews(session.storage, workspace);

  // Fuente personalizada (ADR 0041): el registro `FontFace` no sobrevive a recargar, así que se vuelve a
  // activar al abrir este workspace si la preferencia la sigue señalando. Si el archivo ya no está, se
  // queda sin activar y `noteFontFamily` cae a la reserva del sistema por diseño; no es un error.
  const customFontRef = preferences.noteFont === 'custom' ? preferences.customFontRef : null;
  const customFontFamily = customFontRef ? customFontFamilyName(customFontRef) : undefined;
  const workspaceIdForFont = workspace?.id ?? null;
  useEffect(() => {
    if (!workspaceIdForFont || !customFontRef || !supportsCustomFont()) return undefined;
    const assets = assetsOf(session.storage);
    if (!assets) return undefined;
    let active = true;
    void assets.readAsset(workspaceIdForFont, customFontRef as AssetRef).then((read) => {
      if (active && read.ok) void activateCustomFont(customFontRef, read.value);
    });
    return () => { active = false; };
  }, [workspaceIdForFont, customFontRef, session.storage]);

  const {
    flushPendingText, setPendingText, recoverableDrafts, recoverDraft, discardDrafts, draftProblem, recoveredText,
  } = usePendingText(run, workspace, session);

  const goHome = async () => {
    if (!await flushPendingText() || !await flushWorkspace()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const openSpace = async (target: string) => {
    if (target === id || !await flushPendingText() || !await flushWorkspace()) return;
    router.replace({ pathname: '/workspace', params: { id: target } });
  };

  const select = async (cardId: CardId | null) => {
    if (!await flushPendingText()) return false;
    setSelectedId(cardId);
    setEditingId(null);
    setInlineEditing(false);
    setMulti(null);
    setFrameId(null);
    setSheetHidden(false);
    if (cardId === null) setFocus(false);
  };
  // Botón «Editar» de la tarjeta ya seleccionada, o llegar a ella con el teclado: abre su editor sin
  // pasar por un doble clic/toque (auditoría de interacción, 2026-09-29).
  const editCard = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    setSelectedId(cardId);
    setEditingId(cardId);
    setInlineEditing(false);
    setMulti(null);
    setFrameId(null);
    setSheetHidden(false);
    // En móvil el formulario y el teclado necesitan toda la pantalla; abrirlo como hoja parcial
    // dejaba poco espacio útil. La selección simple sigue sin editar (ADR 0045).
    setFocus(compact);
  };
  const selectFrame = async (next: string | null) => {
    if (!await flushPendingText()) return;
    setEditingId(null);
    setInlineEditing(false);
    setSelectedId(null);
    setMulti(null);
    setFrameId(next);
    setFocus(false);
    setSheetHidden(false);
  };
  // Doble toque o doble clic: edición rápida si la ficha tiene espacio; editor enfocado en móvil o fichas pequeñas.
  const openCard = async (cardId: CardId) => {
    if (multi !== null) {
      void toggleCard(cardId);
      return;
    }
    if (!await flushPendingText()) return;
    const card = workspace?.cards.find((candidate) => candidate.id === cardId);
    const target = card?.boardTargetId;
    if (target) {
      setEditingId(null);
      setInlineEditing(false);
      setSelectedId(null);
      void chooseBoard(target);
      return;
    }
    const activeBoard = workspace?.boards.find((candidate) => candidate.id === boardId) ?? workspace?.boards[0];
    const activeLayout = workspace?.layouts.find((candidate) => candidate.boardId === activeBoard?.id);
    const placement = activeLayout?.placements.find((candidate) => candidate.cardId === cardId);
    // La edición rápida crece sobre su ficha con un mínimo propio de 240 × 180 px (`InlineCardEditor`,
    // ADR 0048): no hace falta que la ficha YA mida eso. Reproducido el 2026-10-02: con el zoom inicial
    // de 75 % y el tamaño por defecto (4 × 3 celdas de 56 px), la huella real es 168 × 126 px, por debajo
    // del umbral antiguo, así que «Editar dentro de la ficha» abría el editor completo sin avisarlo.
    const base = workspace?.cardTypes.find((candidate) => candidate.id === card?.typeId)?.base;
    // Formas y conectores no tienen cuerpo de nota: su edición pertenece al inspector de propiedades.
    const canEditInline = !compact && placement?.display === 'expanded' && base !== 'shape' && base !== 'connector';
    setSelectedId(cardId);
    setEditingId(cardId);
    setInlineEditing(canEditInline);
    setSheetHidden(false);
    setFocus(!canEditInline);
  };

  const board = workspace ? workspace.boards.find((candidate) => candidate.id === boardId) ?? workspace.boards[0] : undefined;
  // Pestañas de sesión (ADR 0035): el tablero activo siempre está abierto; los IDs de un proyecto
  // anterior se descartan solos porque ya no coinciden con ningún tablero del workspace vigente.
  const openBoards = workspace
    ? (() => {
        const open = openBoardIds.filter((id) => workspace.boards.some((candidate) => candidate.id === id));
        return board && !open.includes(board.id) ? [...open, board.id] : open;
      })()
    : [];
  const openBoardList = workspace ? openBoards.map((id) => workspace.boards.find((candidate) => candidate.id === id)).filter((candidate) => candidate !== undefined) : [];
  const closedBoardList = workspace ? workspace.boards.filter((candidate) => !openBoards.includes(candidate.id)) : [];
  const layout = board ? workspace?.layouts.find((candidate) => candidate.boardId === board.id) : undefined;
  const visibleIds = new Set(layout?.placements.map((placement) => placement.cardId) ?? []);
  const unplaced = unplacedCardIds(board, layout).map((cardId) => workspace?.cards.find((card) => card.id === cardId)?.title ?? t('card.untitled', locale));
  const boardCount = board?.cardIds.length ?? 0;
  // El editor se muestra por `editingId`, no por `selectedId` (auditoría de interacción, 2026-09-29):
  // seleccionar una tarjeta ya no implica editarla.
  const selected = workspace?.cards.find((card) => card.id === editingId && visibleIds.has(card.id));
  // Resaltado/arrastre en el lienzo: sigue siendo por `selectedId`, filtrado igual que `selected`.
  const selectedOnBoard = workspace?.cards.find((card) => card.id === selectedId && visibleIds.has(card.id));
  const multiIds = (multi ?? []).filter((cardId) => visibleIds.has(cardId));
  const multiSet = new Set(multiIds);

  // Ctrl/⌘/Mayús + clic, o tocar en el modo: la tarjeta entra o sale. La que estaba abierta entra en el conjunto.
  const toggleCard = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const base = multi ?? (selectedId && visibleIds.has(selectedId) ? [selectedId] : []);
    setMulti(base.includes(cardId) ? base.filter((current) => current !== cardId) : [...base, cardId]);
    setEditingId(null);
    setSelectedId(null);
    setFrameId(null);
    setFocus(false);
  };
  const startMulti = async (cardIds: readonly CardId[]) => {
    if (!await flushPendingText()) return;
    setMulti(cardIds);
    setEditingId(null);
    setSelectedId(null);
    setFrameId(null);
    setFocus(false);
  };
  // «Agrupar» (ADR 0027): un marco alrededor de la selección; se abre su editor para darle nombre.
  const groupMany = async () => {
    if (!board || multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => groupCardsInFrame(storage, workspaceId, { boardId: board.id, cardIds: multiIds, title: 'Nuevo marco' }),
      pluralAction(multiIds.length, 'action.frameCreated.one', 'action.frameCreated.many'));
    if (result.ok) void selectFrame(result.value);
  };
  const moveFrame = (target: string, delta: GridPoint) => {
    if (!board) return;
    void run((storage, workspaceId) => moveFrameOnBoard(storage, workspaceId, { boardId: board.id, frameId: target, delta }), 'action.frameMoved');
  };
  // Solo para etiquetas de la barra de selección múltiple (fuera del alcance de E7f: no son avisos de `run()`).
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many.replace('#', String(count)));
  const moveMany = (cardIds: readonly CardId[], delta: GridPoint) => {
    if (!board || cardIds.length === 0) return;
    const action = run((storage, workspaceId) => moveCardsOnBoard(storage, workspaceId, { boardId: board.id, cardIds, delta }),
      pluralAction(cardIds.length, 'action.cardMoved', 'action.cardsMoved.many'), { reactive: true });
    // Posición optimista de cada tarjeta del conjunto (mismo motivo que `move`, ver `withPendingRect`).
    setPendingRects((current) => {
      const next = new Map(current);
      for (const cardId of cardIds) {
        const placement = layout?.placements.find((candidate) => candidate.cardId === cardId);
        if (placement) next.set(cardId, { ...placement.rect, x: placement.rect.x + delta.x, y: placement.rect.y + delta.y });
      }
      return next;
    });
    void action.finally(() => setPendingRects((current) => {
      const next = new Map(current);
      for (const cardId of cardIds) next.delete(cardId);
      return next;
    }));
  };
  const archiveMany = async () => {
    if (multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => moveCardsToArchive(storage, workspaceId, multiIds, new Date().toISOString()),
      pluralAction(multiIds.length, 'action.cardArchived', 'action.cardsArchived.many'));
    if (result.ok) setMulti(null);
  };
  const trashMany = async () => {
    if (multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => moveCardsToTrash(storage, workspaceId, multiIds),
      pluralAction(multiIds.length, 'action.cardTrashed', 'action.cardsTrashed.many'));
    if (result.ok) setMulti(null);
  };
  // Portapapeles (ADR 0052): copiar y cortar son instantáneas puras del workspace ya cargado, sin
  // pasar por `run()`; solo pegar y duplicar escriben, cada uno en un solo paso.
  const copyMany = () => {
    if (!board || !workspace || multiIds.length === 0) return;
    const snapshot = snapshotSelection(workspace, board.id, multiIds, 'copy');
    if (!snapshot) return;
    setClipboard(snapshot);
    setFeedback({
      tone: 'success',
      text: multiIds.length === 1 ? t('action.selectionCopied', locale) : t('action.selectionCopied.many', locale, { count: String(multiIds.length) }),
    });
  };
  const cutMany = async () => {
    if (!board || !workspace || multiIds.length === 0) return;
    const snapshot = snapshotSelection(workspace, board.id, multiIds, 'cut');
    if (!snapshot) return;
    const result = await run((storage, workspaceId) => moveCardsToTrash(storage, workspaceId, multiIds),
      pluralAction(multiIds.length, 'action.selectionCut', 'action.selectionCut.many'));
    if (result.ok) { setClipboard(snapshot); setMulti(null); }
  };
  const duplicateMany = async () => {
    if (!board || multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => duplicateSelection(storage, workspaceId, board.id, multiIds),
      pluralAction(multiIds.length, 'action.selectionDuplicated', 'action.selectionDuplicated.many'));
    if (result.ok) setMulti(null);
  };
  const pasteClipboard = async () => {
    if (!board || !clipboard) return;
    const count = clipboard.cards.length;
    await run((storage, workspaceId) => pasteSnapshot(storage, workspaceId, board.id, clipboard),
      pluralAction(count, 'action.selectionPasted', 'action.selectionPasted.many'));
  };

  const openBoard = (next: BoardId) => {
    setBoardId(next);
    // A partir de `openBoards` (derivado), no de `openBoardIds` (estado crudo): el tablero mostrado
    // por defecto solo existe en la derivación hasta que se abre o cierra algo por primera vez; partir
    // del estado crudo lo perdería en ese primer cambio.
    setOpenBoardIds(openBoards.includes(next) ? openBoards : [...openBoards, next]);
  };

  const chooseBoard = async (next: BoardId) => {
    if (!await flushPendingText()) return;
    openBoard(next);
    setEditingId(null);
    setInlineEditing(false);
    setSelectedId(null);
    setMulti(null);
    setFrameId(null);
    setConnectSource(null);
    setPan(START_PAN);
  };

  // Cerrar una pestaña no borra el tablero (ADR 0035): no se permite cerrar la última abierta, y si
  // se cierra la activa, se activa la vecina inmediata a su izquierda (o la primera restante).
  const closeBoardTab = (target: BoardId) => {
    if (openBoards.length <= 1) return;
    const index = openBoards.indexOf(target);
    const remaining = openBoards.filter((id) => id !== target);
    setOpenBoardIds(remaining);
    if (board?.id === target) {
      const neighbor = remaining[Math.max(0, index - 1)] ?? remaining[0];
      if (neighbor) void chooseBoard(neighbor);
    }
  };

  // «Ir» desde la búsqueda: el tablero actual si contiene la tarjeta; si no, el primero que la tenga.
  // Seleccionarla basta: el lienzo la muestra por su cuenta (efecto de revelado). Sin posición en ese
  // tablero, se explica y se ofrece colocarla (ADR 0020).
  const revealCard = (cardId: CardId) => {
    if (!workspace) return;
    const card = workspace.cards.find((candidate) => candidate.id === cardId);
    if (!card) {
      setFeedback({ tone: 'error', text: 'Esa tarjeta ya no existe en este proyecto.' });
      return;
    }
    const containing = workspace.boards.filter((candidate) => candidate.cardIds.includes(cardId));
    const target = board && containing.some((candidate) => candidate.id === board.id) ? board : containing[0];
    if (!target) {
      setFeedback({ tone: 'error', text: `«${card.title ?? t('card.untitled', locale)}» no está en ningún tablero.` });
      return;
    }
    if (target.id !== board?.id) {
      openBoard(target.id);
      setConnectSource(null);
      setPan(START_PAN);
    }
    const placed = workspace.layouts.find((candidate) => candidate.boardId === target.id)?.placements.some((placement) => placement.cardId === cardId) ?? false;
    setPlaceOffer(placed ? null : { cardId, boardId: target.id, title: card.title ?? t('card.untitled', locale) });
    // «Ir a» desde la búsqueda es una navegación directa a esa tarjeta: sigue abriendo su editor, a
    // diferencia de seleccionar en el lienzo (auditoría de interacción, 2026-09-29).
    setSelectedId(placed ? cardId : null);
    setEditingId(placed ? cardId : null);
    setInlineEditing(false);
    setSheetHidden(false);
  };
  const goTo = async (result: SearchResult) => {
    if (!await flushPendingText()) return;
    revealCard(result.cardId);
  };
  const goToProject = async (target: WorkspaceId, cardId: CardId) => {
    if (!await flushPendingText() || !await flushWorkspace()) return;
    router.replace({ pathname: '/workspace', params: { id: target, card: cardId } });
  };
  // Llegada desde la búsqueda global (`?card=`): una vez, cuando el proyecto está listo.
  const arrived = useRef(initialCard === '');
  useEffect(() => {
    if (arrived.current || !workspace) return;
    arrived.current = true;
    revealCard(initialCard as CardId);
  });
  const placeCard = () => {
    if (!placeOffer) return;
    const { cardId, boardId: target } = placeOffer;
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    void run((storage, workspaceId) => placeCardOnBoard(storage, workspaceId, { boardId: target, cardId, ...(near ? { near } : {}) }), 'action.cardPlaced')
      .then((result) => {
        if (!result.ok) return;
        setPlaceOffer(null);
        setSelectedId(cardId);
      });
  };
  const searchAll = (query: string) => searchAllWorkspaces(session.storage, query, workspace ?? undefined);

  const renameProjectTag = async (from: string, to: string) =>
    (await run((storage, workspaceId) => renameTag(storage, workspaceId, from, to), 'action.tagRenamed')).ok;
  const removeProjectTag = async (tag: string) =>
    (await run((storage, workspaceId) => removeTagEverywhere(storage, workspaceId, tag), 'action.tagRemovedEverywhere')).ok;

  // Tamaño visible del lienzo: las tarjetas nuevas se colocan dentro de lo que se ve (P2).
  const canvasSize = useRef<{ width: number; height: number } | null>(null);
  const add = (kind: InsertablePrototypeKind, extra: { readonly url?: string; readonly title?: string; readonly content?: string } = {}) => {
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    // La fecha de creación la pone la interfaz (ADR 0024): application no usa el reloj.
    return run((storage, workspaceId) => addCardToBoard(storage, workspaceId, { kind, ...extra, createdAt: new Date().toISOString(), ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}) }), additions[kind])
      .then((result) => {
        if (result.ok) void select(result.value);
        return result;
      });
  };
  // Nuevo enlace: el diálogo muestra el motivo si no se crea (en móvil, la hoja tapa el aviso de la pantalla).
  const addLink = async (url: string, title: string) => {
    const result = await add('link', { url, ...(title.trim() === '' ? {} : { title: title.trim() }) });
    return result.ok ? null : describeFailure(result.issues, storageMode);
  };

  const addTable = async (rows: number, columns: number) => {
    const encoded = markdownRichTextCodec.serialize(tableDocument(rows, columns));
    if (!encoded.ok) {
      setFeedback({ tone: 'error', text: 'No se pudo preparar la tabla.' });
      return;
    }
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    const result = await run((storage, workspaceId) => addCardToBoard(storage, workspaceId, {
      kind: 'note', content: encoded.value, createdAt: new Date().toISOString(),
      size: { w: Math.max(4, Math.min(12, columns * 2)), h: Math.max(3, rows + 2) },
      ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}),
    }), additions.note);
    if (!result.ok) return;
    setEditingId(result.value);
    setInlineEditing(false);
    setSheetHidden(false);
  };

  const createBoard = () => {
    void run((storage, workspaceId) => addBoardToWorkspace(storage, workspaceId, {}), 'action.boardCreated')
      .then((result) => { if (result.ok) void chooseBoard(result.value); });
  };

  const createShortcut = (targetBoardId: BoardId) => {
    if (!board) return;
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    void run((storage, workspaceId) => addBoardShortcut(storage, workspaceId, {
      boardId: board.id, targetBoardId, createdAt: new Date().toISOString(), ...(near ? { near } : {}),
    }), { label: 'Acceso a tablero creado' }).then((result) => {
      if (result.ok) { setShortcutOpen(false); void select(result.value); }
    });
  };

  const assetPlacement = () => {
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    return { createdAt: new Date().toISOString(), ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}) };
  };

  const pressCard = (cardId: CardId) => {
    if (tool === 'pan') return;
    if (tool === 'select') {
      void (multi !== null ? toggleCard(cardId) : select(cardId));
      return;
    }
    const step = connectTap(connectSource, cardId, workspace?.relations ?? []);
    setConnectSource(step.source);
    if (step.action?.kind === 'connect') {
      const { from, to } = step.action;
      void run((storage, workspaceId) => connectCards(storage, workspaceId, { from, to }), 'action.cardsConnected');
    } else if (step.action?.kind === 'disconnect') {
      const { relationId } = step.action;
      void run((storage, workspaceId) => disconnectCards(storage, workspaceId, relationId), 'action.connectionRemoved');
    }
  };

  // Menú de la línea de conexión (auditoría de interacción, 2026-09-29): mismas acciones que ya ofrecía
  // el inspector de la tarjeta, alcanzables ahora sin abrirlo.
  const setRelationArrow = (relationId: RelationId, arrow: RelationArrow) => {
    void run((storage, workspaceId) => updateConnection(storage, workspaceId, relationId, { arrow }), 'action.connectionStyleChanged');
  };
  const updateRelation = (relationId: RelationId, changes: { readonly typeLabel?: string; readonly label?: string }) => {
    const typeLabel = changes.typeLabel?.trim();
    const label = changes.label?.trim();
    void run((storage, workspaceId) => updateConnection(storage, workspaceId, relationId, {
      ...(typeLabel ? { typeLabel } : {}), ...(label ? { label } : {}),
    }), 'action.connectionUpdated');
  };
  const disconnectRelation = (relationId: RelationId) => {
    void run((storage, workspaceId) => disconnectCards(storage, workspaceId, relationId), 'action.connectionRemoved');
  };

  const changeTool = (next: CanvasTool) => {
    setTool(next);
    setConnectSource(null);
    setConnectorStart(null);
    setMulti(null);
    setFrameId(null);
  };

  const pickConnectorTarget = (point: GridPoint, cardId?: CardId) => {
    if (!connectorStart) {
      setConnectorStart({ point, ...(cardId ? { cardId } : {}) });
      return;
    }
    if (!board) {
      setFeedback({ tone: 'error', text: 'Crea o abre un tablero antes de terminar el conector.' });
      return;
    }
    if (connectorStart.point.x === point.x && connectorStart.point.y === point.y) {
      setFeedback({ tone: 'error', text: 'Elige una segunda posición distinta.' });
      return;
    }
    const path = createOrthogonalConnectorPath(connectorStart.point, point);
    const start = connectorStart;
    setConnectorStart(null);
    setTool('select');
    void run((storage, workspaceId) => addCardToBoard(storage, workspaceId, {
      kind: 'connector', boardId: board.id, createdAt: new Date().toISOString(), connectorPath: path,
      ...(start.cardId ? { connectorStartCardId: start.cardId } : {}),
      ...(cardId ? { connectorEndCardId: cardId } : {}),
    }), additions.connector).then((result) => { if (result.ok) void select(result.value); });
  };

  const changeConnectorPath = (cardId: CardId, connectorPath: readonly GridPoint[]) => {
    if (!board) return;
    void run((storage, workspaceId) => editConnectorPath(storage, workspaceId, { boardId: board.id, cardId, connectorPath }),
      { label: 'Ruta del conector actualizada' }, { reactive: true });
  };

  // Deshacer y rehacer (ADR 0026): antes se guarda el borrador, que es un paso más.
  const undoLast = async () => { if (await flushPendingText()) await undo(); };
  const redoLast = async () => { if (await flushPendingText()) await redo(); };
  const shortcuts = useRef({ undoLast, redoLast, copyMany, cutMany, duplicateMany, pasteClipboard });
  useLayoutEffect(() => { shortcuts.current = { undoLast, redoLast, copyMany, cutMany, duplicateMany, pasteClipboard }; });
  // Ctrl/⌘ + Z, Ctrl/⌘ + Mayús + Z y Ctrl + Y fuera de los campos de texto; dentro deshacen el texto del campo.
  // Ctrl/⌘ + C/X/V/D (ADR 0052): copiar/cortar solo actúan con selección múltiple no vacía; pegar solo
  // con portapapeles no vacío — cada función ya se protege sola, el atajo no duplica esa comprobación.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); void shortcuts.current.undoLast(); }
      else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) { event.preventDefault(); void shortcuts.current.redoLast(); }
      else if (key === 'c') { event.preventDefault(); shortcuts.current.copyMany(); }
      else if (key === 'x') { event.preventDefault(); void shortcuts.current.cutMany(); }
      else if (key === 'd') { event.preventDefault(); void shortcuts.current.duplicateMany(); }
      else if (key === 'v') { event.preventDefault(); void shortcuts.current.pasteClipboard(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape sale de la selección múltiple (web).
  useEffect(() => {
    if (Platform.OS !== 'web' || multi === null) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMulti(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multi]);

  // Escape abandona la conexión a medias (el lienzo cancela aparte un arrastre en curso).
  useEffect(() => {
    if (Platform.OS !== 'web' || connectSource === null) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setConnectSource(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectSource]);

  useEffect(() => {
    if (Platform.OS !== 'web' || tool !== 'connector') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setConnectorStart(null);
      setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  // Flechas mueven el conjunto seleccionado una celda (UX7-A1: sustituye los botones ←↑↓→ de la barra).
  const moveManyRef = useRef(moveMany);
  useLayoutEffect(() => { moveManyRef.current = moveMany; });
  useEffect(() => {
    if (Platform.OS !== 'web' || multi === null || multiIds.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const delta = event.key === 'ArrowLeft' ? { x: -1, y: 0 }
        : event.key === 'ArrowRight' ? { x: 1, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: -1 }
        : event.key === 'ArrowDown' ? { x: 0, y: 1 }
        : null;
      if (!delta) return;
      event.preventDefault();
      moveManyRef.current(multiIds, delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multi, multiIds]);

  const changeDisplay = (cardId: CardId, display: CardDisplayMode, relocate = false) => {
    if (!board) return;
    setRelocateOffer(null);
    void run((storage, workspaceId) => setCardDisplay(storage, workspaceId, { boardId: board.id, cardId, display, relocate }),
      relocate ? 'action.cardExpandedRelocated' : displayMessages[display], { reactive: true })
      .then((result) => {
        const cause = result.ok ? undefined : result.issues[0]?.details?.[0]?.code;
        if (display === 'expanded' && !relocate && cause === 'grid-collision') setRelocateOffer(cardId);
      });
  };

  const sendToTrash = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const result = await run((storage, workspaceId) => moveCardToTrash(storage, workspaceId, cardId), 'action.cardTrashed');
    if (result.ok) {
      setEditingId(null);
      setSelectedId(null);
      setConnectSource(null);
    }
  };

  const deleteSelection = async () => {
    const overlayOpen = editingId !== null || insertOpen || searchOpen || settingsOpen || trashOpen || moreOpen
      || projectsOpen || linkOpen || shortcutOpen || boardActionsId !== null || presentOpen || frameId !== null;
    if (mainView !== 'board' || overlayOpen) return;
    if (multiIds.length > 0) await trashMany();
    else if (selectedId !== null) await sendToTrash(selectedId);
  };
  const deleteSelectionRef = useRef(deleteSelection);
  useLayoutEffect(() => { deleteSelectionRef.current = deleteSelection; });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText = target !== null && (target.isContentEditable
        || target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null);
      if (editingText || event.key !== 'Delete' || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      void deleteSelectionRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Archivo (ADR 0023). La hora la pone la interfaz: application no usa el reloj.
  const archiveSelected = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const result = await run((storage, workspaceId) => moveCardToArchive(storage, workspaceId, cardId, new Date().toISOString()), 'action.cardArchived');
    if (result.ok) {
      setEditingId(null);
      setSelectedId(null);
      setConnectSource(null);
      setFocus(false);
    }
  };
  const restoreArchived = async (cardId: CardId) => {
    const fallbackBoardId = board?.id ?? PROTOTYPE_BOARD.id;
    const result = await run((storage, workspaceId) => restoreCardFromArchive(storage, workspaceId, { cardId, fallbackBoardId }), 'action.cardRestoredFromArchive');
    if (!result.ok) return;
    const notes = [
      result.value.relocated.length > 0 ? t('action.restoredRelocated', locale) : '',
      result.value.addedToFallback ? t('action.restoredFallbackBoard', locale, { board: board?.title ?? 'Tablero principal' }) : '',
      result.value.skippedRelations > 0
        ? t(result.value.skippedRelations === 1 ? 'action.restoredSkippedRelation.one' : 'action.restoredSkippedRelation.many', locale, { count: String(result.value.skippedRelations) })
        : '',
    ].filter(Boolean);
    if (notes.length > 0) setFeedback({ tone: 'success', text: composeSavedWithNotes(t('action.cardRestoredFromArchive', locale), notes, storageMode, locale) });
  };
  const archivedToTrash = (cardId: CardId) => {
    void run((storage, workspaceId) => sendArchivedToTrash(storage, workspaceId, cardId), 'action.cardArchivedToTrash');
  };

  // Tablero completo como unidad (ADR 0039): mismo «sin reloj» que el resto del archivo.
  const archiveBoardById = async (targetBoardId: BoardId): Promise<boolean> => {
    const target = workspace?.boards.find((candidate) => candidate.id === targetBoardId);
    if (!target) return false;
    if (!await flushPendingText()) return false;
    const result = await run((storage, workspaceId) => moveBoardToArchive(storage, workspaceId, target.id, new Date().toISOString()),
      { key: 'action.boardArchived', params: { title: target.title } });
    if (result.ok) {
      setBoardActionsId(null);
      setOpenBoardIds((current) => current.filter((id) => id !== target.id));
      if (board?.id === target.id) setBoardId(workspace?.boards.find((candidate) => candidate.id !== target.id)?.id ?? null);
      setEditingId(null);
      setSelectedId(null);
      setMulti(null);
      setConnectSource(null);
    }
    return result.ok;
  };
  const archiveCurrentBoard = async () => (board ? archiveBoardById(board.id) : false);
  const renameBoardById = async (targetBoardId: BoardId, title: string): Promise<boolean> => {
    const result = await run(
      (storage, workspaceId) => renameBoardInWorkspace(storage, workspaceId, targetBoardId, title),
      { key: 'action.boardRenamed', params: { title: title.trim() } },
    );
    if (result.ok) setBoardActionsId(null);
    return result.ok;
  };
  const restoreArchivedBoardById = async (boardId: BoardId, title: string) => {
    const result = await run((storage, workspaceId) => restoreBoardFromArchive(storage, workspaceId, boardId), { key: 'action.boardRestored', params: { title } });
    if (!result.ok) return;
    if (result.value.skipped > 0) {
      const note = t(result.value.skipped === 1 ? 'action.boardRestoredSkipped.one' : 'action.boardRestoredSkipped.many', locale, { count: String(result.value.skipped) });
      setFeedback({ tone: 'success', text: composeSavedWithNotes(t('action.boardRestored', locale, { title }), [note], storageMode, locale) });
    }
  };
  const restoreArchivedSelection = async (cardIds: readonly CardId[]) => {
    const fallbackBoardId = board?.id ?? PROTOTYPE_BOARD.id;
    const result = await run((storage, workspaceId) => restoreCardsFromArchive(storage, workspaceId, { cardIds, fallbackBoardId }),
      pluralAction(cardIds.length, 'action.cardRestoredFromArchive', 'action.cardsRestoredFromArchive.many'));
    return result.ok;
  };
  const archivedSelectionToTrash = async (cardIds: readonly CardId[]) => {
    const result = await run((storage, workspaceId) => sendArchivedCardsToTrash(storage, workspaceId, cardIds),
      pluralAction(cardIds.length, 'action.cardArchivedToTrash', 'action.cardsArchivedToTrash.many'));
    return result.ok;
  };
  // Exportar selección (ADR 0039): un ZIP nuevo y autocontenido, no el del workspace; no toca nada
  // guardado, así que no hace falta el aviso de «¿ya lo guardaste?» del ZIP principal.
  const exportArchivedSelection = async (cardIds: readonly CardId[]) => {
    if (!workspace) return;
    const built = archiveSelectionForExport(workspace, cardIds);
    if (!built.ok) {
      setFeedback({ tone: 'error', text: built.reason });
      return;
    }
    const assets = assetsOf(session.storage);
    const binaryAssets: Record<string, Uint8Array> = {};
    if (assets) {
      for (const ref of built.value.assetRefs) {
        const read = await assets.readAsset(workspace.id, ref as AssetRef);
        if (read.ok) binaryAssets[ref] = read.value;
      }
    }
    const files = serializeWorkspace(built.value.workspace);
    if (!files.ok) {
      setFeedback({ tone: 'error', text: 'No se pudo armar la selección para exportar.' });
      return;
    }
    const zip = writeWorkspaceArchive(files.value, binaryAssets);
    if (!zip.ok) {
      setFeedback({ tone: 'error', text: 'No se pudo generar el ZIP de la selección.' });
      return;
    }
    downloadFile(`archivo-seleccion-${cardIds.length}.zip`, zip.value);
    const count = t(cardIds.length === 1 ? 'unit.card.one' : 'unit.card.many', locale, { count: String(cardIds.length) });
    setFeedback({ tone: 'success', text: t('action.selectionExported', locale, { count }) });
  };

  const restore = async (cardId: CardId) => {
    const fallbackBoardId = board?.id ?? PROTOTYPE_BOARD.id;
    const result = await run((storage, workspaceId) => restoreCardFromTrash(storage, workspaceId, { cardId, fallbackBoardId }), 'action.cardRestored');
    if (!result.ok) return;
    const notes = [
      result.value.relocated.length > 0 ? t('action.restoredRelocated', locale) : '',
      result.value.addedToFallback ? t('action.restoredFallbackBoard', locale, { board: board?.title ?? 'Tablero principal' }) : '',
      result.value.skippedRelations > 0
        ? t(result.value.skippedRelations === 1 ? 'action.restoredSkippedRelation.one' : 'action.restoredSkippedRelation.many', locale, { count: String(result.value.skippedRelations) })
        : '',
    ].filter(Boolean);
    if (notes.length > 0) setFeedback({ tone: 'success', text: composeSavedWithNotes(t('action.cardRestored', locale), notes, storageMode, locale) });
  };

  const purge = async (cardId: CardId) => {
    const assets = assetsOf(session.storage);
    const result = await run((storage, workspaceId) => purgeCardFromTrash(storage, assets, workspaceId, cardId), 'action.cardPurged', { history: 'clear' });
    if (result.ok && result.value.failedAssets.length > 0) {
      setFeedback({ tone: 'error', text: `La tarjeta se eliminó, pero no se pudo borrar ${result.value.failedAssets.join(', ')}; queda como archivo sin usar.` });
    }
  };

  const importImage = async () => {
    if (!supportsImageImport()) {
      setFeedback({ tone: 'error', text: 'Este entorno no permite elegir imágenes.' });
      return;
    }
    const assets = assetsOf(session.storage);
    if (!assets) {
      setFeedback({ tone: 'error', text: 'Este almacenamiento no guarda imágenes.' });
      return;
    }
    let picked;
    try {
      picked = await pickImageFile();
    } catch {
      setFeedback({ tone: 'error', text: 'No se pudo leer la imagen elegida. Comprueba el permiso y vuelve a intentarlo.' });
      return;
    }
    if (!picked) {
      setFeedback({ tone: 'success', text: 'No se eligió ninguna imagen. No cambió nada.' });
      return;
    }
    const file = picked;
    const result = await run((storage, workspaceId) => importImageCard(storage, assets, workspaceId, {
      bytes: file.bytes, fileName: file.name, createdAt: new Date().toISOString(), ...(board ? { boardId: board.id } : {}),
    }), { key: 'action.imageImported', params: { name: file.name } });
    if (result.ok) void select(result.value);
  };

  // Guarda una posición/tamaño optimista para una tarjeta hasta que su guardado termine (con o sin
  // éxito): sin esto, un redibujado de por medio la mostraría un instante en el layout aún sin guardar.
  const withPendingRect = <T,>(cardId: CardId, rect: GridRect, action: Promise<T>): Promise<T> => {
    setPendingRects((current) => new Map(current).set(cardId, rect));
    return action.finally(() => setPendingRects((current) => {
      if (!current.has(cardId)) return current;
      const next = new Map(current);
      next.delete(cardId);
      return next;
    }));
  };
  const move = (cardId: CardId, to: GridPoint) => {
    if (!board) return;
    const placement = layout?.placements.find((candidate) => candidate.cardId === cardId);
    if (!placement) return;
    void withPendingRect(cardId, { ...placement.rect, ...to },
      run((storage, workspaceId) => moveCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, to }), 'action.cardMoved', { reactive: true }));
  };
  const resize = (cardId: CardId, size: GridSize) => {
    if (!board) return;
    const placement = layout?.placements.find((candidate) => candidate.cardId === cardId);
    if (!placement) return;
    void withPendingRect(cardId, { ...placement.rect, ...size },
      run((storage, workspaceId) => resizeCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, size }), 'action.sizeChanged', { reactive: true }));
  };

  // Documento de lectura del tablero visible, en orden de lectura (ADR 0031); vacío sin tablero.
  const printEntries = workspace && board ? printableDocument(workspace, board.id) : [];
  const printBoard = () => {
    if (!board) return;
    const html = buildPrintHtml(board.title, printEntries, previews.refs);
    if (supportsNativePrint()) {
      void printHtmlNative(html).then((opened) => {
        if (!opened) setFeedback({ tone: 'error', text: 'No se pudo abrir el diálogo de impresión.' });
      });
      return;
    }
    if (Platform.OS !== 'web') return;
    const tab = window.open('', '_blank');
    if (!tab) {
      setFeedback({ tone: 'error', text: 'El navegador bloqueó la pestaña de impresión. Permite las ventanas emergentes e inténtalo de nuevo.' });
      return;
    }
    tab.document.write(html);
    tab.document.close();
    tab.focus();
    tab.print();
  };
  const showArchive = Platform.OS === 'web' && storageMode === 'memory';
  const unexported = workspace ? session.unexported.includes(workspace.id) : false;
  const [awaiting, setAwaiting] = useState<{ fileName: string; revision: number } | null>(null);
  const [exportDraftWarning, setExportDraftWarning] = useState(false);
  const performExportZip = () => {
    if (!workspace) return;
    const outcome = session.exportArchive(workspace.id);
    setExportDraftWarning(false);
    setAwaiting(outcome.ok ? outcome.value : null);
    setArchiveMessage({ tone: outcome.ok ? 'success' : 'error', text: outcome.message });
  };
  const exportZip = () => {
    if (recoverableDrafts.length > 0 && !exportDraftWarning) {
      setExportDraftWarning(true);
      setArchiveMessage({ tone: 'error', text: 'Hay borradores privados pendientes. El ZIP incluirá únicamente documentos durables válidos; revisa o descarta los borradores, o pulsa «Exportar solo lo guardado» para continuar expresamente.' });
      return;
    }
    performExportZip();
  };
  const confirmSaved = () => {
    if (!workspace || !awaiting) return;
    const outcome = session.confirmExported(workspace.id, awaiting.revision);
    setAwaiting(null);
    if (!outcome.ok) {
      setArchiveMessage({ tone: 'error', text: outcome.message });
      return;
    }
    setArchiveMessage({
      tone: 'success',
      text: outcome.value === 'confirmed' ? `Confirmado: el estado exportado en «${awaiting.fileName}» está guardado.` : outcome.message,
    });
  };
  const notSaved = () => {
    setAwaiting(null);
    setArchiveMessage({ tone: 'success', text: 'Sigue sin exportar. Vuelve a exportar cuando quieras.' });
  };

  const { text: status, tone: statusTone } = saveStatus({ mode: storageMode, saving, failed: feedback?.saveFailed === true, native: Platform.OS !== 'web' });
  // Un error nunca usa el color de «guardado»; guardando es neutro y la memoria volátil, aviso.
  const statusColor = statusTone === 'saved' ? colors.selection : statusTone === 'saving' ? colors.textSecondary : colors.danger;
  const hint = tool === 'pan' ? 'Mano: arrastra el lienzo para desplazarte. Las tarjetas no se mueven con esta herramienta.'
    : tool === 'connector'
      ? connectorStart ? 'Posición 1 marcada. Toca una segunda posición o una tarjeta para terminar el conector.'
        : 'Conector: toca una posición libre o una tarjeta para marcar la posición 1.'
    : tool === 'connect'
      ? connectSource ? `Origen: «${workspace?.cards.find((card) => card.id === connectSource)?.title ?? t('card.untitled', locale)}». Toca otra tarjeta para conectar o desconectar; toca el origen para cancelar.`
        : 'Conectar: toca la tarjeta de origen.'
      : (layout?.placements.length ?? 0) === 0
        ? 'Tablero vacío: crea la primera nota desde el lienzo o con «Nota» en la barra.'
        : 'Toca una tarjeta para seleccionarla; ábrela con doble toque o desde Acciones. Arrastra para moverla y usa sus asas para cambiar el tamaño.';

  const frame = frameId ? layout?.frames?.find((candidate) => candidate.id === frameId) : undefined;
  const frameInspector = workspace && board && layout && frame ? (
    <FrameInspector
      key={`${frame.id}-${revision}`}
      frame={frame}
      boardId={board.id}
      members={frameMembers(layout, frame.id).length}
      run={run}
      inSheet={compact}
      onClose={() => setFrameId(null)}
      onSelectMembers={() => void startMulti(frameMembers(layout, frame.id))}
      onNoteAdded={(cardId) => void select(cardId)}
    />
  ) : null;
  const cardInspector = workspace && board && selected && !inlineEditing ? (
    <CardInspector
      key={`${selected.id}-${revision}`}
      workspace={workspace}
      boardId={board.id}
      card={selected}
      placement={layout?.placements.find((placement) => placement.cardId === selected.id)}
      run={run}
      onDraftChange={setPendingText}
      flushPendingText={flushPendingText}
      onClose={() => { setEditingId(null); setInlineEditing(false); setSelectedId(null); }}
      onDisplay={(display) => changeDisplay(selected.id, display)}
      onTrash={() => void sendToTrash(selected.id)}
      onArchive={() => void archiveSelected(selected.id)}
      onSelectMany={boardView === 'canvas' && tool === 'select' ? () => void startMulti([selected.id]) : undefined}
      inSheet={compact}
      noteImages={previews.refs}
      noteFontFamily={noteFontFamily(preferences.noteFont, Platform.OS, customFontFamily)}
      richTextCodec={markdownRichTextCodec}
      initialDraft={recoveredText?.cardId === selected.id ? recoveredText : undefined}
      focused={focus}
      onToggleFocus={() => setFocus((current) => !current)}
      onOpenBoard={(target) => { setEditingId(null); setInlineEditing(false); void chooseBoard(target); }}
    />
  ) : null;
  const inspector = frameInspector ?? cardInspector;
  const focusing = focus && cardInspector !== null;
  // Cerrar el editor guarda antes el borrador (mismo camino que el «Cerrar» del panel).
  const closeInspector = () => { void flushPendingText().then((saved) => { if (saved) { setEditingId(null); setInlineEditing(false); setSelectedId(null); setFrameId(null); setFocus(false); } }); };
  const saveInlineCard = useCallback(async (cardId: CardId, title: string, content: string) => {
    setPendingText({ cardId, title, content }, 'quick');
    return flushPendingText();
  }, [flushPendingText, setPendingText]);
  // UX7-B2: marcar/desmarcar desde el lienzo reutiliza la misma regla que el editor (`toggleChecklistLine`)
  // y el mismo caso de uso de guardado; no abre el editor ni cambia la selección.
  const toggleCheck = (cardId: CardId, lineIndex: number) => {
    const target = workspace?.cards.find((candidate) => candidate.id === cardId);
    if (!target) return;
    const next = toggleChecklistLine(target.content ?? '', lineIndex);
    if (next === null) return;
    void run((storage, workspaceId) => editCardContent(storage, workspaceId, cardId, { content: next }), 'action.textSaved', { reactive: true });
  };

  // Estado de exportación del ZIP y su botón. Desde 800 px van en la cabecera, junto al estado de guardado,
  // y el lienzo recupera la fila de la barra; en móvil siguen en su barra compacta.
  const exportStatus = (
    <Text testID="export-status" accessibilityLiveRegion="polite" numberOfLines={3}
      style={[styles.exportStatus, compact ? styles.exportStatusCompact : styles.exportStatusHeader, { color: unexported ? colors.textPrimary : colors.textSecondary }]}>
      {unexported ? 'CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.' : 'SIN CAMBIOS PENDIENTES DE EXPORTAR'}
    </Text>
  );
  const exportButton = <ActionButton label={exportDraftWarning ? 'Exportar solo lo guardado' : 'Exportar ZIP'} accessibilityLabel={exportDraftWarning ? 'Continuar exportando sin los borradores privados' : 'Exportar este espacio como ZIP'} tone={unexported ? 'primary' : 'default'} onPress={exportZip} />;
  const header = (
    <View style={[styles.header, { borderColor: colors.gridLine, backgroundColor: colors.surface }]}>
      <ActionButton label="←" accessibilityLabel="Volver a mis espacios" onPress={() => void goHome()} />
      {sidebar ? null : <BrandMark size={32} />}
      <View style={styles.headerTitle}>
        {workspace ? (
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 20 : 26 }]}>
            {workspace.metadata.name}
          </Text>
        ) : null}
        {workspace && !compact ? (
          <Text numberOfLines={1} style={[styles.eyebrow, { color: colors.textSecondary }]}>
            {(board?.title ?? 'Sin tableros').toUpperCase()} · {boardCount === 1 ? '1 TARJETA' : `${boardCount} TARJETAS`}
          </Text>
        ) : null}
        {!sidebar ? (
          <Text testID="workspace-memory" numberOfLines={2} style={[styles.memoryText, { color: statusColor }]}>{status}</Text>
        ) : null}
      </View>
      {compact ? (
        workspace ? <ActionButton label="Proyectos" accessibilityLabel="Cambiar de proyecto" onPress={() => setProjectsOpen(true)} /> : null
      ) : (
        <>
          {/* Proyectos ya no tiene su propia franja vertical (ADR 0048): el selector compacto de
              cabecera, antes solo de 800–1099 px, cubre también el escritorio con barra lateral. */}
          {workspace ? <ActionButton label="Proyectos" accessibilityLabel="Cambiar de proyecto" onPress={() => setProjectsOpen(true)} /> : null}
          {showArchive && workspace ? (
            <View testID="export-bar" style={styles.headerExport}>
              {exportStatus}
              {exportButton}
            </View>
          ) : null}
          {sidebar ? (
            <View testID="workspace-memory" style={[styles.memoryChip, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.memoryText, { color: statusTone === 'error' ? colors.danger : colors.textPrimary }]}>{status}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  const exportExtras = Boolean(archiveMessage) || Boolean(awaiting && unexported);
  const exportBar = showArchive && workspace && (compact || exportExtras) ? (
    <View testID={compact ? 'export-bar' : 'export-notice'} style={[styles.exportBar, compact ? styles.exportBarCompact : null, { backgroundColor: colors.surface, borderColor: colors.gridLine }]}>
      {compact ? (
        <View style={styles.exportRow}>
          {exportStatus}
          {exportButton}
        </View>
      ) : null}
      {archiveMessage ? (
        <Text
          testID="archive-message"
          {...(archiveMessage.tone === 'error' ? { accessibilityRole: 'alert' as const } : { accessibilityLiveRegion: 'polite' as const })}
          style={[styles.body, { color: colors.textPrimary }]}
        >
          {archiveMessage.text}
        </Text>
      ) : null}
      {awaiting && unexported ? (
        <View testID="export-confirmation" style={styles.exportRow}>
          <ActionButton label="Ya lo guardé" accessibilityLabel={`Confirmar que guardé ${awaiting.fileName}`} tone="primary" onPress={confirmSaved} />
          <ActionButton label="No se guardó" accessibilityLabel={`El ZIP ${awaiting.fileName} no se guardó`} onPress={notSaved} />
        </View>
      ) : null}
    </View>
  ) : null;

  const feedbackText = workspace ? (
    <Text
      testID="workspace-feedback"
      accessibilityLiveRegion="polite"
      {...(feedback?.tone === 'error' && connectSource === null ? { accessibilityRole: 'alert' as const } : {})}
      numberOfLines={compact ? 2 : 3}
      style={[styles.feedback, compact ? styles.feedbackCompact : null, sidebar ? styles.feedbackInline : null, {
        color: feedback?.tone === 'error' && connectSource === null ? colors.danger : colors.textPrimary,
        backgroundColor: colors.surface,
        borderColor: feedback?.tone === 'error' && connectSource === null ? colors.danger : colors.gridLine,
      }]}
    >
      {tool === 'connector' || connectSource !== null ? hint : feedback ? feedback.text
        : pendingCount > 0 ? `${pendingCount} ${pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}` : hint}
    </Text>
  ) : null;
  const recoveryPending = saveState === 'error' || saveState === 'conflict';
  const feedbackLine = workspace && (compact || recoveryPending) ? (
    <View style={styles.feedbackRow}>
      <View style={styles.feedbackGrow}>{feedbackText}</View>
      {recoveryPending ? <ActionButton label={saveState === 'conflict' ? 'Recargar y reaplicar' : 'Reintentar'}
        accessibilityLabel={saveState === 'conflict' ? 'Recargar el proyecto y reaplicar los cambios pendientes' : 'Reintentar los cambios pendientes'}
        onPress={() => void (saveState === 'conflict' ? recoverExternal() : retry())} /> : null}
      {compact ? <>
        <ActionButton label="↶" accessibilityLabel={undoLabel ? `${t('undo', locale)}: ${undoLabel}` : t('undo', locale)} disabled={undoLabel === null} onPress={() => void undoLast()} />
        <ActionButton label="↷" accessibilityLabel={redoLabel ? `${t('redo', locale)}: ${redoLabel}` : t('redo', locale)} disabled={redoLabel === null} onPress={() => void redoLast()} />
        <ActionButton label={t('paste', locale)} accessibilityLabel={clipboard ? t('paste', locale) : t('paste.empty', locale)} disabled={clipboard === null} onPress={() => void pasteClipboard()} />
      </> : null}
    </View>
  ) : feedbackText;

  const draftCardIds = [...new Set(recoverableDrafts.map((draft) => draft.key.cardId))];
  const firstDraftCardId = draftCardIds[0] as CardId | undefined;
  const firstDraft = firstDraftCardId ? recoverableDrafts.find((draft) => draft.key.cardId === firstDraftCardId && draft.key.zone === 'body')
    ?? recoverableDrafts.find((draft) => draft.key.cardId === firstDraftCardId) : undefined;
  const draftSource = firstDraft?.source.format === 'rich-text' ? JSON.stringify(firstDraft.source.value, null, 2) : firstDraft?.source.value;
  const draftBar = workspace && (recoverableDrafts.length > 0 || draftProblem) ? (
    <View testID="draft-recovery" style={[styles.offer, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
      <View style={styles.draftCopy}>
        <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.textPrimary }]}>BORRADOR PRIVADO RECUPERABLE</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.offerText, { color: colors.textPrimary }]}>
          {draftProblem ?? `${draftCardIds.length} ${draftCardIds.length === 1 ? 'nota tiene' : 'notas tienen'} trabajo pendiente fuera del ZIP y de la carpeta SAF.`}
        </Text>
        {draftSource ? <Text testID="draft-source" selectable numberOfLines={4} style={[styles.draftSource, { color: colors.textPrimary, borderColor: colors.gridLine }]}>{draftSource}</Text> : null}
      </View>
      {firstDraftCardId ? <ActionButton label="Recuperar" accessibilityLabel="Recuperar el primer borrador pendiente" tone="primary" onPress={() => {
        if (!recoverDraft(firstDraftCardId)) return;
        setSelectedId(firstDraftCardId);
        setEditingId(firstDraftCardId);
        setInlineEditing(false);
        setFocus(true);
      }} /> : null}
      {firstDraftCardId ? <ActionButton label="Descartar" accessibilityLabel="Descartar el primer borrador pendiente" onPress={() => Alert.alert(
        'Descartar borrador',
        'Este trabajo privado todavía no está confirmado en el workspace.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: () => { void discardDrafts(firstDraftCardId); } }],
      )} /> : null}
    </View>
  ) : null;

  const toolbar = workspace ? (
    <Toolbar
      compact={compact}
      tool={tool}
      onTool={changeTool}
      onOpenInsert={() => setInsertOpen(true)}
      zoom={zoom}
      onZoomIn={() => setZoom(zoomIn)}
      onZoomOut={() => setZoom(zoomOut)}
      onZoomReset={() => { setZoom(DEFAULT_ZOOM); setPan(START_PAN); }}
      view={boardView}
      onToggleView={() => { setMulti(null); setBoardView((current) => (current === 'canvas' ? 'list' : 'canvas')); }}
      trashCount={workspace.trash?.length ?? 0}
      onOpenTrash={() => setTrashOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenAssets={() => openView('assets')}
      onOpenArchive={() => openView('archive')}
      onOpenDiary={() => openView('diary')}
      onOpenPresent={() => setPresentOpen(true)}
      canPrint={Platform.OS === 'web' || supportsNativePrint()}
      onOpenPrint={() => printBoard()}
      archiveCount={archiveCount}
      onOpenMore={() => setMoreOpen(true)}
      onOpenSearch={() => setSearchOpen(true)}
      undoLabel={undoLabel}
      redoLabel={redoLabel}
      onUndo={() => void undoLast()}
      onRedo={() => void redoLast()}
      canPaste={clipboard !== null}
      onPaste={() => void pasteClipboard()}
      navInSidebar={sidebar}
    />
  ) : null;

  const placeBar = workspace && placeOffer && placeOffer.boardId === board?.id ? (
    <View testID="place-offer" style={[styles.offer, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
      <Text style={[styles.offerText, { color: colors.textPrimary }]}>{`«${placeOffer.title}» está en este tablero pero no tiene posición. Sus datos no cambian hasta que la coloques.`}</Text>
      <ActionButton label="Colocar en un hueco libre" tone="primary" accessibilityLabel={`Colocar ${placeOffer.title} en un hueco libre`} onPress={placeCard} />
      <ActionButton label="Ahora no" accessibilityLabel="No colocar la tarjeta" onPress={() => setPlaceOffer(null)} />
    </View>
  ) : null;

  // Barra de la selección múltiple (ADR 0025; UX7-A1/A2): recuento, todas, cancelar, agrupar, archivar y Papelera.
  // Mover el conjunto ya no usa botones de flecha: las flechas del teclado lo hacen (ver el efecto más arriba).
  const multiBar = workspace && multi !== null ? (
    <View testID="multi-bar" accessibilityRole="toolbar" accessibilityLabel="Selección múltiple"
      accessibilityHint={multiIds.length > 0 ? 'Usa las flechas del teclado para mover el conjunto una celda' : undefined}
      style={[styles.multiBar, { borderColor: colors.selection, backgroundColor: colors.surface }]}>
      {/* Dos filas también en 390 px: recuento, «Todas» y «Cancelar»; debajo, las acciones del conjunto. */}
      <View style={styles.multiRow}>
        <Text testID="multi-count" accessibilityLiveRegion="polite" style={[styles.multiCount, { color: colors.textPrimary }]}>
          {multiIds.length === 0 ? 'NINGUNA · toca tarjetas para añadirlas' : plural(multiIds.length, '1 SELECCIONADA', '# SELECCIONADAS')}
        </Text>
        <ActionButton label="Todas" accessibilityLabel="Seleccionar todas las tarjetas del tablero" onPress={() => setMulti(layout?.placements.map((placement) => placement.cardId) ?? [])} />
        <ActionButton label="Cancelar" accessibilityLabel="Cancelar la selección" onPress={() => setMulti(null)} />
      </View>
      {multiIds.length > 0 ? (
        <View style={styles.multiRow}>
          <ToolButton icon="copy" label="Copiar" accessibilityLabel={plural(multiIds.length, 'Copiar la seleccionada', 'Copiar las # seleccionadas')} onPress={copyMany} style={styles.multiToolCell} />
          <ToolButton icon="cut" label="Cortar" accessibilityLabel={plural(multiIds.length, 'Cortar la seleccionada', 'Cortar las # seleccionadas')} onPress={() => void cutMany()} style={styles.multiToolCell} />
          <ToolButton icon="duplicate" label="Duplicar" accessibilityLabel={plural(multiIds.length, 'Duplicar la seleccionada', 'Duplicar las # seleccionadas')} onPress={() => void duplicateMany()} style={styles.multiToolCell} />
          <ToolButton icon="frame" label="Agrupar" accessibilityLabel={plural(multiIds.length, 'Agrupar la seleccionada en un marco', 'Agrupar las # seleccionadas en un marco')} onPress={() => void groupMany()} style={styles.multiToolCell} />
          <ToolButton icon="archive" label="Archivar" accessibilityLabel={plural(multiIds.length, 'Archivar la seleccionada', 'Archivar las # seleccionadas')} onPress={() => void archiveMany()} style={styles.multiToolCell} />
          <ToolButton icon="trash" label="Papelera" accessibilityLabel={plural(multiIds.length, 'Enviar la seleccionada a la Papelera', 'Enviar las # seleccionadas a la Papelera')} onPress={() => void trashMany()} style={styles.multiToolCell} />
        </View>
      ) : null}
    </View>
  ) : null;

  const relocateBar = workspace && relocateOffer ? (
    <View testID="relocate-offer" style={[styles.offer, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
      <Text style={[styles.offerText, { color: colors.textPrimary }]}>Puedes expandirla en el primer hueco libre del tablero. Su contenido y conexiones no cambian.</Text>
      <ActionButton label="Expandir en un hueco libre" tone="primary" onPress={() => changeDisplay(relocateOffer, 'expanded', true)} />
      <ActionButton label="Dejarla así" accessibilityLabel="No expandir" onPress={() => setRelocateOffer(null)} />
    </View>
  ) : null;

  const boardArea = workspace ? (
    boardView === 'canvas' ? (
      <Canvas
        workspace={workspace}
        layout={layout}
        metrics={metrics}
        zoom={zoom}
        pan={pan}
        onPan={setPan}
        tool={tool}
        snap={snap}
        showGrid={showGrid}
        selectedId={selectedOnBoard?.id ?? null}
        selectedIds={multiSet}
        onCardToggle={(cardId) => void toggleCard(cardId)}
        onMoveMany={moveMany}
        selectedFrameId={frame?.id ?? null}
        onFramePress={(target) => void selectFrame(target)}
        onFrameMove={moveFrame}
        onZoom={setZoom}
        onView={(nextZoom, nextPan) => { setZoom(nextZoom); setPan(nextPan); }}
        onResetView={() => { setZoom(DEFAULT_ZOOM); setPan(START_PAN); }}
        onAreaSelect={(cardIds) => void startMulti(cardIds)}
        showDates={preferences.showDates}
        hideFrames={preferences.hideFrames}
        noteFontFamily={noteFontFamily(preferences.noteFont, Platform.OS, customFontFamily)}
        connectSource={connectSource}
        connectorStart={connectorStart}
        onConnectorTarget={pickConnectorTarget}
        onConnectorPathChange={changeConnectorPath}
        onCardPress={pressCard}
        onToggleCheck={toggleCheck}
        onCardEdit={(cardId) => void editCard(cardId)}
        onCardStartConnect={(cardId) => {
          setEditingId(null);
          setInlineEditing(false);
          setSelectedId(cardId);
          setConnectSource(cardId);
          setTool('connect');
        }}
        onBackgroundPress={() => { if (multi !== null) setMulti(null); else if (frameId) void selectFrame(null); else if (selectedId) void select(null); }}
        onMove={move}
        onResize={resize}
        pendingRects={pendingRects}
        onRejected={(message) => setFeedback({ tone: 'error', text: message })}
        onCreateFirst={() => void add('note')}
        boardTitle={board?.title ?? 'sin tableros'}
        unplaced={unplaced}
        imageUris={previews.cards}
        noteImages={previews.refs}
        onCardOpen={(cardId) => void openCard(cardId)}
        inlineEditingId={inlineEditing ? editingId : null}
        richTextCodec={markdownRichTextCodec}
        onInlineSave={saveInlineCard}
        onInlineClose={() => { setEditingId(null); setInlineEditing(false); setFocus(false); }}
        onInlineAdvanced={(cardId) => { setSelectedId(cardId); setEditingId(cardId); setInlineEditing(false); setFocus(true); }}
        onDisplay={(cardId, display) => changeDisplay(cardId, display)}
        onTrash={(cardId) => void sendToTrash(cardId)}
        onArchive={(cardId) => void archiveSelected(cardId)}
        onSelectMany={(cardId) => void startMulti([cardId])}
        onRelationArrow={setRelationArrow}
        onRelationUpdate={updateRelation}
        onRelationDisconnect={disconnectRelation}
        compact={compact}
        onViewport={(size) => { canvasSize.current = size; }}
      />
    ) : (
      <ScrollView testID="board-list-scroll" contentContainerStyle={styles.listPage}>
        {/* La vista de lista no tiene un botón «Editar» propio (a diferencia del lienzo): seleccionar
            sigue abriendo el editor directamente aquí, fuera del alcance de esta corrección. */}
        <Board workspace={workspace} layout={layout} mode="compact" selectedId={selectedOnBoard?.id ?? null} onSelect={(cardId) => void editCard(cardId)} richTextCodec={markdownRichTextCodec}
          imageUris={previews.cards} noteImages={previews.refs} />
      </ScrollView>
    )
  ) : null;

  // Pestañas de sesión (ADR 0035): reemplaza la franja horizontal de todos los tableros en los anchos
  // sin barra lateral, donde era la única forma de cambiar de tablero. En escritorio la barra lateral ya
  // es una lista completa y siempre visible; no se duplica aquí con las mismas etiquetas.
  const tabs = workspace && !sidebar ? (
    <OpenTabs
      boards={openBoardList}
      current={board?.id}
      onSelect={(next) => void chooseBoard(next)}
      onClose={closeBoardTab}
      closed={closedBoardList}
      onOpen={(next) => void chooseBoard(next)}
      onCreate={createBoard}
      onInsertShortcut={() => setShortcutOpen(true)}
      onActions={setBoardActionsId}
      compact={compact}
      scroll={compact}
    />
  ) : null;
  const trashCount = workspace?.trash?.length ?? 0;
  // Teclado abierto (nativo): se reserva su alto (menos la barra del sistema, ya reservada), la barra
  // inferior se oculta porque quedaría tapada y la hoja del editor puede crecer.
  const keyboard = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const typing = compact && keyboard > 0;
  const sheetScroll = useRef<ScrollView>(null);
  const onSheetScroll = useRevealFocusedInput(keyboard, sheetScroll);

  return (
    <SafeAreaView testID="workspace-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.frame, compact ? null : styles.frameRow, typing ? { paddingBottom: Math.max(0, keyboard - insets.bottom) } : null]}>
        {sidebar ? (
          <ScrollView testID="workspace-sidebar" style={[styles.sidebar, { backgroundColor: colors.surface, borderColor: colors.gridLine }]} contentContainerStyle={styles.sidebarContent}>
            <View style={styles.brandRow}>
              <BrandMark size={44} />
              <Text style={[styles.brandName, { color: colors.brand }]}>NoutyNotes</Text>
            </View>
            {workspace ? (
              <>
                <NavItem icon="trash" label={t("nav.trash", locale)} count={trashCount} accessibilityLabel={`${t("nav.trash.open", locale)} (${trashCount})`} onPress={() => setTrashOpen(true)} />
                <NavItem icon="diary" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => openView('diary')} />
                <NavItem icon="archive" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => openView('archive')} />
                <NavItem icon="assets" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => openView('assets')} />
                <NavItem icon="present" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => setPresentOpen(true)} />
                {Platform.OS === "web" || supportsNativePrint() ? <NavItem icon="print" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => printBoard()} /> : null}
                {board && board.cardIds.length > 0 ? (
                  <NavItem icon="archive" label={t("archive.navItem.label", locale)} accessibilityLabel={t("archive.navItem.accessibilityLabel", locale, { title: board.title })} onPress={() => void archiveCurrentBoard()} />
                ) : null}
                <NavItem icon="settings" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => setSettingsOpen(true)} />
              </>
            ) : null}
          </ScrollView>
        ) : null}
        <View style={styles.main}>
          {header}
          {view.kind === 'loading' ? <Text style={[styles.body, styles.pad, { color: colors.textSecondary }]}>Abriendo el espacio…</Text> : null}
          {view.kind === 'missing' ? (
            <View testID="workspace-missing" style={[styles.missing, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 26 : 36 }]}>Espacio no disponible</Text>
              <Text accessibilityRole="alert" style={[styles.body, { color: colors.textPrimary }]}>{view.message}</Text>
            </View>
          ) : null}
          {/* Aviso de guardado: una sola instancia, transversal a cualquier vista, no solo al lienzo
              (ADR 0036) — antes vivía dentro de la barra del lienzo, que ahora puede estar oculta. */}
          {workspace ? feedbackLine : null}
          {draftBar}
          {workspace && visitedViews.has('diary') ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'diary' ? styles.hidden : null]}>
              <DiaryView
                active={mainView === 'diary'}
                compact={compact}
                workspace={workspace}
                run={run}
                onGo={(cardId) => { void flushPendingText().then((ok) => { if (ok) revealCard(cardId); }); }}
                onBack={() => setMainView('board')}
              />
            </View>
          ) : null}
          {workspace && visitedViews.has('assets') ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'assets' ? styles.hidden : null]}>
              <AssetsView
                active={mainView === 'assets'}
                compact={compact}
                workspace={workspace}
                run={run}
                placement={assetPlacement}
                onAdded={(cardId) => void select(cardId)}
                onGo={(cardId) => { void flushPendingText().then((ok) => { if (ok) revealCard(cardId); }); }}
                onBack={() => setMainView('board')}
                preferences={preferences}
                onPreferencesChange={setPreferences}
              />
            </View>
          ) : null}
          {workspace && visitedViews.has('archive') ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'archive' ? styles.hidden : null]}>
              <ArchiveView
                active={mainView === 'archive'}
                compact={compact}
                workspace={workspace}
                busy={saving}
                onRestore={(cardId) => void restoreArchived(cardId)}
                onSendToTrash={archivedToTrash}
                onRestoreSelection={restoreArchivedSelection}
                onSendSelectionToTrash={archivedSelectionToTrash}
                onExportSelection={(cardIds) => void exportArchivedSelection(cardIds)}
                onRestoreBoard={(boardId, title) => void restoreArchivedBoardById(boardId, title)}
                onBack={() => setMainView('board')}
              />
            </View>
          ) : null}
          {workspace ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'board' ? styles.hidden : null]}>
              {/* Enfocado en móvil: el editor usa todo el alto (sin pestañas ni barra del ZIP). */}
              {compact && focusing ? null : tabs}
              {compact && focusing ? null : exportBar}
              {compact ? null : toolbar}
              {multiBar}
              {relocateBar}
              {placeBar}
              <View style={[styles.stage, compact ? null : styles.stageRow, compact && focusing ? styles.hidden : null]}>
                {/* Enfocado: el lienzo se oculta sin desmontarse y el editor ocupa su sitio. */}
                <View style={[styles.boardSlot, focusing ? styles.hidden : null]}>{boardArea}</View>
                {!compact && inspector ? (
                  <ScrollView testID="inspector-panel" style={[styles.sidePanel, focusing ? styles.sidePanelFocus : null, { borderColor: colors.gridLine, backgroundColor: colors.background }]}
                    contentContainerStyle={[styles.sidePanelContent, focusing ? styles.focusContent : null]}>
                    {inspector}
                  </ScrollView>
                ) : null}
              </View>
              {/* Móvil: el editor ocupa la parte baja sin tapar la barra de herramientas. */}
              {compact && inspector ? (
                <View testID="inspector-sheet" style={[styles.sheet, typing ? styles.sheetTyping : null, focusing ? styles.sheetFocus : null, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={styles.sheetBar}>
                    {/* Una sola barra: título, mostrar/ocultar y cerrar (sin repetir la cabecera del inspector). */}
                    <Text accessibilityRole="header" numberOfLines={1} style={[styles.sheetTitle, { color: colors.textPrimary }]}>{frame ? frame.title : selected?.title ?? t('trash.item.untitled', locale)}</Text>
                    {focusing ? (
                      <ActionButton label={t('inspector.sheet.back', locale)} accessibilityLabel={t('workview.back', locale)} onPress={() => setFocus(false)} />
                    ) : (
                      <>
                        {frame ? null : <ActionButton label="⤢" accessibilityLabel={t('inspector.expand.accessibilityLabel', locale)} onPress={() => { setSheetHidden(false); setFocus(true); }} />}
                        <ActionButton
                          label={t(sheetHidden ? 'inspector.sheet.showLabel' : 'inspector.sheet.hideLabel', locale)}
                          accessibilityLabel={t(sheetHidden ? (frame ? 'inspector.sheet.show.frame.accessibilityLabel' : 'inspector.sheet.show.card.accessibilityLabel') : (frame ? 'inspector.sheet.hide.frame.accessibilityLabel' : 'inspector.sheet.hide.card.accessibilityLabel'), locale)}
                          onPress={() => setSheetHidden((current) => !current)}
                        />
                      </>
                    )}
                    <ActionButton label={t('inspector.close', locale)} accessibilityLabel={t(frame ? 'inspector.sheet.close.frame.accessibilityLabel' : 'inspector.close.accessibilityLabel', locale)} onPress={closeInspector} />
                  </View>
                  {/* Oculto, sigue montado: el texto sin guardar no se pierde. */}
                  <ScrollView ref={sheetScroll} onScroll={onSheetScroll} scrollEventThrottle={32} style={sheetHidden ? styles.hidden : null} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{inspector}</ScrollView>
                </View>
              ) : null}
              {compact && !typing && !focusing ? toolbar : null}
            </View>
          ) : null}
        </View>
        {/* Una sola franja vertical (ADR 0048): tableros a la derecha; proyectos usan el selector
            compacto de cabecera («Proyectos» arriba) en vez de una segunda franja permanente. */}
        {sidebar && workspace ? <BoardRail boards={workspace.boards} current={board?.id} onSelect={(next) => void chooseBoard(next)} onCreate={createBoard} onInsertShortcut={() => setShortcutOpen(true)} onActions={setBoardActionsId} /> : null}
      </View>
      {workspace ? (
        <>
          <ProjectSheet projects={summaries} currentId={id} onOpen={(next) => void openSpace(next)} visible={projectsOpen} onClose={() => setProjectsOpen(false)} />
          {boardActions ? (
            <BoardActionsDialog
              key={`${boardActions.id}:${boardActions.title}`}
              board={boardActions}
              compact={compact}
              busy={saving}
              onClose={() => setBoardActionsId(null)}
              onRename={(title) => renameBoardById(boardActions.id, title)}
              onArchive={() => archiveBoardById(boardActions.id)}
            />
          ) : null}
          <SettingsPanel
            visible={settingsOpen}
            compact={compact}
            preferences={preferences}
            onChange={setPreferences}
            onResetDefaults={() => setPreferences(DEFAULT_PREFERENCES)}
            zoom={zoom}
            onZoomIn={() => setZoom(zoomIn)}
            onZoomOut={() => setZoom(zoomOut)}
            onResetView={() => { setZoom(DEFAULT_ZOOM); setPan(START_PAN); }}
            onOpenFontLibrary={() => { setSettingsOpen(false); openView('assets'); }}
            onClose={() => setSettingsOpen(false)}
          />
          {/* Móvil: «Más» reúne las secciones que no caben en la barra (ADR 0022). */}
          <Dialog visible={moreOpen} title={t('more', locale)} compact={compact} onClose={() => setMoreOpen(false)} testID="more-sheet">
            <NavItem icon="diary" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => { setMoreOpen(false); openView('diary'); }} />
            <NavItem icon="archive" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => { setMoreOpen(false); openView('archive'); }} />
            <NavItem icon="assets" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => { setMoreOpen(false); openView('assets'); }} />
            <NavItem icon="present" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => { setMoreOpen(false); setPresentOpen(true); }} />
            {Platform.OS === "web" || supportsNativePrint() ? <NavItem icon="print" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => { setMoreOpen(false); printBoard(); }} /> : null}
            {board && board.cardIds.length > 0 ? (
              <NavItem icon="archive" label={t("archive.navItem.label", locale)} accessibilityLabel={t("archive.navItem.accessibilityLabel", locale, { title: board.title })} onPress={() => { setMoreOpen(false); void archiveCurrentBoard(); }} />
            ) : null}
            <NavItem icon="settings" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => { setMoreOpen(false); setSettingsOpen(true); }} />
          </Dialog>
          {presentOpen ? (
            <PresentView
              boardTitle={board?.title ?? 'sin tablero'}
              entries={printEntries}
              images={previews.refs}
              onClose={() => setPresentOpen(false)}
            />
          ) : null}
          <TrashPanel
            visible={trashOpen}
            compact={compact}
            workspace={workspace}
            busy={saving}
            onRestore={(cardId) => void restore(cardId)}
            onPurge={(cardId) => void purge(cardId)}
            onClose={() => setTrashOpen(false)}
          />
          <LinkDialog visible={linkOpen} compact={compact} onCreate={addLink} onClose={() => setLinkOpen(false)} />
          <InsertMenu
            visible={insertOpen}
            compact={compact}
            onClose={() => setInsertOpen(false)}
            onNote={() => { setInsertOpen(false); void add('note'); }}
            onText={() => { setInsertOpen(false); void add('text'); }}
            onTitle={() => { setInsertOpen(false); void add('title'); }}
            onImage={() => { setInsertOpen(false); void importImage(); }}
            onLink={() => { setInsertOpen(false); setLinkOpen(true); }}
            onTable={(rows, columns) => { setInsertOpen(false); void addTable(rows, columns); }}
            onShape={() => { setInsertOpen(false); void add('shape'); }}
            onConnector={() => { setInsertOpen(false); changeTool('connector'); }}
          />
          <Dialog visible={shortcutOpen} title="Acceso a tablero" compact={compact} onClose={() => setShortcutOpen(false)} testID="board-shortcut-dialog">
            <Text style={[styles.body, { color: colors.textSecondary }]}>Elige el tablero que abrirá esta ficha.</Text>
            <View style={styles.multiRow}>
              {workspace.boards.filter((candidate) => candidate.id !== board?.id).map((candidate) => (
                <ActionButton key={candidate.id} label={candidate.title} accessibilityLabel={`Crear acceso a ${candidate.title}`} onPress={() => createShortcut(candidate.id)} />
              ))}
            </View>
            {workspace.boards.filter((candidate) => candidate.id !== board?.id).length === 0 ? (
              <Text style={[styles.body, { color: colors.textSecondary }]}>Crea otro tablero para poder enlazarlo.</Text>
            ) : null}
          </Dialog>
          <SearchPanel
            visible={searchOpen}
            compact={compact}
            workspace={workspace}
            busy={saving}
            projectCount={summaries.length}
            onGo={(result) => void goTo(result)}
            onGoProject={(target, cardId) => void goToProject(target, cardId)}
            onSearchAll={searchAll}
            onRenameTag={renameProjectTag}
            onRemoveTag={removeProjectTag}
            onClose={() => setSearchOpen(false)}
          />
        </>
      ) : null}
    </SafeAreaView>
  );
}

/** Entrada de la barra lateral: solo secciones que funcionan (ADR 0016). */
function NavItem({ icon, label, count, accessibilityLabel, onPress }: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly count?: number;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.navItem, { borderColor: focused ? colors.selection : 'transparent', backgroundColor: pressed ? colors.surfaceRaised : 'transparent' }]}
    >
      <View style={styles.navGlyph}><AppIcon name={icon} size={20} color={colors.textPrimary} /></View>
      <Text numberOfLines={1} style={[styles.navLabel, { color: colors.textPrimary }]}>{label}</Text>
      {count !== undefined && count > 0 ? <Text style={[styles.navCount, { color: colors.textSecondary }]}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * Borrador de texto de la tarjeta en modo carpeta: se guarda antes de cambiar de selección, de
 * tablero o de espacio, y antes de volver al inicio (protección del borrador de fase 8).
 */
interface PendingEditorialText {
  readonly cardId: CardId;
  readonly title: string;
  readonly content: string;
  readonly titleDocument?: RichTextDocument;
  readonly sequence: number;
  readonly surface: 'quick' | 'full';
}

function usePendingText(
  run: ReturnType<typeof useWorkspaceEditor>['run'],
  workspace: Workspace | null,
  session: ReturnType<typeof useWorkspaceSession>,
) {
  const pendingText = useRef<PendingEditorialText | null>(null);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const privateTail = useRef<Promise<void>>(Promise.resolve());
  const privateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const persistedSequence = useRef(0);
  const generations = useRef(new Map<string, DraftGeneration>());
  const baseRevisions = useRef(new Map<string, ReturnType<typeof draftRevision>>());
  const leases = useRef(new Map<string, EditorialSessionLease>());
  const [recoverableDrafts, setRecoverableDrafts] = useState<readonly EditorialDraft[]>([]);
  const [draftProblem, setDraftProblem] = useState<string | null>(null);
  const [recoveredText, setRecoveredText] = useState<Omit<PendingEditorialText, 'sequence' | 'surface'> | null>(null);

  const refreshDrafts = useCallback(async () => {
    if (!workspace) { setRecoverableDrafts([]); return; }
    const listed = await session.drafts.list(workspace.id);
    if (listed.ok) setRecoverableDrafts(listed.value);
    else setDraftProblem(listed.issues[0]?.message ?? 'No se pudieron leer los borradores recuperables.');
  }, [session.drafts, workspace]);

  useEffect(() => {
    // Igual que la carga del workspace: se difiere a una microtarea para no encadenar renders dentro del efecto.
    void Promise.resolve().then(refreshDrafts);
  }, [refreshDrafts]);

  const keyLabel = (cardId: CardId, zone: 'title' | 'body') => `${cardId}:${zone}`;
  const durableZoneRevision = useCallback((cardId: CardId, zone: 'title' | 'body') => {
    const card = workspace?.cards.find((candidate) => candidate.id === cardId);
    if (!card) return draftRevision('missing-card');
    return draftRevision(JSON.stringify(zone === 'title' ? (card.titleRichText ?? card.title ?? '') : (card.contentDocument ?? card.content ?? '')));
  }, [workspace]);

  const ensureLease = useCallback((cardId: CardId, zone: 'title' | 'body', surface: 'quick' | 'full') => {
    if (!workspace) return;
    const label = keyLabel(cardId, zone);
    const current = leases.current.get(label);
    if (current?.surface === surface && session.editorialSessions.owns(current)) return;
    const key = createDraftKey(workspace.id, cardId, zone);
    const acquired = current && session.editorialSessions.owns(current)
      ? session.editorialSessions.transfer(current, surface)
      : session.editorialSessions.acquire(key, surface);
    if (acquired.ok) leases.current.set(label, acquired.value);
    else setDraftProblem('Otra superficie mantiene la autoridad de edición de esta nota. Cambia de editor de forma explícita.');
  }, [session.editorialSessions, workspace]);

  const persistPrivate = useCallback((draft: PendingEditorialText): Promise<void> => {
    if (!workspace || persistedSequence.current >= draft.sequence) return privateTail.current;
    const task = privateTail.current.then(async () => {
      if (persistedSequence.current >= draft.sequence) return;
      const titleLabel = keyLabel(draft.cardId, 'title');
      const bodyLabel = keyLabel(draft.cardId, 'body');
      const titleBase = baseRevisions.current.get(titleLabel) ?? durableZoneRevision(draft.cardId, 'title');
      const bodyBase = baseRevisions.current.get(bodyLabel) ?? durableZoneRevision(draft.cardId, 'body');
      baseRevisions.current.set(titleLabel, titleBase);
      baseRevisions.current.set(bodyLabel, bodyBase);
      const titleDocument = draft.titleDocument ?? { schemaVersion: 1 as const, blocks: [{ type: 'paragraph' as const, content: draft.title ? [{ type: 'text' as const, text: draft.title }] : [] }] };
      const titleSaved = await session.drafts.save({
        key: createDraftKey(workspace.id, draft.cardId, 'title'), source: { format: 'rich-text', value: titleDocument },
        baseRevision: titleBase, validation: { status: 'valid' },
      });
      if (!titleSaved.ok) { setDraftProblem(`${titleSaved.issues[0]?.message ?? 'No se pudo proteger el título.'} El texto continúa en memoria mientras esta pantalla permanezca abierta.`); return; }
      generations.current.set(titleLabel, titleSaved.value.generation);
      const bodySaved = await session.drafts.save({
        key: createDraftKey(workspace.id, draft.cardId, 'body'), source: { format: 'legacy-markdown', value: draft.content },
        baseRevision: bodyBase, validation: { status: 'valid' },
      });
      if (!bodySaved.ok) { setDraftProblem(`${bodySaved.issues[0]?.message ?? 'No se pudo proteger el cuerpo.'} El texto continúa en memoria mientras esta pantalla permanezca abierta.`); return; }
      generations.current.set(bodyLabel, bodySaved.value.generation);
      persistedSequence.current = draft.sequence;
      setDraftProblem(null);
      await refreshDrafts();
    });
    privateTail.current = task.catch(() => { setDraftProblem('Falló el almacenamiento privado del borrador. El texto continúa en memoria mientras esta pantalla permanezca abierta.'); });
    return privateTail.current;
  }, [durableZoneRevision, refreshDrafts, session.drafts, workspace]);

  const flushPrivate = useCallback(async () => {
    if (privateTimer.current) { clearTimeout(privateTimer.current); privateTimer.current = null; }
    const draft = pendingText.current;
    if (draft) await persistPrivate(draft);
    await privateTail.current;
  }, [persistPrivate]);

  const flushPendingText = useCallback(async (): Promise<boolean> => {
    while (true) {
      if (pendingSave.current) {
        if (!await pendingSave.current) return false;
        continue;
      }
      const draft = pendingText.current;
      if (!draft) return true;
      await flushPrivate();
      const confirmedGenerations = new Map(generations.current);
      const block = draft.titleDocument?.blocks.length === 1 ? draft.titleDocument.blocks[0] : undefined;
      const task: Promise<boolean> = run((storage, workspaceId) => editCardContent(storage, workspaceId, draft.cardId, {
        ...(block?.type === 'paragraph' ? { titleRichText: block.content.length > 0 ? block.content : null } : { title: draft.title }),
        content: draft.content,
      }), 'action.textSaved', { mergeKey: `text:${draft.cardId}`, reactive: true }).then(async (result) => {
        if (result.ok && workspace) {
          const confirmations: Promise<unknown>[] = [];
          for (const zone of ['title', 'body'] as const) {
            const label = keyLabel(draft.cardId, zone);
            const generation = confirmedGenerations.get(label);
            if (generation) confirmations.push(session.drafts.confirm(createDraftKey(workspace.id, draft.cardId, zone), generation, durableZoneRevision(draft.cardId, zone)));
          }
          await Promise.all(confirmations);
          if (pendingText.current === draft) {
            pendingText.current = null;
            setRecoveredText(null);
            for (const zone of ['title', 'body'] as const) {
              const label = keyLabel(draft.cardId, zone);
              const lease = leases.current.get(label);
              if (lease) session.editorialSessions.release(lease);
              leases.current.delete(label);
              baseRevisions.current.delete(label);
              generations.current.delete(label);
            }
          }
          await refreshDrafts();
        }
        return result.ok;
      }).finally(() => { if (pendingSave.current === task) pendingSave.current = null; });
      pendingSave.current = task;
      if (!await task) return false;
    }
  }, [durableZoneRevision, flushPrivate, refreshDrafts, run, session.drafts, session.editorialSessions, workspace]);

  const setPendingText = useCallback((draft: { cardId: CardId; title: string; content: string; titleDocument?: RichTextDocument }, surface: 'quick' | 'full' = 'full') => {
    ensureLease(draft.cardId, 'title', surface);
    ensureLease(draft.cardId, 'body', surface);
    const next: PendingEditorialText = { ...draft, sequence: ++sequence.current, surface };
    pendingText.current = next;
    if (privateTimer.current) clearTimeout(privateTimer.current);
    privateTimer.current = setTimeout(() => { privateTimer.current = null; void persistPrivate(next); }, 250);
  }, [ensureLease, persistPrivate]);

  useEffect(() => () => {
    if (privateTimer.current) clearTimeout(privateTimer.current);
    for (const lease of leases.current.values()) session.editorialSessions.release(lease);
  }, [session.editorialSessions]);

  const recoverDraft = useCallback((cardId: CardId): boolean => {
    const card = workspace?.cards.find((candidate) => candidate.id === cardId);
    const titleDraft = recoverableDrafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'title');
    const bodyDraft = recoverableDrafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'body');
    if (!card) { setDraftProblem('La nota fue eliminada. El borrador se conserva para copiarlo o descartarlo, pero no se recreará automáticamente.'); return false; }
    if (bodyDraft?.source.format === 'html') { setDraftProblem('Este borrador HTML se conserva como fuente exacta. Su edición corresponde al editor HTML de E3-B; puedes copiarlo o descartarlo ahora.'); return false; }
    const titleDocument = titleDraft?.source.format === 'rich-text' ? titleDraft.source.value : undefined;
    const titleBlock = titleDocument?.blocks.length === 1 ? titleDocument.blocks[0] : undefined;
    const title = titleBlock?.type === 'paragraph' ? cardTitleText({ titleRichText: titleBlock.content }) : cardTitleText(card);
    let content = card.content ?? '';
    if (bodyDraft?.source.format === 'legacy-markdown') content = bodyDraft.source.value;
    else if (bodyDraft?.source.format === 'rich-text') {
      const encoded = markdownRichTextCodec.serialize(bodyDraft.source.value);
      if (encoded.ok) content = encoded.value;
    }
    for (const draft of [titleDraft, bodyDraft]) {
      if (!draft) continue;
      baseRevisions.current.set(keyLabel(cardId, draft.key.zone), draft.baseRevision);
      generations.current.set(keyLabel(cardId, draft.key.zone), draft.generation);
      if (session.drafts.conflicts(draft, durableZoneRevision(cardId, draft.key.zone))) setDraftProblem('El documento durable cambió desde que comenzó este borrador. Revísalo antes de guardar; no se fusionará automáticamente.');
    }
    const recovered = { cardId, title, content, ...(titleDocument ? { titleDocument } : {}) };
    setRecoveredText(recovered);
    setPendingText(recovered, 'full');
    return true;
  }, [durableZoneRevision, recoverableDrafts, session.drafts, setPendingText, workspace]);

  const discardDrafts = useCallback(async (cardId?: CardId) => {
    if (!workspace) return;
    const targets = recoverableDrafts.filter((draft) => cardId === undefined || draft.key.cardId === cardId);
    await Promise.all(targets.map((draft) => session.drafts.discard(draft.key, draft.generation)));
    if (cardId === undefined || pendingText.current?.cardId === cardId) { pendingText.current = null; setRecoveredText(null); }
    await refreshDrafts();
  }, [recoverableDrafts, refreshDrafts, session.drafts, workspace]);

  return { flushPendingText, setPendingText, recoverableDrafts, recoverDraft, discardDrafts, draftProblem, recoveredText };
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  frame: { flex: 1 },
  frameRow: { flexDirection: 'row' },
  sidebar: { width: 220, flexGrow: 0, borderRightWidth: 1 },
  sidebarContent: { padding: 16, gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  brandName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  sectionLabel: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 8 },
  navRule: { height: 2, marginVertical: 8 },
  navItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderWidth: 2 },
  navGlyph: { width: 22, fontSize: 17, textAlign: 'center' },
  navLabel: { flex: 1, fontSize: 16, fontWeight: '800' },
  navCount: { fontSize: 13, fontWeight: '800' },
  main: { flex: 1, minWidth: 0 },
  // Solo propiedades largas (columnGap/rowGap): mezclar `gap` con `rowGap` daba otro resultado en el export estático.
  header: { flexDirection: 'row', alignItems: 'center', columnGap: 10, rowGap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { fontWeight: '900', letterSpacing: -0.5 },
  eyebrow: { fontFamily: mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  memoryChip: { paddingHorizontal: 8, paddingVertical: 6, maxWidth: 200 },
  memoryText: { fontFamily: mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  body: { fontSize: 15, lineHeight: 22 },
  pad: { padding: 16 },
  missing: { borderWidth: 2, padding: 20, gap: 12, margin: 16 },
  workArea: { flex: 1, minHeight: 0, gap: 8 },
  workCompact: { padding: 6, gap: 5 },
  workWide: { padding: 12 },
  exportBar: { borderWidth: 1, padding: 6, gap: 8 },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  exportStatus: { flex: 1, minWidth: 180, fontFamily: mono, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  // En la cabecera: bloque estrecho de dos líneas junto al botón.
  exportStatusHeader: { flex: 0, flexShrink: 1, minWidth: 170, maxWidth: 270, fontSize: 10, lineHeight: 13 },
  headerExport: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  feedback: { fontSize: 14, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1 },
  offer: { borderWidth: 2, padding: 8, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  offerText: { flexBasis: 220, flexGrow: 1, fontSize: 14, lineHeight: 19 },
  draftCopy: { flex: 1, minWidth: 220, gap: 4 },
  draftSource: { fontFamily: mono, fontSize: 11, lineHeight: 15, borderWidth: 1, padding: 6 },
  multiCount: { flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  multiBar: { borderWidth: 2, padding: 6, gap: 6 },
  multiRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  multiToolCell: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 5 },
  // En la barra de herramientas (escritorio): mismo aviso, sin fondo propio que compita con la barra.
  feedbackRow: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  feedbackGrow: { flex: 1, minWidth: 0 },
  feedbackInline: { fontSize: 13, lineHeight: 18, paddingVertical: 4 },
  feedbackCompact: { fontSize: 13, lineHeight: 17, paddingVertical: 5 },
  exportBarCompact: { padding: 6, gap: 6 },
  exportStatusCompact: { fontSize: 10, lineHeight: 14, minWidth: 150 },
  stage: { flex: 1, minHeight: 180, gap: 12 },
  stageRow: { flexDirection: 'row', position: 'relative' },
  boardSlot: { flex: 1, minWidth: 0, minHeight: 0 },
  listPage: { paddingBottom: 16 },
  // Editor enfocado (auditoría de interacción, 2026-09-29): flotante sobre el lienzo, no una columna que
  // le reste ancho. `boardSlot` es el único hijo con `flex` de `stageRow`, así que ocupa toda la fila
  // tanto si el editor está abierto como si no; antes era un hermano de ancho fijo que sí se lo quitaba.
  // Editor contextual centrado: conserva el tablero como contexto y ofrece una anchura de escritura
  // útil. Deja de sentirse como una columna lateral permanente pegada al borde.
  sidePanel: {
    position: 'absolute', top: 12, bottom: 12, left: '50%', width: 620, marginLeft: -310,
    borderWidth: 2, zIndex: 20,
    ...Platform.select({ web: { boxShadow: '0 18px 60px rgba(0,0,0,0.28)' } as object, default: { elevation: 12 } }),
  },
  // «Ampliar» en escritorio: el lienzo ya se oculta aparte (ver `boardSlot`/`focusing`), así que aquí
  // vuelve al flujo normal y ocupa el ancho que deja libre, con una columna de lectura cómoda.
  sidePanelFocus: { position: 'relative', top: 0, bottom: 0, left: 0, width: 'auto', marginLeft: 0, flexGrow: 1 },
  focusContent: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  sidePanelContent: { padding: 0 },
  sheet: { maxHeight: '32%', flexShrink: 0, borderTopWidth: 3, paddingTop: 6 },
  // Escribiendo: la hoja crece, pero cede alto antes que desbordar por debajo del teclado.
  sheetTyping: { maxHeight: '65%', flexShrink: 1 },
  sheetFocus: { maxHeight: '100%', flexGrow: 1, flexShrink: 1 },
  sheetBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 6 },
  sheetTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800' },
  hidden: { display: 'none' },
  sheetContent: { paddingHorizontal: 8, paddingBottom: 12 },
});
