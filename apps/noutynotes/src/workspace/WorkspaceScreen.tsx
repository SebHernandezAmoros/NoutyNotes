import {
  PROTOTYPE_BOARD, addBoardToWorkspace, addCardToBoard, assetsOf, connectCards, disconnectCards, editCardContent, importImageCard,
  groupCardsInFrame, moveFrameOnBoard, moveCardOnBoard, moveCardToArchive, moveCardToTrash, moveCardsOnBoard, moveCardsToArchive, moveCardsToTrash, placeCardOnBoard, printableDocument, purgeCardFromTrash, removeTagEverywhere, renameTag, resizeCardOnBoard, restoreCardFromArchive, restoreCardFromTrash, searchAllWorkspaces, sendArchivedToTrash, setCardDisplay,
} from '@noutynotes/application';
import type { PrototypeCardKind, SearchResult, WorkspaceSummary } from '@noutynotes/application';
import type { BoardId, CardDisplayMode, CardId, GridPoint, GridSize, WorkspaceId } from '@noutynotes/domain';
import { frameMembers } from '@noutynotes/domain';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { Dialog } from '../components/Dialog';
import { ActionButton } from '../components/controls';
import { useKeyboardInset, useRevealFocusedInput } from '../components/useKeyboardInset';
import { t } from '../i18n';
import { noteFontFamily } from './fonts';
import { PresentView } from './PresentView';
import { buildPrintHtml } from './printHtml';
import { describeFailure } from '../session/messages';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { loadViewPreferences, saveViewPreferences } from '../session/viewPreferencesStore';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { Board } from './Board';
import { BoardTabs } from './BoardTabs';
import { Canvas } from './canvas/Canvas';
import type { CanvasTool } from './canvas/Canvas';
import { unplacedCardIds } from './canvas/boardCards';
import { connectTap } from './canvas/connect';
import { DEFAULT_PREFERENCES, metricsFor, parsePreferences } from './canvas/preferences';
import type { ViewPreferences } from './canvas/preferences';
import { visibleCells, zoomIn, zoomOut } from './canvas/viewport';
import type { Point } from './canvas/viewport';
import { CardInspector } from './CardInspector';
import { FrameInspector } from './FrameInspector';
import { ProjectRail, ProjectSheet } from './ProjectTabs';
import { SettingsPanel } from './SettingsPanel';
import { ArchivePanel } from './ArchivePanel';
import { DailyLogPanel } from './DailyLogPanel';
import { AssetsPanel } from './AssetsPanel';
import { LinkDialog } from './LinkDialog';
import { SearchPanel } from './SearchPanel';
import { TrashPanel } from './TrashPanel';
import { useImagePreviews } from './useImagePreviews';
import { Toolbar } from './Toolbar';
import type { BoardView } from './Toolbar';
import { saveStatus } from './saveStatus';
import { useWorkspaceEditor } from './useWorkspaceEditor';

/** Desde este ancho la navegación de espacios y tableros va en una barra lateral. */
const SIDEBAR_MIN_WIDTH = 1100;
const START_PAN: Point = { x: 16, y: 16 };

const displayMessages: Readonly<Record<CardDisplayMode, string>> = {
  expanded: 'Tarjeta expandida. Guardado en memoria.',
  collapsed: 'Tarjeta contraída. Guardado en memoria.',
  minimized: 'Tarjeta minimizada. Guardado en memoria.',
};

const additions: Readonly<Record<PrototypeCardKind, string>> = {
  note: 'Nota añadida. Guardado en memoria.',
  image: 'Imagen de ejemplo añadida. Guardado en memoria.',
  title: 'Título flotante añadido. Guardado en memoria.',
  link: 'Enlace añadido. Guardado en memoria.',
};

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
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // Tarjeta del tablero sin posición a la que se llegó desde la búsqueda: se ofrece colocarla (ADR 0020).
  const [placeOffer, setPlaceOffer] = useState<{ readonly cardId: CardId; readonly boardId: BoardId; readonly title: string } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Expandir falló por colisión: se ofrece, sin hacerlo por su cuenta, expandir en un hueco libre.
  const [relocateOffer, setRelocateOffer] = useState<CardId | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(
    notice !== '' ? { tone: 'success', text: notice } : null,
  );
  const { view, feedback, saving, run, setFeedback, undo, redo, revision, undoLabel, redoLabel } = useWorkspaceEditor(id);
  const [selectedId, setSelectedId] = useState<CardId | null>(null);
  // Selección múltiple (ADR 0025): null fuera del modo; en el modo, tocar una tarjeta la añade o la quita.
  const [multi, setMulti] = useState<readonly CardId[] | null>(null);
  // Marco seleccionado (ADR 0027): excluye la tarjeta abierta y la selección múltiple.
  const [frameId, setFrameId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<BoardId | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [connectSource, setConnectSource] = useState<CardId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>(START_PAN);
  const [boardView, setBoardView] = useState<BoardView>('canvas');
  // Móvil: el editor puede ocultarse para usar el lienzo (y las asas) sin perder el borrador.
  const [sheetHidden, setSheetHidden] = useState(false);
  // Editor enfocado (ADR 0021): el mismo editor ocupa el sitio del lienzo; el borrador no se pierde.
  const [focus, setFocus] = useState(false);
  const workspace = view.kind === 'ready' ? view.workspace : null;
  const archiveCount = workspace?.archive?.length ?? 0;
  const summaries = useSessionSummaries(workspace);
  const previews = useImagePreviews(session.storage, workspace);
  const saved = (text: string) => (storageMode === 'folder' ? text.replace('Guardado en memoria.', 'Guardado en la carpeta.') : text);

  const { flushPendingText, setPendingText } = usePendingText(run, storageMode);

  const goHome = async () => {
    if (!await flushPendingText()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const openSpace = async (target: string) => {
    if (target === id || !await flushPendingText()) return;
    router.replace({ pathname: '/workspace', params: { id: target } });
  };

  const select = async (cardId: CardId | null) => {
    if (!await flushPendingText()) return;
    setSelectedId(cardId);
    setMulti(null);
    setFrameId(null);
    setSheetHidden(false);
    if (cardId === null) setFocus(false);
  };
  const selectFrame = async (next: string | null) => {
    if (!await flushPendingText()) return;
    setSelectedId(null);
    setMulti(null);
    setFrameId(next);
    setFocus(false);
    setSheetHidden(false);
  };
  // Doble toque o doble clic: selecciona y abre el editor enfocado. En selección múltiple solo alterna.
  const openCard = async (cardId: CardId) => {
    if (multi !== null) {
      void toggleCard(cardId);
      return;
    }
    if (!await flushPendingText()) return;
    setSelectedId(cardId);
    setSheetHidden(false);
    setFocus(true);
  };

  const board = workspace ? workspace.boards.find((candidate) => candidate.id === boardId) ?? workspace.boards[0] : undefined;
  const layout = board ? workspace?.layouts.find((candidate) => candidate.boardId === board.id) : undefined;
  const visibleIds = new Set(layout?.placements.map((placement) => placement.cardId) ?? []);
  const unplaced = unplacedCardIds(board, layout).map((cardId) => workspace?.cards.find((card) => card.id === cardId)?.title ?? 'Sin título');
  const boardCount = board?.cardIds.length ?? 0;
  const selected = workspace?.cards.find((card) => card.id === selectedId && visibleIds.has(card.id));
  const multiIds = (multi ?? []).filter((cardId) => visibleIds.has(cardId));
  const multiSet = new Set(multiIds);

  // Ctrl/⌘/Mayús + clic, o tocar en el modo: la tarjeta entra o sale. La que estaba abierta entra en el conjunto.
  const toggleCard = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const base = multi ?? (selectedId && visibleIds.has(selectedId) ? [selectedId] : []);
    setMulti(base.includes(cardId) ? base.filter((current) => current !== cardId) : [...base, cardId]);
    setSelectedId(null);
    setFrameId(null);
    setFocus(false);
  };
  const startMulti = async (cardIds: readonly CardId[]) => {
    if (!await flushPendingText()) return;
    setMulti(cardIds);
    setSelectedId(null);
    setFrameId(null);
    setFocus(false);
  };
  // «Agrupar» (ADR 0027): un marco alrededor de la selección; se abre su editor para darle nombre.
  const groupMany = async () => {
    if (!board || multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => groupCardsInFrame(storage, workspaceId, { boardId: board.id, cardIds: multiIds, title: 'Nuevo marco' }),
      plural(multiIds.length, 'Marco creado con 1 tarjeta. Guardado en memoria.', 'Marco creado con # tarjetas. Guardado en memoria.'));
    if (result.ok) void selectFrame(result.value);
  };
  const moveFrame = (target: string, delta: GridPoint) => {
    if (!board) return;
    void run((storage, workspaceId) => moveFrameOnBoard(storage, workspaceId, { boardId: board.id, frameId: target, delta }), 'Marco movido. Guardado en memoria.');
  };
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many.replace('#', String(count)));
  const moveMany = (cardIds: readonly CardId[], delta: GridPoint) => {
    if (!board || cardIds.length === 0) return;
    void run((storage, workspaceId) => moveCardsOnBoard(storage, workspaceId, { boardId: board.id, cardIds, delta }),
      plural(cardIds.length, 'Tarjeta movida. Guardado en memoria.', '# tarjetas movidas. Guardado en memoria.'));
  };
  const archiveMany = async () => {
    if (multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => moveCardsToArchive(storage, workspaceId, multiIds, new Date().toISOString()),
      plural(multiIds.length, 'Tarjeta archivada. Guardado en memoria.', '# tarjetas archivadas. Guardado en memoria.'));
    if (result.ok) setMulti(null);
  };
  const trashMany = async () => {
    if (multiIds.length === 0) return;
    const result = await run((storage, workspaceId) => moveCardsToTrash(storage, workspaceId, multiIds),
      plural(multiIds.length, 'Tarjeta enviada a la Papelera. Guardado en memoria.', '# tarjetas enviadas a la Papelera. Guardado en memoria.'));
    if (result.ok) setMulti(null);
  };

  const chooseBoard = async (next: BoardId) => {
    if (!await flushPendingText()) return;
    setBoardId(next);
    setSelectedId(null);
    setMulti(null);
    setFrameId(null);
    setConnectSource(null);
    setPan(START_PAN);
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
      setFeedback({ tone: 'error', text: `«${card.title ?? 'Sin título'}» no está en ningún tablero.` });
      return;
    }
    if (target.id !== board?.id) {
      setBoardId(target.id);
      setConnectSource(null);
      setPan(START_PAN);
    }
    const placed = workspace.layouts.find((candidate) => candidate.boardId === target.id)?.placements.some((placement) => placement.cardId === cardId) ?? false;
    setPlaceOffer(placed ? null : { cardId, boardId: target.id, title: card.title ?? 'Sin título' });
    setSelectedId(placed ? cardId : null);
    setSheetHidden(false);
  };
  const goTo = async (result: SearchResult) => {
    if (!await flushPendingText()) return;
    revealCard(result.cardId);
  };
  const goToProject = async (target: WorkspaceId, cardId: CardId) => {
    if (!await flushPendingText()) return;
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
    void run((storage, workspaceId) => placeCardOnBoard(storage, workspaceId, { boardId: target, cardId, ...(near ? { near } : {}) }), 'Tarjeta colocada en un hueco libre. Guardado en memoria.')
      .then((result) => {
        if (!result.ok) return;
        setPlaceOffer(null);
        setSelectedId(cardId);
      });
  };
  const searchAll = (query: string) => searchAllWorkspaces(session.storage, query, workspace ?? undefined);

  const renameProjectTag = async (from: string, to: string) =>
    (await run((storage, workspaceId) => renameTag(storage, workspaceId, from, to), 'Etiqueta renombrada. Guardado en memoria.')).ok;
  const removeProjectTag = async (tag: string) =>
    (await run((storage, workspaceId) => removeTagEverywhere(storage, workspaceId, tag), 'Etiqueta quitada de todas las tarjetas. Guardado en memoria.')).ok;

  // Tamaño visible del lienzo: las tarjetas nuevas se colocan dentro de lo que se ve (P2).
  const canvasSize = useRef<{ width: number; height: number } | null>(null);
  const add = (kind: PrototypeCardKind, extra: { readonly url?: string; readonly title?: string } = {}) => {
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

  const createBoard = () => {
    void run((storage, workspaceId) => addBoardToWorkspace(storage, workspaceId, {}), 'Tablero creado. Guardado en memoria.')
      .then((result) => { if (result.ok) void chooseBoard(result.value); });
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
      void run((storage, workspaceId) => connectCards(storage, workspaceId, { from, to }), 'Tarjetas conectadas. Guardado en memoria.');
    } else if (step.action?.kind === 'disconnect') {
      const { relationId } = step.action;
      void run((storage, workspaceId) => disconnectCards(storage, workspaceId, relationId), 'Conexión eliminada. Guardado en memoria.');
    }
  };

  const changeTool = (next: CanvasTool) => {
    setTool(next);
    setConnectSource(null);
    setMulti(null);
    setFrameId(null);
  };

  // Deshacer y rehacer (ADR 0026): antes se guarda el borrador, que es un paso más.
  const undoLast = async () => { if (await flushPendingText()) await undo(); };
  const redoLast = async () => { if (await flushPendingText()) await redo(); };
  const shortcuts = useRef({ undoLast, redoLast });
  useLayoutEffect(() => { shortcuts.current = { undoLast, redoLast }; });
  // Ctrl/⌘ + Z, Ctrl/⌘ + Mayús + Z y Ctrl + Y fuera de los campos de texto; dentro deshacen el texto del campo.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); void shortcuts.current.undoLast(); }
      else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) { event.preventDefault(); void shortcuts.current.redoLast(); }
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

  const changeDisplay = (cardId: CardId, display: CardDisplayMode, relocate = false) => {
    if (!board) return;
    setRelocateOffer(null);
    void run((storage, workspaceId) => setCardDisplay(storage, workspaceId, { boardId: board.id, cardId, display, relocate }),
      relocate ? 'Tarjeta expandida en un hueco libre. Guardado en memoria.' : displayMessages[display])
      .then((result) => {
        const cause = result.ok ? undefined : result.issues[0]?.details?.[0]?.code;
        if (display === 'expanded' && !relocate && cause === 'grid-collision') setRelocateOffer(cardId);
      });
  };

  const sendToTrash = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const result = await run((storage, workspaceId) => moveCardToTrash(storage, workspaceId, cardId), 'Tarjeta enviada a la Papelera. Guardado en memoria.');
    if (result.ok) {
      setSelectedId(null);
      setConnectSource(null);
    }
  };

  // Archivo (ADR 0023). La hora la pone la interfaz: application no usa el reloj.
  const archiveSelected = async (cardId: CardId) => {
    if (!await flushPendingText()) return;
    const result = await run((storage, workspaceId) => moveCardToArchive(storage, workspaceId, cardId, new Date().toISOString()), 'Tarjeta archivada. Guardado en memoria.');
    if (result.ok) {
      setSelectedId(null);
      setConnectSource(null);
      setFocus(false);
    }
  };
  const restoreArchived = async (cardId: CardId) => {
    const fallbackBoardId = board?.id ?? PROTOTYPE_BOARD.id;
    const result = await run((storage, workspaceId) => restoreCardFromArchive(storage, workspaceId, { cardId, fallbackBoardId }), 'Tarjeta restaurada del Archivo. Guardado en memoria.');
    if (!result.ok) return;
    const notes = [
      result.value.relocated.length > 0 ? 'Su sitio estaba ocupado: se colocó en el primer hueco libre.' : '',
      result.value.addedToFallback ? `Su tablero ya no existe: se añadió a «${board?.title ?? 'Tablero principal'}».` : '',
      result.value.skippedRelations > 0 ? `${result.value.skippedRelations === 1 ? '1 conexión no se restauró' : `${result.value.skippedRelations} conexiones no se restauraron`} porque la otra tarjeta ya no está.` : '',
    ].filter(Boolean);
    if (notes.length > 0) setFeedback({ tone: 'success', text: saved(`Tarjeta restaurada del Archivo. ${notes.join(' ')} Guardado en memoria.`) });
  };
  const archivedToTrash = (cardId: CardId) => {
    void run((storage, workspaceId) => sendArchivedToTrash(storage, workspaceId, cardId), 'Tarjeta enviada del Archivo a la Papelera. Guardado en memoria.');
  };

  const restore = async (cardId: CardId) => {
    const fallbackBoardId = board?.id ?? PROTOTYPE_BOARD.id;
    const result = await run((storage, workspaceId) => restoreCardFromTrash(storage, workspaceId, { cardId, fallbackBoardId }), 'Tarjeta restaurada. Guardado en memoria.');
    if (!result.ok) return;
    const notes = [
      result.value.relocated.length > 0 ? 'Su sitio estaba ocupado: se colocó en el primer hueco libre.' : '',
      result.value.addedToFallback ? `Su tablero ya no existe: se añadió a «${board?.title ?? 'Tablero principal'}».` : '',
      result.value.skippedRelations > 0 ? `${result.value.skippedRelations === 1 ? '1 conexión no se restauró' : `${result.value.skippedRelations} conexiones no se restauraron`} porque la otra tarjeta ya no está.` : '',
    ].filter(Boolean);
    if (notes.length > 0) setFeedback({ tone: 'success', text: saved(`Tarjeta restaurada. ${notes.join(' ')} Guardado en memoria.`) });
  };

  const purge = async (cardId: CardId) => {
    const assets = assetsOf(session.storage);
    const result = await run((storage, workspaceId) => purgeCardFromTrash(storage, assets, workspaceId, cardId), 'Tarjeta eliminada definitivamente. Guardado en memoria.', { history: 'clear' });
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
    }), `Imagen «${file.name}» importada. Guardado en memoria.`);
    if (result.ok) void select(result.value);
  };

  const move = (cardId: CardId, to: GridPoint) => {
    if (!board) return;
    void run((storage, workspaceId) => moveCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, to }), 'Tarjeta movida. Guardado en memoria.');
  };
  const resize = (cardId: CardId, size: GridSize) => {
    if (!board) return;
    void run((storage, workspaceId) => resizeCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, size }), 'Tamaño cambiado. Guardado en memoria.');
  };

  // Documento de lectura del tablero visible, en orden de lectura (ADR 0031); vacío sin tablero.
  const printEntries = workspace && board ? printableDocument(workspace, board.id) : [];
  const printBoard = () => {
    if (Platform.OS !== 'web' || !board) return;
    const html = buildPrintHtml(board.title, printEntries, previews.refs);
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
  const exportZip = () => {
    if (!workspace) return;
    const outcome = session.exportArchive(workspace.id);
    setAwaiting(outcome.ok ? outcome.value : null);
    setArchiveMessage({ tone: outcome.ok ? 'success' : 'error', text: outcome.message });
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
    : tool === 'connect'
      ? connectSource ? `Origen: «${workspace?.cards.find((card) => card.id === connectSource)?.title ?? 'Sin título'}». Toca otra tarjeta para conectar o desconectar; toca el origen para cancelar.`
        : 'Conectar: toca la tarjeta de origen.'
      : (layout?.placements.length ?? 0) === 0
        ? 'Tablero vacío: crea la primera nota desde el lienzo o con «Nota» en la barra.'
        : 'Toca una tarjeta para editarla; arrástrala para moverla y usa sus asas para cambiar el tamaño.';

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
  const cardInspector = workspace && board && selected ? (
    <CardInspector
      key={`${selected.id}-${revision}`}
      workspace={workspace}
      boardId={board.id}
      card={selected}
      placement={layout?.placements.find((placement) => placement.cardId === selected.id)}
      run={run}
      onDraftChange={setPendingText}
      flushPendingText={flushPendingText}
      onClose={() => { setSelectedId(null); }}
      onDisplay={(display) => changeDisplay(selected.id, display)}
      onTrash={() => void sendToTrash(selected.id)}
      onArchive={() => void archiveSelected(selected.id)}
      onSelectMany={boardView === 'canvas' && tool === 'select' ? () => void startMulti([selected.id]) : undefined}
      inSheet={compact}
      noteImages={previews.refs}
      noteFontFamily={noteFontFamily(preferences.noteFont, Platform.OS)}
      focused={focus}
      onToggleFocus={() => setFocus((current) => !current)}
    />
  ) : null;
  const inspector = frameInspector ?? cardInspector;
  const focusing = focus && cardInspector !== null;
  // Cerrar el editor guarda antes el borrador (mismo camino que el «Cerrar» del panel).
  const closeInspector = () => { void flushPendingText().then((saved) => { if (saved) { setSelectedId(null); setFrameId(null); setFocus(false); } }); };

  // Estado de exportación del ZIP y su botón. Desde 800 px van en la cabecera, junto al estado de guardado,
  // y el lienzo recupera la fila de la barra; en móvil siguen en su barra compacta.
  const exportStatus = (
    <Text testID="export-status" accessibilityLiveRegion="polite" numberOfLines={3}
      style={[styles.exportStatus, compact ? styles.exportStatusCompact : styles.exportStatusHeader, { color: unexported ? colors.textPrimary : colors.textSecondary }]}>
      {unexported ? 'CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.' : 'SIN CAMBIOS PENDIENTES DE EXPORTAR'}
    </Text>
  );
  const exportButton = <ActionButton label="Exportar ZIP" accessibilityLabel="Exportar este espacio como ZIP" tone={unexported ? 'primary' : 'default'} onPress={exportZip} />;
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
      {connectSource !== null ? hint : feedback ? feedback.text : hint}
    </Text>
  ) : null;
  const feedbackLine = workspace && compact ? (
    <View style={styles.feedbackRow}>
      <View style={styles.feedbackGrow}>{feedbackText}</View>
      <ActionButton label="↶" accessibilityLabel={undoLabel ? `Deshacer: ${undoLabel}` : 'Deshacer'} disabled={undoLabel === null} onPress={() => void undoLast()} />
      <ActionButton label="↷" accessibilityLabel={redoLabel ? `Rehacer: ${redoLabel}` : 'Rehacer'} disabled={redoLabel === null} onPress={() => void redoLast()} />
    </View>
  ) : feedbackText;

  const toolbar = workspace ? (
    <Toolbar
      compact={compact}
      tool={tool}
      onTool={changeTool}
      onAddNote={() => void add('note')}
      onAddTitle={() => void add('title')}
      onAddLink={() => setLinkOpen(true)}
      onImportImage={() => void importImage()}
      onAddExample={() => void add('image')}
      zoom={zoom}
      onZoomIn={() => setZoom(zoomIn)}
      onZoomOut={() => setZoom(zoomOut)}
      onZoomReset={() => { setZoom(1); setPan(START_PAN); }}
      view={boardView}
      onToggleView={() => { setMulti(null); setBoardView((current) => (current === 'canvas' ? 'list' : 'canvas')); }}
      trashCount={workspace.trash?.length ?? 0}
      onOpenTrash={() => setTrashOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenAssets={() => setAssetsOpen(true)}
      onOpenArchive={() => setArchiveOpen(true)}
      onOpenDiary={() => setDiaryOpen(true)}
      onOpenPresent={() => setPresentOpen(true)}
      canPrint={Platform.OS === 'web'}
      onOpenPrint={() => printBoard()}
      archiveCount={archiveCount}
      onOpenMore={() => setMoreOpen(true)}
      onOpenSearch={() => setSearchOpen(true)}
      undoLabel={undoLabel}
      redoLabel={redoLabel}
      onUndo={() => void undoLast()}
      onRedo={() => void redoLast()}
      navInSidebar={sidebar}
      trailing={sidebar ? feedbackLine : undefined}
    />
  ) : null;

  const placeBar = workspace && placeOffer && placeOffer.boardId === board?.id ? (
    <View testID="place-offer" style={[styles.offer, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
      <Text style={[styles.offerText, { color: colors.textPrimary }]}>{`«${placeOffer.title}» está en este tablero pero no tiene posición. Sus datos no cambian hasta que la coloques.`}</Text>
      <ActionButton label="Colocar en un hueco libre" tone="primary" accessibilityLabel={`Colocar ${placeOffer.title} en un hueco libre`} onPress={placeCard} />
      <ActionButton label="Ahora no" accessibilityLabel="No colocar la tarjeta" onPress={() => setPlaceOffer(null)} />
    </View>
  ) : null;

  // Barra de la selección múltiple (ADR 0025): recuento, mover, todas, archivar, Papelera y cancelar.
  const multiBar = workspace && multi !== null ? (
    <View testID="multi-bar" accessibilityRole="toolbar" accessibilityLabel="Selección múltiple" style={[styles.multiBar, { borderColor: colors.selection, backgroundColor: colors.surface }]}>
      {/* Dos filas también en 390 px: recuento, «Todas» y «Cancelar»; debajo, mover y las acciones del conjunto. */}
      <View style={styles.multiRow}>
        <Text testID="multi-count" accessibilityLiveRegion="polite" style={[styles.multiCount, { color: colors.textPrimary }]}>
          {multiIds.length === 0 ? 'NINGUNA · toca tarjetas para añadirlas' : plural(multiIds.length, '1 SELECCIONADA', '# SELECCIONADAS')}
        </Text>
        <ActionButton label="Todas" accessibilityLabel="Seleccionar todas las tarjetas del tablero" onPress={() => setMulti(layout?.placements.map((placement) => placement.cardId) ?? [])} />
        <ActionButton label="Cancelar" accessibilityLabel="Cancelar la selección" onPress={() => setMulti(null)} />
      </View>
      {multiIds.length > 0 ? (
        <View style={styles.multiRow}>
          <ActionButton label="←" accessibilityLabel="Mover la selección a la izquierda" onPress={() => moveMany(multiIds, { x: -1, y: 0 })} />
          <ActionButton label="↑" accessibilityLabel="Mover la selección hacia arriba" onPress={() => moveMany(multiIds, { x: 0, y: -1 })} />
          <ActionButton label="↓" accessibilityLabel="Mover la selección hacia abajo" onPress={() => moveMany(multiIds, { x: 0, y: 1 })} />
          <ActionButton label="→" accessibilityLabel="Mover la selección a la derecha" onPress={() => moveMany(multiIds, { x: 1, y: 0 })} />
          <View style={styles.multiGap} />
          <ActionButton label={compact ? '▢' : 'Agrupar'} accessibilityLabel={plural(multiIds.length, 'Agrupar la seleccionada en un marco', 'Agrupar las # seleccionadas en un marco')} onPress={() => void groupMany()} />
          {/* En móvil, los glifos de la navegación (▤ Archivo, 🗑 Papelera) con su nombre accesible completo. */}
          <ActionButton label={compact ? '▤' : 'Archivar'} accessibilityLabel={plural(multiIds.length, 'Archivar la seleccionada', 'Archivar las # seleccionadas')} onPress={() => void archiveMany()} />
          <ActionButton label={compact ? '🗑' : 'Papelera'} accessibilityLabel={plural(multiIds.length, 'Enviar la seleccionada a la Papelera', 'Enviar las # seleccionadas a la Papelera')} onPress={() => void trashMany()} />
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
        selectedId={selected?.id ?? null}
        selectedIds={multiSet}
        onCardToggle={(cardId) => void toggleCard(cardId)}
        onMoveMany={moveMany}
        selectedFrameId={frame?.id ?? null}
        onFramePress={(target) => void selectFrame(target)}
        onFrameMove={moveFrame}
        onZoom={setZoom}
        onView={(nextZoom, nextPan) => { setZoom(nextZoom); setPan(nextPan); }}
        onResetView={() => { setZoom(1); setPan(START_PAN); }}
        onAreaSelect={(cardIds) => void startMulti(cardIds)}
        showDates={preferences.showDates}
        noteFontFamily={noteFontFamily(preferences.noteFont, Platform.OS)}
        connectSource={connectSource}
        onCardPress={pressCard}
        onBackgroundPress={() => { if (multi !== null) setMulti(null); else if (frameId) void selectFrame(null); else if (selectedId) void select(null); }}
        onMove={move}
        onResize={resize}
        onRejected={(message) => setFeedback({ tone: 'error', text: message })}
        onCreateFirst={() => void add('note')}
        boardTitle={board?.title ?? 'sin tableros'}
        unplaced={unplaced}
        imageUris={previews.cards}
        noteImages={previews.refs}
        onCardOpen={(cardId) => void openCard(cardId)}
        onDisplay={(cardId, display) => changeDisplay(cardId, display)}
        onTrash={(cardId) => void sendToTrash(cardId)}
        compact={compact}
        onViewport={(size) => { canvasSize.current = size; }}
      />
    ) : (
      <ScrollView testID="board-list-scroll" contentContainerStyle={styles.listPage}>
        <Board workspace={workspace} layout={layout} mode="compact" selectedId={selected?.id ?? null} onSelect={(cardId) => void select(cardId)} />
      </ScrollView>
    )
  ) : null;

  const tabs = workspace && !sidebar ? (
    <BoardTabs boards={workspace.boards} current={board?.id} onSelect={(next) => void chooseBoard(next)} onCreate={createBoard} vertical={false} scroll={compact} />
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
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TABLEROS</Text>
                <BoardTabs boards={workspace.boards} current={board?.id} onSelect={(next) => void chooseBoard(next)} onCreate={createBoard} vertical />
                <View style={[styles.navRule, { backgroundColor: colors.gridLine }]} />
                <NavItem glyph="🗑" label={t("nav.trash", locale)} count={trashCount} accessibilityLabel={`${t("nav.trash.open", locale)} (${trashCount})`} onPress={() => setTrashOpen(true)} />
                <NavItem glyph="◷" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => setDiaryOpen(true)} />
                <NavItem glyph="▤" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => setArchiveOpen(true)} />
                <NavItem glyph="▦" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => setAssetsOpen(true)} />
                <NavItem glyph="▶" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => setPresentOpen(true)} />
                {Platform.OS === "web" ? <NavItem glyph="⎙" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => printBoard()} /> : null}
                <NavItem glyph="⚙" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => setSettingsOpen(true)} />
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
          {workspace ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide]}>
              {/* Enfocado en móvil: el editor usa todo el alto (sin pestañas ni barra del ZIP). */}
              {compact && focusing ? null : tabs}
              {compact && focusing ? null : exportBar}
              {compact ? null : toolbar}
              {sidebar ? null : feedbackLine}
              {multiBar}
              {relocateBar}
              {placeBar}
              <View style={[styles.stage, compact ? null : styles.stageRow, compact && focusing ? styles.hidden : null]}>
                {/* Enfocado: el lienzo se oculta sin desmontarse y el editor ocupa su sitio. */}
                <View style={[styles.boardSlot, focusing ? styles.hidden : null]}>{boardArea}</View>
                {!compact && inspector ? (
                  <ScrollView testID="inspector-panel" style={[styles.sidePanel, focusing ? styles.sidePanelFocus : null, { borderColor: colors.gridLine }]}
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
                    <Text accessibilityRole="header" numberOfLines={1} style={[styles.sheetTitle, { color: colors.textPrimary }]}>{frame ? frame.title : selected?.title ?? 'Sin título'}</Text>
                    {focusing ? (
                      <ActionButton label="Volver" accessibilityLabel="Volver al tablero" onPress={() => setFocus(false)} />
                    ) : (
                      <>
                        {frame ? null : <ActionButton label="⤢" accessibilityLabel="Ampliar el editor" onPress={() => { setSheetHidden(false); setFocus(true); }} />}
                        <ActionButton
                          label={sheetHidden ? 'Mostrar' : 'Ocultar'}
                          accessibilityLabel={`${sheetHidden ? 'Mostrar' : 'Ocultar'} el editor ${frame ? 'del marco' : 'de la tarjeta'}`}
                          onPress={() => setSheetHidden((current) => !current)}
                        />
                      </>
                    )}
                    <ActionButton label="Cerrar" accessibilityLabel={frame ? 'Cerrar el editor del marco' : 'Cerrar el editor de la tarjeta'} onPress={closeInspector} />
                  </View>
                  {/* Oculto, sigue montado: el texto sin guardar no se pierde. */}
                  <ScrollView ref={sheetScroll} onScroll={onSheetScroll} scrollEventThrottle={32} style={sheetHidden ? styles.hidden : null} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{inspector}</ScrollView>
                </View>
              ) : null}
              {compact && !typing && !focusing ? toolbar : null}
            </View>
          ) : null}
        </View>
        {!compact && workspace ? <ProjectRail projects={summaries} currentId={id} onOpen={(next) => void openSpace(next)} /> : null}
      </View>
      {workspace ? (
        <>
          <ProjectSheet projects={summaries} currentId={id} onOpen={(next) => void openSpace(next)} visible={projectsOpen} onClose={() => setProjectsOpen(false)} />
          <SettingsPanel
            visible={settingsOpen}
            compact={compact}
            preferences={preferences}
            onChange={setPreferences}
            onResetDefaults={() => setPreferences(DEFAULT_PREFERENCES)}
            zoom={zoom}
            onZoomIn={() => setZoom(zoomIn)}
            onZoomOut={() => setZoom(zoomOut)}
            onResetView={() => { setZoom(1); setPan(START_PAN); }}
            onClose={() => setSettingsOpen(false)}
          />
          <AssetsPanel
            visible={assetsOpen}
            compact={compact}
            workspace={workspace}
            run={run}
            placement={() => {
              const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
              return { createdAt: new Date().toISOString(), ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}) };
            }}
            onAdded={(cardId) => void select(cardId)}
            onGo={(cardId) => { void flushPendingText().then((ok) => { if (ok) revealCard(cardId); }); }}
            onClose={() => setAssetsOpen(false)}
          />
          {/* Móvil: «Más» reúne las secciones que no caben en la barra (ADR 0022). */}
          <Dialog visible={moreOpen} title={t('more', locale)} compact={compact} onClose={() => setMoreOpen(false)} testID="more-sheet">
            <NavItem glyph="◷" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => { setMoreOpen(false); setDiaryOpen(true); }} />
            <NavItem glyph="▤" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => { setMoreOpen(false); setArchiveOpen(true); }} />
            <NavItem glyph="▦" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => { setMoreOpen(false); setAssetsOpen(true); }} />
            <NavItem glyph="▶" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => { setMoreOpen(false); setPresentOpen(true); }} />
            {Platform.OS === "web" ? <NavItem glyph="⎙" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => { setMoreOpen(false); printBoard(); }} /> : null}
            <NavItem glyph="⚙" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => { setMoreOpen(false); setSettingsOpen(true); }} />
          </Dialog>
          {presentOpen ? (
            <PresentView
              boardTitle={board?.title ?? 'sin tablero'}
              entries={printEntries}
              images={previews.refs}
              onClose={() => setPresentOpen(false)}
            />
          ) : null}
          <DailyLogPanel
            visible={diaryOpen}
            compact={compact}
            workspace={workspace}
            run={run}
            onGo={(cardId) => { void flushPendingText().then((ok) => { if (ok) revealCard(cardId); }); }}
            onClose={() => setDiaryOpen(false)}
          />
          <ArchivePanel
            visible={archiveOpen}
            compact={compact}
            workspace={workspace}
            busy={saving}
            onRestore={(cardId) => void restoreArchived(cardId)}
            onSendToTrash={archivedToTrash}
            onClose={() => setArchiveOpen(false)}
          />
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
function NavItem({ glyph, label, count, accessibilityLabel, onPress }: {
  readonly glyph: string;
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
      <Text style={[styles.navGlyph, { color: colors.textPrimary }]}>{glyph}</Text>
      <Text numberOfLines={1} style={[styles.navLabel, { color: colors.textPrimary }]}>{label}</Text>
      {count !== undefined && count > 0 ? <Text style={[styles.navCount, { color: colors.textSecondary }]}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * Borrador de texto de la tarjeta en modo carpeta: se guarda antes de cambiar de selección, de
 * tablero o de espacio, y antes de volver al inicio (protección del borrador de fase 8).
 */
function usePendingText(run: ReturnType<typeof useWorkspaceEditor>['run'], storageMode: 'memory' | 'folder') {
  const pendingText = useRef<{ cardId: CardId; title: string; content: string } | null>(null);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const flushPendingText = useCallback(async (): Promise<boolean> => {
    if (storageMode !== 'folder') return true;
    while (true) {
      if (pendingSave.current) {
        if (!await pendingSave.current) return false;
        continue;
      }
      const draft = pendingText.current;
      if (!draft) return true;
      const task: Promise<boolean> = run((storage, workspaceId) => editCardContent(storage, workspaceId, draft.cardId, {
        title: draft.title, content: draft.content,
      }), 'Texto guardado en la carpeta.', { mergeKey: `text:${draft.cardId}` }).then((result) => {
        if (result.ok && pendingText.current === draft) pendingText.current = null;
        return result.ok;
      }).finally(() => { if (pendingSave.current === task) pendingSave.current = null; });
      pendingSave.current = task;
      if (!await task) return false;
    }
  }, [run, storageMode]);
  const setPendingText = useCallback((draft: { cardId: CardId; title: string; content: string }) => { pendingText.current = draft; }, []);
  return { flushPendingText, setPendingText };
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
  multiCount: { flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  multiBar: { borderWidth: 2, padding: 6, gap: 6 },
  multiRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  multiGap: { flexGrow: 1, minWidth: 4 },
  // En la barra de herramientas (escritorio): mismo aviso, sin fondo propio que compita con la barra.
  feedbackRow: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  feedbackGrow: { flex: 1, minWidth: 0 },
  feedbackInline: { fontSize: 13, lineHeight: 18, paddingVertical: 4 },
  feedbackCompact: { fontSize: 13, lineHeight: 17, paddingVertical: 5 },
  exportBarCompact: { padding: 6, gap: 6 },
  exportStatusCompact: { fontSize: 10, lineHeight: 14, minWidth: 150 },
  stage: { flex: 1, minHeight: 180, gap: 12 },
  stageRow: { flexDirection: 'row' },
  boardSlot: { flex: 1, minWidth: 0, minHeight: 0 },
  listPage: { paddingBottom: 16 },
  sidePanel: { width: 280, flexGrow: 0, borderWidth: 1 },
  // Enfocado en escritorio: el editor ocupa el ancho del lienzo, con una columna de lectura cómoda.
  sidePanelFocus: { width: 'auto', flexGrow: 1 },
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
