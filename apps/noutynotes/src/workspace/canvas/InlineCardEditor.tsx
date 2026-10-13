import type { RichTextCodec } from '@noutynotes/application';
import { cardTitleText } from '@noutynotes/domain';
import type { Card, RichTextDocument } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, TextField } from '../../components/controls';
import { AppIcon } from '../../components/AppIcon';
import { DialogCloseButton } from '../../components/Dialog';
import { t } from '../../i18n';
import { isBasicRichTextDocument, isWebRichTextDocument } from '../basicRichText';
import type { EditableCardDraft } from '../editorialDraft';
import { RichTextEditor } from '../RichTextEditor';
import type { ScreenBox } from './cardChrome';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

interface InlineCardEditorProps {
  readonly card: Card;
  readonly box: ScreenBox;
  readonly richTextCodec: RichTextCodec;
  /** UX7-CONSOLIDATION: codec HTML v1 (mismo que usa `CardInspector.tsx`) — distinto de
   * `richTextCodec` (que aquí serializa a markdown, el formato que ya persiste `content`). */
  readonly htmlCodec: RichTextCodec;
  readonly noteFontFamily?: string | undefined;
  readonly initialDraft?: EditableCardDraft | undefined;
  readonly onDraftChange: (draft: EditableCardDraft) => void;
  readonly onSave: (draft: EditableCardDraft) => Promise<boolean>;
  readonly onAdvanced: () => void;
  readonly onClose: () => void;
}

/** Edición breve colocada sobre la ficha; las propiedades avanzadas siguen en el editor completo. */
export function InlineCardEditor({ card, box, richTextCodec, htmlCodec, noteFontFamily, initialDraft, onDraftChange, onSave, onAdvanced, onClose }: InlineCardEditorProps) {
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
    ? isWebRichTextDocument(document) && !document.blocks.some((block) => block.type === 'image')
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
  // UX7-CONSOLIDATION: Visual/HTML en edición rápida reutiliza los dos mecanismos seguros ya
  // existentes: `htmlCodec` (mismo codec HTML v1/lista blanca que `CardInspector.tsx`) para leer,
  // validar y persistir el HTML de origen, y `richTextCodec` para conservar la lectura Markdown.
  const [bodyMode, setBodyMode] = useState<'visual' | 'html'>('visual');
  const [htmlDraft, setHtmlDraft] = useState('');
  const [htmlIssue, setHtmlIssue] = useState<string | null>(null);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const openHtml = () => {
    const source = visualDocument ? htmlCodec.serialize(visualDocument) : null;
    setHtmlDraft(source?.ok ? source.value : '');
    setHtmlIssue(null);
    setBodyMode('html');
  };
  const changeHtml = (value: string) => { setHtmlDraft(value); if (htmlIssue) setHtmlIssue(null); };
  const discardHtml = () => { setHtmlIssue(null); setBodyMode('visual'); };
  const applyHtml = () => {
    const parsed = htmlCodec.parse(htmlDraft);
    if (!parsed.ok) { setHtmlIssue(parsed.issues[0]?.message ?? 'El código HTML no es válido.'); return; }
    const encoded = htmlCodec.serialize(parsed.value);
    if (!encoded.ok) { setHtmlIssue(encoded.issues[0]?.message ?? 'No se pudo aplicar el código.'); return; }
    setHtmlAuthored(true);
    setContent(encoded.value);
    setVisualDocument(supportsVisualDocument(parsed.value) ? parsed.value : null);
    onDraftChange({ cardId: card.id, title, content: encoded.value, titleDocument,
      bodySource: { format: 'html', value: encoded.value }, bodyDocument: parsed.value, bodyValidation: { status: 'valid' } });
    setHtmlIssue(null);
    setBodyMode('visual');
  };
  // UX7-VISUAL-FINALIZATION: el título se conserva en la sesión y en el guardado, pero se edita como
  // metadato desde las propiedades del Inspector. La edición rápida dedica toda su superficie al cuerpo.
  const visualAvailable = visualDocument !== null;
  const changeVisualDocument = (document: Parameters<RichTextCodec['serialize']>[0]) => {
    const requiresHtml = document.blocks.some((block) => (block.type === 'paragraph' || block.type === 'heading') && block.alignment !== undefined);
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
  const current = useRef({ title, content });
  const saved = useRef({ title: initialDraft?.title ?? cardTitleText(card), content: initialDraft?.content ?? card.content ?? '' });
  const queued = useRef<{ title: string; content: string } | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(() => { current.current = { title, content }; }, [title, content]);

  const persist = useCallback(() => {
    const draft = { title, content };
    if (draft.title === saved.current.title && draft.content === saved.current.content) return queue.current;
    if (draft.title === queued.current?.title && draft.content === queued.current.content) return queue.current;
    setSaving(true);
    setProblem(null);
    queued.current = draft;
    const task = queue.current.then(() => onSave({ cardId: card.id, ...draft, titleDocument, ...(htmlAuthored && visualDocument ? {
      bodySource: { format: 'html' as const, value: draft.content }, bodyDocument: visualDocument, bodyValidation: { status: 'valid' as const },
    } : {}) })).then((ok) => {
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
  const advanced = () => { onAdvanced(); };
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
        {!floatingText && Platform.OS === 'web' ? (
          <Pressable
            testID="inline-toolbar-toggle"
            accessibilityRole="button"
            accessibilityLabel={t(toolsCollapsed ? 'inline.toolbar.show' : 'inline.toolbar.hide', locale)}
            accessibilityState={{ expanded: !toolsCollapsed }}
            aria-expanded={!toolsCollapsed}
            onPress={() => setToolsCollapsed((collapsed) => !collapsed)}
            style={[styles.iconButton, { borderColor: colors.border }]}
          >
            <Text accessibilityElementsHidden style={[styles.toolbarToggleText, { color: colors.headerText }]}>{toolsCollapsed ? '+' : '−'}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir el editor completo" onPress={advanced} style={[styles.iconButton, { borderColor: colors.border }]}>
          <AppIcon name="expand" size={18} color={colors.headerText} />
        </Pressable>
        <DialogCloseButton label="Guardar y cerrar la edición rápida" onPress={close} />
      </View>
      {!floatingText && Platform.OS === 'web' ? (
        <View
          testID="inline-body-mode-switch"
          style={[styles.modeRow, toolsCollapsed ? styles.toolsHidden : null]}
          accessibilityRole="toolbar"
          accessibilityLabel="Modo de edición del cuerpo"
          accessibilityElementsHidden={toolsCollapsed}
          importantForAccessibility={toolsCollapsed ? 'no-hide-descendants' : 'auto'}
        >
          <ActionButton label="Visual" accessibilityLabel="Editar el cuerpo visualmente" pressed={bodyMode === 'visual'} onPress={() => { if (bodyMode === 'html') applyHtml(); }} />
          <ActionButton label="HTML" accessibilityLabel="Editar el código HTML del cuerpo" pressed={bodyMode === 'html'} onPress={openHtml} />
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
      ) : bodyMode === 'html' ? (
        <View testID="inline-html-editor" style={styles.htmlEditor}>
          <TextField testID="inline-html-source" label="Código HTML del cuerpo" value={htmlDraft} onChangeText={changeHtml} multiline fontFamily={mono} />
          {htmlIssue ? (
            <Text testID="inline-html-error" accessibilityLiveRegion="assertive" style={[styles.modeHint, { color: colors.danger }]}>{htmlIssue}</Text>
          ) : null}
          <View style={styles.modeRow}>
            <ActionButton label="Aplicar HTML" accessibilityLabel="Validar y aplicar el código HTML" tone="primary" onPress={applyHtml} />
            <ActionButton label="Descartar" accessibilityLabel="Descartar los cambios del código HTML" onPress={discardHtml} />
          </View>
        </View>
      ) : visualDocument ? (
        <RichTextEditor cardId={card.id} document={visualDocument} codec={richTextCodec} onChange={changeVisualDocument} fontFamily={noteFontFamily} compact toolbarCollapsed={toolsCollapsed} />
      ) : (
        <View style={styles.unsupportedContent}>
          <Text style={[styles.modeHint, { color: colors.textSecondary }]}>Este contenido se edita desde Más opciones.</Text>
        </View>
      )}
      {/* UX7-CONSOLIDATION: el guardado automático correcto es silencioso (mismo criterio que el resto
          de la app desde UX7-LAYOUT-CORRECTION) — esta fila solo aparece ante un error real, nunca
          como mensaje rutinario. «Más opciones»/«Editar completo» ya vive en la cabecera (icono
          expandir); repetirlo aquí abajo desperdiciaba una fila entera para la misma acción. */}
      {problem ? (
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="assertive" style={[styles.status, { color: colors.danger }]}>{problem}</Text>
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
  toolsHidden: { display: 'none' },
  plainText: { flex: 1, minHeight: 100, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  unsupportedContent: { flex: 1, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8 },
  footer: { minHeight: 38, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 10, lineHeight: 14 },
  more: { minHeight: 30, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  moreText: { fontSize: 11, fontWeight: '800' },
});
