import { addCardTag, addNoteImage, assetsOf, connectCards, disconnectCards, editableCardContent, editCardAppearance, editConnectorPath, nudgeCardOnBoard, parseNoteBlocks, removeCardTag, resizeCardOnBoard, setCardLink, updateConnection, workspaceTags } from '@noutynotes/application';
import type { DraftSource, DraftValidation, RichTextCodec, WorkspaceStorageResult } from '@noutynotes/application';
import { addConnectorDetour, cardContentPresentation, cardIconNames, cardTitleText, connectorArrows, connectorDashes, connectorDirections, createOrthogonalConnectorPath, floatingTextAlignments, floatingTextColors, linkUrlField, moveConnectorPoint, removeConnectorPoint, resetConnectorPath, shapeFills, shapeKinds, shapeStrokes, shapeStrokeWidths } from '@noutynotes/domain';
import type { BoardId, Card, CardDisplayMode, CardIconName, CardPlacement, RelationArrow, RelationId, RichTextDocument, RichTextImage, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { AppIcon } from '../components/AppIcon';
import { t } from '../i18n';
import { formatCreated } from './dates';
import { describeFailure } from '../session/messages';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { cardTitle } from './Board';
import { applyInlineMark, applyListCommand, normalizeListChange, parseChecklistLine, toggleChecklistLine } from './markdownLists';
import { NoteBlocksEditor } from './NoteBlocksEditor';
import { openLink } from './openLink';
import { isBasicRichTextDocument, isNativeRichTextDocument, isWebRichTextDocument } from './basicRichText';
import { RichTextEditor } from './RichTextEditor';
import type { InlineMarkKind, ListKind, TextSelection } from './markdownLists';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';
import type { EditableCardDraft } from './editorialDraft';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface CardInspectorProps {
  readonly workspace: Workspace;
  readonly boardId: BoardId;
  readonly card: Card;
  readonly placement: CardPlacement | undefined;
  readonly run: Run;
  readonly onDraftChange: (draft: EditableCardDraft) => void;
  readonly onBodyModeChange: (mode: 'visual' | 'html') => boolean;
  readonly flushPendingText: () => Promise<boolean>;
  readonly initialDraft?: EditableCardDraft | undefined;
  readonly onClose: () => void;
  /** Representación y Papelera (ADR 0014, ADR 0015); los mismos caminos que la barra de la tarjeta. */
  readonly onDisplay: (display: CardDisplayMode) => void;
  readonly onTrash: () => void;
  /** Archivar (ADR 0023): sale de los tableros sin destruirse. */
  readonly onArchive: () => void;
  /** Selección múltiple (ADR 0025): empieza con esta tarjeta; en táctil es la única entrada. */
  readonly onSelectMany?: (() => void) | undefined;
  /** En la hoja móvil, la barra de la hoja ya muestra el título y «Cerrar»: no se repiten aquí. */
  readonly inSheet?: boolean;
  /** Imágenes intercaladas en notas, por ruta (ADR 0021). */
  readonly noteImages: ReadonlyMap<string, string>;
  /** Tipografía de las notas (ADR 0030), ya resuelta para esta plataforma. */
  readonly noteFontFamily?: string | undefined;
  /** Implementación inyectada en la composición; el componente no conoce storage. */
  readonly richTextCodec: RichTextCodec;
  readonly htmlCodec: RichTextCodec;
  /** Editor enfocado (ADR 0021): ampliar o volver al tablero. En la hoja móvil lo ofrece su barra. */
  readonly focused?: boolean;
  readonly onToggleFocus?: () => void;
  readonly onOpenBoard?: (boardId: BoardId) => void;
}

const displayKeys: readonly { display: CardDisplayMode; labelKey: 'inspector.display.expanded' | 'inspector.display.collapsed' | 'inspector.display.minimized' }[] = [
  { display: 'expanded', labelKey: 'inspector.display.expanded' },
  { display: 'collapsed', labelKey: 'inspector.display.collapsed' },
  { display: 'minimized', labelKey: 'inspector.display.minimized' },
];

const moveKeys = [
  { label: '←', nameKey: 'inspector.move.left', dx: -1, dy: 0 },
  { label: '→', nameKey: 'inspector.move.right', dx: 1, dy: 0 },
  { label: '↑', nameKey: 'inspector.move.up', dx: 0, dy: -1 },
  { label: '↓', nameKey: 'inspector.move.down', dx: 0, dy: 1 },
] as const;

const resizeKeys = [
  { labelKey: 'inspector.resize.width.label', nameKey: 'inspector.resize.width.name', dw: -1, dh: 0 },
  { labelKey: 'inspector.resize.widthPlus.label', nameKey: 'inspector.resize.widthPlus.name', dw: 1, dh: 0 },
  { labelKey: 'inspector.resize.height.label', nameKey: 'inspector.resize.height.name', dw: 0, dh: -1 },
  { labelKey: 'inspector.resize.heightPlus.label', nameKey: 'inspector.resize.heightPlus.name', dw: 0, dh: 1 },
] as const;

/** Catálogo ampliado de iconos de ficha (UX7-D5): mismo nombre que en `AppIcon`, con su etiqueta en español (ADR 0032: el editor de tarjeta no se traduce). */
const iconLabels: Record<CardIconName, string> = {
  note: 'Nota', image: 'Imagen', folder: 'Carpeta', link: 'Enlace', check: 'Tarea', star: 'Estrella',
  text: 'Texto', board: 'Tablero', diary: 'Diario', assets: 'Archivos', present: 'Presentar', print: 'Imprimir', settings: 'Ajustes',
};

function CardIconChoice({ icon, selected, onPress }: { readonly icon: CardIconName; readonly selected: boolean; readonly onPress: () => void }) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const colors = theme.colors;
  return (
    <Pressable
      testID={`card-icon-option-${icon}`}
      accessibilityRole="button"
      accessibilityLabel={`Usar icono ${iconLabels[icon]}`}
      accessibilityState={{ selected }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.iconChoice, {
        backgroundColor: selected ? colors.accent : pressed ? colors.surfaceRaised : colors.surface,
        borderColor: focused ? colors.selection : colors.border,
      }]}
    >
      <AppIcon name={icon} size={24} color={selected ? colors.accentText : colors.textPrimary} />
    </Pressable>
  );
}

/**
 * Editor de la tarjeta seleccionada. Cada botón despacha un caso de uso; los límites y colisiones
 * los decide el motor de grilla y los errores se muestran tal como los devuelve.
 */
export function CardInspector({ workspace, boardId, card, placement, run, onDraftChange, onBodyModeChange, flushPendingText, initialDraft, onClose, onDisplay, onTrash, onArchive, onSelectMany, inSheet = false, noteImages, noteFontFamily, richTextCodec, htmlCodec, focused = false, onToggleFocus, onOpenBoard }: CardInspectorProps) {
  const { mode } = useWorkspaceSession();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const cardBase = workspace.cardTypes.find((type) => type.id === card.typeId)?.base;
  const floatingText = cardBase === 'text';
  const shape = cardBase === 'shape';
  const connector = cardBase === 'connector';
  const connectorPath = placement?.connectorPath;
  const saveConnectorPath = (path: readonly { readonly x: number; readonly y: number }[]) =>
    run((storage, id) => editConnectorPath(storage, id, { boardId, cardId: card.id, connectorPath: path }), { label: 'Ruta del conector actualizada' }, { reactive: true });
  const presentation = cardContentPresentation(card, cardBase);
  const durableHtml = card.contentDocument ? htmlCodec.serialize(card.contentDocument) : null;
  const initialContent = initialDraft?.bodySource?.format === 'html' ? initialDraft.bodySource.value
    : durableHtml?.ok ? durableHtml.value : editableCardContent(card, cardBase);
  const [title, setTitle] = useState(initialDraft?.title ?? card.title ?? '');
  const [titleDocument, setTitleDocument] = useState<RichTextDocument>(() => initialDraft?.titleDocument ?? ({
    schemaVersion: 1,
    blocks: [{ type: 'paragraph', content: card.titleRichText ?? (initialDraft?.title ? [{ type: 'text', text: initialDraft.title }] : card.title ? [{ type: 'text', text: card.title }] : []) }],
  }));
  const [content, setContent] = useState(initialDraft?.content ?? initialContent);
  const initialBodyDocument = initialDraft?.bodyDocument ?? card.contentDocument ?? (() => {
    const parsed = richTextCodec.parse(editableCardContent(card, cardBase));
    return parsed.ok ? parsed.value : null;
  })();
  const originalBodySource = (() => {
    const source = initialDraft?.bodySource;
    // Un borrador HTML pendiente o inválido no puede ser también la base de su propio descarte.
    // En recuperación, la base segura es la representación durable que seguía vigente.
    if (source?.format === 'html' && initialDraft?.bodyValidation?.status !== 'valid') {
      return card.contentDocument && durableHtml?.ok
        ? { format: 'html' as const, value: durableHtml.value }
        : { format: 'legacy-markdown' as const, value: editableCardContent(card, cardBase) };
    }
    if (source?.format === 'html' || source?.format === 'legacy-markdown') return source;
    if (source?.format === 'rich-text') {
      const encoded = richTextCodec.serialize(source.value);
      return { format: 'legacy-markdown' as const, value: encoded.ok ? encoded.value : '' };
    }
    return card.contentDocument && durableHtml?.ok
      ? { format: 'html' as const, value: durableHtml.value }
      : { format: 'legacy-markdown' as const, value: editableCardContent(card, cardBase) };
  })();
  const [lastValidDocument, setLastValidDocument] = useState<RichTextDocument | null>(initialBodyDocument);
  const [htmlAuthored, setHtmlAuthored] = useState(originalBodySource.format === 'html');
  const [bodyMode, setBodyMode] = useState<'visual' | 'html'>(() => initialDraft?.bodySource?.format === 'html' && initialDraft.bodyValidation?.status !== 'valid' ? 'html' : 'visual');
  const [htmlValidation, setHtmlValidation] = useState<DraftValidation>(initialDraft?.bodyValidation ?? { status: 'valid' });
  const [htmlErrorPath, setHtmlErrorPath] = useState<string | null>(null);
  const [htmlModified, setHtmlModified] = useState(initialDraft?.bodySource?.format === 'html' && initialDraft.bodyValidation?.status !== 'valid');
  const [bodyDirty, setBodyDirty] = useState(false);
  const supportsVisualEditor = !shape && !connector && (Platform.OS === 'web' || Platform.OS === 'android');
  const supportsVisualDocument = (document: Parameters<typeof isBasicRichTextDocument>[0]) => Platform.OS === 'web'
    ? isWebRichTextDocument(document)
    : isNativeRichTextDocument(document);
  const [visualRequested, setVisualRequested] = useState(() => {
    if (!supportsVisualEditor) return false;
    return initialBodyDocument !== null && supportsVisualDocument(initialBodyDocument);
  });
  const selectionRef = useRef<TextSelection>({ start: content.length, end: content.length });
  const [forcedSelection, setForcedSelection] = useState<TextSelection | undefined>();
  const dirty = title !== cardTitleText(card) || bodyDirty;
  const parsedRichText = !htmlAuthored && supportsVisualEditor ? richTextCodec.parse(content) : null;
  const visualDocument = htmlAuthored ? lastValidDocument : parsedRichText?.ok ? parsedRichText.value : null;
  const visualAvailable = visualDocument !== null;
  const nativeHtmlReadOnly = Platform.OS !== 'web' && card.contentDocument !== undefined;
  const visualEditing = bodyMode === 'visual' && visualRequested && visualAvailable && !nativeHtmlReadOnly;
  const publishDraft = (next: { readonly title: string; readonly content: string; readonly titleDocument: RichTextDocument }, body?: {
    readonly source: DraftSource; readonly document: RichTextDocument | null; readonly validation: DraftValidation;
  }) => {
    setBodyDirty(true);
    const htmlBody = body ?? (htmlAuthored ? { source: { format: 'html' as const, value: next.content }, document: lastValidDocument, validation: htmlValidation } : null);
    onDraftChange({ cardId: card.id, ...next, ...(htmlBody ? {
      bodySource: htmlBody.source,
      ...(htmlBody.document ? { bodyDocument: htmlBody.document } : {}),
      bodyValidation: htmlBody.validation,
    } : {}) });
  };
  const changeTitleDocument = (document: RichTextDocument) => {
    const block = document.blocks.length === 1 ? document.blocks[0] : undefined;
    if (block?.type !== 'paragraph') return;
    setTitleDocument(document);
    const plain = cardTitleText({ titleRichText: block.content });
    setTitle(plain);
    publishDraft({ title: plain, content, titleDocument: document });
  };
  const changeContent = (value: string) => {
    if (floatingText) {
      setContent(value);
      publishDraft({ title, content: value, titleDocument });
      return;
    }
    const edit = normalizeListChange(content, value, selectionRef.current);
    const next = edit?.text ?? value;
    setContent(next);
    if (edit) setForcedSelection({ start: edit.caret, end: edit.caret });
    publishDraft({ title, content: next, titleDocument });
  };
  const changeVisualDocument = (document: Parameters<RichTextCodec['serialize']>[0]) => {
    const encoded = (htmlAuthored ? htmlCodec : richTextCodec).serialize(document);
    if (!encoded.ok || encoded.value === content) return;
    setLastValidDocument(document);
    setContent(encoded.value);
    publishDraft({ title, content: encoded.value, titleDocument }, htmlAuthored
      ? { source: { format: 'html', value: encoded.value }, document, validation: { status: 'valid' } } : undefined);
  };
  const htmlIssue = htmlValidation.status === 'invalid' ? htmlValidation.error : null;
  const validationFor = (source: string): { readonly document: RichTextDocument | null; readonly validation: DraftValidation; readonly path: string | null } => {
    const parsed = htmlCodec.parse(source);
    if (parsed.ok) return { document: parsed.value, validation: { status: 'pending' }, path: null };
    const issue = parsed.issues[0];
    return { document: null, validation: { status: 'invalid', error: {
      code: issue?.code ?? 'invalid-html', message: issue?.message ?? 'El HTML no es válido.',
    } }, path: issue?.path ?? null };
  };
  const openHtml = () => {
    if (Platform.OS !== 'web' || !visualDocument) return;
    const encoded = htmlCodec.serialize(visualDocument);
    if (!encoded.ok || !onBodyModeChange('html')) return;
    setHtmlAuthored(true);
    setLastValidDocument(visualDocument);
    setContent(encoded.value);
    setHtmlValidation({ status: 'valid' });
    setHtmlErrorPath(null);
    setHtmlModified(false);
    setBodyMode('html');
  };
  const changeHtml = (source: string) => {
    const checked = validationFor(source);
    setContent(source);
    setHtmlValidation(checked.validation);
    setHtmlErrorPath(checked.path);
    setHtmlModified(true);
    publishDraft({ title, content: source, titleDocument }, {
      source: { format: 'html', value: source }, document: lastValidDocument, validation: checked.validation,
    });
  };
  const applyHtml = (returnToVisual = false) => {
    if (!htmlModified) {
      if (returnToVisual && onBodyModeChange('visual')) {
        setBodyMode('visual');
        setVisualRequested(true);
      }
      return true;
    }
    const parsed = htmlCodec.parse(content);
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      const validation: DraftValidation = { status: 'invalid', error: { code: issue?.code ?? 'invalid-html', message: issue?.message ?? 'El HTML no es válido.' } };
      setHtmlValidation(validation);
      setHtmlErrorPath(issue?.path ?? null);
      publishDraft({ title, content, titleDocument }, { source: { format: 'html', value: content }, document: lastValidDocument, validation });
      return false;
    }
    setLastValidDocument(parsed.value);
    setHtmlValidation({ status: 'valid' });
    setHtmlErrorPath(null);
    publishDraft({ title, content, titleDocument }, { source: { format: 'html', value: content }, document: parsed.value, validation: { status: 'valid' } });
    setHtmlModified(false);
    if (returnToVisual && onBodyModeChange('visual')) {
      setBodyMode('visual');
      setVisualRequested(true);
    }
    return true;
  };
  const discardHtml = () => {
    const restoredDocument = initialBodyDocument;
    setHtmlAuthored(originalBodySource.format === 'html');
    setContent(originalBodySource.value);
    setLastValidDocument(restoredDocument);
    setHtmlValidation({ status: 'valid' });
    setHtmlErrorPath(null);
    setHtmlModified(false);
    publishDraft({ title, content: originalBodySource.value, titleDocument }, {
      source: originalBodySource, document: restoredDocument, validation: { status: 'valid' },
    });
    if (onBodyModeChange('visual')) {
      setBodyMode('visual');
      setVisualRequested(true);
    }
  };
  const insertList = (kind: ListKind) => {
    const edit = applyListCommand(content, selectionRef.current, kind);
    setContent(edit.text);
    selectionRef.current = { start: edit.caret, end: edit.caret };
    setForcedSelection(selectionRef.current);
    publishDraft({ title, content: edit.text, titleDocument });
  };
  // UX7-B3: negrita/cursiva envuelven la selección y la mantienen (en vez de colapsar el cursor como
  // las listas), para que escribir reemplace el texto formateado o repetir el atajo lo desenvuelva.
  const applyFormat = (kind: InlineMarkKind) => {
    const edit = applyInlineMark(content, selectionRef.current, kind);
    setContent(edit.text);
    selectionRef.current = edit.selection;
    setForcedSelection(edit.selection);
    publishDraft({ title, content: edit.text, titleDocument });
  };
  const onContentKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData & { readonly ctrlKey?: boolean; readonly metaKey?: boolean }>) => {
    const { ctrlKey, metaKey, key } = event.nativeEvent;
    if (!(ctrlKey || metaKey)) return;
    const lower = key.toLowerCase();
    if (lower === 'b') { event.preventDefault(); applyFormat('bold'); }
    else if (lower === 'i') { event.preventDefault(); applyFormat('italic'); }
  };
  // Etiquetas (ADR 0019): se guardan al momento, aparte del texto; lo escrito se normaliza (#Idea → idea).
  const [tagDraft, setTagDraft] = useState('');
  const addTag = (value: string = tagDraft) => {
    void run((storage, id) => addCardTag(storage, id, card.id, value), 'action.tagAdded', { reactive: true })
      .then((result) => { if (result.ok) setTagDraft(''); });
  };
  const removeTag = (tag: string) => {
    void run((storage, id) => removeCardTag(storage, id, card.id, tag), { key: 'action.tagRemoved', params: { tag } }, { reactive: true });
  };
  // UX7-B4: sugiere etiquetas ya usadas en el proyecto (no las que la ficha ya tiene), filtradas por lo
  // escrito; un toque la añade sin volver a escribirla entera. La deduplicación ya la hace el dominio
  // (`normalizeTag`/`withTag`), así que esto es solo descubrimiento, no una segunda validación.
  const appliedTags = new Set(card.tags ?? []);
  const tagQuery = tagDraft.trim().toLowerCase();
  const tagSuggestions = workspaceTags(workspace)
    .filter(({ tag }) => !appliedTags.has(tag) && tag.toLowerCase().includes(tagQuery))
    .slice(0, 6);
  // Enlace (ADR 0020): la dirección se guarda al pulsar «Guardar enlace», normalizada; abrir usa el sistema.
  const linkKey = linkUrlField(workspace.cardTypes.find((type) => type.id === card.typeId));
  const savedLink = linkKey ? card.fields[linkKey] : undefined;
  const currentLink = typeof savedLink === 'string' ? savedLink : '';
  const [linkDraft, setLinkDraft] = useState(currentLink);
  // Si la dirección guardada cambia (otra tarjeta, o guardada normalizada), el borrador la sigue.
  const [linkBase, setLinkBase] = useState(currentLink);
  if (linkBase !== currentLink) {
    setLinkBase(currentLink);
    setLinkDraft(currentLink);
  }
  const saveLink = () => {
    const input = linkDraft;
    void run((storage, id) => setCardLink(storage, id, card.id, input), 'action.linkSaved')
      .then((result) => { if (result.ok) setLinkDraft(result.value); });
  };
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const open = () => {
    setLinkProblem(null);
    void openLink(currentLink).then((opened) => {
      if (!opened) setLinkProblem(t('inspector.link.openFailed', locale));
    });
  };
  // Contenido en orden (ADR 0021): mover, quitar o el texto alternativo cambian el borrador, como escribir.
  const changeBlocks = (next: string) => {
    setContent(next);
    publishDraft({ title, content: next, titleDocument });
  };
  const blocksType = cardBase;
  const withBlocks = blocksType !== 'image' && blocksType !== 'section' && blocksType !== 'text' && blocksType !== 'shape' && blocksType !== 'connector';
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  // Insertar o reemplazar guarda enseguida el contenido del editor con la imagen (y el asset nuevo).
  const placeImage = async (place: { kind: 'insert'; caret?: number } | { kind: 'replace'; index: number }, draft = content): Promise<RichTextImage | null> => {
    setImageProblem(null);
    if (!supportsImageImport()) { setImageProblem(t('assets.error.noImagePicker', locale)); return null; }
    let picked;
    try {
      picked = await pickImageFile();
    } catch {
      setImageProblem(t('assets.error.imageReadFailed', locale)); return null;
    }
    if (!picked) return null;
    const file = picked;
    const result = await run((storage, id) => {
      const assets = assetsOf(storage);
      if (!assets) return Promise.resolve({ ok: false as const, issues: [{ code: 'invalid-asset' as const, path: 'storage', message: 'Este almacenamiento no guarda imágenes.' }] });
      return addNoteImage(storage, assets, id, card.id, { bytes: file.bytes, fileName: file.name, content: draft, place });
    }, place.kind === 'insert' ? { key: 'action.noteImageInserted', params: { name: file.name } } : { key: 'action.noteImageReplaced', params: { name: file.name } });
    if (result.ok) {
      setContent(result.value.content);
      publishDraft({ title, content: result.value.content, titleDocument });
      const parsed = richTextCodec.parse(result.value.content);
      return parsed.ok ? parsed.value.blocks.find((block): block is RichTextImage => block.type === 'image' && block.assetRef === result.value.ref) ?? null : null;
    } else {
      setImageProblem(describeFailure(result.issues, mode));
    }
    return null;
  };
  const placeVisualImage = async (document: RichTextDocument, place: { readonly kind: 'insert'; readonly afterBlock: number } | { readonly kind: 'replace'; readonly blockIndex: number }) => {
    const encoded = richTextCodec.serialize(document);
    if (!encoded.ok) return null;
    const blocks = parseNoteBlocks(encoded.value);
    if (place.kind === 'replace') {
      const image = document.blocks[place.blockIndex];
      if (image?.type !== 'image') return null;
      const index = blocks.findIndex((block) => block.kind === 'image' && block.ref === image.assetRef);
      return placeImage({ kind: 'replace', index }, encoded.value);
    }
    // La leyenda portable se serializa como un bloque técnico después de la imagen. Se cuenta como
    // parte de esa imagen para que la inserción respete el orden que el usuario ve en el editor.
    let rawIndex = -1;
    let cursor = 0;
    for (let index = 0; index <= place.afterBlock && index < document.blocks.length; index += 1) {
      const visualBlock = document.blocks[index];
      if (!visualBlock) continue;
      if (visualBlock.type === 'image') {
        const imageIndex = blocks.findIndex((block, candidate) => candidate >= cursor && block.kind === 'image' && block.ref === visualBlock.assetRef);
        if (imageIndex >= 0) {
          rawIndex = imageIndex;
          cursor = imageIndex + 1;
          const captionBlock = blocks[cursor];
          if (visualBlock.caption && captionBlock?.kind === 'text' && captionBlock.text.startsWith('<!-- nouty-caption:v1:')) {
            rawIndex = cursor;
            cursor += 1;
          }
        }
      } else {
        const textIndex = blocks.findIndex((block, candidate) => candidate >= cursor && block.kind === 'text' && !block.text.startsWith('<!-- nouty-caption:v1:'));
        if (textIndex >= 0) { rawIndex = textIndex; cursor = textIndex + 1; }
      }
    }
    const caret = blocks[rawIndex]?.start ?? encoded.value.length;
    return placeImage({ kind: 'insert', caret }, encoded.value);
  };
  const toggleCheck = (line: number) => {
    const next = toggleChecklistLine(content, line);
    if (next !== null) {
      setContent(next);
      publishDraft({ title, content: next, titleDocument });
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => { void flushPendingText(); }, 700);
    return () => clearTimeout(timer);
  }, [dirty, card.id, title, content, titleDocument, flushPendingText]);
  useEffect(() => {
    if (Platform.OS !== 'web' || (mode !== 'folder' && !visualEditing) || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mode, visualEditing, dirty]);
  const titles = new Map(workspace.cards.map((other) => [other.id, cardTitle(other, locale)]));
  const typeLabels = new Map(workspace.relationTypes.map((type) => [type.id, type.label]));
  const connected = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id);
  const targets = workspace.cards.filter((other) => other.id !== card.id
    && !workspace.relations.some((relation) => relation.from === card.id && relation.to === other.id));
  // Con pocas tarjetas conectables, listarlas directas es más rápido que buscar; con muchas, una pared
  // de botones no se puede recorrer (auditoría de interacción, 2026-09-29): hace falta escribir para
  // acotarlas por título, hasta un máximo de resultados visibles a la vez.
  const [connectSearch, setConnectSearch] = useState('');
  const needsConnectSearch = targets.length > 6;
  const connectQuery = connectSearch.trim().toLowerCase();
  const matchingTargets = needsConnectSearch
    ? (connectQuery === '' ? [] : targets.filter((target) => cardTitle(target, locale).toLowerCase().includes(connectQuery)))
    : targets;
  const visibleTargets = needsConnectSearch ? matchingTargets.slice(0, 8) : targets;
  // Tipo, rótulo y flecha (ADR 0034): una conexión a la vez en edición; la flecha se aplica al instante.
  const [editingRelation, setEditingRelation] = useState<{ readonly id: RelationId; readonly typeLabel: string; readonly label: string } | null>(null);
  const [connectTypeDraft, setConnectTypeDraft] = useState('');
  const arrowOptions: readonly { readonly value: RelationArrow; readonly label: string }[] = [
    { value: 'none', label: t('inspector.relation.arrow.none', locale) },
    { value: 'forward', label: t('inspector.relation.arrow.forward', locale) },
    { value: 'both', label: t('inspector.relation.arrow.both', locale) },
  ];
  const saveRelationEdit = () => {
    if (!editingRelation) return;
    const { id: relationId, typeLabel, label } = editingRelation;
    void run((storage, id) => updateConnection(storage, id, relationId, {
      ...(typeLabel.trim() === '' ? {} : { typeLabel: typeLabel.trim() }),
      ...(label.trim() === '' ? {} : { label: label.trim() }),
    }), 'action.connectionUpdated').then((result) => { if (result.ok) setEditingRelation(null); });
  };
  const rect = placement?.rect;
  // Posición y tamaño por teclado (ADR 0048): en escritorio el ratón y las asas ya resuelven mover y
  // redimensionar, así que esta sección no es fija; se ofrece agrupada y cerrada por defecto para quien
  // la necesite por teclado o accesibilidad, sin dominar el editor. En la hoja móvil sigue siempre visible.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const geometryBlock = (
    <>
      <Text testID="card-geometry" style={[styles.body, { color: colors.textPrimary }]}>
        {rect ? rect.x < 0 || rect.y < 0
          ? t('inspector.geometry.negative', locale, { x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h) })
          : t('inspector.geometry.cell', locale, { col: String(rect.x + 1), row: String(rect.y + 1), w: String(rect.w), h: String(rect.h) })
          : t('inspector.geometry.none', locale)}
      </Text>
      {rect ? (
        <>
          <View style={styles.row}>
            {moveKeys.map((move) => (
              <ActionButton
                key={move.nameKey}
                label={move.label}
                accessibilityLabel={t(move.nameKey, locale)}
                onPress={() => void run((storage, id) => nudgeCardOnBoard(storage, id, {
                  boardId, cardId: card.id, delta: { x: move.dx, y: move.dy },
                }), 'action.cardMoved', { reactive: true })}
              />
            ))}
          </View>
          <View style={styles.row}>
            {resizeKeys.map((resize) => (
              <ActionButton
                key={resize.nameKey}
                label={t(resize.labelKey, locale)}
                accessibilityLabel={t(resize.nameKey, locale)}
                onPress={() => void run((storage, id) => resizeCardOnBoard(storage, id, {
                  boardId, cardId: card.id, size: { w: rect.w + resize.dw, h: rect.h + resize.dh },
                }), 'action.sizeChanged', { reactive: true })}
              />
            ))}
          </View>
        </>
      ) : null}
    </>
  );

  return (
    <View testID="card-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {inSheet ? null : (
        <View style={styles.header}>
          {/* El título ocupa su propia fila (auditoría visual, 2026-09-29): junto a «Ampliar»/«Cerrar»
              en la misma fila, el panel lateral angosto le dejaba tan poco ancho que se cortaba a mitad
              de la primera palabra aunque tuviera dos líneas permitidas. */}
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.heading.eyebrow', locale)}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{cardTitle(card, locale)}</Text>
          </View>
          <View style={styles.headerActions}>
            {onToggleFocus ? (
              <ActionButton label={focused ? t('workview.back', locale) : t('inspector.expand', locale)} accessibilityLabel={focused ? t('workview.back', locale) : t('inspector.expand.accessibilityLabel', locale)} onPress={onToggleFocus} />
            ) : null}
            <ActionButton label={t('inspector.close', locale)} accessibilityLabel={t('inspector.close.accessibilityLabel', locale)} onPress={() => { void flushPendingText().then((saved) => { if (saved) onClose(); }); }} />
          </View>
        </View>
      )}

      <Text testID="card-created" style={[styles.hint, { color: colors.textSecondary }]}>
        {formatCreated(card.createdAt, new Date(card.createdAt ?? 0).getTimezoneOffset(), locale)}
      </Text>
      {onSelectMany ? (
        <View style={styles.row}>
          <ActionButton label={t('inspector.selectMany', locale)} accessibilityLabel={t('inspector.selectMany.accessibilityLabel', locale)} onPress={onSelectMany} />
        </View>
      ) : null}
      <View style={styles.section}>
        {!shape && !connector && presentation.title === 'visible' ? (
          <View testID="rich-title-editor">
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.title.label', locale)}</Text>
            <RichTextEditor cardId={`${card.id}-title`} document={titleDocument} codec={richTextCodec} onChange={changeTitleDocument}
              fontFamily={noteFontFamily} compact titleOnly />
          </View>
        ) : null}
        {linkKey ? (
          <View testID="card-link" style={styles.tagSection}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.link.section', locale)}</Text>
            <TextField label={t('inspector.link.address.label', locale)} value={linkDraft} onChangeText={setLinkDraft} placeholder={t('link.url.placeholder', locale)} onSubmitEditing={saveLink} testID="link-input" />
            <View style={styles.row}>
              {linkDraft !== currentLink ? <ActionButton label={t('inspector.link.save', locale)} tone="primary" onPress={saveLink} /> : null}
              {currentLink !== '' ? <ActionButton label={t('inspector.link.open', locale)} accessibilityLabel={t('inspector.link.open.accessibilityLabel', locale, { url: currentLink })} onPress={open} /> : null}
            </View>
            {linkProblem ? <Text testID="link-open-problem" style={[styles.hint, { color: colors.danger }]}>{linkProblem}</Text> : null}
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.link.hint', locale)}</Text>
          </View>
        ) : null}
        <View testID="card-tags" style={styles.tagSection}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.tags.section', locale)}</Text>
          {(card.tags ?? []).length > 0 ? (
            <View style={styles.row} accessibilityLabel={t('inspector.tags.accessibilityLabel', locale)}>
              {(card.tags ?? []).map((tag) => (
                <ActionButton key={tag} label={`#${tag}  ×`} accessibilityLabel={t('inspector.tag.remove.accessibilityLabel', locale, { tag })} onPress={() => removeTag(tag)} />
              ))}
            </View>
          ) : <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.tags.empty', locale)}</Text>}
          <View style={styles.tagAdd}>
            <View style={styles.tagInput}>
              <TextField label={t('inspector.tag.new.label', locale)} value={tagDraft} onChangeText={setTagDraft} placeholder="#idea" onSubmitEditing={() => addTag()} testID="tag-input" />
            </View>
            <ActionButton label={t('inspector.tag.add', locale)} accessibilityLabel={t('inspector.tag.add.accessibilityLabel', locale)} onPress={() => addTag()} />
          </View>
          {tagSuggestions.length > 0 ? (
            <View testID="tag-suggestions" style={styles.row} accessibilityRole="toolbar" accessibilityLabel={t('inspector.tag.suggestions.accessibilityLabel', locale)}>
              {tagSuggestions.map(({ tag, count }) => (
                <ActionButton key={tag} label={`#${tag}`} accessibilityLabel={t('inspector.tag.suggestion.accessibilityLabel', locale, { tag, count: String(count) })} onPress={() => addTag(tag)} />
              ))}
            </View>
          ) : null}
        </View>
        {Platform.OS === 'web' && supportsVisualEditor && visualAvailable ? (
          <View testID="body-mode-switch" style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Modo de edición del cuerpo">
            <ActionButton label="Visual" accessibilityLabel="Editar el cuerpo visualmente" pressed={bodyMode === 'visual'} onPress={() => {
              if (bodyMode === 'html') applyHtml(true);
            }} />
            <ActionButton label="HTML" accessibilityLabel="Editar el código HTML del cuerpo" pressed={bodyMode === 'html'} onPress={openHtml} />
          </View>
        ) : null}
        {Platform.OS !== 'web' && focused && supportsVisualEditor && visualAvailable && !visualEditing && !nativeHtmlReadOnly ? (
          <ActionButton label={t('inspector.visual.open', locale)} accessibilityLabel={t('inspector.visual.open.accessibilityLabel', locale)} onPress={() => setVisualRequested(true)} />
        ) : null}
        {Platform.OS !== 'web' && visualEditing ? (
          <ActionButton label={t('inspector.visual.markdown', locale)} accessibilityLabel={t('inspector.visual.markdown.accessibilityLabel', locale)} onPress={() => {
            void flushPendingText().then((saved) => { if (saved) setVisualRequested(false); });
          }} />
        ) : null}
        {nativeHtmlReadOnly ? (
          <Text testID="native-html-read-only" style={[styles.hint, { color: colors.textSecondary }]}>Este cuerpo HTML se conserva en solo lectura en Android. Edítalo en la versión web.</Text>
        ) : null}
        {visualEditing && visualDocument ? (
          <RichTextEditor cardId={card.id} document={visualDocument} codec={richTextCodec} onChange={changeVisualDocument} fontFamily={noteFontFamily}
            images={noteImages} captionPosition={card.captionPosition ?? 'bottom'}
            onInsertImage={(document, afterBlock) => placeVisualImage(document, { kind: 'insert', afterBlock })}
            onReplaceImage={(document, blockIndex) => placeVisualImage(document, { kind: 'replace', blockIndex })} />
        ) : null}
        {Platform.OS === 'web' && bodyMode === 'html' ? (
          <View testID="html-source-editor" style={styles.htmlEditor}>
            <TextField testID="html-source-input" label="Código HTML del cuerpo" value={content} onChangeText={changeHtml} multiline
              fontFamily={mono} placeholder="<p>Contenido</p>" />
            {htmlIssue ? <Text testID="html-source-error" accessibilityLiveRegion="assertive" style={[styles.hint, { color: colors.danger }]}>
              {htmlErrorPath ? `${htmlErrorPath}: ` : ''}{htmlIssue.message}
            </Text> : <Text testID="html-source-status" accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.textSecondary }]}>
              {htmlValidation.status === 'pending' ? 'Fuente modificada. Aplícala para actualizar la vista visual.' : 'Fuente válida aplicada a la sesión.'}
            </Text>}
            <View style={styles.row}>
              <ActionButton label="Aplicar HTML" accessibilityLabel="Validar y aplicar el código HTML" tone="primary" onPress={() => { applyHtml(false); }} />
              <ActionButton label="Descartar cambios HTML" accessibilityLabel="Descartar los cambios del código HTML" onPress={discardHtml} />
            </View>
          </View>
        ) : null}
        {focused && supportsVisualEditor && !visualAvailable ? (
          <Text testID="visual-editor-fallback" style={[styles.hint, { color: colors.textSecondary }]}>
            {t('inspector.visual.fallback', locale)}
          </Text>
        ) : null}
        {visualEditing || bodyMode === 'html' || floatingText || shape || connector ? null : <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel={t('inspector.format.accessibilityLabel', locale)}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.format.section', locale)}</Text>
          <ActionButton label="B" accessibilityLabel={t('inspector.format.bold.accessibilityLabel', locale)} onPress={() => applyFormat('bold')} style={styles.listButton} />
          <ActionButton label="I" accessibilityLabel={t('inspector.format.italic.accessibilityLabel', locale)} onPress={() => applyFormat('italic')} style={styles.listButton} />
        </View>}
        {visualEditing || bodyMode === 'html' || floatingText || shape || connector ? null : <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel={t('inspector.lists.accessibilityLabel', locale)}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.lists.section', locale)}</Text>
          <ActionButton label="−" accessibilityLabel={t('inspector.list.dash.accessibilityLabel', locale)} onPress={() => insertList('dash')} style={styles.listButton} />
          <ActionButton label="•" accessibilityLabel={t('inspector.list.bullet.accessibilityLabel', locale)} onPress={() => insertList('bullet')} style={styles.listButton} />
          <ActionButton label="1." accessibilityLabel={t('inspector.list.number.accessibilityLabel', locale)} onPress={() => insertList('number')} style={styles.listButton} />
          <ActionButton label="☐" accessibilityLabel={t('inspector.list.check.accessibilityLabel', locale)} onPress={() => insertList('check')} style={styles.listButton} />
        </View>}
        {presentation.body === 'hidden' || visualEditing || bodyMode === 'html' || nativeHtmlReadOnly || shape || connector ? null : <TextField label={floatingText ? t('inspector.floatingText.label', locale) : t('inspector.content.label', locale)} value={content} onChangeText={changeContent} multiline placeholder={t('inspector.content.placeholder', locale)}
          fontFamily={noteFontFamily}
          selection={forcedSelection}
          onKeyPress={onContentKeyPress}
          onSelectionChange={(selection) => {
            selectionRef.current = selection;
            if (forcedSelection && selection.start === forcedSelection.start && selection.end === forcedSelection.end) setForcedSelection(undefined);
          }} />}
        {presentation.body === 'visible' && !visualEditing && bodyMode !== 'html' && !nativeHtmlReadOnly && withBlocks ? (
          <NoteBlocksEditor content={content} onChange={changeBlocks} images={noteImages} canPickImages={supportsImageImport()}
            onInsert={() => void placeImage({ kind: 'insert', caret: selectionRef.current.start })}
            onReplace={(index) => void placeImage({ kind: 'replace', index })} />
        ) : null}
        {imageProblem ? <Text testID="note-image-problem" accessibilityLiveRegion="assertive" style={[styles.hint, { color: colors.danger }]}>{imageProblem}</Text> : null}
        {!visualEditing && bodyMode !== 'html' && !floatingText && !shape && content.split('\n').some((line) => parseChecklistLine(line) !== null) ? (
          <View testID="checklist-preview" style={styles.preview}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.checklist.section', locale)}</Text>
            {content.split('\n').map((line, index) => {
              const check = parseChecklistLine(line);
              if (!check) return <Text key={index} style={[styles.body, { color: colors.textPrimary }]}>{line || ' '}</Text>;
              return <View key={index} style={styles.checkRow}>
                <ActionButton label={check.checked ? '☑' : '☐'} accessibilityLabel={t(check.checked ? 'inspector.checklist.uncheck.accessibilityLabel' : 'inspector.checklist.check.accessibilityLabel', locale, { text: check.text })}
                  pressed={check.checked} onPress={() => toggleCheck(index)} />
                <Text style={[styles.body, styles.checkText, { color: colors.textPrimary }]}>{check.text}</Text>
              </View>;
            })}
          </View>
        ) : null}
        {!shape && !connector ? <View style={styles.row}>
          <ActionButton
            label={t('inspector.save', locale)}
            tone="primary"
            onPress={() => { void flushPendingText(); }}
          />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{dirty ? t('inspector.unsaved', locale) : t('inspector.saved', locale)}</Text>
        </View> : null}
      </View>

      {inSheet ? (
        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.position.section', locale)}</Text>
          {geometryBlock}
        </View>
      ) : (
        <View style={styles.section}>
          <ActionButton
            testID="card-position-toggle"
            label={advancedOpen ? t('inspector.position.toggle.hide', locale) : t('inspector.position.toggle.show', locale)}
            accessibilityLabel={advancedOpen ? t('inspector.position.toggle.hide.accessibilityLabel', locale) : t('inspector.position.toggle.show.accessibilityLabel', locale)}
            pressed={advancedOpen}
            onPress={() => setAdvancedOpen((open) => !open)}
          />
          {advancedOpen ? geometryBlock : null}
        </View>
      )}

      {placement && inSheet ? (
        <View testID="card-display" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.display.section', locale)}</Text>
          <View style={styles.row}>
            {displayKeys.map((option) => (
              <ActionButton
                key={option.display}
                label={t(option.labelKey, locale)}
                accessibilityLabel={t('inspector.display.show.accessibilityLabel', locale, { label: t(option.labelKey, locale).toLowerCase() })}
                pressed={placement.display === option.display}
                onPress={() => { if (placement.display !== option.display) onDisplay(option.display); }}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.display.hint', locale)}</Text>
        </View>
      ) : null}

      <View testID="card-icon-picker" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>ICONO</Text>
        <View style={styles.row}>
          <AppIcon name={card.icon ?? 'note'} size={24} color={colors.textPrimary} />
          <Text testID="selected-card-icon" style={[styles.body, { color: colors.textPrimary }]}>
            {`Seleccionado: ${iconLabels[card.icon ?? 'note']}`}
          </Text>
        </View>
        <View style={styles.iconGrid}>
          {cardIconNames.map((icon) => (
            <CardIconChoice key={icon} icon={icon} selected={(card.icon ?? 'note') === icon}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { icon }), { label: 'Apariencia actualizada' }, { reactive: true })} />
          ))}
        </View>
        {card.boardTargetId ? (
          <ActionButton label="Abrir tablero" accessibilityLabel={`Abrir tablero ${workspace.boards.find((candidate) => candidate.id === card.boardTargetId)?.title ?? card.boardTargetId}`}
            tone="primary" onPress={() => onOpenBoard?.(card.boardTargetId as BoardId)} />
        ) : null}
      </View>

      <View testID="card-frame-picker" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.frame.section', locale)}</Text>
        <View style={styles.row}>
          <ActionButton label={t('inspector.frame.followGlobal', locale)} pressed={card.frameOverride === undefined}
            onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { frameOverride: null }), { label: 'Apariencia actualizada' }, { reactive: true })} />
          <ActionButton label={t('inspector.frame.visible', locale)} pressed={card.frameOverride === 'visible'}
            onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { frameOverride: 'visible' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
          <ActionButton label={t('inspector.frame.hidden', locale)} pressed={card.frameOverride === 'hidden'}
            onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { frameOverride: 'hidden' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
        </View>
        {!shape && !connector ? (
          <>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.contentVisibility.section', locale)}</Text>
            <View style={styles.row}>
              <ActionButton label={t('inspector.contentVisibility.title', locale)} pressed={presentation.title === 'visible'}
                accessibilityLabel={t('inspector.contentVisibility.title.accessibilityLabel', locale)}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { titleVisibility: presentation.title === 'visible' ? 'hidden' : 'visible' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
              <ActionButton label={t('inspector.contentVisibility.body', locale)} pressed={presentation.body === 'visible'}
                accessibilityLabel={t('inspector.contentVisibility.body.accessibilityLabel', locale)}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { bodyVisibility: presentation.body === 'visible' ? 'hidden' : 'visible' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            </View>
            <View style={styles.row}>
              <ActionButton label={t('inspector.contentLayout.document', locale)} pressed={presentation.layout === 'document'}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { contentLayout: 'document' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
              <ActionButton label={t('inspector.contentLayout.banner', locale)} pressed={presentation.layout === 'banner'}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { contentLayout: 'banner' }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            </View>
          </>
        ) : null}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.frame.hint', locale)}</Text>
      </View>

      {shape ? (
        <View testID="shape-style-picker" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>FORMA</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Tipo</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Tipo de forma">
            {shapeKinds.map((kind) => (
              <ActionButton key={kind} label={kind === 'rectangle' ? 'Rectángulo' : kind === 'rounded-rectangle' ? 'Redondeado' : kind === 'ellipse' ? 'Elipse' : 'Línea'}
                pressed={(card.shapeKind ?? 'rectangle') === kind}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { shapeKind: kind }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Relleno</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Color de relleno">
            {shapeFills.map((fill) => (
              <ActionButton key={fill} label={fill === 'transparent' ? 'Transparente' : fill === 'red' ? 'Rojo' : fill === 'orange' ? 'Naranja' : fill === 'yellow' ? 'Amarillo' : fill === 'green' ? 'Verde' : fill === 'blue' ? 'Azul' : 'Morado'}
                pressed={(card.shapeFill ?? 'blue') === fill}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { shapeFill: fill }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Borde</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Color del borde">
            {shapeStrokes.map((stroke) => (
              <ActionButton key={stroke} label={stroke === 'default' ? 'Tema' : stroke === 'red' ? 'Rojo' : stroke === 'orange' ? 'Naranja' : stroke === 'yellow' ? 'Amarillo' : stroke === 'green' ? 'Verde' : stroke === 'blue' ? 'Azul' : 'Morado'}
                pressed={(card.shapeStroke ?? 'default') === stroke}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { shapeStroke: stroke }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Grosor</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Grosor del borde">
            {shapeStrokeWidths.map((width) => (
              <ActionButton key={width} label={width === 'thin' ? 'Fino' : width === 'medium' ? 'Medio' : 'Grueso'}
                pressed={(card.shapeStrokeWidth ?? 'medium') === width}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { shapeStrokeWidth: width }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
        </View>
      ) : null}

      {connector ? (
        <View testID="connector-style-picker" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>CONECTOR DECORATIVO</Text>
          {connectorPath ? (
            <View testID="connector-route-editor" style={styles.tagSection}>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>RUTA ORTOGONAL · {connectorPath.length} puntos · {connectorPath.length - 1} tramos</Text>
              <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Editar ruta ortogonal">
                <ActionButton label="Añadir desvío" onPress={() => void saveConnectorPath(addConnectorDetour(connectorPath, 0, 1))} />
                <ActionButton label="Horizontal primero" onPress={() => void saveConnectorPath(resetConnectorPath(connectorPath, 'horizontal-first'))} />
                <ActionButton label="Vertical primero" onPress={() => void saveConnectorPath(resetConnectorPath(connectorPath, 'vertical-first'))} />
              </View>
              {connectorPath.map((point, index) => (
                <View key={`${point.x}-${point.y}-${index}`} style={styles.row}>
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>{index === 0 ? 'Inicio' : index === connectorPath.length - 1 ? 'Final' : `Codo ${index}`}</Text>
                  <ActionButton label="←" accessibilityLabel={`Mover punto ${index + 1} a la izquierda`} onPress={() => void saveConnectorPath(moveConnectorPoint(connectorPath, index, { x: point.x - 0.25, y: point.y }))} />
                  <ActionButton label="→" accessibilityLabel={`Mover punto ${index + 1} a la derecha`} onPress={() => void saveConnectorPath(moveConnectorPoint(connectorPath, index, { x: point.x + 0.25, y: point.y }))} />
                  <ActionButton label="↑" accessibilityLabel={`Mover punto ${index + 1} hacia arriba`} onPress={() => void saveConnectorPath(moveConnectorPoint(connectorPath, index, { x: point.x, y: point.y - 0.25 }))} />
                  <ActionButton label="↓" accessibilityLabel={`Mover punto ${index + 1} hacia abajo`} onPress={() => void saveConnectorPath(moveConnectorPoint(connectorPath, index, { x: point.x, y: point.y + 0.25 }))} />
                  {index > 0 && index < connectorPath.length - 1 ? <ActionButton label="Quitar" accessibilityLabel={`Quitar codo ${index}`} onPress={() => void saveConnectorPath(removeConnectorPoint(connectorPath, index))} /> : null}
                </View>
              ))}
            </View>
          ) : placement ? (
            <View testID="connector-legacy-editor" style={styles.tagSection}>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Conector anterior: conserva su diagonal hasta convertirlo.</Text>
              <ActionButton label="Convertir a ruta ortogonal" onPress={() => {
                const down = (card.connectorDirection ?? 'down') === 'down';
                const start = { x: placement.rect.x, y: down ? placement.rect.y : placement.rect.y + placement.rect.h };
                const end = { x: placement.rect.x + placement.rect.w, y: down ? placement.rect.y + placement.rect.h : placement.rect.y };
                void saveConnectorPath(createOrthogonalConnectorPath(start, end));
              }} />
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Dirección diagonal anterior</Text>
              <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Dirección del conector anterior">
                {connectorDirections.map((direction) => <ActionButton key={direction} label={direction === 'down' ? 'Descendente' : 'Ascendente'} pressed={(card.connectorDirection ?? 'down') === direction}
                  onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { connectorDirection: direction }), { label: 'Conector actualizado' }, { reactive: true })} />)}
              </View>
            </View>
          ) : null}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Color</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Color del conector">
            {shapeStrokes.map((color) => <ActionButton key={color} label={color === 'default' ? 'Tema' : color === 'red' ? 'Rojo' : color === 'orange' ? 'Naranja' : color === 'yellow' ? 'Amarillo' : color === 'green' ? 'Verde' : color === 'blue' ? 'Azul' : 'Morado'} pressed={(card.connectorColor ?? 'default') === color}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { connectorColor: color }), { label: 'Conector actualizado' }, { reactive: true })} />)}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Grosor</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Grosor del conector">
            {shapeStrokeWidths.map((width) => <ActionButton key={width} label={width === 'thin' ? 'Fino' : width === 'medium' ? 'Medio' : 'Grueso'} pressed={(card.connectorWidth ?? 'medium') === width}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { connectorWidth: width }), { label: 'Conector actualizado' }, { reactive: true })} />)}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Trazo</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Trazo del conector">
            {connectorDashes.map((dash) => <ActionButton key={dash} label={dash === 'solid' ? 'Continuo' : dash === 'dashed' ? 'Discontinuo' : 'Punteado'} pressed={(card.connectorDash ?? 'solid') === dash}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { connectorDash: dash }), { label: 'Conector actualizado' }, { reactive: true })} />)}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Puntas</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Puntas del conector">
            {connectorArrows.map((arrows) => <ActionButton key={arrows} label={arrows === 'none' ? 'Ninguna' : arrows === 'start' ? 'Inicial' : arrows === 'end' ? 'Final' : 'Doble'} pressed={(card.connectorArrows ?? 'end') === arrows}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { connectorArrows: arrows }), { label: 'Conector actualizado' }, { reactive: true })} />)}
          </View>
          {(['connectorStartCardId', 'connectorEndCardId'] as const).map((field, endpoint) => <View key={field}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{endpoint === 0 ? 'Extremo inicial' : 'Extremo final'}</Text>
            <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel={`Anclaje del extremo ${endpoint === 0 ? 'inicial' : 'final'}`}>
              <ActionButton label="Libre" pressed={card[field] === undefined}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { [field]: null }), { label: 'Anclaje actualizado' }, { reactive: true })} />
              {(workspace.boards.find((candidate) => candidate.id === boardId)?.cardIds ?? []).filter((candidate) => candidate !== card.id).map((candidate) => {
                const target = workspace.cards.find((item) => item.id === candidate);
                const label = target ? cardTitle(target, locale) : candidate;
                return <ActionButton key={candidate} label={label} accessibilityLabel={`Anclar extremo ${endpoint === 0 ? 'inicial' : 'final'} a ${label}`} pressed={card[field] === candidate}
                  onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { [field]: candidate }), { label: 'Anclaje actualizado' }, { reactive: true })} />;
              })}
            </View>
          </View>)}
        </View>
      ) : null}

      {floatingText ? (
        <View testID="floating-text-style-picker" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>TEXTO FLOTANTE</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Alineación</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Alineación del texto flotante">
            {floatingTextAlignments.map((alignment) => (
              <ActionButton key={alignment} label={alignment === 'left' ? 'Izquierda' : alignment === 'center' ? 'Centro' : 'Derecha'}
                pressed={(card.textAlign ?? 'left') === alignment}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { textAlign: alignment === 'left' ? null : alignment }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Color</Text>
          <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Color del texto flotante">
            {floatingTextColors.map((color) => (
              <ActionButton key={color} label={color === 'default' ? 'Tema' : color === 'red' ? 'Rojo' : color === 'orange' ? 'Naranja' : color === 'green' ? 'Verde' : color === 'blue' ? 'Azul' : 'Morado'}
                pressed={(card.textColor ?? 'default') === color}
                onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { textColor: color === 'default' ? null : color }), { label: 'Apariencia actualizada' }, { reactive: true })} />
            ))}
          </View>
        </View>
      ) : null}

      {!shape ? <View testID="card-caption-position-picker" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.captionPosition.section', locale)}</Text>
        <View style={styles.row}>
          {(['bottom', 'top', 'left', 'right'] as const).map((position) => (
            <ActionButton key={position} label={t(`inspector.captionPosition.${position}`, locale)}
              accessibilityLabel={t(`inspector.captionPosition.${position}.accessibilityLabel`, locale)}
              pressed={(card.captionPosition ?? 'bottom') === position}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { captionPosition: position === 'bottom' ? null : position }), { label: 'Apariencia actualizada' }, { reactive: true })} />
          ))}
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.captionPosition.hint', locale)}</Text>
      </View> : null}

      {(card.assetRefs?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.files.section', locale)}</Text>
          <Text testID="card-asset" style={[styles.body, { color: colors.textPrimary }]}>{card.assetRefs?.join(', ')}</Text>
        </View>
      ) : null}

      {inSheet ? <View testID="card-connections" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.connections.section', locale)}</Text>
        {connected.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('inspector.connections.empty', locale)}</Text>
        ) : connected.map((relation) => {
          const outgoing = relation.from === card.id;
          const other = titles.get(outgoing ? relation.to : relation.from) ?? t('trash.item.untitled', locale);
          const typeLabel = typeLabels.get(relation.typeId) ?? '';
          const arrow = relation.arrow ?? 'forward';
          const editingThis = editingRelation?.id === relation.id;
          return (
            <View key={relation.id} testID={`connection-${relation.id}`} style={styles.connectionBlock}>
              <View style={styles.connection}>
                <Text style={[styles.body, styles.connectionText, { color: colors.textPrimary }]}>
                  {`${outgoing ? '→' : '←'} ${other} (${typeLabel}${relation.label ? `: ${relation.label}` : ''})`}
                </Text>
              </View>
              {editingThis ? (
                <>
                  <TextField label={t('inspector.relation.type.label', locale)} value={editingRelation.typeLabel} onChangeText={(value) => setEditingRelation({ ...editingRelation, typeLabel: value })} />
                  <TextField label={t('inspector.relation.label.label', locale)} value={editingRelation.label} onChangeText={(value) => setEditingRelation({ ...editingRelation, label: value })} placeholder={t('inspector.relation.label.placeholder', locale)} />
                  <View style={styles.row}>
                    <ActionButton label={t('inspector.relation.save', locale)} tone="primary" accessibilityLabel={t('inspector.relation.save.accessibilityLabel', locale)} onPress={saveRelationEdit} />
                    <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('inspector.relation.cancel.accessibilityLabel', locale)} onPress={() => setEditingRelation(null)} />
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  {arrowOptions.map((option) => (
                    <ActionButton
                      key={option.value}
                      label={option.label}
                      accessibilityLabel={t('inspector.relation.arrow.use.accessibilityLabel', locale, { label: option.label.toLowerCase() })}
                      pressed={arrow === option.value}
                      onPress={() => void run((storage, id) => updateConnection(storage, id, relation.id, { arrow: option.value }), 'action.connectionStyleChanged')}
                    />
                  ))}
                  <ActionButton
                    label={t('inspector.relation.edit', locale)}
                    accessibilityLabel={t('inspector.relation.edit.accessibilityLabel', locale, { other })}
                    onPress={() => setEditingRelation({ id: relation.id, typeLabel, label: relation.label ?? '' })}
                  />
                  <ActionButton
                    label={t('inspector.relation.disconnect', locale)}
                    accessibilityLabel={t(outgoing ? 'inspector.relation.disconnect.from.accessibilityLabel' : 'inspector.relation.disconnect.since.accessibilityLabel', locale, { other })}
                    onPress={() => void run((storage, id) => disconnectCards(storage, id, relation.id), 'action.connectionRemoved')}
                  />
                </View>
              )}
            </View>
          );
        })}
        {targets.length > 0 ? (
          <>
            <TextField label={t('inspector.connect.type.label', locale)} value={connectTypeDraft} onChangeText={setConnectTypeDraft} placeholder={t('inspector.connect.type.placeholder', locale)} testID="connect-type-input" />
            {needsConnectSearch ? (
              <TextField label={t('inspector.connect.search.label', locale)} value={connectSearch} onChangeText={setConnectSearch} placeholder={t('inspector.connect.search.placeholder', locale)} testID="connect-search-input" />
            ) : null}
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.connect.with', locale)}</Text>
          </>
        ) : null}
        {needsConnectSearch && connectQuery !== '' && matchingTargets.length === 0 ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.connect.none', locale, { query: connectSearch.trim() })}</Text>
        ) : null}
        <View style={styles.row}>
          {visibleTargets.map((target) => (
            <ActionButton
              key={target.id}
              label={cardTitle(target, locale)}
              accessibilityLabel={t('inspector.connect.accessibilityLabel', locale, { title: cardTitle(target, locale) })}
              onPress={() => void run((storage, id) => connectCards(storage, id, {
                from: card.id, to: target.id, ...(connectTypeDraft.trim() === '' ? {} : { typeLabel: connectTypeDraft.trim() }),
              }), 'action.cardsConnected')}
            />
          ))}
        </View>
        {needsConnectSearch && matchingTargets.length > visibleTargets.length ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {matchingTargets.length - visibleTargets.length === 1
              ? t('inspector.connect.more.one', locale)
              : t('inspector.connect.more.many', locale).replace('#', String(matchingTargets.length - visibleTargets.length))}
          </Text>
        ) : null}
      </View> : null}
      {inSheet ? <View style={styles.section}>
        <ActionButton label={t('inspector.archive', locale)} accessibilityLabel={t('inspector.archive.accessibilityLabel', locale, { title: cardTitle(card, locale) })} onPress={onArchive} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.archive.hint', locale)}</Text>
        <ActionButton label={t('inspector.trash', locale)} accessibilityLabel={t('inspector.trash.accessibilityLabel', locale, { title: cardTitle(card, locale) })} onPress={onTrash} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.trash.hint', locale)}</Text>
      </View> : null}
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  tagSection: { gap: 6 },
  tagAdd: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  tagInput: { flex: 1, minWidth: 0 },
  // Botones de lista de 44 × 44: los cuatro caben en una fila junto a «LISTAS» (panel de 320 px).
  listButton: { width: 44, minWidth: 44, paddingHorizontal: 0 },
  panel: { padding: 16, gap: 20 },
  header: { gap: 10 },
  headerText: { minWidth: 0, gap: 4 },
  headerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  section: { gap: 10 },
  htmlEditor: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChoice: { width: 48, height: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
  connectionBlock: { gap: 6 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionText: { flex: 1, minWidth: 0 },
  preview: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { flex: 1, minWidth: 0 },
});
