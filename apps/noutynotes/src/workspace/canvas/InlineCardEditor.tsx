import type { Card, CardId } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

import { AppIcon } from '../../components/AppIcon';
import { applyInlineMark, normalizeListChange } from '../markdownLists';
import type { InlineMarkKind, TextSelection } from '../markdownLists';
import type { ScreenBox } from './cardChrome';

interface InlineCardEditorProps {
  readonly card: Card;
  readonly box: ScreenBox;
  readonly onSave: (cardId: CardId, title: string, content: string) => Promise<boolean>;
  readonly onAdvanced: () => void;
  readonly onClose: () => void;
}

/** Edición breve colocada sobre la ficha; las propiedades avanzadas siguen en el editor completo. */
export function InlineCardEditor({ card, box, onSave, onAdvanced, onClose }: InlineCardEditorProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [title, setTitle] = useState(card.title ?? '');
  const [content, setContent] = useState(card.content ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // UX7-B1: misma regla de continuidad de listas que el editor completo (markdownLists.ts), sin un
  // segundo algoritmo: Enter continúa marcador/sangría, un elemento vacío termina la lista.
  const selectionRef = useRef<TextSelection>({ start: content.length, end: content.length });
  const [forcedSelection, setForcedSelection] = useState<TextSelection | undefined>();
  const changeContent = (value: string) => {
    const edit = normalizeListChange(content, value, selectionRef.current);
    setContent(edit?.text ?? value);
    if (edit) setForcedSelection({ start: edit.caret, end: edit.caret });
  };
  // UX7-B3: misma función que el editor completo (markdownLists.ts), sin un segundo algoritmo.
  const applyFormat = (kind: InlineMarkKind) => {
    const edit = applyInlineMark(content, selectionRef.current, kind);
    setContent(edit.text);
    selectionRef.current = edit.selection;
    setForcedSelection(edit.selection);
  };
  const onContentKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData & { readonly ctrlKey?: boolean; readonly metaKey?: boolean }>) => {
    const { ctrlKey, metaKey, key } = event.nativeEvent;
    if (!(ctrlKey || metaKey)) return;
    const lower = key.toLowerCase();
    if (lower === 'b') { event.preventDefault(); applyFormat('bold'); }
    else if (lower === 'i') { event.preventDefault(); applyFormat('italic'); }
  };
  const current = useRef({ title, content });
  const saved = useRef({ title: card.title ?? '', content: card.content ?? '' });
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
    const task = queue.current.then(() => onSave(card.id, draft.title, draft.content)).then((ok) => {
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
  }, [card.id, content, onSave, title]);

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
  const advanced = () => { void persist().then((ok) => { if (ok) onAdvanced(); }); };
  return (
    <View
      testID="inline-card-editor"
      accessibilityViewIsModal
      style={[styles.editor, {
        left: box.left, top: box.top, width: box.width, height: box.height,
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
      <TextInput
        testID="inline-card-title"
        accessibilityLabel="Título de la tarjeta"
        value={title}
        onChangeText={setTitle}
        onBlur={() => { void persist(); }}
        placeholder="Título"
        placeholderTextColor={colors.textSecondary}
        style={[styles.title, { color: colors.cardText, borderColor: colors.gridLine }]}
      />
      <View style={styles.formatRow} accessibilityRole="toolbar" accessibilityLabel="Formato de texto">
        <Pressable testID="inline-format-bold" accessibilityRole="button" accessibilityLabel="Negrita" onPress={() => applyFormat('bold')} style={[styles.formatButton, { borderColor: colors.border }]}>
          <Text style={[styles.formatButtonText, { color: colors.cardText, fontWeight: '900' }]}>B</Text>
        </Pressable>
        <Pressable testID="inline-format-italic" accessibilityRole="button" accessibilityLabel="Cursiva" onPress={() => applyFormat('italic')} style={[styles.formatButton, { borderColor: colors.border }]}>
          <Text style={[styles.formatButtonText, { color: colors.cardText, fontStyle: 'italic' }]}>I</Text>
        </Pressable>
      </View>
      <TextInput
        testID="inline-card-content"
        accessibilityLabel="Contenido Markdown"
        value={content}
        onChangeText={changeContent}
        {...(forcedSelection === undefined ? {} : { selection: forcedSelection })}
        onSelectionChange={(event) => {
          const next = event.nativeEvent.selection;
          selectionRef.current = next;
          if (forcedSelection && next.start === forcedSelection.start && next.end === forcedSelection.end) setForcedSelection(undefined);
        }}
        onKeyPress={onContentKeyPress}
        onBlur={() => { void persist(); }}
        placeholder="Escribe una idea…"
        placeholderTextColor={colors.textSecondary}
        multiline
        textAlignVertical="top"
        style={[styles.content, { color: colors.cardText }]}
      />
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
  formatRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingTop: 6 },
  formatButton: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  formatButtonText: { fontSize: 14 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1 },
  title: { height: 42, paddingHorizontal: 10, borderBottomWidth: 1, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  content: { flex: 1, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, lineHeight: 20 },
  footer: { minHeight: 38, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 10, lineHeight: 14 },
  more: { minHeight: 30, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  moreText: { fontSize: 11, fontWeight: '800' },
});
