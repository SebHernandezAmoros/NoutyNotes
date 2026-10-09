import type { RichTextCodec } from '@noutynotes/application';
import type { Card, CardId, RichTextDocument } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppIcon } from '../../components/AppIcon';
import { isBasicRichTextDocument, isWebRichTextDocument } from '../basicRichText';
import { RichTextEditor } from '../RichTextEditor';
import type { ScreenBox } from './cardChrome';

interface InlineCardEditorProps {
  readonly card: Card;
  readonly box: ScreenBox;
  readonly richTextCodec: RichTextCodec;
  readonly noteFontFamily?: string | undefined;
  readonly initialDraft?: { readonly title: string; readonly content: string; readonly titleDocument?: RichTextDocument } | undefined;
  readonly onDraftChange: (draft: { cardId: CardId; title: string; content: string; titleDocument?: RichTextDocument }) => void;
  readonly onSave: (cardId: CardId, title: string, content: string, titleDocument: RichTextDocument) => Promise<boolean>;
  readonly onAdvanced: () => void;
  readonly onClose: () => void;
}

/** Edición breve colocada sobre la ficha; las propiedades avanzadas siguen en el editor completo. */
export function InlineCardEditor({ card, box, richTextCodec, noteFontFamily, initialDraft, onDraftChange, onSave, onAdvanced, onClose }: InlineCardEditorProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [title, setTitle] = useState(initialDraft?.title ?? card.title ?? '');
  const [content, setContent] = useState(initialDraft?.content ?? card.content ?? '');
  const [titleDocument, setTitleDocument] = useState<RichTextDocument>(() => initialDraft?.titleDocument ?? ({
    schemaVersion: 1, blocks: [{ type: 'paragraph', content: (initialDraft?.title ?? card.title) ? [{ type: 'text', text: initialDraft?.title ?? card.title ?? '' }] : [] }],
  }));
  const floatingText = card.typeId === 'texto-flotante';
  const supportsVisualDocument = (document: Parameters<typeof isBasicRichTextDocument>[0]) => Platform.OS === 'web'
    ? isWebRichTextDocument(document) && !document.blocks.some((block) => block.type === 'image')
    : isBasicRichTextDocument(document);
  const [visualDocument, setVisualDocument] = useState<Parameters<RichTextCodec['serialize']>[0] | null>(() => {
    const parsed = richTextCodec.parse(initialDraft?.content ?? card.content ?? '');
    return parsed.ok && supportsVisualDocument(parsed.value) ? parsed.value : null;
  });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const visualAvailable = visualDocument !== null;
  const changeVisualDocument = (document: Parameters<RichTextCodec['serialize']>[0]) => {
    const encoded = richTextCodec.serialize(document);
    if (encoded.ok) {
      setVisualDocument(document);
      setContent(encoded.value);
      onDraftChange({ cardId: card.id, title, content: encoded.value, titleDocument });
    }
  };
  const current = useRef({ title, content });
  const saved = useRef({ title: initialDraft?.title ?? card.title ?? '', content: initialDraft?.content ?? card.content ?? '' });
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
    const task = queue.current.then(() => onSave(card.id, draft.title, draft.content, titleDocument)).then((ok) => {
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
  }, [card.id, content, onSave, title, titleDocument]);

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
        width: visualAvailable ? Math.max(box.width, 320) : box.width,
        height: visualAvailable ? Math.max(box.height, 300) : box.height,
        backgroundColor: colors.cardSurface, borderColor: colors.selection,
      }]}
    >
      <View style={[styles.bar, { backgroundColor: colors.headerNote, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.headerText }]}>EDICIÓN RÁPIDA</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir el editor completo" onPress={advanced} style={[styles.iconButton, { borderColor: colors.border }]}>
          <AppIcon name="expand" size={18} color={colors.headerText} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Guardar y cerrar la edición rápida" onPress={close} style={[styles.iconButton, { borderColor: colors.border }]}>
          <AppIcon name="close" size={18} color={colors.headerText} />
        </Pressable>
      </View>
      {!floatingText ? <TextInput
        testID="inline-card-title"
        accessibilityLabel="Título de la tarjeta"
        value={title}
        onChangeText={(value) => {
          const document: RichTextDocument = { schemaVersion: 1, blocks: [{ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] }] };
          setTitle(value); setTitleDocument(document); onDraftChange({ cardId: card.id, title: value, content, titleDocument: document });
        }}
        onBlur={() => { void persist(); }}
        placeholder="Título"
        placeholderTextColor={colors.textSecondary}
        style={[styles.title, { color: colors.cardText, borderColor: colors.gridLine }]}
      /> : null}
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
        <RichTextEditor cardId={card.id} document={visualDocument} codec={richTextCodec} onChange={changeVisualDocument} fontFamily={noteFontFamily} compact />
      ) : (
        <View style={styles.unsupportedContent}>
          <Text style={[styles.modeHint, { color: colors.textSecondary }]}>Este contenido se edita desde Más opciones.</Text>
        </View>
      )}
      <View style={styles.footer}>
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: problem ? colors.danger : colors.textSecondary }]}>{problem ?? (saving ? 'Guardando…' : 'Los cambios se guardan automáticamente')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir el editor completo" onPress={advanced} style={[styles.more, { borderColor: colors.border }]}>
          <Text style={[styles.moreText, { color: colors.cardText }]}>Más opciones</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { position: 'absolute', zIndex: 45, borderWidth: 3, minWidth: 240, minHeight: 180, overflow: 'hidden' },
  bar: { height: 44, borderBottomWidth: 2, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { flex: 1, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  modeHint: { fontSize: 11, lineHeight: 16 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1 },
  title: { height: 42, paddingHorizontal: 10, borderBottomWidth: 1, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  plainText: { flex: 1, minHeight: 100, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  unsupportedContent: { flex: 1, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8 },
  footer: { minHeight: 38, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 10, lineHeight: 14 },
  more: { minHeight: 30, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  moreText: { fontSize: 11, fontWeight: '800' },
});
