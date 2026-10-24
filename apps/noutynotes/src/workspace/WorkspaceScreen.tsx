import {
  PROTOTYPE_BOARD, addBoardShortcut, addBoardToWorkspace, addCardToBoard, addNoteImage, addNoteImageDocument, archiveSelectionForExport, assetsOf, connectCards, createDraftKey, disconnectCards, draftRevision, duplicateSelection, editCardAppearance, editCardContent, editConnectorPath, importImageCard, importImageCardAt, insertExistingNoteImage, insertExistingNoteImageDocument,
  groupCardsInFrame, moveBoardToArchive, moveFrameOnBoard, moveCardOnBoard, moveCardToArchive, moveCardToTrash, moveCardsOnBoard, moveCardsToArchive, moveCardsToTrash, pasteSnapshot, placeCardOnBoard, printableDocument, purgeCardFromTrash, removeTagEverywhere, renameBoardInWorkspace, renameTag, reorderBoardInWorkspace, resizeCardOnBoard, restoreBoardFromArchive, restoreCardFromArchive, restoreCardFromTrash, restoreCardsFromArchive, searchAllWorkspaces, sendArchivedCardsToTrash, sendArchivedToTrash, setCardDisplay, snapshotSelection, storageFailure, updateConnection,
} from '@noutynotes/application';
import type { ClipboardSnapshot, DraftGeneration, DraftSurface, EditorialDraft, EditorialSessionLease, PrototypeCardKind, SearchResult, WorkspaceSummary } from '@noutynotes/application';
import type { AssetRef, BoardId, Card, CardDisplayMode, CardId, GridPoint, GridRect, GridSize, RelationArrow, RelationId, RichTextDocument, Workspace, WorkspaceId } from '@noutynotes/domain';
import { cardTitleText, createOrthogonalConnectorPath, frameMembers, toggleRichTextChecklistItem } from '@noutynotes/domain';
import { htmlRichTextCodec, markdownRichTextCodec, serializeWorkspace, writeWorkspaceArchive } from '@noutynotes/storage';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { AppIcon } from '../components/AppIcon';
import type { AppIconName } from '../components/AppIcon';
import { Dialog, DialogCloseButton } from '../components/Dialog';
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
import { WorkspaceResumeGate } from '../session/WorkspaceResumeGate';
import { writeResumeIntent } from '../session/sessionResumeStore';
import { useRecentConnections } from '../session/useRecentConnections';
import type { RecentProjectEntry } from '../session/recentItems';
import { Board } from './Board';
import { BoardRail } from './BoardTabs';
import { BoardActionsDialog } from './BoardActionsDialog';
import { BoardOrganizerDialog } from './BoardOrganizerDialog';
import { OpenTabs } from './OpenTabs';
import { Canvas } from './canvas/Canvas';
import type { CanvasTool } from './canvas/Canvas';
import { unplacedCardIds } from './canvas/boardCards';
import { connectTap } from './canvas/connect';
import { toggleChecklistLine } from './markdownLists';
import { DEFAULT_PREFERENCES, PREFERENCE_LIMITS, metricsFor, parsePreferences } from './canvas/preferences';
import type { ViewPreferences } from './canvas/preferences';
import { visibleCells, zoomIn, zoomOut } from './canvas/viewport';
import type { Point } from './canvas/viewport';
import { CardInspector } from './CardInspector';
import type { CardInspectorSection } from './CardInspector';
import { PdfPreview } from './PdfPreview';
import { usePdfPreview } from './usePdfPreview';
import { FrameInspector } from './FrameInspector';
import { ProjectSheet } from './ProjectTabs';
import { SettingsPanel } from './SettingsPanel';
import { ArchiveView } from './ArchiveView';
import { DiaryView } from './DiaryView';
import { AssetImagePickerDialog } from './AssetImagePickerDialog';
import { AssetsView } from './AssetsView';
import { LinkDialog } from './LinkDialog';
import { InsertMenu } from './InsertMenu';
import { SearchPanel } from './SearchPanel';
import { RecoveryCenter } from './RecoveryCenter';
import { TrashPanel } from './TrashPanel';
import { useImagePreviews } from './useImagePreviews';
import { useAssetImagePicker } from './useAssetImagePicker';
import type { MarkdownImagePlace, ResolvedNoteImageSource, VisualImagePlace } from './noteImagePlacement';
import { Toolbar } from './Toolbar';
import type { BoardView } from './Toolbar';
import { saveStatus } from './saveStatus';
import { useWorkspaceEditor } from './useWorkspaceEditor';
import type { ActionSuccess } from './useWorkspaceEditor';
import { composeSavedWithNotes } from './actionFeedback';
import type { EditableCardDraft } from './editorialDraft';

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

// UX7.1-A4: un documento, como una imagen, nunca se crea desde el menú genérico de Insertar — solo se
// añade un PDF ya catalogado desde Assets («Añadir al tablero»), con su propio mensaje de confirmación.
type InsertablePrototypeKind = Exclude<PrototypeCardKind, 'image' | 'document'>;

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
  const content = <WorkspaceView key={id ?? ''} id={id} notice={typeof params.notice === 'string' ? params.notice : ''} initialCard={typeof params.card === 'string' ? params.card : ''} />;
  return Platform.OS === 'web' ? <WorkspaceResumeGate key={id ?? ''} id={id}>{content}</WorkspaceResumeGate> : content;
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
  const [multiMoreOpen, setMultiMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [boardActionsId, setBoardActionsId] = useState<BoardId | null>(null);
  const [boardOrganizerOpen, setBoardOrganizerOpen] = useState(false);
  // Tarjeta del tablero sin posición a la que se llegó desde la búsqueda: se ofrece colocarla (ADR 0020).
  const [placeOffer, setPlaceOffer] = useState<{ readonly cardId: CardId; readonly boardId: BoardId; readonly title: string } | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Expandir falló por colisión: se ofrece, sin hacerlo por su cuenta, expandir en un hueco libre.
  const [relocateOffer, setRelocateOffer] = useState<CardId | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(
    notice !== '' ? { tone: 'success', text: notice } : null,
  );
  const {
    view, feedback, saving, saveState, saveIssues, run, setFeedback, undo, redo, retry, recoverExternal,
    flush: flushWorkspace, revision, undoLabel, redoLabel,
  } = useWorkspaceEditor(id);
  const [selectedId, setSelectedId] = useState<CardId | null>(null);
  // Editor visible (auditoría de interacción, 2026-09-29): separado de `selectedId» a propósito.
  // Seleccionar una tarjeta ya no abre su editor ni reduce el lienzo; solo «Editar» (doble clic/toque,
  // o el botón que aparece junto a la seleccionada) lo hace. `null` mientras solo hay selección.
  const [editingId, setEditingId] = useState<CardId | null>(null);
  const [inspectorSection, setInspectorSection] = useState<CardInspectorSection>('content');
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
  // Cada apertura de tablero solicita un único encuadre cuando Canvas ya conoce su viewport. No se
  // vuelve a centrar por seleccionar, editar, mover o redimensionar una Nota.
  const [boardFitRequest, setBoardFitRequest] = useState(1);
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
  const openedProjectId = view.kind === 'ready' && view.storage === session.storage ? workspace?.id : undefined;
  useEffect(() => {
    if (!openedProjectId || Platform.OS !== 'web') return;
    if (session.mode === 'folder' && session.activeFolderId) {
      writeResumeIntent({ version: 1, backend: 'web', folderId: session.activeFolderId, workspaceId: openedProjectId });
    } else if (session.mode === 'memory') writeResumeIntent(null);
  }, [openedProjectId, session.mode, session.activeFolderId]);
  // UX7.1-A4: mismo visor y mismo hook de ciclo de vida que Assets — una tarjeta de documento abre su
  // PDF ya catalogado, sin un segundo sistema de vista previa.
  const { preview: pdfPreview, open: openPdfPreview, close: closePdfPreview } = usePdfPreview(assetsOf(session.storage), workspace?.id);
  const boardActions = workspace?.boards.find((candidate) => candidate.id === boardActionsId) ?? null;
  const archiveCount = workspace?.archive?.length ?? 0;
  const summaries = useSessionSummaries(workspace);
  const previews = useImagePreviews(session.storage, workspace);
  // UX7.1-IMAGES (ASSET-04): una sola instancia del selector «Insertar desde Assets» sirve tanto a la
  // edición rápida como al Inspector completo — ninguna de las dos necesita conocer `storage` ni
  // renderizar su propio diálogo (`onPickAssetImageRef`, más abajo).
  const assetImagePicker = useAssetImagePicker(session.storage, workspace);
  /** Mismas operaciones que ya usa el Inspector (`addNoteImage`/`insertExistingNoteImage`), expuestas
   * como puerto estrecho para que la edición rápida (`InlineCardEditor`, sin acceso a `storage`) pueda
   * insertar una imagen nueva, una ya catalogada o una recién pegada, exactamente igual. */
  const placeInlineNoteImage = useCallback((cardId: CardId, place: MarkdownImagePlace, content: string, source: ResolvedNoteImageSource) => run<{ readonly content: string; readonly ref: AssetRef }>((storage, id) => {
    const assets = assetsOf(storage);
    if (!assets) return Promise.resolve(storageFailure('invalid-asset', 'storage', 'Este almacenamiento no guarda imágenes.'));
    return source.kind === 'existing'
      ? insertExistingNoteImage(storage, assets, id, cardId, { ref: source.ref as AssetRef, content, place })
      : addNoteImage(storage, assets, id, cardId, { bytes: source.bytes, fileName: source.name, content, place });
  }, place.kind === 'insert' ? 'action.noteImageInserted' : 'action.noteImageReplaced'), [run]);
  const placeInlineNoteImageDocument = useCallback((cardId: CardId, place: VisualImagePlace, contentDocument: RichTextDocument, source: ResolvedNoteImageSource) => run<{ readonly contentDocument: RichTextDocument; readonly ref: AssetRef }>((storage, id) => {
    const assets = assetsOf(storage);
    if (!assets) return Promise.resolve(storageFailure('invalid-asset', 'storage', 'Este almacenamiento no guarda imágenes.'));
    return source.kind === 'existing'
      ? insertExistingNoteImageDocument(storage, assets, id, cardId, { ref: source.ref as AssetRef, contentDocument, place })
      : addNoteImageDocument(storage, assets, id, cardId, { bytes: source.bytes, fileName: source.name, contentDocument, place });
  }, place.kind === 'insert' ? 'action.noteImageInserted' : 'action.noteImageReplaced'), [run]);

  // Fuente personalizada (ADR 0041): el registro `FontFace` no sobrevive a recargar, así que se vuelve a
  // activar al abrir este workspace si la preferencia la sigue señalando. Si el archivo ya no está, se
  // queda sin activar y `noteFontFamily` cae a la reserva del sistema por diseño; no es un error.
  const customFontRef = preferences.noteFont === 'custom' ? preferences.customFontRef : null;
  const customFontFamily = customFontRef ? customFontFamilyName(customFontRef) : undefined;
  const workspaceIdForFont = workspace?.id ?? null;
  const customFontKey = workspaceIdForFont && customFontRef ? `${workspaceIdForFont}:${customFontRef}` : null;
  const customFontAssets = workspaceIdForFont ? assetsOf(session.storage) : null;
  const customFontSupported = supportsCustomFont();
  const [customFontActivation, setCustomFontActivation] = useState<{
    readonly key: string;
    readonly status: 'active' | 'missing' | 'failed';
  } | null>(null);
  const customFontStatus: 'inactive' | 'loading' | 'active' | 'missing' | 'failed' | 'unsupported' = !customFontRef
    ? 'inactive'
    : !workspaceIdForFont ? 'loading'
      : !customFontSupported ? 'unsupported'
        : !customFontAssets ? 'missing'
          : customFontActivation?.key === customFontKey ? customFontActivation.status : 'loading';
  useEffect(() => {
    if (!workspaceIdForFont || !customFontRef || !customFontKey || !customFontSupported || !customFontAssets) return undefined;
    let active = true;
    void customFontAssets.readAsset(workspaceIdForFont, customFontRef as AssetRef).then((read) => {
      if (!active) return;
      if (!read.ok) {
        setCustomFontActivation({ key: customFontKey, status: 'missing' });
        return;
      }
      void activateCustomFont(customFontRef, read.value).then((activated) => {
        if (active) setCustomFontActivation({ key: customFontKey, status: activated ? 'active' : 'failed' });
      });
    });
    return () => { active = false; };
  }, [workspaceIdForFont, customFontRef, customFontKey, customFontSupported, customFontAssets]);

  const {
    flushPendingText, setPendingText, activateSurface, transferBodyMode, authority, recoverableDrafts, recoverDraft, discardDrafts, draftProblem, recoveredText, hasPendingEdit,
  } = usePendingText(run, workspace, session);
  // UX7-SAVE: el banner grande sobre el lienzo se retiró. Un borrador recuperable ya no interrumpe la
  // edición — solo añade una insignia discreta junto al estado de guardado (§6/§12); el detalle,
  // las acciones y cualquier aviso real viven en el Centro de recuperación (`RecoveryCenter.tsx`),
  // que la persona usuaria abre explícitamente. Nunca se abre solo.
  const recoverableCount = new Set(recoverableDrafts.map((draft) => draft.key.cardId)).size;

  // Centro de recuperación (UX7-SAVE): nunca se abre solo, ni siquiera ante un problema nuevo — solo
  // la insignia junto al estado de guardado cambia (§12). Reemplaza el banner que antes vivía sobre
  // el lienzo (`draftExpanded`/`discardConfirming`), ahora dentro de `RecoveryCenter.tsx`.
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  // UX7-D: la salida segura puede esperar un borrador y la cola durable. La ref bloquea incluso tres
  // activaciones ocurridas antes del siguiente render; el estado comunica la espera a todos los
  // accesos equivalentes. Si una protección rechaza la salida, se habilitan de nuevo sin navegar.
  const leavingHomeRef = useRef(false);
  const [leavingHome, setLeavingHome] = useState(false);
  const goHome = async () => {
    if (leavingHomeRef.current) return;
    leavingHomeRef.current = true;
    setLeavingHome(true);
    let navigated = false;
    try {
      if (!await flushPendingText() || !await flushWorkspace()) return;
      session.leaveProject();
      if (router.canGoBack()) router.back();
      else router.replace('/');
      navigated = true;
    } finally {
      if (!navigated) {
        leavingHomeRef.current = false;
        setLeavingHome(false);
      }
    }
  };

  // UX7-D-FIX: «Inicio» es navegación interna al lienzo del tablero activo. No comparte `goHome`,
  // que sigue siendo la salida explícita de «Volver a mis espacios». `mainView` es la única fuente
  // de verdad de la superficie principal; cambiarla no toca boardId, cámara, zoom ni geometría.
  // Antes de ocultar una vista auxiliar se intenta confirmar el borrador con el coordinador ya
  // existente. Si la validación o la persistencia lo rechazan, el lienzo sigue montado y el retorno
  // revela el editor con su fuente intacta para corregirla; a diferencia de `goHome`, aquí no hay
  // desmontaje que justifique bloquear a la persona en la vista auxiliar. La ref evita transiciones
  // repetidas antes del siguiente render.
  const returningToBoardRef = useRef(false);
  const [returningToBoard, setReturningToBoard] = useState(false);
  const returnToBoard = async () => {
    setMoreOpen(false);
    const overlayOpen = settingsOpen || trashOpen || presentOpen || projectsOpen || recoveryOpen;
    if (mainView === 'board' && !overlayOpen) return;
    if (returningToBoardRef.current) return;
    returningToBoardRef.current = true;
    setReturningToBoard(true);
    try {
      await flushPendingText();
      setMainView('board');
      setSettingsOpen(false);
      setTrashOpen(false);
      setPresentOpen(false);
      setProjectsOpen(false);
      setRecoveryOpen(false);
    } finally {
      returningToBoardRef.current = false;
      setReturningToBoard(false);
    }
  };

  const openSpace = async (target: string) => {
    if (target === id || !await flushPendingText() || !await flushWorkspace()) return;
    router.replace({ pathname: '/workspace', params: { id: target } });
  };

  // UX7-E2C/D: identidad de carpetas, Recientes y reconexión por evidencia real — mismo hook que
  // HomeScreen.tsx (UX7-E2A/B), para que el catálogo de `ProjectSheet` no duplique esa lógica.
  const recentConnections = useRecentConnections();

  /** UX7-E2D: un proyecto creado desde el panel permanece en la carpeta activa — ningún cambio de
   * backend, así que basta reutilizar `openSpace` (ya protege el borrador del proyecto anterior). */
  const onProjectCreated = (projectId: string, name: string) => {
    recentConnections.recordProjectUse({ workspaceId: projectId, name, backend: recentConnections.currentBackend, folderId: recentConnections.currentFolderId });
    void openSpace(projectId);
  };

  /** UX7-E2C: abrir un proyecto reciente de otra carpeta — protege primero la edición pendiente (igual
   * que `openSpace`/`goHome`), reconecta esa carpeta concreta y solo navega si la reconexión
   * corresponde exactamente a la que el proyecto espera (nunca por coincidencia de nombre). Si falla
   * en cualquier punto, la sesión original queda intacta. */
  const onOpenOtherProject = async (entry: RecentProjectEntry) => {
    if (!await flushPendingText() || !await flushWorkspace()) return;
    if (entry.backend !== 'memory') {
      const folderEntry = recentConnections.folders.find((folder) => folder.id === entry.folderId);
      if (!folderEntry) { setFeedback({ tone: 'error', text: t('project.sheet.other.reconnect.failed', locale) }); return; }
      const result = await recentConnections.reconnectFolderEntry(folderEntry);
      if (!result.ok) { setFeedback({ tone: 'error', text: result.message }); return; }
      if (result.folderId !== entry.folderId) return; // carpeta distinta elegida: no abrir por error.
    }
    recentConnections.recordProjectUse({ workspaceId: entry.workspaceId, name: entry.name, backend: entry.backend, folderId: entry.folderId });
    router.replace({ pathname: '/workspace', params: { id: entry.workspaceId } });
  };

  // Guardar ahora (UX7-SAVE): la misma infraestructura real que ya usan `goHome`/`openSpace` —
  // confirma primero el borrador editorial válido pendiente (nunca descarta una fuente HTML inválida
  // ni sustituye la última versión válida: `flushPendingText` ya rechaza eso) y después espera a que
  // la cola reactiva confirme la escritura durable. Nunca afirma éxito antes de esa confirmación real.
  const [savingNow, setSavingNow] = useState(false);
  const saveNow = async () => {
    if (savingNow) return;
    setSavingNow(true);
    try {
      if (!await flushPendingText()) {
        setFeedback({ tone: 'error', text: 'No se pudo guardar: revisa primero el aviso del borrador en el Centro de recuperación.' });
        return;
      }
      const ok = await flushWorkspace();
      // UX7-LAYOUT-CORRECTION: un guardado manual correcto no anuncia nada — el guardado normal es
      // silencioso (el estado ya refleja «guardado» por sí solo); solo un error real se notifica.
      if (!ok) setFeedback({ tone: 'error', text: 'No se pudo guardar. Revisa el aviso.', saveFailed: true });
    } finally {
      setSavingNow(false);
    }
  };
  const saveNowRef = useRef(saveNow);
  useLayoutEffect(() => { saveNowRef.current = saveNow; });
  // Ctrl+S/Cmd+S (web): sustituye el diálogo nativo de «guardar página» por esta acción real: a
  // diferencia de los atajos de deshacer/copiar de abajo, se mantiene activo incluso con el foco
  // dentro del editor (no compite con ningún atajo nativo de un campo de texto para esta tecla).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void saveNowRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // Única transición hacia CardInspector. El menú contextual lo presenta como panel lateral en
  // escritorio; «Continuar en el Inspector» desde la edición rápida conserva la intención explícita
  // de ampliar y lo presenta enfocado. Ambos caminos comparten selección, sección y limpieza de estado.
  const showCardInspector = (cardId: CardId, section: CardInspectorSection, focused: boolean) => {
    if (!activateSurface(cardId, 'full')) return;
    setSelectedId(cardId);
    setEditingId(cardId);
    setInspectorSection(section);
    setInlineEditing(false);
    setMulti(null);
    setFrameId(null);
    setSheetHidden(false);
    setFocus(focused);
  };
  // Botón «Inspector» de la tarjeta ya seleccionada, o llegar a ella con el teclado: abre su editor
  // sin pasar por un doble clic/toque (auditoría de interacción, 2026-09-29).
  const editCard = async (cardId: CardId, section: CardInspectorSection = 'content') => {
    if (!await flushPendingText()) return;
    // En móvil el formulario y el teclado necesitan toda la pantalla; abrirlo como hoja parcial
    // dejaba poco espacio útil. La selección simple sigue sin editar (ADR 0045).
    showCardInspector(cardId, section, compact);
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
    // UX7.1-A4: una tarjeta de documento no abre edición ni inspector al activarla — abre el PDF ya
    // catalogado que referencia, igual que «Vista previa» en Assets (mismo visor, mismo hook).
    if (base === 'file') {
      const ref = card?.assetRefs?.[0];
      if (ref) void openPdfPreview({ ref, name: cardTitleText(card) || t('card.untitled', locale) });
      return;
    }
    // Formas y conectores no tienen cuerpo de nota: su edición pertenece al inspector de propiedades.
    // El editor rápido comparte la misma autoridad Visual/HTML y puede conservar documentos HTML
    // compatibles; el propio editor deriva al inspector completo si encuentra bloques no soportados.
    const canEditInline = !compact && placement?.display === 'expanded' && base !== 'shape' && base !== 'connector';
    if (!activateSurface(cardId, canEditInline ? 'quick' : 'full')) return;
    setInspectorSection('content');
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
  const titleOrUntitled = (found: Card | undefined) => (found ? cardTitleText(found) : '') || t('card.untitled', locale);
  const unplaced = unplacedCardIds(board, layout).map((cardId) => titleOrUntitled(workspace?.cards.find((card) => card.id === cardId)));
  // El editor se muestra por `editingId`, no por `selectedId` (auditoría de interacción, 2026-09-29):
  // seleccionar una tarjeta ya no implica editarla.
  const selected = workspace?.cards.find((card) => card.id === editingId && visibleIds.has(card.id));
  // Resaltado/arrastre en el lienzo: sigue siendo por `selectedId`, filtrado igual que `selected`.
  const selectedOnBoard = workspace?.cards.find((card) => card.id === selectedId && visibleIds.has(card.id));
  useEffect(() => {
    if (!selected || inlineEditing || (authority?.cardId === selected.id && authority.surface === 'full')) return;
    activateSurface(selected.id, 'full');
  }, [activateSurface, authority?.cardId, authority?.surface, inlineEditing, selected]);
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
  const copyCard = (cardId: CardId) => {
    if (!board || !workspace) return;
    const snapshot = snapshotSelection(workspace, board.id, [cardId], 'copy');
    if (!snapshot) return;
    setClipboard(snapshot);
    setFeedback({ tone: 'success', text: t('action.selectionCopied', locale) });
  };
  const duplicateCard = async (cardId: CardId) => {
    if (!board) return;
    await run((storage, workspaceId) => duplicateSelection(storage, workspaceId, board.id, [cardId]), 'action.selectionDuplicated');
  };
  /** UX7.3-B: binario del menú contextual — alterna el estado EFECTIVO (override + preferencia
   * global `hideFrames`), nunca lo reinicia a «según preferencia» (eso sigue siendo exclusivo del
   * selector de 3 vías del Inspector). */
  const toggleCardFrame = async (cardId: CardId) => {
    const card = workspace?.cards.find((candidate) => candidate.id === cardId);
    if (!card) return;
    const effectivelyHidden = card.frameOverride === 'hidden' || (preferences.hideFrames && card.frameOverride !== 'visible');
    const frameOverride = effectivelyHidden ? 'visible' : 'hidden';
    await run((storage, id) => editCardAppearance(storage, id, cardId, { frameOverride }), { label: 'Apariencia actualizada' }, { reactive: true });
  };
  const pasteClipboardAt = async (point: GridPoint) => {
    if (!board || !clipboard) return;
    const count = clipboard.cards.length;
    await run((storage, workspaceId) => pasteSnapshot(storage, workspaceId, board.id, clipboard, point),
      pluralAction(count, 'action.selectionPasted', 'action.selectionPasted.many'));
  };

  const openBoard = (next: BoardId) => {
    setBoardId(next);
    setBoardFitRequest((current) => current + 1);
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
      setFeedback({ tone: 'error', text: `«${cardTitleText(card) || t('card.untitled', locale)}» no está en ningún tablero.` });
      return;
    }
    if (target.id !== board?.id) {
      openBoard(target.id);
      setConnectSource(null);
      setPan(START_PAN);
    }
    const placed = workspace.layouts.find((candidate) => candidate.boardId === target.id)?.placements.some((placement) => placement.cardId === cardId) ?? false;
    setPlaceOffer(placed ? null : { cardId, boardId: target.id, title: cardTitleText(card) || t('card.untitled', locale) });
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
    const near = visibleCellsNow();
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

  // Tamaño visible del lienzo: las tarjetas nuevas se colocan dentro de lo que se ve (P2). Función
  // compartida (en vez de repetir la misma expresión en cada sitio de creación) para que `canvasSize`
  // tenga un único punto de lectura.
  const canvasSize = useRef<{ width: number; height: number } | null>(null);
  const visibleCellsNow = () => (boardView === 'canvas' && canvasSize.current ? visibleCells(pan, zoom, metrics, canvasSize.current) : undefined);
  const add = (kind: InsertablePrototypeKind, extra: { readonly url?: string; readonly title?: string; readonly content?: string } = {}, nearOverride?: { readonly x: number; readonly y: number; readonly columns: number }) => {
    const near = nearOverride ?? visibleCellsNow();
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
    const near = visibleCellsNow();
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
    const near = visibleCellsNow();
    void run((storage, workspaceId) => addBoardShortcut(storage, workspaceId, {
      boardId: board.id, targetBoardId, createdAt: new Date().toISOString(), ...(near ? { near } : {}),
    }), { label: 'Acceso a tablero creado' }).then((result) => {
      if (result.ok) { setShortcutOpen(false); void select(result.value); }
    });
  };

  const assetPlacement = () => {
    const near = visibleCellsNow();
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
  const shortcuts = useRef({ undoLast, redoLast, copyMany, cutMany, duplicateMany, pasteClipboard, hasClipboard: clipboard !== null });
  useLayoutEffect(() => { shortcuts.current = { undoLast, redoLast, copyMany, cutMany, duplicateMany, pasteClipboard, hasClipboard: clipboard !== null }; });
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
      // UX7.1-IMAGES-FIX: solo se bloquea el pegado nativo del navegador cuando hay algo propio que
      // pegar (una tarjeta copiada). Si no hay nada, se deja seguir su curso normal — eso es lo que
      // permite que el evento `paste` real llegue después a `onPasteImageToCanvas` con una imagen del
      // portapapeles del sistema operativo; antes, este `preventDefault()` incondicional lo bloqueaba
      // siempre e impedía que Ctrl+V pegara una imagen sobre el lienzo.
      else if (key === 'v' && shortcuts.current.hasClipboard) { event.preventDefault(); void shortcuts.current.pasteClipboard(); }
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
      || projectsOpen || linkOpen || shortcutOpen || boardActionsId !== null || boardOrganizerOpen || presentOpen || frameId !== null || multiMoreOpen;
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
    return result.ok;
  };
  const reorderBoardById = async (targetBoardId: BoardId, targetIndex: number): Promise<boolean> => {
    const result = await run(
      (storage, workspaceId) => reorderBoardInWorkspace(storage, workspaceId, targetBoardId, targetIndex),
      'action.boardReordered',
    );
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
    // Eliminar definitivamente ya es la acción destructiva confirmada (ADR 0015/0023): un borrador
    // privado de esa misma tarjeta no puede recuperarse hacia ningún sitio a partir de aquí, así que
    // limpiarlo aquí no es una pérdida nueva — es la causa real del aviso «BORRADOR PRIVADO
    // RECUPERABLE» que seguía apareciendo para notas ya eliminadas para siempre.
    if (result.ok) await discardDrafts(cardId);
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

  /** UX7.1-IMAGES-FIX (Corrección B): Ctrl+V con el foco en el lienzo (no en un editor de texto) crea
   * una tarjeta de imagen a partir de bytes ya extraídos del portapapeles real del sistema operativo. */
  const pasteImageToCanvas = async (bytes: Uint8Array, fileName: string) => {
    const overlayOpen = editingId !== null || insertOpen || searchOpen || settingsOpen || trashOpen || moreOpen
      || projectsOpen || linkOpen || shortcutOpen || boardActionsId !== null || boardOrganizerOpen || presentOpen || frameId !== null || multiMoreOpen;
    if (mainView !== 'board' || overlayOpen) return;
    const assets = assetsOf(session.storage);
    if (!assets) { setFeedback({ tone: 'error', text: 'Este almacenamiento no guarda imágenes.' }); return; }
    // Un espacio recién creado todavía no tiene ningún tablero (se crea el del prototipo recién con la
    // primera tarjeta, igual que ya hace `importImage` más arriba): sin `board`, se omite `boardId` y
    // `importImageCardAt`/`addCardToBoard` lo crean solos, en vez de bloquear el pegado.
    const near = visibleCellsNow();
    const result = await run<CardId>((storage, workspaceId) => importImageCardAt(storage, assets, workspaceId, {
      bytes, fileName, createdAt: new Date().toISOString(), ...(board ? { boardId: board.id } : {}), ...(near ? { near } : {}),
    }), { key: 'action.imageImported', params: { name: fileName } });
    if (result.ok) void select(result.value);
  };
  const pasteImageToCanvasRef = useRef(pasteImageToCanvas);
  useLayoutEffect(() => { pasteImageToCanvasRef.current = pasteImageToCanvas; });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      const imageFile = [...clipboardData.files].find((file) => file.type.startsWith('image/'));
      if (!imageFile) return;
      event.preventDefault();
      void imageFile.arrayBuffer().then((buffer) => pasteImageToCanvasRef.current(new Uint8Array(buffer), imageFile.name || 'imagen-pegada'));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /** UX7.1-IMAGES-FIX (Corrección C): «Pegar imagen aquí» del menú contextual del lienzo. Lectura
   * explícita del portapapeles disparada por el propio clic del usuario (activación transitoria real,
   * no asumida): si el navegador no la admite o se deniega el permiso, se avisa sin crear nada. */
  const pasteImageAt = async (point: GridPoint) => {
    if (!board) return;
    const clipboardApi = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboardApi || typeof clipboardApi.read !== 'function') {
      setFeedback({ tone: 'error', text: t('canvasMenu.pasteImage.unsupported', locale) });
      return;
    }
    let items: ClipboardItems;
    try {
      items = await clipboardApi.read();
    } catch {
      setFeedback({ tone: 'error', text: t('canvasMenu.pasteImage.denied', locale) });
      return;
    }
    const imageType = items.flatMap((item) => item.types).find((type) => type.startsWith('image/'));
    const imageItem = imageType ? items.find((item) => item.types.includes(imageType)) : undefined;
    if (!imageItem || !imageType) {
      setFeedback({ tone: 'error', text: t('canvasMenu.pasteImage.empty', locale) });
      return;
    }
    const assets = assetsOf(session.storage);
    if (!assets) { setFeedback({ tone: 'error', text: 'Este almacenamiento no guarda imágenes.' }); return; }
    const blob = await imageItem.getType(imageType);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await run<CardId>((storage, workspaceId) => importImageCardAt(storage, assets, workspaceId, {
      bytes, fileName: 'imagen-pegada', boardId: board.id, createdAt: new Date().toISOString(), near: { ...point, columns: 1 },
    }), { key: 'action.imageImported', params: { name: 'imagen-pegada' } });
    if (result.ok) void select(result.value);
  };

  // Guarda una posición/tamaño optimista para una tarjeta hasta que su guardado termine (con o sin
  // éxito): sin esto, un redibujado de por medio la mostraría un instante en el layout aún sin guardar.
  const withPendingRect = useCallback(<T,>(cardId: CardId, rect: GridRect, action: Promise<T>): Promise<T> => {
    setPendingRects((current) => new Map(current).set(cardId, rect));
    return action.finally(() => setPendingRects((current) => {
      if (!current.has(cardId)) return current;
      const next = new Map(current);
      next.delete(cardId);
      return next;
    }));
  }, []);
  const move = useCallback((cardId: CardId, to: GridPoint) => {
    if (!board) return;
    const placement = layout?.placements.find((candidate) => candidate.cardId === cardId);
    if (!placement) return;
    void withPendingRect(cardId, { ...placement.rect, ...to },
      run((storage, workspaceId) => moveCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, to }), 'action.cardMoved', { reactive: true }));
  }, [board, layout, run, withPendingRect]);
  const resize = useCallback((cardId: CardId, size: GridSize) => {
    if (!board) return;
    const placement = layout?.placements.find((candidate) => candidate.cardId === cardId);
    if (!placement) return;
    void withPendingRect(cardId, { ...placement.rect, ...size },
      run((storage, workspaceId) => resizeCardOnBoard(storage, workspaceId, { boardId: board.id, cardId, size }), 'action.sizeChanged', { reactive: true }));
  }, [board, layout, run, withPendingRect]);

  // Alternativa accesible a arrastrar y usar las asas. `Pressable` consume flechas en web, por eso el
  // listener global usa captura y se restringe a la ficha seleccionada que conserva el foco.
  useEffect(() => {
    if (Platform.OS !== 'web' || multi !== null || !selectedOnBoard) return;
    const placement = layout?.placements.find((candidate) => candidate.cardId === selectedOnBoard.id);
    if (!placement) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const selectedElement = target?.closest(`[data-testid="card-${selectedOnBoard.id}"]`);
      if (!selectedElement || event.ctrlKey || event.metaKey || event.altKey) return;
      const delta = event.key === 'ArrowLeft' ? { x: -1, y: 0 }
        : event.key === 'ArrowRight' ? { x: 1, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: -1 }
        : event.key === 'ArrowDown' ? { x: 0, y: 1 }
        : null;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey) move(selectedOnBoard.id, { x: placement.rect.x + delta.x, y: placement.rect.y + delta.y });
      else {
        const size = { w: placement.rect.w + delta.x, h: placement.rect.h + delta.y };
        if (size.w >= 1 && size.h >= 1) resize(selectedOnBoard.id, size);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [layout, move, multi, resize, selectedOnBoard]);

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

  const { text: status, tone: statusTone } = saveStatus({
    mode: storageMode, saving, failed: feedback?.saveFailed === true, native: Platform.OS !== 'web',
    conflict: saveState === 'conflict', pending: hasPendingEdit,
  });
  // Un error/conflicto nunca usa el color de «guardado»; guardando/pendiente son neutros y la memoria volátil, aviso.
  const statusColor = statusTone === 'saved' ? colors.selection : statusTone === 'saving' || statusTone === 'pending' ? colors.textSecondary : colors.danger;
  const recoveryPending = saveState === 'error' || saveState === 'conflict';
  const saveIssue = saveIssues[0];
  const saveProblem = recoveryPending
    ? (saveIssues.length > 0 ? describeFailure(saveIssues, storageMode) : feedback?.text ?? 'No se pudieron confirmar los cambios pendientes.')
    : null;
  const saveProblemKind: 'conflict' | 'reselect' | 'retry' | null = saveState === 'conflict'
    ? 'conflict'
    : saveIssue && ['permission-denied', 'invalid-stored-data', 'workspace-not-found'].includes(saveIssue.code)
      ? 'reselect'
      : saveState === 'error' ? 'retry' : null;
  const hint = tool === 'pan' ? 'Mano: arrastra el lienzo para desplazarte. Las tarjetas no se mueven con esta herramienta.'
    : tool === 'connector'
      ? connectorStart ? 'Posición 1 marcada. Toca una segunda posición o una tarjeta para terminar el conector.'
        : 'Conector: toca una posición libre o una tarjeta para marcar la posición 1.'
    : tool === 'connect'
      ? connectSource ? `Origen: «${titleOrUntitled(workspace?.cards.find((card) => card.id === connectSource))}». Toca otra tarjeta para conectar o desconectar; toca el origen para cancelar.`
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
      onDraftChange={(draft) => { setPendingText(draft, authority); }}
      onBodyModeChange={transferBodyMode}
      flushPendingText={() => flushPendingText(authority ?? undefined)}
      onClose={() => { setEditingId(null); setInlineEditing(false); setSelectedId(null); }}
      onDisplay={(display) => changeDisplay(selected.id, display)}
      onTrash={() => void sendToTrash(selected.id)}
      onArchive={() => void archiveSelected(selected.id)}
      onSelectMany={boardView === 'canvas' && tool === 'select' ? () => void startMulti([selected.id]) : undefined}
      inSheet={compact}
      noteImages={previews.refs}
      noteFontFamily={noteFontFamily(preferences.noteFont, Platform.OS, customFontFamily)}
      richTextCodec={markdownRichTextCodec}
      htmlCodec={htmlRichTextCodec}
      initialDraft={recoveredText?.cardId === selected.id ? recoveredText : undefined}
      section={inspectorSection}
      onSectionChange={setInspectorSection}
      focused={focus}
      onToggleFocus={() => setFocus((current) => !current)}
      onOpenBoard={(target) => { setEditingId(null); setInlineEditing(false); void chooseBoard(target); }}
      onPickAssetImageRef={assetImagePicker.pick}
    />
  ) : null;
  const inspector = frameInspector ?? cardInspector;
  const focusing = focus && cardInspector !== null;
  // Cerrar el editor guarda antes el borrador (mismo camino que el «Cerrar» del panel).
  const closeInspector = () => { void flushPendingText().then((saved) => { if (saved) { setEditingId(null); setInlineEditing(false); setSelectedId(null); setFrameId(null); setFocus(false); } }); };
  const saveInlineCard = useCallback(async (draft: EditableCardDraft) => {
    if (!setPendingText(draft, authority)) return true;
    return flushPendingText(authority ?? undefined);
  }, [authority, flushPendingText, setPendingText]);
  // UX7-B2: marcar/desmarcar desde el lienzo reutiliza la misma regla que el editor y el mismo caso de
  // uso de guardado; no abre el editor ni cambia la selección. Un cuerpo HTML seguro (ADR 0066) marca la
  // posición entre casillas del documento (`toggleRichTextChecklistItem`), no una línea de Markdown.
  const toggleCheck = (cardId: CardId, lineIndex: number) => {
    const target = workspace?.cards.find((candidate) => candidate.id === cardId);
    if (!target) return;
    if (target.contentDocument !== undefined) {
      const next = toggleRichTextChecklistItem(target.contentDocument, lineIndex);
      if (next === null) return;
      void run((storage, workspaceId) => editCardContent(storage, workspaceId, cardId, { contentDocument: next }), 'action.textSaved', { reactive: true });
      return;
    }
    const next = toggleChecklistLine(target.content ?? '', lineIndex);
    if (next === null) return;
    void run((storage, workspaceId) => editCardContent(storage, workspaceId, cardId, { content: next }), 'action.textSaved', { reactive: true });
  };

  // Estado de exportación del ZIP y su botón: siempre en su propia franja (`exportBar`), nunca
  // dentro de una cabecera (UX7-LAYOUT), en cualquier ancho.
  const exportStatus = (
    <Text testID="export-status" accessibilityLiveRegion="polite" numberOfLines={3}
      style={[styles.exportStatus, compact ? styles.exportStatusCompact : styles.exportStatusHeader, { color: unexported ? colors.textPrimary : colors.textSecondary }]}>
      {unexported ? 'CAMBIOS SIN EXPORTAR · Exporta un ZIP para conservarlos al recargar o cerrar.' : 'SIN CAMBIOS PENDIENTES DE EXPORTAR'}
    </Text>
  );
  const exportButton = <ActionButton label={exportDraftWarning ? 'Exportar solo lo guardado' : 'Exportar ZIP'} accessibilityLabel={exportDraftWarning ? 'Continuar exportando sin los borradores privados' : 'Exportar este espacio como ZIP'} tone={unexported ? 'primary' : 'default'} onPress={exportZip} />;

  /**
   * UX7-LAYOUT: la cabecera superior desaparece como región de interfaz permanente (sin borde ni
   * fondo propios, sin botones de acción). Solo queda identidad + dos señales persistentes que un
   * menú cerrado volvería engañosas si se escondieran (irían a 0/invisible aunque el estado real
   * fuera otro): «Volver a mis espacios» (navegación básica, probada en toda la suite por su nombre
   * accesible) y la insignia de recuperación (su presencia/ausencia es la señal, no solo la acción
   * de abrirla). Guardar y Proyectos —acciones puntuales, no señales continuas— se trasladan de
   * verdad a la navegación: barra lateral (≥1100 px) o barra de herramientas del lienzo —su
   * `trailing`, ya existente sin usar— en los demás anchos. **Ninguna fila vive ya encima del
   * lienzo**: la barra de herramientas es el primer elemento del área de trabajo (sin barra
   * lateral) o el lienzo lo es (con ella, donde identidad/estado viven en la propia barra
   * lateral). Ningún texto/aviso de guardado se declara antes de que `saveStatus()` confirme que
   * corresponde (ver `saveStatus.ts`).
   */
  const backButton = <ActionButton label="←" accessibilityLabel="Volver a mis espacios" disabled={leavingHome} onPress={() => void goHome()} />;
  const identityHeading = workspace ? (
    <Text accessibilityRole="header" numberOfLines={1} style={[styles.identityTitle, { color: colors.textPrimary }]}>
      {workspace.metadata.name}
    </Text>
  ) : null;
  /**
   * UX7-CONSOLIDATION (sustituye el criterio de UX7-SIDEBAR): Recuperación deja de ser una entrada
   * permanente de la navegación. La incidencia real (fallo/conflicto de guardado, o un borrador
   * huérfano cuya tarjeta está en Papelera/Archivo/eliminada — `draftProblem`, con riesgo real de
   * perderse) se anuncia de forma contextual y clara bajo el nombre del proyecto, en el mismo lugar
   * donde ya vivía el estado de guardado (`identityStatus`) — no en un punto de color aparte. Fuera
   * de una incidencia, Recuperación sigue siendo alcanzable de forma estable desde Configuración
   * (`SettingsPanel`), nunca oculta ni en riesgo: ningún borrador histórico deja de ser recuperable
   * por no tener ya una entrada de navegación dedicada.
   */
  const draftAttention = draftProblem !== null || saveState === 'error' || saveState === 'conflict';
  const recoveryReason = saveState === 'conflict' ? 'Conflicto de cambios · Revisar'
    : saveState === 'error' ? 'Error al guardar · Revisar'
    : draftProblem !== null ? 'Borrador por revisar · Revisar'
    : null;
  const identityStatus = workspace ? (draftAttention && recoveryReason ? (
    <Pressable
      testID="save-issue"
      accessibilityRole="button"
      accessibilityLabel={saveState === 'conflict' ? 'Conflicto de cambios. Revisar recuperación'
        : saveState === 'error' ? 'Error al guardar. Revisar recuperación'
        : 'Hay un borrador por revisar. Abrir el Centro de recuperación'}
      onPress={() => setRecoveryOpen(true)}
      style={({ pressed }) => [styles.saveIssue, { borderColor: colors.danger, backgroundColor: pressed ? colors.surfaceRaised : 'transparent' }]}
    >
      <Text numberOfLines={1} style={[styles.memoryText, { color: colors.danger }]}>{recoveryReason}</Text>
    </Pressable>
  ) : (
    <Text testID="workspace-memory" numberOfLines={1} style={[styles.memoryText, { color: statusColor }]}>{status}</Text>
  )) : null;

  const exportBar = showArchive && workspace ? (
    <View testID="export-bar" style={[styles.exportBar, compact ? styles.exportBarCompact : null, { backgroundColor: colors.surface, borderColor: colors.gridLine }]}>
      <View style={styles.exportRow}>
        {exportStatus}
        {exportButton}
      </View>
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

  // UX7-MASTER: la franja ya no anuncia NADA rutinario — ni confirmaciones de éxito («Texto
  // guardado», «Tarjeta movida», «Tamaño cambiado», «Guardado en la carpeta»...) ni «N cambios
  // pendientes» (ese estado ya lo refleja, de forma discreta y sin franja propia, el indicador de
  // guardado de la navegación — `identityStatus`/`saveStatus()` — duplicarlo aquí era exactamente
  // la franja dinámica que se pidió retirar). Lo único que sigue viviendo aquí es información que
  // de verdad exige al usuario hacer algo: guía de una herramienta activa en uso (mano/conector/
  // conectar) o un error real de guardado/conflicto. Un éxito rutinario (`feedback?.tone ===
  // 'success'`) nunca llega aquí.
  const feedbackContent = tool === 'pan' || tool === 'connector' || tool === 'connect' || connectSource !== null ? hint
    : feedback?.tone === 'error' && feedback.saveFailed !== true ? feedback.text
    : null;
  const feedbackText = workspace && feedbackContent ? (
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
      {feedbackContent}
    </Text>
  ) : null;
  // UX7-LAYOUT-CORRECTION: deshacer/rehacer/pegar ya no viven sueltos aquí (ADR 0026/0052
  // superada) — son un grupo más de la propia barra de herramientas del lienzo, en cualquier
  // ancho (ver `Toolbar.tsx`). Esta línea ahora solo existe cuando hay algo real que decir.
  const feedbackLine = feedbackText;

  // UX7-LAYOUT-CORRECTION: sin barra lateral (< 1100 px), no hay ninguna fila encima del lienzo.
  // En compacto (< 800 px), identidad/estado/recuperación caben al final de la propia barra de
  // herramientas (`trailing`, ya existente sin usar) porque esa barra vive bajo el lienzo, no
  // encima: añadirlos ahí no crea ninguna fila nueva sobre el contenido. Entre 800 y 1099 px la
  // barra de herramientas SÍ vive sobre el lienzo (como exige el encargo) y ya está muy ocupada
  // con las secciones que no caben en una barra lateral que no existe a este ancho: meter aquí
  // también identidad/Proyectos/Guardar la desbordaba a una fila propia que, aunque técnicamente
  // formara parte del componente, se veía exactamente como la cabecera retirada. Por eso, a este
  // ancho, todo vive en «Más secciones» (nuevo botón «menú» en esta misma barra), igual que en
  // compacto — nunca como una fila nueva.
  // «Volver a mis espacios» no depende de `workspace` (debe funcionar también en la vista «Espacio
  // no disponible»); el resto de la identidad sí necesita un workspace cargado.
  const toolbarIdentity = compact ? (
    <View style={styles.toolbarExtras}>
      {backButton}
      {workspace ? (
        <>
          {identityHeading}
          {identityStatus}
        </>
      ) : null}
    </View>
  ) : null;
  const toolbar = workspace ? (
    <Toolbar
      compact={compact}
      tool={tool}
      onTool={changeTool}
      onOpenInsert={() => setInsertOpen(true)}
      onInsertShortcut={() => setShortcutOpen(true)}
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
      trailing={toolbarIdentity}
    />
  ) : null;

  const placeBar = workspace && placeOffer && placeOffer.boardId === board?.id ? (
    <View testID="place-offer" style={[styles.offer, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
      <Text style={[styles.offerText, { color: colors.textPrimary }]}>{`«${placeOffer.title}» está en este tablero pero no tiene posición. Sus datos no cambian hasta que la coloques.`}</Text>
      <ActionButton label="Colocar en un hueco libre" tone="primary" accessibilityLabel={`Colocar ${placeOffer.title} en un hueco libre`} onPress={placeCard} />
      <ActionButton label="Ahora no" accessibilityLabel="No colocar la tarjeta" onPress={() => setPlaceOffer(null)} />
    </View>
  ) : null;

  // Barra de la selección múltiple (ADR 0025; UX7-A1/A2; UX7-REFINEMENT-D):
  // una sola fila flotante sobre el lienzo (no reflow): recuento, Más (Todas/Copiar/Cortar/
  // Duplicar/Agrupar), Archivar, Papelera y Cancelar. Mover el conjunto usa las flechas del
  // teclado (ver el efecto más arriba), no botones.
  const multiBar = workspace && multi !== null ? (
    <View testID="multi-bar" accessibilityRole="toolbar" accessibilityLabel="Selección múltiple"
      accessibilityHint={multiIds.length > 0 ? 'Usa las flechas del teclado para mover el conjunto una celda' : undefined}
      style={[styles.multiBar, { borderColor: colors.selection, backgroundColor: colors.surface }]}>
      <View style={styles.multiRow}>
        <Text testID="multi-count" accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.multiCount, { color: colors.textPrimary }]}>
          {multiIds.length === 0 ? 'NINGUNA' : plural(multiIds.length, '1 SELECCIONADA', '# SELECCIONADAS')}
        </Text>
        {multiIds.length > 0 ? (
          <>
            <ToolButton testID="multi-more" icon="menu" label="Más" accessibilityLabel="Más acciones sobre la selección" onPress={() => setMultiMoreOpen(true)} style={styles.multiToolCell} />
            <ToolButton icon="archive" label="Archivar" accessibilityLabel={plural(multiIds.length, 'Archivar la seleccionada', 'Archivar las # seleccionadas')} onPress={() => void archiveMany()} style={styles.multiToolCell} />
            <ToolButton icon="trash" label="Papelera" accessibilityLabel={plural(multiIds.length, 'Enviar la seleccionada a la Papelera', 'Enviar las # seleccionadas a la Papelera')} onPress={() => void trashMany()} style={styles.multiToolCell} />
          </>
        ) : null}
        <ActionButton label="Cancelar" accessibilityLabel="Cancelar la selección" onPress={() => setMulti(null)} />
      </View>
    </View>
  ) : null;

  const multiMoreSheet = workspace && multi !== null ? (
    <Dialog visible={multiMoreOpen} title="Más acciones" compact={compact} onClose={() => setMultiMoreOpen(false)} testID="multi-more-sheet">
      <ActionButton label="Seleccionar todas" accessibilityLabel="Seleccionar todas las tarjetas del tablero"
        onPress={() => { setMulti(layout?.placements.map((placement) => placement.cardId) ?? []); setMultiMoreOpen(false); }} />
      {multiIds.length > 0 ? (
        <>
          <ActionButton label="Copiar" accessibilityLabel={plural(multiIds.length, 'Copiar la seleccionada', 'Copiar las # seleccionadas')}
            onPress={() => { copyMany(); setMultiMoreOpen(false); }} />
          <ActionButton label="Cortar" accessibilityLabel={plural(multiIds.length, 'Cortar la seleccionada', 'Cortar las # seleccionadas')}
            onPress={() => { void cutMany(); setMultiMoreOpen(false); }} />
          <ActionButton label="Duplicar" accessibilityLabel={plural(multiIds.length, 'Duplicar la seleccionada', 'Duplicar las # seleccionadas')}
            onPress={() => { void duplicateMany(); setMultiMoreOpen(false); }} />
          <ActionButton label="Agrupar en un marco" accessibilityLabel={plural(multiIds.length, 'Agrupar la seleccionada en un marco', 'Agrupar las # seleccionadas en un marco')}
            onPress={() => { void groupMany(); setMultiMoreOpen(false); }} />
        </>
      ) : null}
    </Dialog>
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
        fitRequest={boardFitRequest}
        layoutReady={width !== null}
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
        // UX7-CONSOLIDATION: las etiquetas se movieron de «Más» a «Contenido» en el Inspector — este
        // acceso directo debe seguir apuntando a donde viven de verdad.
        onCardTags={(cardId) => void editCard(cardId, 'content')}
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
        onCreateAt={(point) => { void add('note', {}, { ...point, columns: 1 }); }}
        canPaste={clipboard !== null}
        onPasteAt={(point) => { void pasteClipboardAt(point); }}
        onPasteImageAt={(point) => { void pasteImageAt(point); }}
        boardTitle={board?.title ?? 'sin tableros'}
        unplaced={unplaced}
        noteImages={previews.refs}
        imageResources={previews.cardResources}
        noteImageResources={previews.refResources}
        onCardOpen={(cardId) => void openCard(cardId)}
        inlineEditingId={inlineEditing ? editingId : null}
        richTextCodec={markdownRichTextCodec}
        htmlCodec={htmlRichTextCodec}
        inlineDraft={recoveredText?.cardId === editingId ? recoveredText : undefined}
        onInlineDraftChange={(draft) => { setPendingText(draft, authority); }}
        onInlineSave={saveInlineCard}
        onPickAssetImageRef={assetImagePicker.pick}
        onPlaceImage={placeInlineNoteImage}
        onPlaceImageDocument={placeInlineNoteImageDocument}
        onInlineClose={() => { setEditingId(null); setInlineEditing(false); setFocus(false); }}
        onInlineAdvanced={(cardId) => {
          showCardInspector(cardId, 'content', true);
        }}
        onDisplay={(cardId, display) => changeDisplay(cardId, display)}
        onCardCopy={copyCard}
        onCardDuplicate={(cardId) => { void duplicateCard(cardId); }}
        onCardToggleFrame={(cardId) => { void toggleCardFrame(cardId); }}
        onCardPaste={() => { void pasteClipboard(); }}
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
          imageResources={previews.cardResources} noteImageResources={previews.refResources} />
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
      onOrganize={() => setBoardOrganizerOpen(true)}
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
        {/*
          UX7-SIDEBAR: tres regiones — superior fija (identidad), central desplazable (secciones)
          e inferior fija (Proyectos/Recuperación/Guardar). Antes, un único `ScrollView` envolvía
          todo: desplazar la lista central se llevaba consigo el logo y las acciones. Ahora el
          scroll solo afecta a la región B; A y C son `View` normales fuera de cualquier
          `ScrollView`, así que nunca se mueven.
        */}
        {sidebar ? (
          <View testID="workspace-sidebar" style={[styles.sidebar, { width: preferences.leftSidebarWidth, backgroundColor: colors.surface, borderColor: colors.gridLine }]}>
            <View style={styles.sidebarTop}>
              <View style={styles.brandRow}>
                <BrandMark size={44} />
                <Text style={[styles.brandName, { color: colors.brand }]}>NoutyNotes</Text>
              </View>
              {/* «Volver a mis espacios» es navegación básica: debe seguir disponible incluso sin
                  workspace cargado (p. ej. tras recargar un espacio en memoria/carpeta reconectable,
                  vista «Espacio no disponible») — regresión real encontrada al reestructurar esta
                  región, corregida sacando el botón de la condición `workspace`. */}
              <View style={styles.sidebarIdentity}>
                {backButton}
                {identityHeading}
              </View>
              {identityStatus}
            </View>
            {workspace ? (
              <ScrollView testID="workspace-sidebar-nav"
                style={[styles.sidebarNav, Platform.OS === 'web' ? { scrollbarGutter: 'stable' } as object : null]}
                contentContainerStyle={styles.sidebarNavContent}>
                {/* UX7-CONSOLIDATION (Hito C) + UX7-D-FIX: Inicio vuelve al lienzo del tablero activo;
                    el resto conserva su orden por frecuencia — Diario, Assets, Archivo, Presentar, Imprimir,
                    Papelera. Papelera pasa al final: es la sección de menor frecuencia de uso cotidiano,
                    no la primera que alguien busca al abrir la barra. */}
                <NavItem testID="nav-home" icon="home" label={t("nav.home", locale)} accessibilityLabel={t("nav.home.open", locale)} disabled={returningToBoard} onPress={() => void returnToBoard()} />
                <NavItem icon="diary" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => openView('diary')} />
                <NavItem icon="assets" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => openView('assets')} />
                <NavItem icon="archive" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => openView('archive')} />
                <NavItem icon="present" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => setPresentOpen(true)} />
                {Platform.OS === "web" || supportsNativePrint() ? <NavItem icon="print" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => printBoard()} /> : null}
                <NavItem icon="trash" label={t("nav.trash", locale)} count={trashCount} accessibilityLabel={`${t("nav.trash.open", locale)} (${trashCount})`} onPress={() => setTrashOpen(true)} />
                {/* UX7-CONSOLIDATION: «Archivar tablero» ya vive en la barra lateral derecha (Opciones
                    del tablero → BoardActionsDialog) a este mismo ancho — repetirlo aquí era un
                    duplicado real, no dos superficies con propósitos distintos. En compacto/tablet
                    (sin barra derecha) la versión de «Más secciones» sigue siendo la única vía y se
                    conserva sin cambios. */}
              </ScrollView>
            ) : null}
            {workspace ? (
              <View style={styles.sidebarBottom}>
                <View style={[styles.navRule, { backgroundColor: colors.gridLine }]} />
                {/* UX7-CONSOLIDATION (Hito C): orden definitivo de la región inferior — Proyectos,
                    Guardar, Configuración (última entrada; se usa con poca frecuencia pero debe seguir
                    siendo fácil de encontrar sin desplazar la lista central). «Recuperación» no es una
                    entrada de navegación propia (ver `identityStatus` arriba y «Centro de recuperación»
                    dentro de Configuración, siempre disponible). */}
                <NavItem icon="folder" label="Proyectos" accessibilityLabel="Cambiar de proyecto" onPress={() => setProjectsOpen(true)} />
                <NavItem icon="check" label={savingNow ? 'Guardando…' : 'Guardar'} accessibilityLabel="Guardar ahora (Ctrl+S)" onPress={() => void saveNow()} />
                <NavItem icon="settings" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => setSettingsOpen(true)} />
              </View>
            ) : null}
          </View>
        ) : null}
        {sidebar ? (
          <ResizeHandle
            testID="left-sidebar-resize"
            label="Ajustar ancho de la barra izquierda"
            value={preferences.leftSidebarWidth}
            limits={PREFERENCE_LIMITS.leftSidebarWidth}
            direction={1}
            onChange={(leftSidebarWidth) => setPreferences((current) => ({ ...current, leftSidebarWidth }))}
          />
        ) : null}
        <View style={styles.main}>
          {/* Sin barra lateral (< 1100 px) y sin workspace cargado (cargando o «no disponible»),
              «Volver a mis espacios» no vive en ningún otro sitio todavía —la barra de herramientas,
              donde vive el resto del ancho, necesita un workspace real para existir—. Regresión real
              encontrada al mover la identidad a la barra de herramientas: antes vivía en una fila
              siempre presente, independiente de si había workspace. Con workspace cargado, ya está
              en la barra lateral o en la propia barra de herramientas; no se duplica aquí. */}
          {!sidebar && !workspace ? <View style={styles.sidebarIdentity}>{backButton}</View> : null}
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
          {workspace && visitedViews.has('diary') ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'diary' ? styles.hidden : null]}>
              <DiaryView
                active={mainView === 'diary'}
                compact={compact}
                workspace={workspace}
                run={run}
                onGo={(cardId) => { void flushPendingText().then((ok) => { if (ok) revealCard(cardId); }); }}
                onBack={() => void returnToBoard()}
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
                onBack={() => void returnToBoard()}
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
                onBack={() => void returnToBoard()}
              />
            </View>
          ) : null}
          {workspace ? (
            <View style={[styles.workArea, compact ? styles.workCompact : styles.workWide, mainView !== 'board' ? styles.hidden : null]}>
              {/* Enfocado en móvil: el editor usa todo el alto (sin pestañas ni barra del ZIP). */}
              {compact && focusing ? null : tabs}
              {/* UX7-LAYOUT-CORRECTION: ninguna fila nueva reemplaza al tablero/recuento que vivían
                  en la cabecera retirada — ya es información del tablero, no del lienzo: `tabs`
                  (pestañas, con el número de tarjetas por tablero) cubre 800-1099 px y compacto; en
                  ≥1100 px vive en la barra lateral derecha (`BoardRail`, conservada). */}
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
                    <Text accessibilityRole="header" numberOfLines={1} style={[styles.sheetTitle, { color: colors.textPrimary }]}>{frame ? frame.title : titleOrUntitled(selected)}</Text>
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
                    <DialogCloseButton label={t(frame ? 'inspector.sheet.close.frame.accessibilityLabel' : 'inspector.close.accessibilityLabel', locale)} onPress={closeInspector} />
                  </View>
                  {/* Oculto, sigue montado: el texto sin guardar no se pierde. */}
                  <ScrollView ref={sheetScroll} onScroll={onSheetScroll} scrollEventThrottle={32} style={sheetHidden ? styles.hidden : null} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{inspector}</ScrollView>
                </View>
              ) : null}
              {/* UX7-LAYOUT-CORRECTION: la barra ya no se oculta solo por enfocar/seleccionar una
                  tarjeta — es la única vía compacta hacia «Más secciones» (Proyectos/Guardar/
                  Recuperación no viven en ninguna fila permanente encima). UX7.3-C (defecto
                  confirmado, pendiente de decisión de producto): `typing` solo puede ser cierto en
                  nativo (`useKeyboardInset` devuelve siempre 0 en web; aquí, con el teclado real del
                  sistema cubriendo pantalla, la barra completa SÍ se oculta — y con ella la única vía
                  a «Más secciones» — para dejar sitio a la hoja del editor). En web esta rama nunca se
                  activa, así que no hay forma de confirmarla ni corregirla con una prueba de
                  navegador; sin un dispositivo Android/iOS real no se puede afirmar qué ocurre ahí.
                  Qué (si algo) debería seguir accesible durante ese tramo no está decidido todavía;
                  ver Docs/knowledge/UX7-CANVAS-EXPERIENCE.md (sección I, inventario de la barra). */}
              {compact && !typing ? toolbar : null}
            </View>
          ) : null}
        </View>
        {/* Barra lateral derecha de tableros (ADR 0048): conservada tal como funcionaba antes de
            UX7-CLEANUP, por instrucción explícita — no se sustituye por un botón en la barra de
            herramientas. */}
        {sidebar && workspace ? (
          <>
            <ResizeHandle
              testID="board-rail-resize"
              label="Ajustar ancho de la barra de tableros"
              value={preferences.boardRailWidth}
              limits={PREFERENCE_LIMITS.boardRailWidth}
              direction={-1}
              onChange={(boardRailWidth) => setPreferences((current) => ({ ...current, boardRailWidth }))}
            />
            <BoardRail width={preferences.boardRailWidth} boards={workspace.boards} current={board?.id} onSelect={(next) => void chooseBoard(next)} onCreate={createBoard}
              onActions={setBoardActionsId} onOrganize={() => setBoardOrganizerOpen(true)}
              onReorder={(target, index) => void reorderBoardById(target, index)} />
          </>
        ) : null}
      </View>
      {workspace ? (
        <>
          <ProjectSheet
            projects={summaries}
            currentId={id}
            onOpen={(next) => void openSpace(next)}
            storage={session.storage}
            onCreated={onProjectCreated}
            onOpenOtherProject={(entry) => void onOpenOtherProject(entry)}
            locale={locale}
            visible={projectsOpen}
            onClose={() => setProjectsOpen(false)}
          />
          {boardOrganizerOpen ? (
            <BoardOrganizerDialog
              boards={workspace.boards}
              current={board?.id}
              compact={compact}
              busy={saving}
              onClose={() => setBoardOrganizerOpen(false)}
              onRename={renameBoardById}
              onReorder={reorderBoardById}
              onActions={(target) => { setBoardOrganizerOpen(false); setBoardActionsId(target); }}
            />
          ) : null}
          {boardActions ? (
            <BoardActionsDialog
              key={boardActions.id}
              board={boardActions}
              boardIndex={workspace.boards.findIndex(({ id: candidateId }) => candidateId === boardActions.id)}
              boardCount={workspace.boards.length}
              compact={compact}
              busy={saving}
              onClose={() => setBoardActionsId(null)}
              onRename={(title) => renameBoardById(boardActions.id, title)}
              onReorder={(targetIndex) => reorderBoardById(boardActions.id, targetIndex)}
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
            onOpenRecovery={() => { setSettingsOpen(false); setRecoveryOpen(true); }}
            recoverableCount={recoverableCount}
            customFontStatus={customFontStatus}
            onClose={() => setSettingsOpen(false)}
          />
          {/* Sin barra lateral, «Más» reúne Inicio y las secciones/acciones que no caben (ADR 0022). */}
          <Dialog visible={moreOpen} title={t('more', locale)} compact={compact} onClose={() => setMoreOpen(false)} testID="more-sheet">
            {/* UX7-LAYOUT-CORRECTION: entre 800 y 1099 px no hay barra lateral y la barra de
                herramientas ya inlinea Papelera/Diario/Archivo/Assets/Presentar/Imprimir/
                Configuración (no caben en una barra lateral que no existe a este ancho) — así que
                aquí solo viven identidad/estado y la salida explícita a Inicio, para no duplicar
                las demás secciones. UX7-CONSOLIDATION:
                «Recuperación» ya no es una entrada propia; su incidencia (si la hay) ya se anuncia en
                `identityStatus`, y el acceso estable vive dentro de Configuración. */}
            {!sidebar && !compact ? (
              <View style={styles.toolbarExtras}>
                {identityHeading}
                {identityStatus}
              </View>
            ) : null}
            {/* UX7-CONSOLIDATION (Hito C) + UX7-D: mismo orden que la barra lateral — Inicio, Diario,
                Assets, Archivo, Presentar, Imprimir; «Archivar este tablero» es una acción puntual del
                tablero actual, no una sección de navegación, y se conserva junto a las demás acciones
                de tablero. Configuración pasa al final, después de Proyectos/Guardar, igual que en la
                región inferior fija de escritorio — antes aparecía antes de Proyectos/Guardar aquí, un
                orden distinto al de escritorio sin motivo. */}
            {!sidebar ? (
              <NavItem testID="more-nav-home" icon="home" label={t("nav.home", locale)} accessibilityLabel={t("nav.home.open", locale)} disabled={returningToBoard} onPress={() => void returnToBoard()} />
            ) : null}
            {compact ? (
              <>
                <NavItem icon="diary" label={t("nav.diary", locale)} accessibilityLabel={t("nav.diary.open", locale)} onPress={() => { setMoreOpen(false); openView('diary'); }} />
                <NavItem icon="assets" label={t("nav.assets", locale)} accessibilityLabel={t("nav.assets.open", locale)} onPress={() => { setMoreOpen(false); openView('assets'); }} />
                <NavItem icon="archive" label={t("nav.archive", locale)} count={archiveCount} accessibilityLabel={`${t("nav.archive.open", locale)} (${archiveCount})`} onPress={() => { setMoreOpen(false); openView('archive'); }} />
                <NavItem icon="present" label={t("nav.present", locale)} accessibilityLabel={t("nav.present.open", locale)} onPress={() => { setMoreOpen(false); setPresentOpen(true); }} />
                {Platform.OS === "web" || supportsNativePrint() ? <NavItem icon="print" label={t("nav.print", locale)} accessibilityLabel={t("nav.print.open", locale)} onPress={() => { setMoreOpen(false); printBoard(); }} /> : null}
                {board && board.cardIds.length > 0 ? (
                  <NavItem icon="archive" label={t("archive.navItem.label", locale)} accessibilityLabel={t("archive.navItem.accessibilityLabel", locale, { title: board.title })} onPress={() => { setMoreOpen(false); void archiveCurrentBoard(); }} />
                ) : null}
              </>
            ) : null}
            {/* Proyectos y Guardar: acciones puntuales, nunca una fila nueva sobre el lienzo —
                la barra de herramientas ya no se oculta al enfocar una tarjeta, así que «Más»
                sigue alcanzable incluso editando. */}
            <NavItem icon="folder" label="Proyectos" accessibilityLabel="Cambiar de proyecto" onPress={() => { setMoreOpen(false); setProjectsOpen(true); }} />
            <NavItem icon="check" label={savingNow ? 'Guardando…' : 'Guardar'} accessibilityLabel="Guardar ahora (Ctrl+S)" onPress={() => { setMoreOpen(false); void saveNow(); }} />
            {compact ? (
              <NavItem icon="settings" label={t("nav.settings", locale)} accessibilityLabel={t("nav.settings.open", locale)} onPress={() => { setMoreOpen(false); setSettingsOpen(true); }} />
            ) : null}
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
          <RecoveryCenter
            visible={recoveryOpen}
            compact={compact}
            workspace={workspace}
            drafts={recoverableDrafts}
            problem={draftProblem}
            saveProblem={saveProblem}
            saveProblemKind={saveProblemKind}
            onRetrySave={() => { void retry(); }}
            onRecoverExternal={() => { void recoverExternal(); }}
            onReconnectFolder={() => {
              void recentConnections.reconnectCurrentFolder().then((result) => {
                if (result.ok) setRecoveryOpen(false);
                else setFeedback({ tone: 'error', text: result.message });
              });
            }}
            onReselectFolder={() => {
              void recentConnections.connectNewFolder().then((result) => {
                if (result.ok) setRecoveryOpen(false);
                else setFeedback({ tone: 'error', text: result.message });
              });
            }}
            onRecover={(cardId) => {
              if (!recoverDraft(cardId)) return;
              setRecoveryOpen(false);
              setSelectedId(cardId);
              setEditingId(cardId);
              setInlineEditing(false);
              setFocus(true);
            }}
            onDiscard={(cardId) => void discardDrafts(cardId)}
            onClose={() => setRecoveryOpen(false)}
          />
          <LinkDialog visible={linkOpen} compact={compact} onCreate={addLink} onClose={() => setLinkOpen(false)} />
          <PdfPreview state={pdfPreview} locale={locale} onClose={closePdfPreview} />
          <AssetImagePickerDialog
            visible={assetImagePicker.visible}
            compact={compact}
            entries={assetImagePicker.entries}
            loading={assetImagePicker.loading}
            onSelect={assetImagePicker.select}
            onCancel={assetImagePicker.cancel}
          />
          {multiMoreSheet}
          <InsertMenu
            visible={insertOpen}
            compact={compact}
            onClose={() => setInsertOpen(false)}
            onNote={() => { setInsertOpen(false); void add('note'); }}
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
function NavItem({ icon, label, count, attention, testID, accessibilityLabel, disabled = false, onPress }: {
  readonly icon: AppIconName;
  readonly label: string;
  readonly count?: number;
  /**
   * UX7-SIDEBAR: señal discreta de atención (punto de color), no un número — para distinguir una
   * incidencia real (fallo de guardado, conflicto, borrador huérfano con problema real) de un
   * simple recuento informativo. Nunca ambos a la vez en el mismo ítem.
   */
  readonly attention?: string | undefined;
  readonly testID?: string;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.navItem, disabled ? styles.navItemDisabled : null, { borderColor: focused ? colors.selection : 'transparent', backgroundColor: pressed ? colors.surfaceRaised : 'transparent' }]}
    >
      <View style={styles.navGlyph}><AppIcon name={icon} size={20} color={colors.textPrimary} /></View>
      <Text numberOfLines={1} style={[styles.navLabel, { color: colors.textPrimary }]}>{label}</Text>
      {count !== undefined && count > 0 ? <Text style={[styles.navCount, { color: colors.textSecondary }]}>{count}</Text> : null}
      {attention ? <View testID={testID ? `${testID}-attention` : undefined} accessibilityElementsHidden style={[styles.navAttention, { backgroundColor: attention }]} /> : null}
    </Pressable>
  );
}

/**
 * Borrador de texto de la tarjeta en modo carpeta: se guarda antes de cambiar de selección, de
 * tablero o de espacio, y antes de volver al inicio (protección del borrador de fase 8).
 */
interface PendingEditorialText extends EditableCardDraft {
  readonly sequence: number;
  readonly surface: DraftSurface;
  readonly authority: EditorialAuthority;
}

interface EditorialAuthority {
  readonly cardId: CardId;
  readonly surface: DraftSurface;
  readonly title: EditorialSessionLease;
  readonly body: EditorialSessionLease;
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
  const conflicts = useRef(new Set<string>());
  const leases = useRef(new Map<string, EditorialSessionLease>());
  const authorityRef = useRef<EditorialAuthority | null>(null);
  const [authority, setAuthority] = useState<EditorialAuthority | null>(null);
  const [recoverableDrafts, setRecoverableDrafts] = useState<readonly EditorialDraft[]>([]);
  const [draftProblem, setDraftProblem] = useState<string | null>(null);
  // A qué tarjeta huérfana se refiere `draftProblem` (si a alguna): sin esto, un aviso de «esta nota
  // ya no existe/está en la Papelera/el Archivo» quedaba pegado para siempre tras resolverlo (ni
  // recuperar con éxito, ni descartar el borrador señalado, ni que ese borrador deje de listarse lo
  // limpiaban) — reaparecía como fantasma, sin botones de acción, cada vez que algo ajeno (guardar el
  // borrador privado de OTRA tarjeta) lo despejaba momentáneamente y la lista se volvía a leer.
  const draftProblemCardId = useRef<CardId | null>(null);
  const clearDraftProblem = useCallback(() => { draftProblemCardId.current = null; setDraftProblem(null); }, []);
  const [recoveredText, setRecoveredText] = useState<Omit<PendingEditorialText, 'sequence' | 'surface' | 'authority'> | null>(null);
  // Proyección reactiva de `pendingText` (UX7-SAVE): no es una segunda autoridad, solo un espejo de
  // si hay texto escrito todavía sin confirmar en el almacenamiento durable, para el indicador «Cambios
  // pendientes». `pendingText` sigue siendo la única fuente real; esto nunca se lee para decidir nada.
  const [hasPendingEdit, setHasPendingEdit] = useState(false);
  const setPendingRef = useCallback((value: PendingEditorialText | null) => {
    pendingText.current = value;
    setHasPendingEdit(value !== null);
  }, []);

  const refreshDrafts = useCallback(async () => {
    if (!workspace) { setRecoverableDrafts([]); return; }
    const listed = await session.drafts.list(workspace.id);
    if (!listed.ok) { setDraftProblem(listed.issues[0]?.message ?? 'No se pudieron leer los borradores recuperables.'); return; }
    setRecoverableDrafts(listed.value);
    // El borrador que motivó el aviso de tarjeta huérfana ya no está en la lista (se descartó, se
    // recuperó, o la tarjeta volvió a existir): el aviso ya no describe nada real, se limpia solo.
    const stillOrphaned = draftProblemCardId.current !== null
      && listed.value.some((draft) => draft.key.cardId === draftProblemCardId.current);
    if (draftProblemCardId.current !== null && !stillOrphaned) clearDraftProblem();
  }, [clearDraftProblem, session.drafts, workspace]);

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

  const ownsAuthority = useCallback((candidate: EditorialAuthority | null | undefined) => Boolean(candidate
    && session.editorialSessions.owns(candidate.title) && session.editorialSessions.owns(candidate.body)), [session.editorialSessions]);

  const activateSurface = useCallback((cardId: CardId, surface: DraftSurface): EditorialAuthority | null => {
    if (!workspace) return null;
    const card = workspace.cards.find((candidate) => candidate.id === cardId);
    if (!card) return null;
    const previous = authorityRef.current;
    if (previous && previous.cardId !== cardId) {
      session.editorialSessions.release(previous.title);
      session.editorialSessions.release(previous.body);
    }
    const draft = pendingText.current?.cardId === cardId ? pendingText.current : null;
    const titleDocument = draft?.titleDocument ?? {
      schemaVersion: 1 as const,
      blocks: [{ type: 'paragraph' as const, content: (draft?.title ?? cardTitleText(card)) ? [{ type: 'text' as const, text: draft?.title ?? cardTitleText(card) }] : [] }],
    };
    const durableHtml = card.contentDocument ? htmlRichTextCodec.serialize(card.contentDocument) : null;
    const content = draft?.content ?? (durableHtml?.ok ? durableHtml.value : card.content ?? '');
    const bodySource = draft?.bodySource ?? (card.contentDocument && durableHtml?.ok
      ? { format: 'html' as const, value: durableHtml.value }
      : { format: 'legacy-markdown' as const, value: content });
    const parsedBody = bodySource.format === 'rich-text' ? bodySource.value
      : bodySource.format === 'legacy-markdown' ? markdownRichTextCodec.parse(bodySource.value)
        : htmlRichTextCodec.parse(bodySource.value);
    const parsed = draft?.bodyDocument ?? card.contentDocument ?? parsedBody;
    const bodyDocument = 'ok' in parsed ? (parsed.ok ? parsed.value : null) : parsed;
    const acquireZone = (zone: 'title' | 'body') => {
      const key = createDraftKey(workspace.id, cardId, zone);
      const old = previous?.cardId === cardId ? previous[zone] : undefined;
      return old && session.editorialSessions.owns(old)
        ? session.editorialSessions.transfer(old, surface)
        : session.editorialSessions.acquire(key, surface, {
          source: zone === 'title' ? { format: 'rich-text', value: titleDocument } : bodySource,
          lastValidDocument: zone === 'title' ? titleDocument : bodyDocument,
          baseRevision: durableZoneRevision(cardId, zone), validation: { status: 'valid' }, persistence: 'saved',
        });
    };
    const titleResult = acquireZone('title');
    const bodyResult = acquireZone('body');
    if (!titleResult.ok || !bodyResult.ok) {
      if (titleResult.ok) session.editorialSessions.release(titleResult.value);
      if (bodyResult.ok) session.editorialSessions.release(bodyResult.value);
      setDraftProblem('Otra superficie mantiene la autoridad de edición de esta nota. Cambia de editor de forma explícita.');
      return null;
    }
    const next = { cardId, surface, title: titleResult.value, body: bodyResult.value } as const;
    leases.current.set(keyLabel(cardId, 'title'), next.title);
    leases.current.set(keyLabel(cardId, 'body'), next.body);
    authorityRef.current = next;
    setAuthority(next);
    if (draft) setPendingRef({ ...draft, surface, authority: next });
    const titleState = session.editorialSessions.read(next.title.key);
    const bodyState = session.editorialSessions.read(next.body.key);
    const currentTitleDocument = titleState?.source.format === 'rich-text' ? titleState.source.value : titleDocument;
    const titleBlock = currentTitleDocument.blocks.length === 1 ? currentTitleDocument.blocks[0] : undefined;
    setRecoveredText({
      cardId,
      title: titleBlock?.type === 'paragraph' ? cardTitleText({ titleRichText: titleBlock.content }) : cardTitleText(card),
      content: bodyState?.source.format === 'legacy-markdown' ? bodyState.source.value : content,
      titleDocument: currentTitleDocument,
      bodySource: bodyState?.source ?? bodySource,
      ...(bodyState?.lastValidDocument ? { bodyDocument: bodyState.lastValidDocument } : bodyDocument ? { bodyDocument } : {}),
      bodyValidation: bodyState?.validation ?? { status: 'valid' },
    });
    return next;
  }, [durableZoneRevision, session.editorialSessions, setPendingRef, workspace]);

  const transferBodyMode = useCallback((mode: 'visual' | 'html'): boolean => {
    const current = authorityRef.current;
    if (!current || current.surface !== 'full' || !ownsAuthority(current)) return false;
    const transferred = session.editorialSessions.transfer(current.body, mode === 'html' ? 'html' : 'full');
    if (!transferred.ok) return false;
    const next: EditorialAuthority = { ...current, body: transferred.value };
    authorityRef.current = next;
    leases.current.set(keyLabel(current.cardId, 'body'), next.body);
    if (pendingText.current?.cardId === current.cardId) setPendingRef({ ...pendingText.current, authority: next });
    setAuthority(next);
    return true;
  }, [ownsAuthority, session.editorialSessions, setPendingRef]);

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
      if (!titleSaved.ok) { session.editorialSessions.update(draft.authority.title, { persistence: 'error' }); setDraftProblem(`${titleSaved.issues[0]?.message ?? 'No se pudo proteger el título.'} El texto continúa en memoria mientras esta pantalla permanezca abierta.`); return; }
      generations.current.set(titleLabel, titleSaved.value.generation);
      session.editorialSessions.update(draft.authority.title, { draftGeneration: titleSaved.value.generation, persistence: 'protected' });
      const bodySaved = await session.drafts.save({
        key: createDraftKey(workspace.id, draft.cardId, 'body'), source: draft.bodySource ?? { format: 'legacy-markdown', value: draft.content },
        baseRevision: bodyBase, validation: draft.bodyValidation ?? { status: 'valid' },
      });
      if (!bodySaved.ok) { session.editorialSessions.update(draft.authority.body, { persistence: 'error' }); setDraftProblem(`${bodySaved.issues[0]?.message ?? 'No se pudo proteger el cuerpo.'} El texto continúa en memoria mientras esta pantalla permanezca abierta.`); return; }
      generations.current.set(bodyLabel, bodySaved.value.generation);
      session.editorialSessions.update(draft.authority.body, { draftGeneration: bodySaved.value.generation, persistence: 'protected' });
      persistedSequence.current = draft.sequence;
      clearDraftProblem();
      await refreshDrafts();
    });
    privateTail.current = task.catch(() => { setDraftProblem('Falló el almacenamiento privado del borrador. El texto continúa en memoria mientras esta pantalla permanezca abierta.'); });
    return privateTail.current;
  }, [clearDraftProblem, durableZoneRevision, refreshDrafts, session.drafts, session.editorialSessions, workspace]);

  const flushPrivate = useCallback(async () => {
    if (privateTimer.current) { clearTimeout(privateTimer.current); privateTimer.current = null; }
    const draft = pendingText.current;
    if (draft) await persistPrivate(draft);
    await privateTail.current;
  }, [persistPrivate]);

  const flushPendingText = useCallback(async (requestedAuthority?: EditorialAuthority): Promise<boolean> => {
    if (requestedAuthority && !ownsAuthority(requestedAuthority)) return true;
    while (true) {
      if (requestedAuthority && !ownsAuthority(requestedAuthority)) return true;
      if (pendingSave.current) {
        if (!await pendingSave.current) return false;
        continue;
      }
      const draft = pendingText.current;
      if (!draft) return true;
      if (!ownsAuthority(draft.authority)) return true;
      if (draft.bodyValidation && draft.bodyValidation.status !== 'valid') {
        setDraftProblem(draft.bodyValidation.status === 'invalid'
          ? draft.bodyValidation.error.message
          : 'Aplica o descarta la fuente HTML antes de guardar el documento.');
        return false;
      }
      if (conflicts.current.has(keyLabel(draft.cardId, 'title')) || conflicts.current.has(keyLabel(draft.cardId, 'body'))) {
        session.editorialSessions.update(draft.authority.title, { persistence: 'conflict' });
        session.editorialSessions.update(draft.authority.body, { persistence: 'conflict' });
        setDraftProblem('El documento durable cambió desde que comenzó este borrador. Conservamos ambas versiones; copia el borrador o descártalo antes de continuar.');
        return false;
      }
      await flushPrivate();
      session.editorialSessions.update(draft.authority.title, { persistence: 'save-pending' });
      session.editorialSessions.update(draft.authority.body, { persistence: 'save-pending' });
      const confirmedGenerations = new Map(generations.current);
      const block = draft.titleDocument?.blocks.length === 1 ? draft.titleDocument.blocks[0] : undefined;
      const task: Promise<boolean> = run((storage, workspaceId) => editCardContent(storage, workspaceId, draft.cardId, {
        ...(block?.type === 'paragraph' ? { titleRichText: block.content.length > 0 ? block.content : null } : { title: draft.title }),
        ...(draft.bodySource?.format === 'html' && draft.bodyDocument
          ? { contentDocument: draft.bodyDocument }
          : { content: draft.content }),
      }), 'action.textSaved', { mergeKey: `text:${draft.cardId}`, reactive: true }).then(async (result) => {
        if (result.ok && workspace) {
          session.editorialSessions.update(draft.authority.title, { persistence: 'saved' });
          session.editorialSessions.update(draft.authority.body, { persistence: 'saved' });
          const confirmations: Promise<unknown>[] = [];
          for (const zone of ['title', 'body'] as const) {
            const label = keyLabel(draft.cardId, zone);
            const generation = confirmedGenerations.get(label);
            if (generation) confirmations.push(session.drafts.confirm(createDraftKey(workspace.id, draft.cardId, zone), generation, durableZoneRevision(draft.cardId, zone)));
          }
          await Promise.all(confirmations);
          if (pendingText.current === draft) {
            setPendingRef(null);
            setRecoveredText(null);
          }
          await refreshDrafts();
        }
        return result.ok;
      }).finally(() => { if (pendingSave.current === task) pendingSave.current = null; });
      pendingSave.current = task;
      if (!await task) return false;
    }
  }, [durableZoneRevision, flushPrivate, ownsAuthority, refreshDrafts, run, session.drafts, session.editorialSessions, setPendingRef, workspace]);

  const setPendingText = useCallback((draft: EditableCardDraft, requestedAuthority: EditorialAuthority | null = authorityRef.current) => {
    if (!requestedAuthority || requestedAuthority.cardId !== draft.cardId || !ownsAuthority(requestedAuthority)) return false;
    const titleDocument = draft.titleDocument ?? { schemaVersion: 1 as const, blocks: [{ type: 'paragraph' as const, content: draft.title ? [{ type: 'text' as const, text: draft.title }] : [] }] };
    session.editorialSessions.update(requestedAuthority.title, { source: { format: 'rich-text', value: titleDocument }, lastValidDocument: titleDocument, validation: { status: 'valid' }, persistence: 'protection-pending' });
    const bodySource = draft.bodySource ?? { format: 'legacy-markdown' as const, value: draft.content };
    const bodyValidation = draft.bodyValidation ?? { status: 'valid' as const };
    // Una edición Markdown válida también cambia el documento visual de la sesión. Antes solo se
    // actualizaba `lastValidDocument` cuando el editor entregaba `bodyDocument`; al volver a abrir la
    // misma Nota, la fuente contenía el texto nuevo pero el editor Visual priorizaba el documento
    // antiguo (a menudo vacío). Derivarlo aquí mantiene sincronizadas ambas representaciones sin
    // convertir ni reescribir todavía el documento durable.
    const parsedBody = draft.bodyDocument ?? (bodyValidation.status === 'valid'
      ? bodySource.format === 'rich-text'
        ? bodySource.value
        : bodySource.format === 'legacy-markdown'
          ? markdownRichTextCodec.parse(bodySource.value)
          : htmlRichTextCodec.parse(bodySource.value)
      : null);
    const currentBodyDocument = parsedBody && 'ok' in parsedBody
      ? (parsedBody.ok ? parsedBody.value : null)
      : parsedBody;
    session.editorialSessions.update(requestedAuthority.body, {
      source: bodySource,
      ...(currentBodyDocument ? { lastValidDocument: currentBodyDocument } : {}),
      validation: bodyValidation,
      persistence: 'protection-pending',
    });
    const next: PendingEditorialText = { ...draft, titleDocument, sequence: ++sequence.current, surface: requestedAuthority.surface, authority: requestedAuthority };
    setPendingRef(next);
    if (privateTimer.current) clearTimeout(privateTimer.current);
    privateTimer.current = setTimeout(() => { privateTimer.current = null; void persistPrivate(next); }, 250);
    return true;
  }, [ownsAuthority, persistPrivate, session.editorialSessions, setPendingRef]);

  useEffect(() => () => {
    if (privateTimer.current) clearTimeout(privateTimer.current);
    for (const lease of leases.current.values()) session.editorialSessions.release(lease);
  }, [session.editorialSessions]);

  const recoverDraft = useCallback((cardId: CardId): boolean => {
    const card = workspace?.cards.find((candidate) => candidate.id === cardId);
    const titleDraft = recoverableDrafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'title');
    const bodyDraft = recoverableDrafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'body');
    if (!card) {
      // La nota puede estar en la Papelera o el Archivo (recuperable restaurándola primero) en vez de
      // eliminada para siempre: antes solo se comprobaban las tarjetas activas, así que ambos casos
      // mostraban el mismo aviso de «eliminada», aunque uno sí tiene solución inmediata.
      const inTrash = workspace?.trash?.some((entry) => entry.card.id === cardId) ?? false;
      const inArchive = workspace?.archive?.some((entry) => entry.card.id === cardId) ?? false;
      draftProblemCardId.current = cardId;
      setDraftProblem(inTrash
        ? 'Esta nota está en la Papelera. Restáurala para recuperar el borrador; mientras tanto puedes copiarlo o descartarlo.'
        : inArchive
          ? 'Esta nota está en el Archivo. Restáurala para recuperar el borrador; mientras tanto puedes copiarlo o descartarlo.'
          : 'La nota ya no existe (se eliminó definitivamente). El borrador no puede recrearla; puedes copiarlo o descartarlo.');
      return false;
    }
    if (bodyDraft?.source.format === 'html' && Platform.OS !== 'web') {
      draftProblemCardId.current = cardId;
      setDraftProblem('Este borrador HTML se conserva como fuente exacta y no se reescribe mediante el editor Android transitorio. Puedes copiarlo o descartarlo.');
      return false;
    }
    // Esta tarjeta ya no es huérfana (existe y su borrador se va a recuperar): si el aviso visible
    // era justo sobre ella, deja de aplicar — nunca se limpiaba solo antes de este arreglo.
    if (draftProblemCardId.current === cardId) clearDraftProblem();
    const titleDocument = titleDraft?.source.format === 'rich-text' ? titleDraft.source.value : undefined;
    const titleBlock = titleDocument?.blocks.length === 1 ? titleDocument.blocks[0] : undefined;
    const title = titleBlock?.type === 'paragraph' ? cardTitleText({ titleRichText: titleBlock.content }) : cardTitleText(card);
    let content = card.content ?? '';
    let bodyDocument = card.contentDocument;
    if (bodyDraft?.source.format === 'legacy-markdown') content = bodyDraft.source.value;
    else if (bodyDraft?.source.format === 'html') {
      content = bodyDraft.source.value;
      const parsed = htmlRichTextCodec.parse(content);
      if (parsed.ok) bodyDocument = parsed.value;
    }
    else if (bodyDraft?.source.format === 'rich-text') {
      const encoded = markdownRichTextCodec.serialize(bodyDraft.source.value);
      if (encoded.ok) content = encoded.value;
    }
    for (const draft of [titleDraft, bodyDraft]) {
      if (!draft) continue;
      baseRevisions.current.set(keyLabel(cardId, draft.key.zone), draft.baseRevision);
      generations.current.set(keyLabel(cardId, draft.key.zone), draft.generation);
      if (session.drafts.conflicts(draft, durableZoneRevision(cardId, draft.key.zone))) {
        conflicts.current.add(keyLabel(cardId, draft.key.zone));
        setDraftProblem('El documento durable cambió desde que comenzó este borrador. Revísalo antes de guardar; no se fusionará automáticamente.');
      }
    }
    const recovered: EditableCardDraft = {
      cardId, title, content, ...(titleDocument ? { titleDocument } : {}),
      ...(bodyDraft ? { bodySource: bodyDraft.source, bodyValidation: bodyDraft.validation } : {}),
      ...(bodyDocument ? { bodyDocument } : {}),
    };
    const recoveredAuthority = activateSurface(cardId, 'full');
    if (recoveredAuthority) {
      if (bodyDraft?.source.format === 'html') transferBodyMode('html');
      setRecoveredText(recovered);
      setPendingText(recovered);
    }
    return true;
  }, [activateSurface, clearDraftProblem, durableZoneRevision, recoverableDrafts, session.drafts, setPendingText, transferBodyMode, workspace]);

  const discardDrafts = useCallback(async (cardId?: CardId) => {
    if (!workspace) return;
    const targets = recoverableDrafts.filter((draft) => cardId === undefined || draft.key.cardId === cardId);
    await Promise.all(targets.map((draft) => session.drafts.discard(draft.key, draft.generation)));
    for (const draft of targets) conflicts.current.delete(keyLabel(draft.key.cardId as CardId, draft.key.zone));
    if (cardId === undefined || pendingText.current?.cardId === cardId) { setPendingRef(null); setRecoveredText(null); }
    // Descartar es la resolución explícita del aviso: si hablaba de esta tarjeta (o se descartó todo),
    // debe desaparecer aquí mismo — antes quedaba pegado hasta que algo ajeno lo despejara sin querer.
    if (cardId === undefined || draftProblemCardId.current === cardId) clearDraftProblem();
    await refreshDrafts();
  }, [clearDraftProblem, recoverableDrafts, refreshDrafts, session.drafts, setPendingRef, workspace]);

  return {
    flushPendingText, setPendingText, activateSurface, transferBodyMode, authority, recoverableDrafts, recoverDraft, discardDrafts,
    draftProblem, recoveredText, hasPendingEdit,
  };
}

interface ResizeHandleProps {
  readonly testID: string;
  readonly label: string;
  readonly value: number;
  readonly limits: { readonly min: number; readonly max: number; readonly step: number };
  readonly direction: 1 | -1;
  readonly onChange: (value: number) => void;
}

function ResizeHandle(props: ResizeHandleProps) {
  return Platform.OS === 'web' ? <WebResizeHandle {...props} /> : <NativeResizeHandle {...props} />;
}

function WebResizeHandle({ testID, label, value, limits, direction, onChange }: ResizeHandleProps) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const pointerRef = useRef<number | null>(null);
  const pointerOrigin = useRef({ x: 0, value });
  const snap = (candidate: number) => {
    const clamped = Math.min(limits.max, Math.max(limits.min, candidate));
    return Math.min(limits.max, limits.min + Math.round((clamped - limits.min) / limits.step) * limits.step);
  };
  const onKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const screenDelta = event.key === 'ArrowRight' ? limits.step : -limits.step;
    onChange(snap(value + screenDelta * direction));
  };
  const lineColor = focused ? theme.colors.selection : theme.colors.border;
  return (
    <div role="slider" tabIndex={0} data-testid={testID} aria-label={label}
      aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={value} aria-valuetext={`${value} px`}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKeyDown}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        pointerRef.current = event.pointerId;
        pointerOrigin.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== event.pointerId) return;
        onChange(snap(pointerOrigin.current.value + (event.clientX - pointerOrigin.current.x) * direction));
      }}
      onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== event.pointerId) return;
        onChange(snap(pointerOrigin.current.value + (event.clientX - pointerOrigin.current.x) * direction));
        pointerRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { pointerRef.current = null; }}
      style={{
        width: 10, flex: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'col-resize', userSelect: 'none', touchAction: 'none', backgroundColor: theme.colors.surfaceRaised,
      }}>
      <div style={{ width: 2, height: '100%', backgroundColor: lineColor }} />
    </div>
  );
}

function NativeResizeHandle({ testID, label, value, limits, direction, onChange }: ResizeHandleProps) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const configRef = useRef({ value, limits, direction, onChange });
  const [responder, setResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);
  useEffect(() => {
    configRef.current = { value, limits, direction, onChange };
  }, [direction, limits, onChange, value]);
  useEffect(() => {
    const gesture = { origin: configRef.current.value };
    const snap = (candidate: number) => {
      const { limits: currentLimits } = configRef.current;
      const clamped = Math.min(currentLimits.max, Math.max(currentLimits.min, candidate));
      return Math.min(currentLimits.max, currentLimits.min + Math.round((clamped - currentLimits.min) / currentLimits.step) * currentLimits.step);
    };
    setResponder(PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, state) => Math.abs(state.dx) >= 2,
      onPanResponderGrant: () => { gesture.origin = configRef.current.value; },
      onPanResponderMove: (_event, state) => {
        const current = configRef.current;
        current.onChange(snap(gesture.origin + state.dx * current.direction));
      },
      onPanResponderRelease: (_event, state) => {
        const current = configRef.current;
        current.onChange(snap(gesture.origin + state.dx * current.direction));
      },
      onPanResponderTerminationRequest: () => false,
    }));
  }, []);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: limits.min, max: limits.max, now: value, text: `${value} px` }}
      {...responder?.panHandlers}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.resizeHandle, { backgroundColor: theme.colors.surfaceRaised }]}
    >
      <View style={[styles.resizeHandleLine, { backgroundColor: focused ? theme.colors.selection : theme.colors.border }]} />
    </Pressable>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  frame: { flex: 1 },
  frameRow: { flexDirection: 'row' },
  resizeHandle: { width: 10, flexGrow: 0, alignItems: 'center', justifyContent: 'center' },
  resizeHandleLine: { width: 2, height: '100%' },
  // UX7-SIDEBAR: columna de tres regiones — superior fija, central desplazable, inferior fija.
  sidebar: { width: 220, flexGrow: 0, flexDirection: 'column', borderRightWidth: 1 },
  sidebarTop: { flexShrink: 0, padding: 16, paddingBottom: 8, gap: 8 },
  // `minHeight: 0` (lección ya conocida de `Dialog.tsx` esta misma fase): sin esto, un `ScrollView`
  // dentro de una columna flex no se recorta a su espacio disponible y no llega a desplazarse.
  sidebarNav: { flex: 1, minHeight: 0 },
  sidebarNavContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  sidebarBottom: { flexShrink: 0, paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarIdentity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 },
  brandName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  sectionLabel: { fontFamily: mono, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 8 },
  navRule: { height: 2, marginVertical: 8 },
  navItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderWidth: 2 },
  navItemDisabled: { opacity: 0.55 },
  navGlyph: { width: 22, fontSize: 17, textAlign: 'center' },
  navLabel: { flex: 1, fontSize: 16, fontWeight: '800' },
  navCount: { fontSize: 13, fontWeight: '800' },
  navAttention: { width: 9, height: 9, borderRadius: 5 },
  main: { flex: 1, minWidth: 0 },
  // UX7-LAYOUT: ya no es una cabecera (sin fondo ni borde propios, sin botones de acción) — solo
  // identidad (volver + nombre) y dos señales de estado persistentes (guardado, recuperación).
  identityTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700' },
  title: { fontWeight: '900', letterSpacing: -0.5 },
  memoryText: { flexShrink: 1, fontFamily: mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  saveIssue: { minHeight: 32, alignSelf: 'flex-start', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  // `flexWrap` (no una sola línea rígida): «←» + título + estado + Proyectos/Guardar no siempre
  // caben en una fila; sin esto, el título (único elemento con `flexGrow`) se comprimía a 0 px de
  // ancho —invisible para Playwright aunque el nodo existiera— en vez de que el resto pasara a una
  // segunda línea (mismo defecto real ya encontrado y corregido una vez en `identityBar`).
  toolbarExtras: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4, flexShrink: 1, minWidth: 0 },
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
  feedback: { fontSize: 14, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1 },
  offer: { borderWidth: 2, padding: 8, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  offerText: { flexBasis: 220, flexGrow: 1, fontSize: 14, lineHeight: 19 },
  multiCount: { flexShrink: 1, minWidth: 0, fontFamily: mono, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  // UX7-REFINEMENT-CORRECTION: ancho ajustado a su contenido, no a todo el área de trabajo — una barra
  // contextual con 4-5 controles no debe ocupar el ancho entero del lienzo (captura 3 del usuario).
  multiBar: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 2, padding: 6, gap: 6 },
  multiRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  multiToolCell: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 5 },
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
