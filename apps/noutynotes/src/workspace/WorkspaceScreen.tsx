import {
  PROTOTYPE_BOARD, addBoardToWorkspace, addCardToBoard, assetsOf, connectCards, disconnectCards, editCardContent, importImageCard,
  moveCardOnBoard, moveCardToTrash, purgeCardFromTrash, resizeCardOnBoard, restoreCardFromTrash, setCardDisplay,
} from '@noutynotes/application';
import type { PrototypeCardKind, WorkspaceSummary } from '@noutynotes/application';
import type { BoardId, CardDisplayMode, CardId, GridPoint, GridSize } from '@noutynotes/domain';
import { resolveLayoutMode, useTheme, useWindowWidth } from '@noutynotes/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { ActionButton } from '../components/controls';
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
import { ProjectRail, ProjectSheet } from './ProjectTabs';
import { SettingsPanel } from './SettingsPanel';
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
};

export function WorkspaceScreen() {
  const params = useLocalSearchParams<{ id?: string; notice?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  // Cambiar de espacio desde la barra lateral reinicia todo el estado de pantalla.
  return <WorkspaceView key={id ?? ''} id={id} notice={typeof params.notice === 'string' ? params.notice : ''} />;
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

function WorkspaceView({ id, notice }: { readonly id: string | undefined; readonly notice: string }) {
  const session = useWorkspaceSession();
  const storageMode = session.mode;
  const { theme } = useTheme();
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
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Expandir falló por colisión: se ofrece, sin hacerlo por su cuenta, expandir en un hueco libre.
  const [relocateOffer, setRelocateOffer] = useState<CardId | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(
    notice !== '' ? { tone: 'success', text: notice } : null,
  );
  const { view, feedback, saving, run, setFeedback } = useWorkspaceEditor(id);
  const [selectedId, setSelectedId] = useState<CardId | null>(null);
  const [boardId, setBoardId] = useState<BoardId | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [connectSource, setConnectSource] = useState<CardId | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>(START_PAN);
  const [boardView, setBoardView] = useState<BoardView>('canvas');
  // Móvil: el editor puede ocultarse para usar el lienzo (y las asas) sin perder el borrador.
  const [sheetHidden, setSheetHidden] = useState(false);
  const workspace = view.kind === 'ready' ? view.workspace : null;
  const summaries = useSessionSummaries(workspace);
  const imageUris = useImagePreviews(session.storage, workspace);
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
    setSheetHidden(false);
  };

  const board = workspace ? workspace.boards.find((candidate) => candidate.id === boardId) ?? workspace.boards[0] : undefined;
  const layout = board ? workspace?.layouts.find((candidate) => candidate.boardId === board.id) : undefined;
  const visibleIds = new Set(layout?.placements.map((placement) => placement.cardId) ?? []);
  const unplaced = unplacedCardIds(board, layout).map((cardId) => workspace?.cards.find((card) => card.id === cardId)?.title ?? 'Sin título');
  const boardCount = board?.cardIds.length ?? 0;
  const selected = workspace?.cards.find((card) => card.id === selectedId && visibleIds.has(card.id));

  const chooseBoard = async (next: BoardId) => {
    if (!await flushPendingText()) return;
    setBoardId(next);
    setSelectedId(null);
    setConnectSource(null);
    setPan(START_PAN);
  };

  // Tamaño visible del lienzo: las tarjetas nuevas se colocan dentro de lo que se ve (P2).
  const canvasSize = useRef<{ width: number; height: number } | null>(null);
  const add = (kind: PrototypeCardKind) => {
    const near = boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined;
    void run((storage, workspaceId) => addCardToBoard(storage, workspaceId, { kind, ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}) }), additions[kind])
      .then((result) => { if (result.ok) void select(result.value); });
  };

  const createBoard = () => {
    void run((storage, workspaceId) => addBoardToWorkspace(storage, workspaceId, {}), 'Tablero creado. Guardado en memoria.')
      .then((result) => { if (result.ok) void chooseBoard(result.value); });
  };

  const pressCard = (cardId: CardId) => {
    if (tool === 'pan') return;
    if (tool === 'select') {
      void select(cardId);
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
  };

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
    const result = await run((storage, workspaceId) => purgeCardFromTrash(storage, assets, workspaceId, cardId), 'Tarjeta eliminada definitivamente. Guardado en memoria.');
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
      bytes: file.bytes, fileName: file.name, ...(board ? { boardId: board.id } : {}),
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

  const { text: status, tone: statusTone } = saveStatus({ mode: storageMode, saving, failed: feedback?.tone === 'error', native: Platform.OS !== 'web' });
  // Un error nunca usa el color de «guardado»; guardando es neutro y la memoria volátil, aviso.
  const statusColor = statusTone === 'saved' ? colors.selection : statusTone === 'saving' ? colors.textSecondary : colors.danger;
  const hint = tool === 'pan' ? 'Mano: arrastra el lienzo para desplazarte. Las tarjetas no se mueven con esta herramienta.'
    : tool === 'connect'
      ? connectSource ? `Origen: «${workspace?.cards.find((card) => card.id === connectSource)?.title ?? 'Sin título'}». Toca otra tarjeta para conectar o desconectar; toca el origen para cancelar.`
        : 'Conectar: toca la tarjeta de origen.'
      : (layout?.placements.length ?? 0) === 0
        ? 'Tablero vacío: crea la primera nota desde el lienzo o con «Nota» en la barra.'
        : 'Toca una tarjeta para editarla; arrástrala para moverla y usa sus asas para cambiar el tamaño.';

  const inspector = workspace && board && selected ? (
    <CardInspector
      key={selected.id}
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
      inSheet={compact}
    />
  ) : null;
  // Cerrar el editor guarda antes el borrador (mismo camino que el «Cerrar» del panel).
  const closeInspector = () => { void flushPendingText().then((saved) => { if (saved) setSelectedId(null); }); };

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

  const feedbackLine = workspace ? (
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

  const toolbar = workspace ? (
    <Toolbar
      compact={compact}
      tool={tool}
      onTool={changeTool}
      onAddNote={() => add('note')}
      onAddTitle={() => add('title')}
      onImportImage={() => void importImage()}
      onAddExample={() => add('image')}
      zoom={zoom}
      onZoomIn={() => setZoom(zoomIn)}
      onZoomOut={() => setZoom(zoomOut)}
      onZoomReset={() => { setZoom(1); setPan(START_PAN); }}
      view={boardView}
      onToggleView={() => setBoardView((current) => (current === 'canvas' ? 'list' : 'canvas'))}
      trashCount={workspace.trash?.length ?? 0}
      onOpenTrash={() => setTrashOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      navInSidebar={sidebar}
      trailing={sidebar ? feedbackLine : undefined}
    />
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
        connectSource={connectSource}
        onCardPress={pressCard}
        onBackgroundPress={() => { if (selectedId) void select(null); }}
        onMove={move}
        onResize={resize}
        onRejected={(message) => setFeedback({ tone: 'error', text: message })}
        onCreateFirst={() => add('note')}
        boardTitle={board?.title ?? 'sin tableros'}
        unplaced={unplaced}
        imageUris={imageUris}
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

  return (
    <SafeAreaView testID="workspace-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.frame, compact ? null : styles.frameRow]}>
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
                <NavItem glyph="🗑" label="Papelera" count={trashCount} accessibilityLabel={`Abrir la Papelera (${trashCount})`} onPress={() => setTrashOpen(true)} />
                <NavItem glyph="⚙" label="Configuración" accessibilityLabel="Abrir la configuración" onPress={() => setSettingsOpen(true)} />
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
              {tabs}
              {exportBar}
              {compact ? null : toolbar}
              {sidebar ? null : feedbackLine}
              {relocateBar}
              <View style={[styles.stage, compact ? null : styles.stageRow]}>
                <View style={styles.boardSlot}>{boardArea}</View>
                {!compact && inspector ? (
                  <ScrollView testID="inspector-panel" style={[styles.sidePanel, { borderColor: colors.gridLine }]} contentContainerStyle={styles.sidePanelContent}>
                    {inspector}
                  </ScrollView>
                ) : null}
              </View>
              {/* Móvil: el editor ocupa la parte baja sin tapar la barra de herramientas. */}
              {compact && inspector ? (
                <View testID="inspector-sheet" style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={styles.sheetBar}>
                    {/* Una sola barra: título, mostrar/ocultar y cerrar (sin repetir la cabecera del inspector). */}
                    <Text accessibilityRole="header" numberOfLines={1} style={[styles.sheetTitle, { color: colors.textPrimary }]}>{selected?.title ?? 'Sin título'}</Text>
                    <ActionButton
                      label={sheetHidden ? 'Mostrar' : 'Ocultar'}
                      accessibilityLabel={sheetHidden ? 'Mostrar el editor de la tarjeta' : 'Ocultar el editor de la tarjeta'}
                      onPress={() => setSheetHidden((current) => !current)}
                    />
                    <ActionButton label="Cerrar" accessibilityLabel="Cerrar el editor de la tarjeta" onPress={closeInspector} />
                  </View>
                  {/* Oculto, sigue montado: el texto sin guardar no se pierde. */}
                  <ScrollView style={sheetHidden ? styles.hidden : null} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{inspector}</ScrollView>
                </View>
              ) : null}
              {compact ? toolbar : null}
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
          <TrashPanel
            visible={trashOpen}
            compact={compact}
            workspace={workspace}
            busy={saving}
            onRestore={(cardId) => void restore(cardId)}
            onPurge={(cardId) => void purge(cardId)}
            onClose={() => setTrashOpen(false)}
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
      }), 'Texto guardado en la carpeta.').then((result) => {
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
  // En la barra de herramientas (escritorio): mismo aviso, sin fondo propio que compita con la barra.
  feedbackInline: { fontSize: 13, lineHeight: 18, paddingVertical: 4 },
  feedbackCompact: { fontSize: 13, lineHeight: 17, paddingVertical: 5 },
  exportBarCompact: { padding: 6, gap: 6 },
  exportStatusCompact: { fontSize: 10, lineHeight: 14, minWidth: 150 },
  stage: { flex: 1, minHeight: 180, gap: 12 },
  stageRow: { flexDirection: 'row' },
  boardSlot: { flex: 1, minWidth: 0, minHeight: 0 },
  listPage: { paddingBottom: 16 },
  sidePanel: { width: 280, flexGrow: 0, borderWidth: 1 },
  sidePanelContent: { padding: 0 },
  sheet: { maxHeight: '32%', flexShrink: 0, borderTopWidth: 3, paddingTop: 6 },
  sheetBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 6 },
  sheetTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800' },
  hidden: { display: 'none' },
  sheetContent: { paddingHorizontal: 8, paddingBottom: 12 },
});
