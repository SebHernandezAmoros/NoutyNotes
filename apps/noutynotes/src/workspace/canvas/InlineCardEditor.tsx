import type { RichTextCodec, WorkspaceStorageResult } from '@noutynotes/application';
import { cardTitleText } from '@noutynotes/domain';
import type { AssetRef, Card, CardId, RichTextDocument, RichTextImage } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppIcon } from '../../components/AppIcon';
import { DialogCloseButton } from '../../components/Dialog';
import { t } from '../../i18n';
import { pickImageFile, supportsImageImport } from '../../session/imageFiles';
import { isBasicRichTextDocument, isWebRichTextDocument } from '../basicRichText';
import type { EditableCardDraft } from '../editorialDraft';
import { resolveMarkdownImagePlace } from '../noteImagePlacement';
import type { MarkdownImagePlace, NoteImageSource, ResolvedNoteImageSource, VisualImagePlace } from '../noteImagePlacement';
import { RichTextEditor } from '../RichTextEditor';
import type { ScreenBox } from './cardChrome';

export interface InlineCardEditorProps {
  readonly card: Card;
  readonly box: ScreenBox;
  readonly richTextCodec: RichTextCodec;
  /** UX7-CONSOLIDATION: codec HTML v1 (mismo que usa `CardInspector.tsx`) — distinto de
   * `richTextCodec` (que aquí serializa a markdown, el formato que ya persiste `content`). */
  readonly htmlCodec: RichTextCodec;
  readonly noteFontFamily?: string | undefined;
  readonly noteImages: ReadonlyMap<string, string>;
  readonly initialDraft?: EditableCardDraft | undefined;
  readonly onDraftChange: (draft: EditableCardDraft) => void;
  readonly onSave: (draft: EditableCardDraft) => Promise<boolean>;
  /** UX7.1-IMAGES (ASSET-04/06/07): edición rápida no tiene acceso a `storage`; estas tres vías
   * estrechas (en vez de un `run` genérico) le dan justo lo que necesita para insertar una imagen
   * nueva, una ya catalogada o una recién pegada — mismas operaciones que usa el Inspector completo. */
  readonly onPickAssetImageRef: () => Promise<string | null>;
  readonly onPlaceImage: (cardId: CardId, place: MarkdownImagePlace, content: string, source: ResolvedNoteImageSource) => Promise<WorkspaceStorageResult<{ readonly content: string; readonly ref: AssetRef }>>;
  readonly onPlaceImageDocument: (cardId: CardId, place: VisualImagePlace, contentDocument: RichTextDocument, source: ResolvedNoteImageSource) => Promise<WorkspaceStorageResult<{ readonly contentDocument: RichTextDocument; readonly ref: AssetRef }>>;
  readonly onAdvanced: () => void;
  readonly onCollapse: () => void;
  readonly onClose: () => void;
}

/** Edición breve colocada sobre la ficha; las propiedades avanzadas siguen en el editor completo. */
export function InlineCardEditor({ card, box, richTextCodec, htmlCodec, noteFontFamily, noteImages, initialDraft, onDraftChange, onSave, onPickAssetImageRef, onPlaceImage, onPlaceImageDocument, onAdvanced, onCollapse, onClose }: InlineCardEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const initialHtml = card.contentDocument ? htmlCodec.serialize(card.contentDocument) : null;
  const [title] = useState(initialDraft?.title ?? cardTitleText(card));
  const [content, setContent] = useState(initialDraft?.content ?? (initialHtml?.ok ? initialHtml.value : card.content ?? ''));
  const [titleDocument] = useState<RichTextDocument>(() => initialDraft?.titleDocument ?? ({
    schemaVersion: 1, blocks: [{ type: 'paragraph', content: (initialDraft?.title ?? cardTitleText(card)) ? [{ type: 'text', text: initialDraft?.title ?? cardTitleText(card) }] : [] }],
  }));
  const floatingText = card.typeId === 'texto-flotante';
  const supportsVisualDocument = (document: Parameters<typeof isBasicRichTextDocument>[0]) => Platform.OS === 'web'
    ? isWebRichTextDocument(document)
    : isBasicRichTextDocument(document);
  const initialHtmlAuthored = initialDraft?.bodySource?.format === 'html' || card.contentDocument !== undefined;
  const [htmlAuthored, setHtmlAuthored] = useState(initialHtmlAuthored);
  const [visualDocument, setVisualDocument] = useState<Parameters<RichTextCodec['serialize']>[0] | null>(() => {
    if (initialDraft?.bodyDocument && supportsVisualDocument(initialDraft.bodyDocument)) return initialDraft.bodyDocument;
    if (card.contentDocument && supportsVisualDocument(card.contentDocument)) return card.contentDocument;
    const source = initialDraft?.content ?? card.content ?? '';
    const parsed = (initialHtmlAuthored ? htmlCodec : richTextCodec).parse(source);
    return parsed.ok && supportsVisualDocument(parsed.value) ? parsed.value : null;
  });
  // UX7-CONSOLIDATION: ya no hay un indicador rutinario de «Guardando…» (guardar correctamente es
  // silencioso); `setSaving` se conserva porque `persist()` todavía lo usa para no solapar guardados.
  const [, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  // UX7-VISUAL-FINALIZATION: el título se conserva en la sesión y en el guardado, pero se edita como
  // metadato desde las propiedades del Inspector. La edición rápida dedica toda su superficie al cuerpo.
  const visualAvailable = visualDocument !== null;
  const changeVisualDocument = (document: Parameters<RichTextCodec['serialize']>[0]) => {
    const requiresHtml = document.blocks.some((block) =>
      ((block.type === 'paragraph' || block.type === 'heading') && block.alignment !== undefined)
      || (block.type === 'image' && (block.size !== undefined || block.alignment !== undefined || block.caption !== undefined))
      || (block.type === 'table' && block.rows.some((row) => row.cells.some((cell) => cell.verticalAlignment !== undefined))));
    const nextHtmlAuthored = htmlAuthored || requiresHtml;
    const encoded = (nextHtmlAuthored ? htmlCodec : richTextCodec).serialize(document);
    if (encoded.ok) {
      if (requiresHtml && !htmlAuthored) setHtmlAuthored(true);
      setVisualDocument(document);
      setContent(encoded.value);
      onDraftChange({ cardId: card.id, title, content: encoded.value, titleDocument, ...(nextHtmlAuthored ? {
        bodySource: { format: 'html' as const, value: encoded.value }, bodyDocument: document, bodyValidation: { status: 'valid' as const },
      } : {}) });
    }
  };
  // UX7.1-IMAGES: mismas tres operaciones que el Inspector completo (`addNoteImage`/
  // `addNoteImageDocument`/`insertExistingNoteImage*`), pero a través de los puertos estrechos que
  // recibe por props en vez de `run` — edición rápida nunca conoce `storage` directamente.
  const resolveImageFile = async (source: NoteImageSource): Promise<{ readonly bytes: Uint8Array; readonly name: string } | null> => {
    if (source.kind === 'bytes') return { bytes: source.bytes, name: source.name };
    if (source.kind === 'existing') return null;
    if (!supportsImageImport()) { setImageProblem('Este entorno no permite elegir imágenes.'); return null; }
    try {
      return await pickImageFile();
    } catch {
      setImageProblem('No se pudo leer la imagen elegida.');
      return null;
    }
  };
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  const placeImage = async (place: MarkdownImagePlace, draft: string, source: NoteImageSource): Promise<RichTextImage | null> => {
    setImageProblem(null);
    const file = source.kind === 'existing' ? null : await resolveImageFile(source);
    if (source.kind !== 'existing' && !file) return null;
    const result = await onPlaceImage(card.id, place, draft, source.kind === 'existing' ? source : { kind: 'bytes', bytes: file!.bytes, name: file!.name });
    if (!result.ok) { setImageProblem(result.issues[0]?.message ?? 'No se pudo insertar la imagen.'); return null; }
    setContent(result.value.content);
    onDraftChange({ cardId: card.id, title, content: result.value.content, titleDocument });
    const parsed = richTextCodec.parse(result.value.content);
    return parsed.ok ? parsed.value.blocks.find((block): block is RichTextImage => block.type === 'image' && block.assetRef === result.value.ref) ?? null : null;
  };
  const placeImageDocument = async (place: VisualImagePlace, draft: RichTextDocument, source: NoteImageSource): Promise<RichTextImage | null> => {
    setImageProblem(null);
    const file = source.kind === 'existing' ? null : await resolveImageFile(source);
    if (source.kind !== 'existing' && !file) return null;
    const result = await onPlaceImageDocument(card.id, place, draft, source.kind === 'existing' ? source : { kind: 'bytes', bytes: file!.bytes, name: file!.name });
    if (!result.ok) { setImageProblem(result.issues[0]?.message ?? 'No se pudo insertar la imagen.'); return null; }
    setHtmlAuthored(true);
    setVisualDocument(supportsVisualDocument(result.value.contentDocument) ? result.value.contentDocument : visualDocument);
    const encoded = htmlCodec.serialize(result.value.contentDocument);
    const nextContent = encoded.ok ? encoded.value : content;
    setContent(nextContent);
    onDraftChange({ cardId: card.id, title, content: nextContent, titleDocument, bodySource: { format: 'html', value: nextContent }, bodyDocument: result.value.contentDocument, bodyValidation: { status: 'valid' } });
    return result.value.contentDocument.blocks.find((block): block is RichTextImage => block.type === 'image' && block.assetRef === result.value.ref) ?? null;
  };
  const placeVisualImage = async (document: RichTextDocument, place: VisualImagePlace, source: NoteImageSource = { kind: 'upload' }): Promise<RichTextImage | null> => {
    if (htmlAuthored) return placeImageDocument(place, document, source);
    const resolved = resolveMarkdownImagePlace(document, place, richTextCodec);
    if (!resolved) return null;
    return placeImage(resolved.place, resolved.content, source);
  };
  const placeImageFromAssets = (document: RichTextDocument, afterBlock: number) => onPickAssetImageRef().then((ref) => (
    ref === null ? null : placeVisualImage(document, { kind: 'insert', afterBlock }, { kind: 'existing', ref })
  ));
  const pasteImage = (document: RichTextDocument, afterBlock: number, file: { readonly bytes: Uint8Array; readonly name: string }) =>
    placeVisualImage(document, { kind: 'insert', afterBlock }, { kind: 'bytes', bytes: file.bytes, name: file.name });
  const current = useRef({ title, content });
  const saved = useRef({ title: initialDraft?.title ?? cardTitleText(card), content: initialDraft?.content ?? card.content ?? '' });
  const queued = useRef<{ title: string; content: string } | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(() => { current.current = { title, content }; }, [title, content]);

  const persist = useCallback((override?: EditableCardDraft) => {
    const draft: EditableCardDraft = override ?? { cardId: card.id, title, content, titleDocument, ...(htmlAuthored && visualDocument ? {
      bodySource: { format: 'html' as const, value: content }, bodyDocument: visualDocument, bodyValidation: { status: 'valid' as const },
    } : {}) };
    if (draft.title === saved.current.title && draft.content === saved.current.content) return queue.current;
    if (draft.title === queued.current?.title && draft.content === queued.current.content) return queue.current;
    setSaving(true);
    setProblem(null);
    queued.current = draft;
    const task = queue.current.then(() => onSave(draft)).then((ok) => {
      if (ok) saved.current = draft;
      else setProblem('No se pudo guardar. La edición sigue abierta.');
      return ok;
    }).finally(() => {
      if (queued.current === draft) {
        queued.current = null;
        setSaving(false);
      }
    });
    queue.current = task;
    return task;
  }, [card.id, content, htmlAuthored, onSave, title, titleDocument, visualDocument]);

  useEffect(() => {
    if (title === saved.current.title && content === saved.current.content) return undefined;
    const timer = setTimeout(() => { void persist(); }, 700);
    return () => clearTimeout(timer);
  }, [title, content, persist]);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current.title === saved.current.title && current.current.content === saved.current.content) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const close = () => { void persist().then((ok) => { if (ok) onClose(); }); };
  const collapse = () => { void persist().then((ok) => { if (ok) onCollapse(); }); };
  const advanced = () => onAdvanced();
  return (
    <View
      testID="inline-card-editor"
      accessibilityViewIsModal
      style={[styles.editor, {
        left: box.left, top: box.top,
        // La toolbar secundaria conserva una sola fila y deja un viewport editorial útil incluso
        // sobre una ficha pequeña; el lienzo sigue visible alrededor y el editor continúa compacto.
        width: visualAvailable ? Math.max(box.width, 380) : box.width,
        height: visualAvailable ? Math.max(box.height, 340) : box.height,
        backgroundColor: colors.cardSurface, borderColor: colors.selection,
      }]}
    >
      <View style={[styles.bar, { backgroundColor: colors.headerNote, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.headerText }]}>{toolsCollapsed ? 'EDICIÓN RÁPIDA · HERRAMIENTAS PLEGADAS' : 'EDICIÓN RÁPIDA'}</Text>
        <Pressable testID="inline-collapse-note" accessibilityRole="button" accessibilityLabel="Contraer Nota" onPress={collapse} style={[styles.iconButton, { borderColor: colors.border }]}>
          <Text accessibilityElementsHidden style={[styles.toolbarToggleText, { color: colors.headerText }]}>−</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Continuar en el Inspector" onPress={advanced} style={[styles.iconButton, { borderColor: colors.border }]}>
          <AppIcon name="expand" size={18} color={colors.headerText} />
        </Pressable>
        <DialogCloseButton label="Guardar y cerrar la edición rápida" onPress={close} />
      </View>
      {!floatingText && Platform.OS === 'web' ? (
        <View
          testID="inline-body-mode-switch"
          style={styles.modeRow}
          accessibilityRole="toolbar"
          accessibilityLabel="Modo de edición del cuerpo"
        >
          <Pressable
            testID="inline-toolbar-toggle"
            accessibilityRole="button"
            accessibilityLabel={t(toolsCollapsed ? 'inline.toolbar.show' : 'inline.toolbar.hide', locale)}
            accessibilityState={{ expanded: !toolsCollapsed }}
            aria-expanded={!toolsCollapsed}
            onPress={() => setToolsCollapsed((collapsed) => !collapsed)}
            style={[styles.toolsToggle, { borderColor: colors.border }]}
          >
            <Text style={[styles.toolsToggleText, { color: colors.cardText }]}>{toolsCollapsed ? '+ Mostrar herramientas' : '− Ocultar herramientas'}</Text>
          </Pressable>
        </View>
      ) : null}
      {floatingText ? (
        <TextInput
          testID="inline-floating-text"
          accessibilityLabel="Texto flotante"
          value={content}
          onChangeText={(value) => { setContent(value); onDraftChange({ cardId: card.id, title, content: value, titleDocument }); }}
          onBlur={() => { void persist(); }}
          multiline
          autoFocus
          placeholder="Escribe texto"
          placeholderTextColor={colors.textSecondary}
          style={[styles.plainText, { color: colors.cardText }, noteFontFamily === undefined ? null : { fontFamily: noteFontFamily }]}
        />
      ) : visualDocument ? (
        <RichTextEditor cardId={card.id} document={visualDocument} codec={richTextCodec} onChange={changeVisualDocument} images={noteImages} onOpenFullEditor={advanced} fontFamily={noteFontFamily} compact toolbarCollapsed={toolsCollapsed}
          onInsertImage={(document, afterBlock) => placeVisualImage(document, { kind: 'insert', afterBlock })}
          onReplaceImage={(document, blockIndex) => placeVisualImage(document, { kind: 'replace', blockIndex })}
          onInsertImageFromAssets={placeImageFromAssets}
          onPasteImage={pasteImage}
          onPasteImageRejected={setImageProblem} />
      ) : (
        <View style={styles.unsupportedContent}>
          <Text style={[styles.modeHint, { color: colors.textSecondary }]}>Este contenido se edita desde Más opciones.</Text>
        </View>
      )}
      {/* UX7-CONSOLIDATION: el guardado automático correcto es silencioso (mismo criterio que el resto
          de la app desde UX7-LAYOUT-CORRECTION) — esta fila solo aparece ante un error real, nunca
          como mensaje rutinario. «Más opciones»/«Editar completo» ya vive en la cabecera (icono
          expandir); repetirlo aquí abajo desperdiciaba una fila entera para la misma acción. */}
      {problem || imageProblem ? (
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="assertive" style={[styles.status, { color: colors.danger }]}>{problem ?? imageProblem}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { position: 'absolute', zIndex: 45, borderWidth: 3, minWidth: 240, minHeight: 180, overflow: 'hidden' },
  bar: { height: 44, borderBottomWidth: 2, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { flex: 1, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  modeHint: { fontSize: 11, lineHeight: 16 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  htmlEditor: { flex: 1, minHeight: 100, paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1 },
  toolbarToggleText: { fontSize: 22, lineHeight: 24, fontWeight: '900' },
  toolsToggle: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  toolsToggleText: { fontSize: 12, fontWeight: '800' },
  plainText: { flex: 1, minHeight: 100, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  unsupportedContent: { flex: 1, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8 },
  footer: { minHeight: 38, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 10, lineHeight: 14 },
  more: { minHeight: 30, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  moreText: { fontSize: 11, fontWeight: '800' },
});
